import Foundation

/**
 * Whose records a request is about.
 *
 * The same distinction `MeasurementSubject` already draws, and for the same
 * reason it is a type rather than an optional id: the two paths are different
 * on the server, because the permission is. A patient has `self.read`, not
 * `documents.read` — giving them the latter would bring every patient's file
 * within reach, which is exactly what the permission matrix exists to prevent.
 *
 * So `me/documents` is not a convenience alias for `patients/{id}/documents`.
 * Sending a patient down the staff path answers 403, and this type is what
 * stops a screen being wired to the wrong one by accident.
 */
public enum RecordSubject: Sendable, Equatable {
    case patient(id: String)
    case me

    /// The path prefix for this subject, e.g. `me` or `patients/<id>`.
    func base(_ suffix: String) -> String {
        switch self {
        case .patient(let id): return "patients/\(id)/\(suffix)"
        case .me: return "me/\(suffix)"
        }
    }
}
