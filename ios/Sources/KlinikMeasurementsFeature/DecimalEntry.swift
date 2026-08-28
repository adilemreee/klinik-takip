import Foundation

/// Reading a number the way a person typed it.
///
/// A Turkish keyboard produces "72,4" and an English one "72.4", and both reach
/// this app — patients arrive from many countries and the clinic's own staff
/// type in Turkish. `Double("72,4")` is nil, so a naive parse silently turns a
/// perfectly good weight into a blank field, or worse, into 72.
///
/// Deliberately locale-independent: it accepts either separator rather than
/// the one the device is set to, because the device locale and the keyboard
/// the person is using are not the same thing.
public enum DecimalEntry {
    public static func parse(_ text: String) -> Double? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }

        // Reject anything that is not digits and a single separator, so "72.4.5"
        // or "12kg" are refused rather than parsed to something plausible.
        let allowed = CharacterSet(charactersIn: "0123456789.,")
        guard trimmed.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }

        let separators = trimmed.filter { $0 == "." || $0 == "," }
        guard separators.count <= 1 else { return nil }

        // Whichever separator the person used, it means the same thing here:
        // these are single measurements, never thousands-grouped.
        let normalised = trimmed.replacingOccurrences(of: ",", with: ".")
        guard !normalised.hasSuffix(".") else { return nil }

        // Parsed in a fixed locale, because by this point the text has been
        // normalised to one form; using the device locale here would undo that.
        return Double(normalised)
    }
}
