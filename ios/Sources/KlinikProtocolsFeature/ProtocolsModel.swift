import Foundation
import KlinikAPI
import KlinikCore

public enum ProtocolsPhase: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case notPermitted
    case failed(String)
}

public struct ProtocolsState: Sendable, Equatable {
    public var phase: ProtocolsPhase = .loading
    public var documents: [ProtocolSummary] = []
    public var includeRetired = false
    public var busyId: String?
    public var error: String?

    public init() {}

    /// Documents the assistant can actually quote from today.
    public var usable: [ProtocolSummary] { documents.filter(\.isUsable) }
    /// Stored but unreachable — no embedding, or retired.
    public var unusable: [ProtocolSummary] { documents.filter { !$0.isUsable } }
}

/**
 * What the assistant is allowed to say (spec M4).
 *
 * The assistant answers only from these documents. That rule is the reason it
 * is safe to put in front of a patient at all, which makes this screen the
 * place where the clinic decides what a machine may tell somebody recovering
 * from surgery — so it shows, plainly, which documents are actually reachable.
 *
 * A document stored without an embedding is stored and invisible to retrieval.
 * Listing it beside the working ones with no distinction would let a clinic
 * believe it had answered a question it cannot answer.
 */
@MainActor
public final class ProtocolsModel {
    private let api: ProtocolsAPI
    private var state = ProtocolsState()

    public init(api: ProtocolsAPI) {
        self.api = api
    }

    public func currentState() -> ProtocolsState { state }

    public func load() async {
        do {
            state.documents = try await api.list(includeInactive: state.includeRetired)
                .sorted { $0.document.createdAt > $1.document.createdAt }
            state.phase = state.documents.isEmpty ? .empty : .loaded
        } catch APIError.forbidden {
            state.phase = .notPermitted
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    public func showRetired(_ include: Bool) async {
        state.includeRetired = include
        state.phase = .loading
        await load()
    }

    public func add(
        title: String,
        content: String,
        procedureType: String,
        language: String
    ) async -> Bool {
        guard let problem = ProtocolsModel.problem(title: title, content: content) else {
            state.busyId = "new"
            state.error = nil

            defer { state.busyId = nil }

            do {
                _ = try await api.upload(
                    title: title.trimmed,
                    content: content.trimmed,
                    procedureType: procedureType.trimmed.isEmpty ? nil : procedureType.trimmed,
                    language: language
                )

                await load()

                return true
            } catch let error as APIError {
                state.error = L10n.message(for: error)
            } catch {
                state.error = L10n.string("error.server")
            }

            return false
        }

        state.error = problem

        return false
    }

    public func retire(_ documentId: String) async {
        state.busyId = documentId
        state.error = nil

        defer { state.busyId = nil }

        do {
            _ = try await api.retire(documentId)
            await load()
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }
    }

    /// Nil when the document is worth uploading.
    ///
    /// The length floor is not arbitrary: a document shorter than a sentence
    /// produces one chunk that matches everything weakly, which is how an
    /// assistant ends up quoting a heading at somebody asking about bleeding.
    public nonisolated static func problem(title: String, content: String) -> String? {
        if title.trimmed.isEmpty { return L10n.string("protocol.needTitle") }
        if content.trimmed.count < 40 { return L10n.string("protocol.needContent") }

        return nil
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
