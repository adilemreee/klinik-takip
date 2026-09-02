import Foundation
import KlinikAPI
import KlinikCore

public enum AppointmentsPhase: Sendable, Equatable {
    case loading
    case loaded
    /// Nothing booked. Not a failure.
    case empty
    case notFound
    case failed(String)
}

public struct AppointmentsState: Sendable, Equatable {
    public var phase: AppointmentsPhase = .loading
    public var appointments: [Appointment] = []
    /// The appointment being acted on, so its buttons can be disabled.
    public var working: String?
    public var booking = false
    public var error: String?

    /// The next one still ahead — what a patient opens this screen for.
    public func next(after now: Date = Date()) -> Appointment? {
        appointments.first { $0.scheduledAt >= now && $0.status.isUpcoming }
    }

    /// Requests the clinic has not answered yet, which is what staff act on.
    public var awaitingConfirmation: [Appointment] {
        appointments.filter { $0.status == .requested }
    }

    public init() {}
}

/// Appointments (spec M10).
public actor AppointmentsModel {
    private let api: AppointmentsAPI
    private let load: @Sendable (AppointmentsAPI) async throws -> [Appointment]

    private(set) public var state = AppointmentsState()

    /// The caller's own appointments.
    public init(api: AppointmentsAPI) {
        self.api = api
        self.load = { try await $0.mine() }
    }

    /// A named patient's, for staff.
    public init(api: AppointmentsAPI, patientId: String) {
        self.api = api
        self.load = { try await $0.forPatient(patientId) }
    }

    public func currentState() -> AppointmentsState { state }

    public func refresh() async {
        state.phase = .loading

        do {
            let appointments = try await load(api)
            state.appointments = appointments
            state.phase = appointments.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            if case .notFound = error {
                state.phase = .notFound
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    /**
     * Asks for an appointment.
     *
     * A refused slot is explained in its own words: "that time is taken" sends
     * someone looking for another slot, where "the clinic is not open then"
     * sends them to another day, and the wrong one wastes their afternoon.
     */
    @discardableResult
    public func request(
        type: AppointmentType,
        at scheduledAt: Date,
        staffId: String?,
        note: String? = nil
    ) async -> Bool {
        guard !state.booking else { return false }

        state.booking = true
        state.error = nil
        defer { state.booking = false }

        do {
            _ = try await api.request(
                type: type,
                scheduledAt: scheduledAt,
                staffId: staffId,
                note: note
            )
        } catch let error as APIError {
            state.error = AppointmentsAPI.refusal(from: error)?.localizedMessage
                ?? L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        await refresh()
        return true
    }

    @discardableResult
    public func confirm(_ appointmentId: String) async -> Bool {
        await act(appointmentId) { try await self.api.confirm(appointmentId) }
    }

    @discardableResult
    public func cancel(_ appointmentId: String, reason: String? = nil) async -> Bool {
        await act(appointmentId) { try await self.api.cancel(appointmentId, reason: reason) }
    }

    @discardableResult
    public func reschedule(_ appointmentId: String, to scheduledAt: Date) async -> Bool {
        await act(appointmentId) {
            try await self.api.reschedule(appointmentId, to: scheduledAt)
        }
    }

    /**
     * Replaces the row with what the server returned.
     *
     * Not removed, even when cancelled: a patient who cancelled should see that
     * it is cancelled rather than watch the appointment vanish and wonder
     * whether the clinic got the message.
     */
    private func act(
        _ appointmentId: String,
        _ work: @Sendable () async throws -> Appointment
    ) async -> Bool {
        guard state.working == nil else { return false }

        state.working = appointmentId
        state.error = nil
        defer { state.working = nil }

        do {
            let updated = try await work()
            state.appointments = state.appointments.map {
                $0.id == updated.id ? updated : $0
            }
        } catch let error as APIError {
            state.error = AppointmentsAPI.refusal(from: error)?.localizedMessage
                ?? L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        return true
    }
}
