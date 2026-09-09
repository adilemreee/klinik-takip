import Foundation
import KlinikAPI
import KlinikCore

public enum FinancePhase: Sendable, Equatable {
    case loading
    case loaded
    case notPermitted
    case failed(String)
}

public struct FinanceState: Sendable, Equatable {
    public var phase: FinancePhase = .loading
    public var currency: Currency = .turkishLira
    /// Nil means "everything"; the picker's first option.
    public var status: PaymentStatus?

    public var records: [FinanceRecord] = []
    public var nextCursor: String?
    public var outstanding: OutstandingReport?
    public var collections: CollectionReport?

    public var busyId: String?
    public var error: String?

    public init() {}

    public var hasMore: Bool { nextCursor != nil }
}

/**
 * What has been billed and what has been paid (spec M11).
 *
 * Three reads: the ledger, what is still owed with its ageing, and what came in
 * this month. Together they answer the two questions a clinic asks of a finance
 * screen — who owes us, and did the money arrive — and neither is answerable
 * from the record list alone.
 *
 * Nothing here computes money. Every figure is a string the server produced
 * from a decimal, and the client renders it. Arithmetic in the client would be
 * arithmetic in a second place, and the two would eventually disagree in front
 * of a patient.
 */
@MainActor
public final class FinanceModel {
    private let api: FinanceAPI
    private var state = FinanceState()

    public init(api: FinanceAPI) {
        self.api = api
    }

    public func currentState() -> FinanceState { state }

    public func load() async {
        async let page = optional {
            try await api.records(status: self.state.status, currency: self.state.currency)
        }
        async let outstanding = optional { try await api.outstanding(currency: self.state.currency) }
        async let collections = optional { try await self.thisMonthsCollections() }

        let loaded = await (page, outstanding, collections)

        state.records = loaded.0?.items ?? []
        state.nextCursor = loaded.0?.nextCursor
        state.outstanding = loaded.1
        state.collections = loaded.2

        state.phase = loaded.0 == nil && loaded.1 == nil && loaded.2 == nil
            ? .notPermitted
            : .loaded
    }

    public func loadMore() async {
        guard let cursor = state.nextCursor else { return }

        guard
            let page = try? await api.records(
                status: state.status,
                currency: state.currency,
                cursor: cursor
            )
        else { return }

        state.records += page.items
        state.nextCursor = page.nextCursor
    }

    public func choose(currency: Currency) async {
        state.currency = currency
        state.phase = .loading
        await load()
    }

    public func choose(status: PaymentStatus?) async {
        state.status = status
        state.phase = .loading
        await load()
    }

    /// Records a payment against one invoice and replaces that row with what
    /// the server returned — never with a locally adjusted balance.
    public func pay(
        recordId: String,
        amount: String,
        method: PaymentMethod,
        reference: String?
    ) async -> Bool {
        state.busyId = recordId
        state.error = nil

        defer { state.busyId = nil }

        do {
            let updated = try await api.recordPayment(
                recordId: recordId,
                amount: amount,
                method: method,
                reference: reference
            )

            if let index = state.records.firstIndex(where: { $0.id == recordId }) {
                state.records[index] = updated
            }

            // The ageing and the month's takings both moved.
            state.outstanding = try? await api.outstanding(currency: state.currency)
            state.collections = try? await thisMonthsCollections()

            return true
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }

        return false
    }

    /**
     * Reverses a payment (spec M11).
     *
     * The row stays and stops counting — the server's design, and the right
     * one: a payment that was entered and undone is part of what happened, and
     * a ledger that forgets its corrections is a ledger nobody can audit. The
     * reason is required for the same reason.
     */
    public func reverse(paymentId: String, reason: String) async -> Bool {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmed.isEmpty else {
            state.error = L10n.string("finance.reverseNeedsReason")
            return false
        }

        state.busyId = paymentId
        state.error = nil

        defer { state.busyId = nil }

        do {
            let updated = try await api.reversePayment(paymentId, reason: trimmed)

            if let index = state.records.firstIndex(where: { $0.id == updated.id }) {
                state.records[index] = updated
            }

            state.outstanding = try? await api.outstanding(currency: state.currency)
            state.collections = try? await thisMonthsCollections()

            return true
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }

        return false
    }

    private func thisMonthsCollections() async throws -> CollectionReport {
        let calendar = Calendar.current
        let now = Date()
        let start = calendar.date(from: calendar.dateComponents([.year, .month], from: now)) ?? now

        return try await api.collections(from: start, to: now, currency: state.currency)
    }

    private func optional<T: Sendable>(_ work: @Sendable () async throws -> T) async -> T? {
        try? await work()
    }
}

public extension Amount {
    /// A figure with its symbol. Formatting only — the value is the server's.
    func display(_ currency: Currency) -> String {
        "\(currency.symbol)\(text)"
    }
}
