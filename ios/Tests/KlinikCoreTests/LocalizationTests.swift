import XCTest
@testable import KlinikCore

/// Reads the catalogues from disk rather than through the bundle, so a missing
/// translation is caught as a fact about the files instead of depending on
/// which language the test machine happens to run in.
final class LocalizationTests: XCTestCase {
    private struct Catalogue {
        let language: String
        let entries: [String: String]
    }

    private func loadCatalogues() throws -> [Catalogue] {
        // Tests/KlinikCoreTests/… -> ios/Sources/KlinikCore/Resources
        let resources = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/KlinikCore/Resources")

        return try ["tr", "en"].map { language in
            let url = resources
                .appendingPathComponent("\(language).lproj")
                .appendingPathComponent("Localizable.strings")
            let text = try String(contentsOf: url, encoding: .utf8)

            var entries: [String: String] = [:]
            for line in text.split(separator: "\n") {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                guard trimmed.hasPrefix("\"") else { continue }

                let parts = trimmed.components(separatedBy: "\" = \"")
                guard parts.count == 2 else { continue }

                let key = String(parts[0].dropFirst())
                let value = String(parts[1].dropLast(2))
                entries[key] = value
            }

            return Catalogue(language: language, entries: entries)
        }
    }

    /// The invariant that matters: a key present in one language and missing in
    /// the other means English text appearing mid-sentence in a Turkish screen,
    /// or the raw key showing to a patient.
    func testEveryLanguageDefinesTheSameKeys() throws {
        let catalogues = try loadCatalogues()
        let turkish = Set(catalogues[0].entries.keys)
        let english = Set(catalogues[1].entries.keys)

        XCTAssertEqual(
            turkish.symmetricDifference(english),
            [],
            "Keys differ between languages: \(turkish.symmetricDifference(english).sorted())"
        )
    }

    func testNoValueIsEmpty() throws {
        for catalogue in try loadCatalogues() {
            for (key, value) in catalogue.entries {
                XCTAssertFalse(
                    value.trimmingCharacters(in: .whitespaces).isEmpty,
                    "\(catalogue.language): \(key) is empty"
                )
            }
        }
    }

    func testNoTranslationIsLeftAsItsOwnKey() throws {
        for catalogue in try loadCatalogues() {
            for (key, value) in catalogue.entries {
                XCTAssertNotEqual(value, key, "\(catalogue.language): \(key) is untranslated")
            }
        }
    }

    func testCoversTheStatesTheSpecCallsFor() throws {
        let turkish = try loadCatalogues()[0].entries

        // Offline, syncing and up-to-date must be nameable (spec M15), and the
        // authentication failures the server can return must each have text.
        for key in [
            "connection.offline",
            "connection.syncing",
            "connection.upToDate",
            "auth.error.invalidCredentials",
            "auth.error.accountLocked",
            "auth.error.mfaInvalid",
        ] {
            XCTAssertNotNil(turkish[key], "Missing key: \(key)")
        }
    }

    func testEveryAuthErrorCodeMapsToAMessage() throws {
        let turkish = try loadCatalogues()[0].entries
        let codes: [AuthErrorCode] = [
            .invalidCredentials, .accountLocked, .accountInactive, .mfaRequired,
            .mfaInvalid, .mfaSetupRequired, .invitationInvalid, .invitationExpired,
            .invitationAttemptsExceeded, .passwordTooWeak,
        ]

        for code in codes {
            let message = L10n.message(for: .auth(code, ErrorResponse(statusCode: 401, message: code.rawValue)))

            // Resolved through the catalogue, so nothing falls back to a raw key.
            XCTAssertFalse(message.isEmpty)
            XCTAssertFalse(
                turkish.keys.contains(message),
                "\(code.rawValue) resolved to a key rather than text"
            )
        }
    }

    func testNetworkErrorsAlsoResolveToText() throws {
        for error in [APIError.offline, .timedOut, .notFound(ErrorResponse(statusCode: 404, message: "")), .forbidden(ErrorResponse(statusCode: 403, message: ""))] {
            XCTAssertFalse(L10n.message(for: error).isEmpty)
        }
    }
}
