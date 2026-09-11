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

    /// Every line that defines a key, in file order — duplicates included.
    ///
    /// `loadCatalogues` builds a dictionary, which is exactly why the twelve
    /// duplicate definitions below went unnoticed for months: the second
    /// silently replaced the first and every test saw one key.
    private func definedKeys(_ language: String) throws -> [String] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/KlinikCore/Resources")
            .appendingPathComponent("\(language).lproj")
            .appendingPathComponent("Localizable.strings")

        return try String(contentsOf: url, encoding: .utf8)
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.hasPrefix("\"") }
            .compactMap { line in
                let parts = line.components(separatedBy: "\" = \"")
                guard parts.count == 2 else { return nil }
                return String(parts[0].dropFirst())
            }
    }

    /**
     * No key is defined twice.
     *
     * A `.strings` file keeps the *last* definition, so a duplicate is not a
     * harmless repetition: it is one piece of wording silently overriding
     * another. That is how the patient's medication screen came to say "Bu
     * hastaya yazılmış ilaç yok" — a sentence written for a clinician.
     */
    func testNoKeyIsDefinedTwice() throws {
        for language in ["tr", "en"] {
            let keys = try definedKeys(language)
            let duplicates = Set(keys.filter { key in keys.filter { $0 == key }.count > 1 })

            XCTAssertEqual(
                duplicates,
                [],
                "\(language): defined more than once — the later one silently wins: "
                    + "\(duplicates.sorted())"
            )
        }
    }

    /**
     * A format string is used with `String(format:)`, and only then.
     *
     * Both mistakes show the reader a raw specifier or an argument with
     * nowhere to go. The patient's medication screen used to read
     * "%d gündür aksatmadınız: 7".
     */
    func testFormatStringsAreUsedAsFormatStrings() throws {
        let catalogue = try loadCatalogues()[0].entries
        let sources = try swiftSources()
        let specifier = try NSRegularExpression(pattern: "%(?:\\d+\\$)?[@dfsu]")

        func hasPlaceholder(_ value: String) -> Bool {
            let range = NSRange(value.startIndex..., in: value)
            return specifier.firstMatch(in: value, range: range) != nil
        }

        // One pass over the sources rather than two `contains` per key: there
        // are a thousand keys and a megabyte of Swift, and the naive version
        // took the best part of a minute.
        var formatted: Set<String> = []
        var plain: Set<String> = []

        let call = try NSRegularExpression(
            pattern: "(format:\\s*)?L10n\\.string\\(\"([^\"]+)\"\\)"
        )
        let whole = NSRange(sources.startIndex..., in: sources)

        for match in call.matches(in: sources, range: whole) {
            guard
                let keyRange = Range(match.range(at: 2), in: sources)
            else { continue }

            let key = String(sources[keyRange])

            if match.range(at: 1).location == NSNotFound {
                plain.insert(key)
            } else {
                formatted.insert(key)
            }
        }

        for key in plain.subtracting(formatted) {
            XCTAssertFalse(
                hasPlaceholder(catalogue[key] ?? ""),
                "\(key) carries a placeholder but is read without String(format:)"
            )
        }

        for key in formatted {
            XCTAssertTrue(
                hasPlaceholder(catalogue[key] ?? ""),
                "\(key) is used with String(format:) but carries no placeholder"
            )
        }
    }

    /// Every Swift file in the package, concatenated. Read from disk because
    /// the question is about the source, not about what it compiled to.
    private func swiftSources() throws -> String {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources")

        guard let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)
        else {
            return ""
        }

        var joined = ""

        for case let url as URL in files where url.pathExtension == "swift" {
            joined += (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        }

        return joined
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
