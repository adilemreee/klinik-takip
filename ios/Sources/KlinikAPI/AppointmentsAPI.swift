import Foundation
import KlinikCore

public enum AppointmentType: String, Decodable, Encodable, Sendable, CaseIterable {
    case consultation = "CONSULTATION"
    case surgery = "SURGERY"
    case control = "CONTROL"
    case videoCall = "VIDEO_CALL"

    public var localizedName: String { L10n.string("appointment.type.\(rawValue)") }
}

public enum AppointmentStatus: String, Decodable, Sendable, Equatable {
    /// A patient has asked; the clinic has not agreed yet.
    case requested = "REQUESTED"
    case confirmed = "CONFIRMED"
    case cancelled = "CANCELLED"
    case completed = "COMPLETED"
    case noShow = "NO_SHOW"

    public var localizedName: String { L10n.string("appointment.status.\(rawValue)") }

    /// Whether the patient is still expected to come.
    public var isUpcoming: Bool { self == .requested || self == .confirmed }
}

public struct Appointment: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let patientId: String
    public let staffId: String?
    public let type: AppointmentType
    public let status: AppointmentStatus
    public let scheduledAt: Date
    public let durationMinutes: Int
    public let location: String?
    public let note: String?
    public let cancelledAt: Date?
    public let cancelledReason: String?
    /// Reminders already sent — P7D, P1D, PT2H.
    public let remindersSent: [String]

    public var endsAt: Date {
        scheduledAt.addingTimeInterval(TimeInterval(durationMinutes * 60))
    }
}

/// One row on a cross-patient calendar: the appointment and whose it is.
///
/// The name travels with the appointment because a day showing four rows of
/// `patientId` is a day nobody can read.
public struct CalendarEntry: Decodable, Sendable, Equatable, Identifiable {
    public let appointment: Appointment
    public let patient: CalendarPatient

    public var id: String { appointment.id }

    public struct CalendarPatient: Decodable, Sendable, Equatable {
        public let id: String
        public let mrn: String
        public let fullName: String
    }
}

/// A clash the server refused, in a form the screen can explain.
public enum BookingRefusal: Sendable, Equatable {
    case slotTaken
    case outsideAvailability
    case other(String)

    public var localizedMessage: String {
        switch self {
        case .slotTaken: return L10n.string("appointment.slotTaken")
        case .outsideAvailability: return L10n.string("appointment.outsideHours")
        case .other(let message): return message
        }
    }
}

public struct AppointmentsAPI: Sendable {
    private let client: APIClient

    public init(client: APIClient) {
        self.client = client
    }

    public func mine() async throws -> [Appointment] {
        try await client.send(Endpoint(method: .get, path: "me/appointments"), as: [Appointment].self)
    }

    public func forPatient(_ patientId: String) async throws -> [Appointment] {
        try await client.send(
            Endpoint(method: .get, path: "patients/\(patientId)/appointments"),
            as: [Appointment].self
        )
    }

    public func calendar(from: Date, to: Date) async throws -> [CalendarEntry] {
        let formatter = ISO8601DateFormatter()

        return try await client.send(
            Endpoint(
                method: .get,
                path: "appointments/calendar",
                query: ["from": formatter.string(from: from), "to": formatter.string(from: to)]
            ),
            as: [CalendarEntry].self
        )
    }

    /**
     * The patient's own appointments as an iCalendar file (spec M10).
     *
     * Bytes rather than a link. The file names the clinic, the doctor and the
     * dates, and a URL that could be pasted into a group chat is a URL that
     * will be.
     */
    public func calendarFile() async throws -> Data {
        try await client.data(for: Endpoint(method: .get, path: "me/appointments/calendar.ics"))
    }

    /// A patient asking. The clinic confirms it separately.
    public func request(
        type: AppointmentType,
        scheduledAt: Date,
        staffId: String?,
        note: String?
    ) async throws -> Appointment {
        try await client.send(
            Endpoint(
                method: .post,
                path: "me/appointments",
                body: try JSONEncoder.klinik.encode(
                    BookBody(type: type, scheduledAt: scheduledAt, staffId: staffId, note: note)
                )
            ),
            as: Appointment.self
        )
    }

    public func book(
        patientId: String,
        type: AppointmentType,
        scheduledAt: Date,
        staffId: String?,
        durationMinutes: Int? = nil,
        location: String? = nil,
        note: String? = nil
    ) async throws -> Appointment {
        try await client.send(
            Endpoint(
                method: .post,
                path: "patients/\(patientId)/appointments",
                body: try JSONEncoder.klinik.encode(
                    BookBody(
                        type: type,
                        scheduledAt: scheduledAt,
                        staffId: staffId,
                        note: note,
                        durationMinutes: durationMinutes,
                        location: location
                    )
                )
            ),
            as: Appointment.self
        )
    }

    public func confirm(_ appointmentId: String) async throws -> Appointment {
        try await client.send(
            Endpoint(method: .patch, path: "appointments/\(appointmentId)/confirm"),
            as: Appointment.self
        )
    }

    public func reschedule(_ appointmentId: String, to scheduledAt: Date) async throws -> Appointment {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "appointments/\(appointmentId)/reschedule",
                body: try JSONEncoder.klinik.encode(RescheduleBody(scheduledAt: scheduledAt))
            ),
            as: Appointment.self
        )
    }

    public func cancel(_ appointmentId: String, reason: String?) async throws -> Appointment {
        try await client.send(
            Endpoint(
                method: .patch,
                path: "appointments/\(appointmentId)/cancel",
                body: try JSONEncoder.klinik.encode(CancelBody(reason: reason))
            ),
            as: Appointment.self
        )
    }

    /**
     * Reads a refusal the server sent as a conflict.
     *
     * The two reasons need different words: "that time is taken" sends someone
     * looking for another slot, where "the clinic is not open then" sends them
     * to another day. Telling them the wrong one wastes their afternoon.
     */
    public static func refusal(from error: APIError) -> BookingRefusal? {
        guard case .conflict(let body) = error else { return nil }

        if body.message.contains("SLOT_TAKEN") { return .slotTaken }
        if body.message.contains("OUTSIDE_AVAILABILITY") { return .outsideAvailability }

        return .other(body.message)
    }

    private struct BookBody: Encodable {
        let type: AppointmentType
        let scheduledAt: Date
        let staffId: String?
        let note: String?
        var durationMinutes: Int?
        var location: String?
    }

    private struct RescheduleBody: Encodable {
        let scheduledAt: Date
    }

    private struct CancelBody: Encodable {
        let reason: String?
    }
}
