import Foundation
import KlinikAPI
import KlinikCore

public enum NewPatientPhase: Sendable, Equatable {
    case editing
    case saving
    /// Opened, and carrying the number the clinic will write on paper.
    case created(mrn: String, id: String)
    case failed(String)
}

public struct NewPatientState: Sendable, Equatable {
    public var phase: NewPatientPhase = .editing
    public var error: String?

    public init() {}
}

/**
 * Opening a patient file (spec M2).
 *
 * The file number is not asked for and cannot be supplied: the server
 * allocates it. A client that could choose one could collide with a file that
 * already exists, and that number is what the clinic writes on paper and says
 * on the telephone.
 *
 * Validation is done here rather than only by the server, for one reason —
 * a nurse who fills a form, waits, and is then told the country code is wrong
 * has been made to wait for something the screen already knew.
 */
public actor NewPatientModel {
    private let api: PatientsAPI

    private(set) public var state = NewPatientState()

    public init(api: PatientsAPI) {
        self.api = api
    }

    public func currentState() -> NewPatientState { state }

    /// What the form must have before it is worth sending. Nil when it is fine.
    public static func problem(firstName: String, lastName: String, country: String) -> String? {
        if firstName.trimmingCharacters(in: .whitespaces).isEmpty
            || lastName.trimmingCharacters(in: .whitespaces).isEmpty {
            return L10n.string("patient.needName")
        }

        // Two letters, because the server drives language and discharge advice
        // off this and a wrong code sends somebody the wrong emergency number.
        let code = country.trimmingCharacters(in: .whitespaces)
        if code.count != 2 || !code.allSatisfy(\.isLetter) {
            return L10n.string("patient.needCountry")
        }

        return nil
    }

    @discardableResult
    public func create(
        firstName: String,
        lastName: String,
        birthDate: Date,
        sex: String,
        country: String,
        city: String?,
        referralSource: String?
    ) async -> Bool {
        guard state.phase != .saving else { return false }

        if let problem = NewPatientModel.problem(
            firstName: firstName,
            lastName: lastName,
            country: country
        ) {
            state.error = problem
            return false
        }

        state.phase = .saving
        state.error = nil

        do {
            let patient = try await api.create(
                NewPatient(
                    firstName: firstName.trimmingCharacters(in: .whitespaces),
                    lastName: lastName.trimmingCharacters(in: .whitespaces),
                    birthDate: birthDate,
                    sex: sex,
                    country: country.trimmingCharacters(in: .whitespaces).uppercased(),
                    city: city?.isEmpty == true ? nil : city,
                    referralSource: referralSource?.isEmpty == true ? nil : referralSource
                )
            )

            state.phase = .created(mrn: patient.mrn, id: patient.id)
        } catch let error as APIError {
            state.phase = .editing
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.phase = .editing
            state.error = L10n.string("error.server")
            return false
        }

        return true
    }
}
