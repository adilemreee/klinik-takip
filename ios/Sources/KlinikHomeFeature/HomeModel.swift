import Foundation
import KlinikAPI
import KlinikCore

/// The five things a patient can do from the home screen (spec section 7).
///
/// Fixed and exhaustive: the limit is the point. A sixth action would be a
/// decision to make the screen harder for the people least able to absorb it.
public enum HomeAction: String, Sendable, CaseIterable, Identifiable {
    case messages
    case uploadDocument
    case medications
    case addPhoto
    case emergency

    public var id: String { rawValue }

    /// Icon names come from the shared token file, so both clients show the
    /// same symbol for the same action.
    public var iconName: String {
        switch self {
        case .messages: return "bubble.left.and.bubble.right"
        case .uploadDocument: return "doc.badge.plus"
        case .medications: return "pills"
        case .addPhoto: return "camera"
        case .emergency: return "exclamationmark.triangle.fill"
        }
    }

    public var titleKey: String {
        switch self {
        case .messages: return "home.action.messages"
        case .uploadDocument: return "home.action.uploadDocument"
        case .medications: return "home.action.medications"
        case .addPhoto: return "home.action.addPhoto"
        case .emergency: return "home.action.emergency"
        }
    }
}

public enum HomePhase: Sendable, Equatable {
    case loading
    case loaded(PatientHomeSummary)
    /// The account exists but is not linked to a patient file.
    case noPatientFile
    case failed(String)
}

public struct HomeState: Sendable, Equatable {
    public var phase: HomePhase = .loading
    /// Counts shown on the action tiles. Absent means no badge, which is
    /// different from zero — a zero badge is noise.
    public var badges: [String: Int] = [:]

    public init() {}
}

public actor HomeModel {
    private let api: MeAPI

    private(set) public var state = HomeState()

    public init(api: MeAPI) {
        self.api = api
    }

    public func currentState() -> HomeState { state }

    public func load() async {
        state.phase = .loading

        do {
            let summary = try await api.summary()
            state.phase = .loaded(summary)
            state.badges = Self.badges(for: summary)
        } catch let error as APIError {
            if case .notFound = error {
                // Not an error to retry: the account simply has no file yet.
                // The screen explains rather than offering a retry button.
                state.phase = .noPatientFile
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
            state.badges = [:]
        } catch {
            state.phase = .failed(L10n.string("error.server"))
            state.badges = [:]
        }
    }

    /// Only non-zero counts become badges: a tile reading "0" tells the reader
    /// nothing and competes for attention with the ones that matter.
    static func badges(for summary: PatientHomeSummary) -> [String: Int] {
        var badges: [String: Int] = [:]

        if summary.unreadMessages > 0 {
            badges[HomeAction.messages.rawValue] = summary.unreadMessages
        }
        if summary.medicationsDueToday > 0 {
            badges[HomeAction.medications.rawValue] = summary.medicationsDueToday
        }
        if summary.missingDocuments > 0 {
            badges[HomeAction.uploadDocument.rawValue] = summary.missingDocuments
        }

        return badges
    }
}
