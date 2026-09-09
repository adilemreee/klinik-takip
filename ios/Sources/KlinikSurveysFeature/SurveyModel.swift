import Foundation
import KlinikAPI
import KlinikCore

public enum SurveyPhase: Sendable, Equatable {
    case loading
    case loaded
    /// Nothing to fill in. Not a failure.
    case none
    case failed(String)
}

public struct SurveyState: Sendable, Equatable {
    public var phase: SurveyPhase = .loading
    public var surveys: [PendingSurvey] = []
    /// Answers for the survey on screen, keyed by question.
    public var answers: [String: SurveyAnswer] = [:]
    public var submitting = false
    public var submitted = false
    /// The answers were kept on the phone rather than delivered (spec M15).
    public var queued = false
    public var error: String?

    public init() {}

    /// The one being answered: the earliest still open.
    public var current: PendingSurvey? {
        surveys.first { $0.isOpen() }
    }

    /// Whether every required question has an answer.
    public var canSubmit: Bool {
        guard let current else { return false }

        return current.questions
            .filter(\.isRequired)
            .allSatisfy { answers[$0.id] != nil }
    }
}

/**
 * The short surveys a patient fills in after surgery (spec M18).
 *
 * Answers are held until the whole form is sent. A survey saved question by
 * question would leave half-answered forms in the record that read as a patient
 * reporting nothing about the other half — and a pain score of "nothing" is a
 * clinical statement, not an absence.
 *
 * A closed survey is shown as closed rather than hidden. Somebody who opens the
 * app a week after the reminder should be told they missed it, not left
 * wondering whether the app forgot.
 */
@MainActor
public final class SurveyModel {
    private let api: SurveysAPI
    private var state = SurveyState()

    public init(api: SurveysAPI) {
        self.api = api
    }

    public func currentState() -> SurveyState { state }

    public func load() async {
        do {
            state.surveys = try await api.mine()
                .sorted { $0.scheduledFor < $1.scheduledFor }
            state.phase = state.surveys.isEmpty ? .none : .loaded
            state.answers = [:]
            state.submitted = false
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    public func answer(_ questionId: String, _ answer: SurveyAnswer) {
        state.answers[questionId] = answer
    }

    public func submit() async {
        guard let survey = state.current, state.canSubmit else { return }

        state.submitting = true
        state.error = nil

        defer { state.submitting = false }

        do {
            _ = try await api.submit(survey.id, answers: state.answers)

            state.surveys.removeAll { $0.id == survey.id }
            state.answers = [:]
            state.submitted = true
            state.queued = false
            state.phase = state.surveys.contains { $0.isOpen() } ? .loaded : .none
        } catch APIError.queuedForLater {
            // Ten minutes of somebody's attention, kept. The questionnaire
            // leaves the list exactly as it would have: it is answered, and
            // what is outstanding is the delivery, not the answering.
            state.surveys.removeAll { $0.id == survey.id }
            state.answers = [:]
            state.submitted = true
            state.queued = true
            state.error = nil
            state.phase = state.surveys.contains { $0.isOpen() } ? .loaded : .none
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }
    }
}

// MARK: - Staff side

public enum SurveyTrendPhase: Sendable, Equatable {
    case loading
    case loaded(PatientSurveys)
    case empty
    case failed(String)
}

/// One patient's answers over time, for the clinician (spec M18).
@MainActor
public final class SurveyTrendModel {
    private let api: SurveysAPI
    private let patientId: String

    private var phase: SurveyTrendPhase = .loading

    public init(api: SurveysAPI, patientId: String) {
        self.api = api
        self.patientId = patientId
    }

    public func currentPhase() -> SurveyTrendPhase { phase }

    public func load() async {
        do {
            let surveys = try await api.forPatient(patientId)
            phase = surveys.series.isEmpty ? .empty : .loaded(surveys)
        } catch let error as APIError {
            phase = .failed(L10n.message(for: error))
        } catch {
            phase = .failed(L10n.string("error.server"))
        }
    }
}
