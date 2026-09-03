import XCTest
import KlinikCore
@testable import KlinikAPI

/**
 * The clinic dashboard (spec M11, T6.4).
 *
 * These tests are almost all about one thing: a missing proportion must never
 * reach the screen as a number. "Not enough data" and "nought per cent" are
 * different statements, and only one of them is true.
 */
final class AnalyticsAPITests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder.klinik.decode(type, from: Data(json.utf8))
    }

    func testAMissingProportionIsNeverRenderedAsZero() {
        let unknown = Proportion(nil)

        XCTAssertFalse(unknown.isKnown)
        XCTAssertNotEqual(unknown.formatted(), "0%")
        XCTAssertEqual(unknown.formatted(), L10n.string("analytics.tooFew"))
    }

    func testAKnownProportionIsAPercentage() {
        XCTAssertEqual(Proportion(0.4).formatted(), "40%")
        XCTAssertEqual(Proportion(0).formatted(), "0%")
    }

    func testReadsProceduresWithTheQuietMonthsStillInThem() throws {
        let report = try decode(
            ProcedureReport.self,
            #"""
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-04-30T00:00:00.000Z","total":3,
             "byMonth":[{"month":"2026-01","count":0},{"month":"2026-02","count":2},
                        {"month":"2026-03","count":0},{"month":"2026-04","count":1}],
             "byProcedure":[{"label":"Rinoplasti","count":2,"share":null}]}
            """#
        )

        XCTAssertEqual(report.byMonth.count, 4)
        XCTAssertEqual(report.busiestMonth?.month, "2026-02")
        // Two of three is not "67%" worth stating.
        XCTAssertFalse(report.byProcedure[0].proportion.isKnown)
    }

    func testGeographyKeepsThePatientsWithNoCity() throws {
        let report = try decode(
            GeographyReport.self,
            #"""
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-12-31T00:00:00.000Z","total":10,
             "byCountry":[{"label":"DE","count":6,"share":0.6},{"label":"GB","count":4,"share":0.4}],
             "byCity":[{"label":"Berlin","count":5,"share":0.5}],
             "cityUnknown":5}
            """#
        )

        XCTAssertEqual(report.cityUnknown, 5)
        XCTAssertEqual(report.byCountry[0].proportion.formatted(), "60%")
    }

    /**
     * The one that matters most on this screen: an empty revenue column is not
     * evidence that a channel earned nothing.
     */
    func testSaysWhyTheRevenueColumnIsEmpty() throws {
        let withheld = try decode(
            ChannelReport.self,
            #"""
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-12-31T00:00:00.000Z","total":40,
             "channels":[{"label":"Instagram","key":"instagram","patients":30,"converted":9,
                          "conversionRate":0.3}],
             "revenueWithheld":true,
             "conversionDefinition":"A patient counted as converted has at least one recorded operation.",
             "minimumForRate":5}
            """#
        )

        XCTAssertNil(withheld.channels[0].revenue)
        XCTAssertNotNil(withheld.revenueNotice)
        XCTAssertEqual(withheld.channels[0].conversion.formatted(), "30%")
    }

    func testCarriesTheDefinitionOfConversion() throws {
        let report = try decode(
            ChannelReport.self,
            #"""
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-12-31T00:00:00.000Z","total":3,
             "channels":[{"label":"Google","key":"google","patients":3,"converted":3,
                          "conversionRate":null}],
             "revenueWithheld":false,
             "conversionDefinition":"A patient counted as converted has at least one recorded operation.",
             "minimumForRate":5}
            """#
        )

        // Three of three is not a hundred per cent conversion rate.
        XCTAssertFalse(report.channels[0].conversion.isKnown)
        XCTAssertNil(report.revenueNotice)
        XCTAssertFalse(report.conversionDefinition.isEmpty)
    }

    func testRevenueSaysWhenTheMarginIsMissingSomething() throws {
        let report = try decode(
            RevenueReport.self,
            #"""
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-12-31T00:00:00.000Z","currency":"TRY",
             "gross":{"currency":"TRY","converted":"100000.00","byCurrency":[],"unconverted":[],"complete":true},
             "discount":{"currency":"TRY","converted":"0.00","byCurrency":[],"unconverted":[],"complete":true},
             "net":{"currency":"TRY","converted":"100000.00","byCurrency":[],"unconverted":[],"complete":true},
             "cost":{"currency":"TRY","converted":"40000.00","byCurrency":[],"unconverted":[],"complete":true},
             "agencyCommission":{"currency":"TRY","converted":"10000.00","byCurrency":[],"unconverted":[],"complete":true},
             "margin":{"currency":"TRY","converted":"50000.00","byCurrency":[],"unconverted":[],"complete":true},
             "byMonth":[{"month":"2026-01","net":"100000.00","converted":true}],
             "averageByCurrency":[{"currency":"EUR","average":"4000.00","count":12}],
             "recordCount":12,"cancelledExcluded":1,"unreadableCostLines":3}
            """#
        )

        XCTAssertFalse(report.marginIsWhole)
        XCTAssertTrue(report.caveats.contains(L10n.string("analytics.costLinesUnread")))
        XCTAssertEqual(report.averageByCurrency[0].amount.value, Decimal(string: "4000.00"))
    }

    func testRevenueIsWholeWhenNothingIsMissing() throws {
        let report = try decode(
            RevenueReport.self,
            #"""
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-12-31T00:00:00.000Z","currency":"TRY",
             "gross":{"currency":"TRY","converted":"100.00","byCurrency":[],"unconverted":[],"complete":true},
             "discount":{"currency":"TRY","converted":"0.00","byCurrency":[],"unconverted":[],"complete":true},
             "net":{"currency":"TRY","converted":"100.00","byCurrency":[],"unconverted":[],"complete":true},
             "cost":{"currency":"TRY","converted":"0.00","byCurrency":[],"unconverted":[],"complete":true},
             "agencyCommission":{"currency":"TRY","converted":"0.00","byCurrency":[],"unconverted":[],"complete":true},
             "margin":{"currency":"TRY","converted":"100.00","byCurrency":[],"unconverted":[],"complete":true},
             "byMonth":[{"month":"2026-01","net":"100.00","converted":true}],
             "averageByCurrency":[],"recordCount":1,"cancelledExcluded":0,"unreadableCostLines":0}
            """#
        )

        XCTAssertTrue(report.marginIsWhole)
        XCTAssertTrue(report.caveats.isEmpty)
    }

    func testAMonthThatCouldNotConvertIsMarked() throws {
        let month = try decode(
            MonthlyNet.self,
            #"{"month":"2026-02","net":"0.00","converted":false}"#
        )

        // So a chart can mark it rather than draw a dip that never happened.
        XCTAssertFalse(month.converted)
    }

    func testOccupancySaysWhenThereIsNoDenominator() throws {
        let report = try decode(
            OccupancyReport.self,
            #"""
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-01-31T00:00:00.000Z",
             "byMonth":[{"month":"2026-01","bookedMinutes":600,"availableMinutes":0,
                         "rate":null,"appointments":8}],
             "capacityUnconfigured":true}
            """#
        )

        // Nought per cent would read as an empty diary. This is a missing
        // setting, which is a different thing to tell somebody.
        XCTAssertFalse(report.byMonth[0].occupancy.isKnown)
        XCTAssertNotNil(report.notice)
        XCTAssertEqual(report.byMonth[0].bookedMinutes, 600)
    }

    func testOccupancyHasARateOnceHoursAreConfigured() throws {
        let report = try decode(
            OccupancyReport.self,
            #"""
            {"from":"2026-01-01T00:00:00.000Z","to":"2026-01-31T00:00:00.000Z",
             "byMonth":[{"month":"2026-01","bookedMinutes":240,"availableMinutes":480,
                         "rate":0.5,"appointments":4}],
             "capacityUnconfigured":false}
            """#
        )

        XCTAssertEqual(report.byMonth[0].occupancy.formatted(), "50%")
        XCTAssertNil(report.notice)
    }

    func testEveryDashboardStringExists() {
        for key in [
            "analytics.tooFew",
            "analytics.revenueWithheld",
            "analytics.capacityUnconfigured",
            "analytics.costLinesUnread",
        ] {
            XCTAssertNotEqual(L10n.string(key), key)
            XCTAssertFalse(L10n.string(key).isEmpty)
        }
    }
}
