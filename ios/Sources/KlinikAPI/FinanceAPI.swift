import Foundation
import KlinikCore

/**
 * The finance desk (spec M11, T6.3).
 *
 * Amounts arrive as strings and stay `Decimal` on this side. `Double` would
 * lose them: a bill of `4500.10` is not representable in binary floating point,
 * and a screen that adds a column of them will eventually disagree with the
 * server by a kuruş — which is the one kind of disagreement a finance desk
 * cannot ignore.
 */

public enum Currency: String, Decodable, Sendable, Equatable, CaseIterable {
    case turkishLira = "TRY"
    case euro = "EUR"
    case usDollar = "USD"
    case sterling = "GBP"

    /// ₺, €, $, £ — what belongs next to the figure.
    public var symbol: String {
        switch self {
        case .turkishLira: "₺"
        case .euro: "€"
        case .usDollar: "$"
        case .sterling: "£"
        }
    }
}

public enum PaymentStatus: String, Decodable, Sendable, Equatable, CaseIterable {
    case pending = "PENDING"
    case partial = "PARTIAL"
    case paid = "PAID"
    case refunded = "REFUNDED"
    case cancelled = "CANCELLED"

    public var localizedName: String { L10n.string("finance.status.\(rawValue)") }

    /// Whether the clinic is still waiting for money.
    public var isOutstanding: Bool { self == .pending || self == .partial }
}

public enum PaymentMethod: String, Decodable, Sendable, Equatable, CaseIterable {
    case cash = "CASH"
    case card = "CARD"
    case bankTransfer = "BANK_TRANSFER"
    case online = "ONLINE"
    case other = "OTHER"

    public var localizedName: String { L10n.string("finance.method.\(rawValue)") }
}

public enum PaymentKind: String, Decodable, Sendable, Equatable {
    case payment = "PAYMENT"
    case refund = "REFUND"
}

/**
 * An amount as it came off the wire.
 *
 * Kept as the original string as well as a `Decimal`, so a figure is displayed
 * exactly as the server stated it rather than re-formatted through a type that
 * might round it.
 */
public struct Amount: Decodable, Sendable, Equatable {
    public let text: String
    public let value: Decimal

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        text = try container.decode(String.self)

        guard let decimal = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Not an amount: \(text)"
            )
        }

        value = decimal
    }

    public init(_ text: String) {
        self.text = text
        value = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")) ?? .zero
    }

    public var isZero: Bool { value == .zero }
    public var isNegative: Bool { value < .zero }

    public func formatted(_ currency: Currency, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        formatter.locale = locale

        let number = formatter.string(from: value as NSDecimalNumber) ?? text
        return "\(number) \(currency.symbol)"
    }
}

public struct FinancePatient: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let mrn: String
    public let firstName: String
    public let lastName: String
    public let country: String

    public var fullName: String { "\(firstName) \(lastName)" }
}

public struct PaymentEntry: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: PaymentKind
    public let amount: Amount
    public let currency: Currency
    /// The same money in the bill's currency.
    public let appliedAmount: Amount
    public let rate: String?
    public let method: PaymentMethod
    public let paidAt: Date
    public let reference: String?
    public let note: String?
    /// A correction. The row stays; it stops counting.
    public let reversedAt: Date?
    public let reversalReason: String?

    public var isReversed: Bool { reversedAt != nil }
}

public struct FinanceRecord: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let patientId: String
    /// Name, file number and country. Nothing clinical.
    public let patient: FinancePatient?
    public let procedureName: String
    public let currency: Currency
    public let grossAmount: Amount
    public let discount: Amount
    public let netAmount: Amount
    public let paidAmount: Amount
    public let refundedAmount: Amount
    /// Still owed. Negative when the patient has overpaid.
    public let balance: Amount
    public let paymentStatus: PaymentStatus
    public let paidAt: Date?
    public let cancelledAt: Date?
    public let agencyId: String?
    public let agencyName: String?
    public let agencyCommission: Amount?
    public let note: String?
    public let payments: [PaymentEntry]
    public let createdAt: Date

    /// Payments that still count, in the order they arrived.
    public var livePayments: [PaymentEntry] { payments.filter { !$0.isReversed } }

    public var isOverpaid: Bool { balance.isNegative }
}

/**
 * A total, and how much of one it is.
 *
 * `unconverted` is the field a screen must not skip. An amount with no exchange
 * rate for its day is reported in its own currency rather than dropped, so a
 * total that reads "128.400 ₺" while two thousand pounds sit outside it says
 * so.
 */
public struct Totals: Decodable, Sendable, Equatable {
    public struct Entry: Decodable, Sendable, Equatable {
        public let currency: Currency
        public let amount: Amount
    }

    public let currency: Currency
    public let converted: Amount
    /// Every currency present, converted or not.
    public let byCurrency: [Entry]
    /// What had no rate for its day. Non-empty means `converted` is partial.
    public let unconverted: [Entry]
    public let complete: Bool

    /// Whether the headline figure is the whole answer.
    public var isWholeAnswer: Bool { complete }
}

public struct CollectionReport: Decodable, Sendable, Equatable {
    public let from: Date
    public let to: Date
    public let currency: Currency
    public let received: Totals
    public let refunded: Totals
    /// Received less refunded.
    public let net: Totals
    public let byMethod: [MethodTotals]
    public let paymentCount: Int

    public struct MethodTotals: Decodable, Sendable, Equatable {
        public let method: PaymentMethod
        public let totals: Totals
    }
}

public struct OutstandingReport: Decodable, Sendable, Equatable {
    public let currency: Currency
    public let outstanding: Totals
    public let ageing: [Bucket]
    public let recordCount: Int

    public struct Bucket: Decodable, Sendable, Equatable, Identifiable {
        public let bucket: String
        public let totals: Totals
        public let recordCount: Int

        public var id: String { bucket }
        public var localizedName: String { L10n.string("finance.ageing.\(bucket)") }
    }
}

public struct FinanceRecordPage: Decodable, Sendable, Equatable {
    public let items: [FinanceRecord]
    public let nextCursor: String?
}

public struct FinanceAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func records(
        status: PaymentStatus? = nil,
        currency: Currency? = nil,
        cursor: String? = nil
    ) async throws -> FinanceRecordPage {
        var query: [String: String] = [:]
        query["status"] = status?.rawValue
        query["currency"] = currency?.rawValue
        query["cursor"] = cursor

        return try await client.send(
            Endpoint(method: .get, path: "finance/records", query: query),
            as: FinanceRecordPage.self
        )
    }

    public func record(_ id: String) async throws -> FinanceRecord {
        try await client.send(
            Endpoint(method: .get, path: "finance/records/\(id)"),
            as: FinanceRecord.self
        )
    }

    public func forPatient(_ patientId: String) async throws -> [FinanceRecord] {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/finance"),
            as: [FinanceRecord].self
        )
    }

    /// Recording money that arrived. Amounts go up as strings too.
    public func recordPayment(
        recordId: String,
        amount: String,
        method: PaymentMethod,
        currency: Currency? = nil,
        appliedAmount: String? = nil,
        paidAt: Date? = nil,
        reference: String? = nil
    ) async throws -> FinanceRecord {
        try await client.send(
            Endpoint(
                method: .post,
                path: "finance/records/\(recordId)/payments",
                body: try JSONEncoder.klinik.encode(
                    PaymentBody(
                        amount: amount,
                        currency: currency?.rawValue,
                        appliedAmount: appliedAmount,
                        method: method.rawValue,
                        paidAt: paidAt,
                        reference: reference
                    )
                )
            ),
            as: FinanceRecord.self
        )
    }

    public func reversePayment(_ paymentId: String, reason: String) async throws -> FinanceRecord {
        try await client.send(
            Endpoint(
                method: .post,
                path: "finance/payments/\(paymentId)/reverse",
                body: try JSONEncoder.klinik.encode(ReasonBody(reason: reason))
            ),
            as: FinanceRecord.self
        )
    }

    public func collections(
        from: Date,
        to: Date,
        currency: Currency = .turkishLira
    ) async throws -> CollectionReport {
        try await client.send(
            Endpoint(
                method: .get,
                path: "finance/collections",
                query: [
                    "from": ISO8601DateFormatter().string(from: from),
                    "to": ISO8601DateFormatter().string(from: to),
                    "currency": currency.rawValue,
                ]
            ),
            as: CollectionReport.self
        )
    }

    public func outstanding(currency: Currency = .turkishLira) async throws -> OutstandingReport {
        try await client.send(
            Endpoint(
                method: .get,
                path: "finance/outstanding",
                query: ["currency": currency.rawValue]
            ),
            as: OutstandingReport.self
        )
    }

    private struct PaymentBody: Encodable {
        let amount: String
        let currency: String?
        let appliedAmount: String?
        let method: String
        let paidAt: Date?
        let reference: String?
    }

    private struct ReasonBody: Encodable {
        let reason: String
    }
}
