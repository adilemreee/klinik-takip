import Foundation
import KlinikCore

/**
 * Patient-reported outcome questionnaires (spec M18, T6.7).
 *
 * The patient's screen and the clinician's screen read the same data and must
 * not say the same things about it. A patient sees the questions and their own
 * answers; they never see a finding, because "your reported pain has worsened"
 * is a clinical reading and this is not the thing that should deliver one.
 */

public enum SurveyAnswerType: String, Decodable, Sendable, Equatable {
    case scale0to10 = "SCALE_0_10"
    case yesNo = "YES_NO"
    case text = "TEXT"
}

public enum SurveyDirection: String, Decodable, Sendable, Equatable {
    /// Pain, swelling: a higher answer is a worse one.
    case higherIsWorse = "higher-is-worse"
    /// Sleep, satisfaction.
    case higherIsBetter = "higher-is-better"
}

public struct SurveyQuestion: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let text: String
    public let type: SurveyAnswerType
    /// Which way is bad. Absent on questions that are not scales.
    public let direction: SurveyDirection?
    public let alarmAt: Int?
    public let required: Bool?

    public var isRequired: Bool { required == true }

    /// Whether a chart can plot this one.
    public var isNumeric: Bool { type == .scale0to10 || type == .yesNo }
}

public struct PendingSurvey: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let description: String?
    /// Days after the operation this one is about.
    public let milestoneDays: Int
    public let scheduledFor: Date
    /// After this it can no longer be answered.
    public let expiresAt: Date?
    public let questions: [SurveyQuestion]

    /**
     * Whether it is still open.
     *
     * A late answer is refused by the server, so the form must not invite one:
     * asking somebody to fill in five questions and then rejecting them is
     * worse than not asking.
     */
    public func isOpen(at moment: Date = Date()) -> Bool {
        guard let expiresAt else { return true }

        return expiresAt > moment
    }

    public var requiredQuestions: [SurveyQuestion] { questions.filter(\.isRequired) }
}

/// What the patient is told back. Deliberately not a reading of their answers.
public struct SurveySubmitResult: Decodable, Sendable, Equatable {
    /// True when a very satisfied patient was invited to review the clinic.
    public let invited: Bool
}

public enum SurveyFindingKind: String, Decodable, Sendable, Equatable {
    /// Worse than this patient's own previous answer, by enough to mean something.
    case worsened
    /// Past the question's own threshold, whatever the trend.
    case severe
}

public struct SurveyFinding: Decodable, Sendable, Equatable, Identifiable {
    public let kind: SurveyFindingKind
    public let questionId: String
    public let questionText: String
    public let value: Int
    /// The same question last time. Absent on a `severe` finding.
    public let previous: Int?

    public var id: String { "\(kind.rawValue)-\(questionId)" }

    public var localizedKind: String { L10n.string("survey.finding.\(kind.rawValue)") }
}

public struct SurveyPoint: Decodable, Sendable, Equatable, Identifiable {
    public let assignmentId: String
    public let milestoneDays: Int
    public let submittedAt: Date
    /// Question id to answer.
    public let values: [String: Int]
    public let answeredCount: Int
    public let questionCount: Int
    /**
     * Too little was answered for this point to sit beside a full one.
     *
     * Still drawn — the answers are real — but a chart has to mark it, or a
     * single answer out of five reads as a complete assessment.
     */
    public let partial: Bool

    public var id: String { assignmentId }
}

public struct SurveyTemplateInfo: Decodable, Sendable, Equatable {
    public let code: String
    public let version: Int
    public let title: String
    public let questions: [SurveyQuestion]
}

public struct PatientSurveys: Decodable, Sendable, Equatable {
    public let template: SurveyTemplateInfo
    /// Oldest first.
    public let series: [SurveyPoint]
    /// From the most recent response only.
    public let latestFindings: [SurveyFinding]
    /// False while there is one response: a line needs two points.
    public let hasTrend: Bool

    /// The series for one question, skipping the responses that left it blank.
    public func points(for questionId: String) -> [(point: SurveyPoint, value: Int)] {
        series.compactMap { point in
            point.values[questionId].map { (point, $0) }
        }
    }

    public var needsAttention: Bool { !latestFindings.isEmpty }
}

public struct SurveysAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    /// Questionnaires waiting for me.
    public func mine() async throws -> [PendingSurvey] {
        try await client.send(Endpoint(method: .get, path: "me/surveys"), as: [PendingSurvey].self)
    }

    /// Answers. A value that does not fit its question is refused by the server.
    public func submit(
        _ assignmentId: String,
        answers: [String: SurveyAnswer]
    ) async throws -> SurveySubmitResult {
        try await client.send(
            Endpoint(
                method: .post,
                path: "me/surveys/\(assignmentId)",
                body: try JSONEncoder.klinik.encode(SubmitBody(answers: answers))
            ),
            as: SurveySubmitResult.self
        )
    }

    public func forPatient(_ patientId: String) async throws -> PatientSurveys {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/surveys"),
            as: PatientSurveys.self
        )
    }

    private struct SubmitBody: Encodable {
        let answers: [String: SurveyAnswer]
    }
}

/// One answer, in the shape its question expects.
public enum SurveyAnswer: Encodable, Sendable, Equatable {
    case scale(Int)
    case yesNo(Bool)
    case text(String)

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch self {
        case let .scale(value): try container.encode(value)
        case let .yesNo(value): try container.encode(value)
        case let .text(value): try container.encode(value)
        }
    }
}
