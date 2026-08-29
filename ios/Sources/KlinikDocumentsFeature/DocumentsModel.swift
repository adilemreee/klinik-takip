import Foundation
import KlinikAPI
import KlinikCore

public enum DocumentsPhase: Sendable, Equatable {
    case loading
    case loaded
    /// Nothing uploaded yet. Not a failure, and must not be shown as one.
    case empty
    /// Absent, or outside this user's scope — the backend makes the two
    /// indistinguishable on purpose.
    case notFound
    case failed(String)
}

public struct DocumentsState: Sendable, Equatable {
    public var phase: DocumentsPhase = .loading
    public var documents: [ClinicalDocument] = []
    public var nextCursor: String?
    public var isLoadingMore = false
    public var uploading = false
    public var uploadError: String?
    /// How much of the current upload has reached the server, for a progress bar.
    public var uploadProgress: UploadProgress?

    public var hasMore: Bool { nextCursor != nil }

    /// Whether anything is still being processed, so the screen knows whether
    /// there is any point polling again.
    public var hasUnsettledWork: Bool {
        documents.contains { !$0.ocrStatus.isSettled }
    }

    public init() {}
}

/// A patient's documents: the list, uploading, and watching processing finish.
public actor DocumentsModel {
    private let api: DocumentsAPI
    private let resumable: ResumableUpload
    private let patientId: String
    private let pageSize: Int

    /**
     * Above this, the upload is chunked and resumable.
     *
     * Below it, a failed attempt costs one small request and the three-call
     * dance would be pure overhead. Above it, a dropped connection costs the
     * patient their whole transfer — which on mobile data abroad is the case
     * this product has to survive.
     */
    private let resumableThreshold: Int

    private(set) public var state = DocumentsState()

    public init(
        api: DocumentsAPI,
        resumable: ResumableUpload,
        patientId: String,
        pageSize: Int = 25,
        resumableThreshold: Int = ResumableUpload.chunkSize
    ) {
        self.api = api
        self.resumable = resumable
        self.patientId = patientId
        self.pageSize = pageSize
        self.resumableThreshold = resumableThreshold
    }

    public func currentState() -> DocumentsState { state }

    public func load() async {
        state.phase = .loading
        state.documents = []
        state.nextCursor = nil
        await fetchPage(cursor: nil)
    }

    /// The next page. Ignored while one is already in flight, so a fast scroll
    /// does not request the same cursor twice and duplicate rows.
    public func loadMore() async {
        guard let cursor = state.nextCursor, !state.isLoadingMore else { return }

        state.isLoadingMore = true
        defer { state.isLoadingMore = false }

        await fetchPage(cursor: cursor)
    }

    /// Uploads a file and reloads the list.
    ///
    /// Reloading rather than prepending what we sent: the server decides the
    /// document's real type from the bytes, and a row showing what the client
    /// guessed would disagree with the one beside it after the next refresh.
    @discardableResult
    public func upload(
        fileURL: URL,
        type: DocumentType,
        contentType: String = "application/octet-stream"
    ) async -> Bool {
        guard !state.uploading else { return false }

        state.uploading = true
        state.uploadError = nil
        state.uploadProgress = nil
        defer {
            state.uploading = false
            state.uploadProgress = nil
        }

        do {
            if (try? fileSize(of: fileURL)) ?? 0 > resumableThreshold {
                try await sendResumable(fileURL: fileURL, type: type)
            } else {
                _ = try await api.upload(
                    patientId: patientId,
                    fileURL: fileURL,
                    type: type,
                    contentType: contentType
                )
            }
        } catch let error as APIError {
            // A refused upload is the type or size check doing its job, and the
            // server's message says which. Our own would say less.
            state.uploadError = L10n.message(for: error)
            return false
        } catch {
            state.uploadError = L10n.string("error.server")
            return false
        }

        await load()
        return true
    }

    /**
     * Re-reads the first page to pick up processing that has finished.
     *
     * Polling, not pushing: live updates arrive with the message socket in a
     * later task, and until then a screen that never updates would leave a
     * document sitting at "queued" long after it was done.
     */
    public func refreshStatuses() async {
        guard state.hasUnsettledWork else { return }

        do {
            let page = try await api.list(patientId: patientId, limit: pageSize)
            merge(page.items)
        } catch {
            // A failed poll is not worth interrupting the screen for: the list
            // on display is still correct, only slightly stale.
        }
    }

    public func remove(documentId: String) async {
        do {
            try await api.remove(documentId: documentId)
            state.documents.removeAll { $0.id == documentId }
            if state.documents.isEmpty { state.phase = .empty }
        } catch let error as APIError {
            state.uploadError = L10n.message(for: error)
        } catch {
            state.uploadError = L10n.string("error.server")
        }
    }

    /// Opens a session, streams the file, and completes it. The session id is
    /// kept for the duration so an interrupted send resumes rather than
    /// restarts; surviving an app relaunch needs the local store that T2.6
    /// still owes.
    private func sendResumable(fileURL: URL, type: DocumentType) async throws {
        let session = try await resumable.begin(
            patientId: patientId,
            type: type,
            originalName: fileURL.lastPathComponent
        )

        do {
            _ = try await resumable.send(fileURL: fileURL, sessionId: session.id) { progress in
                Task { await self.report(progress) }
            }

            _ = try await resumable.complete(sessionId: session.id, fileURL: fileURL)
        } catch {
            // Releases the parts already sent. Best-effort: the sweep on the
            // server catches whatever this misses.
            try? await resumable.abort(sessionId: session.id)
            throw error
        }
    }

    private func report(_ progress: UploadProgress) {
        state.uploadProgress = progress
    }

    private func fileSize(of fileURL: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        return (attributes[.size] as? Int) ?? 0
    }

    private func fetchPage(cursor: String?) async {
        do {
            let page = try await api.list(
                patientId: patientId,
                cursor: cursor,
                limit: pageSize
            )

            state.documents += page.items
            state.nextCursor = page.nextCursor
            state.phase = state.documents.isEmpty ? .empty : .loaded
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

    /// Updates statuses in place rather than replacing the list, so a poll
    /// landing mid-scroll does not throw away pages already loaded.
    private func merge(_ fresh: [ClinicalDocument]) {
        var byId: [String: ClinicalDocument] = [:]
        for document in fresh { byId[document.id] = document }

        state.documents = state.documents.map { byId[$0.id] ?? $0 }
    }
}
