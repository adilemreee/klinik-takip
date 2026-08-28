import Foundation
import Security

public enum KeychainError: Error, Equatable {
    case unexpectedStatus(OSStatus)
    case malformedData
}

/// Tokens in the Keychain rather than UserDefaults (spec section 8).
///
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` is deliberate:
/// `ThisDeviceOnly` keeps the item out of encrypted backups and off any other
/// device, and `AfterFirstUnlock` still lets a background refresh or a push
/// handler read it while the phone is locked — which the medication reminders
/// and emergency flow need.
public final class KeychainTokenStore: TokenStore, @unchecked Sendable {
    private let service: String
    private let account: String

    public init(service: String = "xyz.klinik.tokens", account: String = "session") {
        self.service = service
        self.account = account
    }

    public func load() throws -> SessionTokens? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)

        if status == errSecItemNotFound {
            return nil
        }

        guard status == errSecSuccess else {
            throw KeychainError.unexpectedStatus(status)
        }

        guard let data = item as? Data else {
            throw KeychainError.malformedData
        }

        return try JSONDecoder.klinik.decode(SessionTokens.self, from: data)
    }

    public func save(_ tokens: SessionTokens) throws {
        let data = try JSONEncoder.klinik.encode(tokens)
        let query = baseQuery()

        let attributes: [String: Any] = [kSecValueData as String: data]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)

        if status == errSecSuccess {
            return
        }

        guard status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }

        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let addStatus = SecItemAdd(insert as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainError.unexpectedStatus(addStatus)
        }
    }

    public func clear() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)

        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unexpectedStatus(status)
        }
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

/// Date handling for the API contract.
///
/// Uses `Date.ISO8601FormatStyle` rather than `ISO8601DateFormatter`: the
/// formatter class is a reference type and not `Sendable`, so sharing one
/// across concurrent requests is a data race that Swift 6 refuses outright.
/// The format style is a value type and can be shared safely.
enum ISO8601 {
    static let withFractionalSeconds = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    static let plain = Date.ISO8601FormatStyle(includingFractionalSeconds: false)

    /// The backend emits fractional seconds, but dates that originate from a
    /// database column sometimes do not; accept both rather than failing a
    /// whole response over a missing ".000".
    static func parse(_ text: String) -> Date? {
        (try? withFractionalSeconds.parse(text)) ?? (try? plain.parse(text))
    }

    static func format(_ date: Date) -> String {
        withFractionalSeconds.format(date)
    }
}

public extension JSONDecoder {
    /// Matches the backend, which serialises every timestamp as ISO 8601.
    static let klinik: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)

            guard let date = ISO8601.parse(text) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Unrecognised date: \(text)"
                )
            }

            return date
        }
        return decoder
    }()
}

public extension JSONEncoder {
    static let klinik: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(ISO8601.format(date))
        }
        return encoder
    }()
}
