import Foundation
import KlinikAPI
import KlinikCore

public enum ExportsPhase: Sendable, Equatable {
    case loading
    case loaded
    case notPermitted
    case failed(String)
}

public struct ExportsState: Sendable, Equatable {
    public var phase: ExportsPhase = .loading
    /// Newest first.
    public var requests: [ExportRequest] = []
    /// The catalogue, with what this viewer may take marked on it.
    public var columns: [ExportColumn] = []
    public var chosen: Set<String> = []
    public var format: ExportFormat = .csv
    public var busy = false
    public var error: String?

    public init() {}

    /// Grouped the way the catalogue groups them, so the picker reads as
    /// sections rather than sixty checkboxes.
    public var groupedColumns: [(group: String, columns: [ExportColumn])] {
        Dictionary(grouping: columns, by: \.group)
            .map { (group: $0.key, columns: $0.value) }
            .sorted { $0.group < $1.group }
    }

    public var hasUnfinished: Bool {
        requests.contains { $0.status == .queued || $0.status == .processing }
    }
}

/**
 * Taking data out of the clinic (spec M12).
 *
 * Every export is written to the audit log — who took what, and when — and the
 * download link is asked for separately and recorded again. That is the
 * server's doing; what this screen must not do is make any of it invisible.
 * So a finished export is not downloaded automatically: somebody presses a
 * button, and that press is the thing the log records.
 *
 * Columns come from the server marked with whether this viewer may have them.
 * A column somebody cannot export is shown and disabled rather than hidden —
 * hiding it would make an incomplete spreadsheet look like a complete one.
 */
@MainActor
public final class ExportsModel {
    private let api: ExportsAPI
    private var state = ExportsState()

    public init(api: ExportsAPI) {
        self.api = api
    }

    public func currentState() -> ExportsState { state }

    public func load() async {
        async let requests = optional { try await api.mine() }
        async let columns = optional { try await api.columns() }

        let loaded = await (requests, columns)

        state.requests = (loaded.0 ?? []).sorted { $0.createdAt > $1.createdAt }
        state.columns = loaded.1 ?? []

        if state.chosen.isEmpty {
            // A first visit starts with everything the viewer may take, which
            // is the common case; unticking is faster than ticking forty boxes.
            state.chosen = Set(state.columns.filter(\.available).map(\.key))
        }

        state.phase = loaded.0 == nil && loaded.1 == nil ? .notPermitted : .loaded
    }

    public func toggle(_ key: String) {
        if state.chosen.contains(key) {
            state.chosen.remove(key)
        } else {
            state.chosen.insert(key)
        }
    }

    public func choose(format: ExportFormat) {
        state.format = format
    }

    public func requestPatientList(from: Date?, to: Date?, country: String?) async {
        state.busy = true
        state.error = nil

        defer { state.busy = false }

        do {
            let request = try await api.requestPatientList(
                format: state.format,
                columns: Array(state.chosen).sorted(),
                from: from,
                to: to,
                country: country?.isEmpty == true ? nil : country
            )

            state.requests.insert(request, at: 0)
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }
    }

    /// Refreshes only the ones still working. A finished export never changes,
    /// and re-reading forty of them every three seconds is a battery complaint.
    public func refreshUnfinished() async {
        for request in state.requests where request.status == .queued || request.status == .processing {
            guard let updated = try? await api.status(request.id) else { continue }

            if let index = state.requests.firstIndex(where: { $0.id == request.id }) {
                state.requests[index] = updated
            }
        }
    }

    /// The signed link. Asking for one is itself recorded, which is why it
    /// happens on a press rather than as soon as the file is ready.
    public func download(_ id: String) async -> URL? {
        state.error = nil

        do {
            let link = try await api.download(id)

            return URL(string: link.url)
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }

        return nil
    }

    private func optional<T: Sendable>(_ work: @Sendable () async throws -> T) async -> T? {
        try? await work()
    }
}
