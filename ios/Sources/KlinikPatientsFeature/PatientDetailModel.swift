import Foundation
import KlinikAPI
import KlinikCore

public enum DetailPhase: Sendable, Equatable {
    case loading
    case loaded(Patient)
    /// The record is not there, or is outside this user's scope. The backend
    /// makes those indistinguishable on purpose, so the message must not
    /// suggest the record exists.
    case notFound
    case failed(String)
}

public struct PatientDetailState: Sendable, Equatable {
    public var phase: DetailPhase = .loading

    public init() {}
}

public actor PatientDetailModel {
    private let api: PatientsAPI
    private let patientId: String

    private(set) public var state = PatientDetailState()

    public init(api: PatientsAPI, patientId: String) {
        self.api = api
        self.patientId = patientId
    }

    public func currentState() -> PatientDetailState { state }

    public func load() async {
        state.phase = .loading

        do {
            state.phase = .loaded(try await api.detail(id: patientId))
        } catch let error as APIError {
            if case .notFound = error {
                // Deliberately not "you do not have access": saying so would
                // confirm the record exists, which is what the backend's 404
                // is there to avoid.
                state.phase = .notFound
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }
}
