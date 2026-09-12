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

    /// One patient's exports, or the clinic-wide lists that belong to nobody.
    public struct Group: Sendable, Equatable, Identifiable {
        /// Nil for patient lists: those are about the clinic, not a person.
        public let patientName: String?
        public let mrn: String?
        public let requests: [ExportRequest]

        public var id: String { mrn ?? patientName ?? "" }
    }

    /**
     * The history, grouped by whose it is.
     *
     * A flat list of twenty exports is twenty status badges and twenty
     * timestamps, and finding the summary made for one patient means reading
     * all of them. Grouped, the name is read once and the rows under it are
     * short.
     *
     * Patient lists come last: they are a different kind of thing, and a
     * coordinator scanning for a person's file should not have to pass them.
     */
    public var grouped: [Group] {
        let byPatient = Dictionary(grouping: requests.filter { $0.patientName != nil }) {
            $0.patientName ?? ""
        }

        let people = byPatient
            .map { name, rows in
                Group(patientName: name, mrn: rows.first?.mrn, requests: rows)
            }
            // By the newest export in each group, so the file somebody just
            // worked on is at the top.
            .sorted { ($0.requests.first?.createdAt ?? .distantPast) > ($1.requests.first?.createdAt ?? .distantPast) }

        let lists = requests.filter { $0.patientName == nil }

        return people + (lists.isEmpty ? [] : [Group(patientName: nil, mrn: nil, requests: lists)])
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

    /**
     * Set when the screen belongs to one patient's file.
     *
     * The summary a coordinator asks for from a record used to land in a
     * clinic-wide pile at the bottom of another screen. Scoped, the same list
     * answers "what have I taken out of *this* file", which is the question
     * somebody standing in the record is asking.
     */
    private let patientId: String?

    private var state = ExportsState()

    public init(api: ExportsAPI, patientId: String? = nil) {
        self.api = api
        self.patientId = patientId
    }

    /// Whether this is one patient's history rather than the clinic's.
    public var isScopedToPatient: Bool { patientId != nil }

    public func currentState() -> ExportsState { state }

    public func load() async {
        async let requests = attempt { try await self.api.mine(patientId: self.patientId) }
        // The column catalogue drives the patient-list picker, which a
        // patient's own page does not show. Asking for it there would be a
        // request for something nothing on screen uses.
        async let columns = attempt {
            self.patientId == nil ? try await self.api.columns() : []
        }

        let loaded = await (requests, columns)

        state.requests = (loaded.0.value ?? []).sorted { $0.createdAt > $1.createdAt }
        state.columns = loaded.1.value ?? []

        if state.chosen.isEmpty {
            // A first visit starts with everything the viewer may take, which
            // is the common case; unticking is faster than ticking forty boxes.
            state.chosen = Set(state.columns.filter(\.available).map(\.key))
        }

        // A refusal is a refusal; anything else is a failure worth retrying,
        // and worth naming rather than blaming the reader's permissions.
        if let requestError = loaded.0.error, loaded.1.error != nil {
            switch ReadOutcome.of([requestError, loaded.1.error].compactMap { $0 }) {
            case .refused: state.phase = .notPermitted
            case .failed(let message): state.phase = .failed(message)
            }
        } else {
            state.phase = .loaded
        }
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

}
