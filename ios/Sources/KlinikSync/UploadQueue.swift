import Foundation
import KlinikAPI
import KlinikCore

/// What happened to one queued upload.
public enum UploadOutcome: Sendable, Equatable {
    case finished
    /// Worth another attempt: no connection, or the server is struggling.
    case retryable(String)
    /// Will never succeed as it stands — a type the clinic refuses, a
    /// permission the user no longer has.
    case rejected(String)
    /// The bytes are no longer on this device, so there is nothing to send.
    case fileMissing
}

/**
 * Files waiting to reach the clinic (spec M15, T3.2).
 *
 * The write outbox carries requests; this carries bytes, which is a different
 * problem. A queued measurement is four hundred characters of JSON that can be
 * replayed in one request. A queued scan is twenty megabytes that has to
 * survive the app being killed, resume from wherever the server got to, and
 * still be the same file when it is finally assembled.
 *
 * So the file is copied somewhere the app owns, the session is remembered
 * beside it, and the whole thing is picked up again on the next launch.
 */
public actor UploadQueue {
    private let store: UploadStore
    private let uploads: ResumableUpload
    private let maxAttempts: Int

    public init(store: UploadStore, uploads: ResumableUpload, maxAttempts: Int = 5) {
        self.store = store
        self.uploads = uploads
        self.maxAttempts = maxAttempts
    }

    /**
     * Takes custody of a file the user chose to send.
     *
     * The copy is the point. The document picker hands over something in the
     * temporary directory, which the system empties whenever it likes — and an
     * upload whose bytes have been swept away is not resumable, it is lost.
     */
    @discardableResult
    public func accept(
        fileURL: URL,
        subject: RecordSubject,
        type: DocumentType,
        contentType: String,
        originalName: String? = nil,
        sessionId: String? = nil,
        fileManager: FileManager = .default
    ) async throws -> PendingUpload {
        let directory = try PendingUpload.directory(fileManager: fileManager)
        let id = UUID().uuidString
        let destination = directory
            .appendingPathComponent(id)
            .appendingPathExtension(fileURL.pathExtension)

        try fileManager.copyItem(at: fileURL, to: destination)

        let attributes = try? fileManager.attributesOfItem(atPath: destination.path)
        let size = (attributes?[.size] as? Int) ?? 0

        let upload = PendingUpload(
            id: id,
            sessionId: sessionId,
            fileURL: destination,
            patientId: UploadQueue.patientId(of: subject),
            documentType: type.rawValue,
            originalName: originalName ?? fileURL.lastPathComponent,
            contentType: contentType,
            totalBytes: size
        )

        try await store.remember(upload)

        return upload
    }

    public func unfinished() async -> [PendingUpload] {
        (try? await store.unfinished()) ?? []
    }

    /// Everything the clinic has refused often enough that trying again is not
    /// the answer.
    public func stuck() async -> [PendingUpload] {
        await unfinished().filter { $0.attempts >= maxAttempts || !$0.fileExists }
    }

    /**
     * Sends what is waiting, oldest first.
     *
     * Stops at the first connectivity failure: the same dead connection is
     * about to meet every other file, and walking the rest would spend the
     * battery of somebody who has no signal.
     */
    @discardableResult
    public func drain(onProgress: (@Sendable (String, UploadProgress) -> Void)? = nil) async -> Int {
        var finished = 0

        for upload in await unfinished() {
            guard upload.attempts < maxAttempts else { continue }

            switch await send(upload, onProgress: onProgress) {
            case .finished:
                finished += 1

            case .retryable:
                return finished

            case .rejected, .fileMissing:
                continue
            }
        }

        return finished
    }

    /**
     * One file, from wherever the server got to.
     *
     * The session is opened here rather than when the file was chosen, because
     * a file chosen with no connection at all never had a server to ask. An
     * expired session is replaced rather than reported: the bytes are still
     * here, and starting the transfer again is a better answer than telling
     * somebody their document failed.
     */
    public func send(
        _ upload: PendingUpload,
        onProgress: (@Sendable (String, UploadProgress) -> Void)? = nil
    ) async -> UploadOutcome {
        guard upload.fileExists else {
            // Nothing to retry with. Kept in the list so the person is told,
            // rather than removed as if it had been sent.
            await record(upload, error: L10n.string("upload.fileGone"))
            return .fileMissing
        }

        var current = upload

        do {
            let session = try await resumableSession(for: &current)
            let id = current.id

            _ = try await uploads.send(
                fileURL: current.fileURL,
                sessionId: session.id,
                from: session.receivedBytes
            ) { progress in
                onProgress?(id, progress)
            }

            _ = try await uploads.complete(sessionId: session.id, fileURL: current.fileURL)

            await forget(current)

            return .finished
        } catch let error as APIError {
            let message = L10n.message(for: error)
            await record(current, error: message)

            return error.isRetryable ? .retryable(message) : .rejected(message)
        } catch {
            let message = L10n.string("error.server")
            await record(current, error: message)

            return .retryable(message)
        }
    }

    /**
     * The session to send into, opening or replacing one as needed.
     *
     * A session the server has forgotten answers 404. That is not a failure to
     * report — the file is still on the phone — so a new session is opened and
     * the transfer starts again from nothing.
     */
    private func resumableSession(for upload: inout PendingUpload) async throws -> UploadSession {
        if let sessionId = upload.sessionId {
            do {
                return try await uploads.status(sessionId: sessionId)
            } catch let error as APIError {
                guard case .notFound = error else { throw error }
            }
        }

        let session = try await uploads.begin(
            subject: UploadQueue.subject(of: upload),
            type: DocumentType(rawValue: upload.documentType) ?? .other,
            originalName: upload.originalName
        )

        upload.sessionId = session.id
        try? await store.remember(upload)

        return session
    }

    /// Drops a queued upload at the user's request, and the bytes with it.
    public func discard(id: String, fileManager: FileManager = .default) async {
        let upload = await unfinished().first { $0.id == id }

        try? await store.forget(id: id)

        if let upload {
            try? fileManager.removeItem(at: upload.fileURL)
        }
    }

    /// Empties the queue when the session ends. The rows are addressed to
    /// `me/…` like everything else here, and the files are one person's.
    public func discardEverything(fileManager: FileManager = .default) async {
        for upload in await unfinished() {
            try? await store.forget(id: upload.id)
            try? fileManager.removeItem(at: upload.fileURL)
        }
    }

    private func forget(_ upload: PendingUpload, fileManager: FileManager = .default) async {
        try? await store.forget(id: upload.id)
        // The clinic has it now; a second copy on the phone is only somebody's
        // medical record taking up space in a directory nobody looks at.
        try? fileManager.removeItem(at: upload.fileURL)
    }

    private func record(_ upload: PendingUpload, error: String) async {
        var updated = upload
        updated.attempts += 1
        updated.lastError = error

        try? await store.remember(updated)
    }

    static func patientId(of subject: RecordSubject) -> String? {
        switch subject {
        case .patient(let id): return id
        case .me: return nil
        }
    }

    static func subject(of upload: PendingUpload) -> RecordSubject {
        upload.patientId.map { RecordSubject.patient(id: $0) } ?? .me
    }
}


/// The queue, as a screen that has just failed to send a file sees it.
extension UploadQueue: PendingUploadQueue {
    public func keep(
        fileURL: URL,
        subject: RecordSubject,
        type: DocumentType,
        contentType: String,
        originalName: String?,
        sessionId: String?
    ) async throws {
        try await accept(
            fileURL: fileURL,
            subject: subject,
            type: type,
            contentType: contentType,
            originalName: originalName,
            sessionId: sessionId
        )
    }
}
