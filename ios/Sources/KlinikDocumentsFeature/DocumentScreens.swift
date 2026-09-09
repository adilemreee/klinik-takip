import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// A patient's documents, with what has happened to each one.
public struct DocumentListView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: DocumentsModel
    private let canUpload: Bool
    private let pickFile: () async -> (url: URL, contentType: String)?

    @State private var state = DocumentsState()
    @State private var chosenType: DocumentType = .lab
    @State private var previewing: PreviewedDocument?

    /// - Parameter pickFile: supplied by the app shell, which owns the document
    ///   picker. Kept out of here so the screen stays testable and does not
    ///   depend on UIKit presentation.
    public init(
        model: DocumentsModel,
        canUpload: Bool = true,
        pickFile: @escaping () async -> (url: URL, contentType: String)?
    ) {
        self.model = model
        self.canUpload = canUpload
        self.pickFile = pickFile
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await refresh { await model.load() } }
        .task { await pollWhileProcessing() }
        .sheet(item: $previewing) { document in
            DocumentPreview(url: document.url)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            Spacer()
            ProgressView().accessibilityLabel(L10n.string("common.loading"))
            Spacer()

        case .empty:
            MessageState(
                icon: "doc.badge.plus",
                text: L10n.string("document.empty"),
                retryTitle: canUpload ? L10n.string("document.upload") : nil,
                retry: canUpload ? { await startUpload() } : nil
            )

        case .notFound:
            MessageState(icon: "questionmark.folder", text: L10n.string("error.notFound"))

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await refresh { await model.load() }
            }

        case .loaded:
            list
        }
    }

    private var list: some View {
        VStack(spacing: Tokens.Spacing.md) {
            if let error = state.uploadError {
                ErrorBanner(message: error)
                    .padding(.horizontal, Tokens.Spacing.lg)
            }

            List {
                ForEach(state.documents) { document in
                    Button {
                        Task { await open(document) }
                    } label: {
                        DocumentRow(document: document, isOpening: state.openingId == document.id)
                    }
                    .buttonStyle(.plain)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                    .swipeActions(edge: .trailing) {
                        Button(L10n.string("common.delete"), role: .destructive) {
                            Task { await refresh { await model.remove(documentId: document.id) } }
                        }
                    }
                    .onAppear {
                        if document.id == state.documents.last?.id {
                            Task { await refresh { await model.loadMore() } }
                        }
                    }
                }
            }
            .listStyle(.plain)

            if canUpload {
                VStack(spacing: Tokens.Spacing.sm) {
                    Picker(L10n.string("document.type"), selection: $chosenType) {
                        ForEach(DocumentType.allCases, id: \.self) { type in
                            Text(type.localizedName).tag(type)
                        }
                    }
                    .accessibilityLabel(L10n.string("document.type"))

                    if let progress = state.uploadProgress {
                        // A 20 MB scan on mobile data takes long enough that a
                        // spinner alone reads as a hang.
                        ProgressView(value: progress.fraction)
                            .accessibilityLabel(L10n.string("document.uploading"))
                            .accessibilityValue("\(Int(progress.fraction * 100))%")
                    }

                    PrimaryButton(
                        title: L10n.string("document.upload"),
                        isBusy: state.uploading,
                        isEnabled: !state.uploading
                    ) {
                        await startUpload()
                    }
                }
                .padding(Tokens.Spacing.lg)
            }
        }
    }

    /**
     * Opens a document.
     *
     * The file is fetched before the sheet appears rather than after: a
     * previewer that opens empty and fills in later reads as a broken document,
     * and on hotel wifi that gap is seconds long.
     */
    private func open(_ document: ClinicalDocument) async {
        guard state.openingId == nil else { return }

        state = await model.currentState()
        let url = await model.localCopy(of: document.id)
        state = await model.currentState()

        if let url {
            previewing = PreviewedDocument(id: document.id, url: url)
        }
    }

    private func startUpload() async {
        guard let picked = await pickFile() else { return }

        await refresh {
            await model.upload(
                fileURL: picked.url,
                type: chosenType,
                contentType: picked.contentType
            )
        }
    }

    /**
     * Watches processing finish.
     *
     * Bounded rather than open-ended: a document that has not settled after a
     * couple of minutes is not going to settle because we asked again, and a
     * screen left polling forever in a pocket is a battery complaint.
     */
    private func pollWhileProcessing() async {
        for _ in 0..<40 {
            try? await Task.sleep(for: .seconds(3))

            if Task.isCancelled { return }

            await refresh { await model.refreshStatuses() }

            if !state.hasUnsettledWork { return }
        }
    }

    private func refresh(_ work: () async -> Void) async {
        await work()
        state = await model.currentState()
    }
}

struct DocumentRow: View {
    @Environment(\.colorScheme) private var scheme

    let document: ClinicalDocument
    var isOpening = false

    var body: some View {
        HStack(spacing: Tokens.Spacing.md) {
            Image(systemName: DocumentRow.symbol(for: document.mime))
                .font(Tokens.Typography.headingRelative)
                .frame(width: 32)
                .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                // The row is announced as one element; the name says what it is.
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                Text(document.displayName)
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)

                Text("\(document.type.localizedName) · \(sizeText) · \(document.createdAt.formatted(date: .abbreviated, time: .omitted))")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            Spacer(minLength: Tokens.Spacing.sm)

            if isOpening {
                ProgressView().accessibilityLabel(L10n.string("common.loading"))
            } else {
                StatusBadge(status: document.ocrStatus)
            }
        }
        .padding(.vertical, Tokens.Spacing.xs)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    /// The icon says what kind of file it is before the name is read.
    static func symbol(for mime: String) -> String {
        if mime.hasPrefix("image/") { return "photo" }
        if mime == "application/pdf" { return "doc.richtext" }

        return "doc"
    }

    private var sizeText: String {
        ByteCountFormatter.string(fromByteCount: Int64(document.size), countStyle: .file)
    }
}

/// Processing state, in words as well as colour — a state a reader cannot
/// distinguish by hue is no state at all (spec section 7).
struct StatusBadge: View {
    @Environment(\.colorScheme) private var scheme

    let status: ProcessingStatus

    var body: some View {
        Text(status.localizedName)
            .font(Tokens.Typography.footnoteRelative)
            .foregroundStyle(tint.resolve(for: scheme))
            .padding(.horizontal, Tokens.Spacing.sm)
            .padding(.vertical, Tokens.Spacing.xxs)
            .background(surface.resolve(for: scheme))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.sm))
    }

    private var tint: ThemedColor {
        switch status {
        case .done: return Tokens.Palette.success
        case .failed: return Tokens.Palette.critical
        case .skipped: return Tokens.Palette.textSecondary
        case .pending, .queued, .processing: return Tokens.Palette.info
        }
    }

    private var surface: ThemedColor {
        switch status {
        case .done: return Tokens.Palette.successSurface
        case .failed: return Tokens.Palette.criticalSurface
        case .skipped: return Tokens.Palette.surface
        case .pending, .queued, .processing: return Tokens.Palette.infoSurface
        }
    }
}
