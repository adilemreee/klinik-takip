import XCTest
import KlinikCore
@testable import KlinikAPI

/**
 * Patient-reported outcome questionnaires (spec M18, T6.7).
 *
 * The patient's screen and the clinician's read the same data and must not say
 * the same things about it, so the two views are tested separately.
 */
final class SurveysAPITests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder.klinik.decode(type, from: Data(json.utf8))
    }

    // MARK: - The patient's side

    func testReadsAQuestionnaireWithItsQuestions() throws {
        let pending = try decode(
            [PendingSurvey].self,
            #"""
            [{"id":"a1","title":"Ameliyat sonrası kısa değerlendirme","description":null,
              "milestoneDays":7,"scheduledFor":"2026-03-09T08:00:00.000Z",
              "expiresAt":"2099-03-23T08:00:00.000Z",
              "questions":[
                {"id":"pain","text":"Ağrı","type":"SCALE_0_10","direction":"higher-is-worse",
                 "alarmAt":8,"required":true},
                {"id":"comment","text":"Not","type":"TEXT"}]}]
            """#
        )

        XCTAssertEqual(pending[0].questions.count, 2)
        XCTAssertEqual(pending[0].questions[0].direction, .higherIsWorse)
        XCTAssertTrue(pending[0].questions[0].isRequired)
        XCTAssertFalse(pending[0].questions[1].isRequired)
        XCTAssertEqual(pending[0].requiredQuestions.map(\.id), ["pain"])
    }

    /**
     * A late answer is refused by the server, so the form must not invite one:
     * asking somebody to fill in five questions and then rejecting them is
     * worse than not asking.
     */
    func testKnowsWhenAQuestionnaireHasClosed() throws {
        let open = try decode(
            PendingSurvey.self,
            #"""
            {"id":"a1","title":"T","description":null,"milestoneDays":7,
             "scheduledFor":"2026-03-09T08:00:00.000Z","expiresAt":"2099-03-23T08:00:00.000Z",
             "questions":[]}
            """#
        )
        let closed = try decode(
            PendingSurvey.self,
            #"""
            {"id":"a2","title":"T","description":null,"milestoneDays":7,
             "scheduledFor":"2020-03-09T08:00:00.000Z","expiresAt":"2020-03-23T08:00:00.000Z",
             "questions":[]}
            """#
        )

        XCTAssertTrue(open.isOpen())
        XCTAssertFalse(closed.isOpen())
        XCTAssertNotEqual(L10n.string("survey.closed"), "survey.closed")
    }

    func testAnswersEncodeInTheShapeTheirQuestionExpects() throws {
        let body = try JSONEncoder.klinik.encode([
            "pain": SurveyAnswer.scale(4),
            "slept": SurveyAnswer.yesNo(true),
            "comment": SurveyAnswer.text("iyiyim"),
        ])
        let text = String(decoding: body, as: UTF8.self)

        XCTAssertTrue(text.contains("\"pain\":4"))
        XCTAssertTrue(text.contains("\"slept\":true"))
        XCTAssertTrue(text.contains("iyiyim"))
    }

    /** The patient is told it was recorded, and nothing about what it means. */
    func testTheAnswerComesBackWithNoClinicalReading() throws {
        let result = try decode(SurveySubmitResult.self, #"{"invited":true}"#)

        XCTAssertTrue(result.invited)
        XCTAssertNotEqual(L10n.string("survey.thanks"), "survey.thanks")
    }

    // MARK: - The clinician's side

    func testDrawsNoTrendThroughASinglePoint() throws {
        let view = try decode(
            PatientSurveys.self,
            #"""
            {"template":{"code":"postop","version":1,"title":"T","questions":[]},
             "series":[{"assignmentId":"a1","milestoneDays":7,
                        "submittedAt":"2026-03-09T09:00:00.000Z","values":{"pain":5},
                        "answeredCount":5,"questionCount":5,"partial":false}],
             "latestFindings":[],"hasTrend":false}
            """#
        )

        XCTAssertFalse(view.hasTrend)
        XCTAssertEqual(view.series.count, 1)
        XCTAssertNotEqual(L10n.string("survey.noTrend"), "survey.noTrend")
    }

    func testMarksAPartialResponseSoItIsNotReadAsAFullOne() throws {
        let view = try decode(
            PatientSurveys.self,
            #"""
            {"template":{"code":"postop","version":1,"title":"T","questions":[]},
             "series":[{"assignmentId":"a1","milestoneDays":7,
                        "submittedAt":"2026-03-09T09:00:00.000Z","values":{"pain":2},
                        "answeredCount":1,"questionCount":5,"partial":true},
                       {"assignmentId":"a2","milestoneDays":30,
                        "submittedAt":"2026-04-01T09:00:00.000Z","values":{"pain":3,"sleep":8},
                        "answeredCount":5,"questionCount":5,"partial":false}],
             "latestFindings":[],"hasTrend":true}
            """#
        )

        // A single answer out of five otherwise reads as a complete assessment.
        XCTAssertTrue(view.series[0].partial)
        XCTAssertFalse(view.series[1].partial)
        XCTAssertTrue(view.hasTrend)
    }

    func testSkipsTheResponsesThatLeftAQuestionBlank() throws {
        let view = try decode(
            PatientSurveys.self,
            #"""
            {"template":{"code":"postop","version":1,"title":"T","questions":[]},
             "series":[{"assignmentId":"a1","milestoneDays":7,
                        "submittedAt":"2026-03-09T09:00:00.000Z","values":{"pain":2},
                        "answeredCount":1,"questionCount":5,"partial":true},
                       {"assignmentId":"a2","milestoneDays":30,
                        "submittedAt":"2026-04-01T09:00:00.000Z","values":{"pain":3,"sleep":8},
                        "answeredCount":5,"questionCount":5,"partial":false}],
             "latestFindings":[],"hasTrend":true}
            """#
        )

        // A gap, not a nought: the chart must not drop a point to the floor
        // because somebody skipped a question.
        XCTAssertEqual(view.points(for: "pain").map(\.value), [2, 3])
        XCTAssertEqual(view.points(for: "sleep").map(\.value), [8])
        XCTAssertEqual(view.points(for: "swelling").count, 0)
    }

    func testReadsFindingsWithTheirReason() throws {
        let view = try decode(
            PatientSurveys.self,
            #"""
            {"template":{"code":"postop","version":1,"title":"T","questions":[]},
             "series":[],
             "latestFindings":[
               {"kind":"worsened","questionId":"pain","questionText":"Ağrı","value":7,"previous":2},
               {"kind":"severe","questionId":"sleep","questionText":"Uyku","value":1}],
             "hasTrend":true}
            """#
        )

        XCTAssertTrue(view.needsAttention)
        XCTAssertEqual(view.latestFindings[0].previous, 2)
        // A severe finding stands on its own, with nothing to compare against.
        XCTAssertNil(view.latestFindings[1].previous)

        for finding in view.latestFindings {
            XCTAssertNotEqual(finding.localizedKind, "survey.finding.\(finding.kind.rawValue)")
        }
    }

    func testAQuietSeriesNeedsNoAttention() throws {
        let view = try decode(
            PatientSurveys.self,
            #"""
            {"template":{"code":"postop","version":1,"title":"T","questions":[]},
             "series":[],"latestFindings":[],"hasTrend":false}
            """#
        )

        XCTAssertFalse(view.needsAttention)
    }

    func testKnowsWhichQuestionsAChartCanPlot() throws {
        let questions = try decode(
            [SurveyQuestion].self,
            #"""
            [{"id":"pain","text":"A","type":"SCALE_0_10","direction":"higher-is-worse"},
             {"id":"slept","text":"B","type":"YES_NO"},
             {"id":"comment","text":"C","type":"TEXT"}]
            """#
        )

        XCTAssertEqual(questions.filter(\.isNumeric).map(\.id), ["pain", "slept"])
    }
}
