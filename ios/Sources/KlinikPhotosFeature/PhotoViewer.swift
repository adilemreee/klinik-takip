import KlinikAPI
import KlinikCore
import KlinikDesign
import SwiftUI

/**
 * One clinical photograph, full screen.
 *
 * The gallery draws thumbnails two hundred points high, which is enough to
 * tell a wound photograph from a passport scan and not enough to look at a
 * suture line. This is where somebody actually looks: pinch to zoom, drag to
 * move, double-tap to start again.
 *
 * Saving goes through the system share sheet rather than writing to the
 * camera roll directly. Where a clinical photograph ends up is the clinician's
 * decision and their device's business, and an app that silently put wound
 * photographs in a personal photo library would be making that decision for
 * them. Asking the server for the signed link is already recorded as a read of
 * that photo, so the moment the image can leave is in the audit log either
 * way.
 */
/**
 * The few facts the viewer needs about a photograph.
 *
 * Taken instead of a whole model type because the gallery and the flagged
 * worklist carry different ones — the worklist's rows also name a patient —
 * and a viewer that insisted on one of them would need a second copy of
 * itself for the other.
 */
public struct ViewablePhoto: Identifiable, Sendable, Equatable {
    public let id: String
    public let title: String
    public let takenAt: Date
    public let bodyArea: String?
    public let mime: String
    public let hasUsageConsent: Bool

    public init(
        id: String,
        title: String,
        takenAt: Date,
        bodyArea: String?,
        mime: String,
        hasUsageConsent: Bool
    ) {
        self.id = id
        self.title = title
        self.takenAt = takenAt
        self.bodyArea = bodyArea
        self.mime = mime
        self.hasUsageConsent = hasUsageConsent
    }
}

public extension ClinicalPhoto {
    var viewable: ViewablePhoto {
        ViewablePhoto(
            id: id,
            title: phaseLabel ?? category.localizedName,
            takenAt: takenAt,
            bodyArea: bodyArea,
            mime: mime,
            hasUsageConsent: hasUsageConsent
        )
    }
}

public extension FlaggedPhoto {
    var viewable: ViewablePhoto {
        ViewablePhoto(
            id: id,
            title: phaseLabel ?? category.localizedName,
            takenAt: takenAt,
            bodyArea: bodyArea,
            mime: mime,
            hasUsageConsent: hasUsageConsent
        )
    }
}

public struct PhotoViewer: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    private let photo: ViewablePhoto
    private let linkFor: @Sendable (String) async -> URL?

    @State private var url: URL?
    @State private var saved: URL?
    @State private var downloading = false
    @State private var failed = false

    /// Live zoom, and what it settles at when the fingers lift.
    @State private var zoom: CGFloat = 1
    @State private var committedZoom: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var committedOffset: CGSize = .zero

    public init(photo: ViewablePhoto, linkFor: @escaping @Sendable (String) async -> URL?) {
        self.photo = photo
        self.linkFor = linkFor
    }

    public var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                image
                facts
            }
            .background(Tokens.Palette.background.resolve(for: scheme))
            .navigationTitle(photo.title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.string("common.close")) { dismiss() }
                        .frame(minHeight: Tokens.minimumTouchTarget)
                }

                ToolbarItem(placement: .primaryAction) {
                    if let saved {
                        ShareLink(item: saved) {
                            Label(
                                L10n.string("photo.saveOrShare"),
                                systemImage: "square.and.arrow.up"
                            )
                        }
                    } else {
                        Button {
                            Task { await prepareForSharing() }
                        } label: {
                            if downloading {
                                ProgressView()
                                    .accessibilityLabel(L10n.string("common.loading"))
                            } else {
                                Label(
                                    L10n.string("photo.saveOrShare"),
                                    systemImage: "square.and.arrow.down"
                                )
                            }
                        }
                        .disabled(downloading || url == nil)
                    }
                }
            }
        }
        .task { url = await linkFor(photo.id) }
    }

    private var image: some View {
        GeometryReader { geometry in
            SignedImage(url: url, fill: false)
                .scaleEffect(zoom)
                .offset(offset)
                .frame(width: geometry.size.width, height: geometry.size.height)
                .contentShape(Rectangle())
                .gesture(
                    MagnifyGesture()
                        .onChanged { value in
                            // Never below one: an image smaller than its frame
                            // drifts away from the finger and reads as broken.
                            zoom = max(1, committedZoom * value.magnification)
                        }
                        .onEnded { _ in committedZoom = zoom }
                        .simultaneously(
                            with: DragGesture()
                                .onChanged { value in
                                    // Only when there is something to pan to.
                                    guard zoom > 1 else { return }

                                    offset = CGSize(
                                        width: committedOffset.width + value.translation.width,
                                        height: committedOffset.height + value.translation.height
                                    )
                                }
                                .onEnded { _ in committedOffset = offset }
                        )
                )
                // A way back out of a zoom somebody got lost in, without
                // closing and reopening the photograph.
                .onTapGesture(count: 2) { reset() }
                .accessibilityLabel(L10n.string("photo.image"))
                .accessibilityHint(L10n.string("photo.zoomHint"))
        }
        .clipped()
    }

    private var facts: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            if failed {
                Text(L10n.string("photo.downloadFailed"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))
            }

            HStack {
                Text(photo.takenAt, style: .date)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                if let area = photo.bodyArea {
                    Text("· \(area)")
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }

                Spacer()
            }

            // Carried into the viewer rather than left on the thumbnail: this
            // is the screen somebody shares from, and whether the image may
            // leave the clinic is the fact that decides it.
            Label(
                L10n.string(photo.hasUsageConsent ? "photo.consentGiven" : "photo.clinicalUseOnly"),
                systemImage: photo.hasUsageConsent ? "checkmark.shield" : "lock.shield"
            )
            .font(Tokens.Typography.captionRelative)
            .foregroundStyle(
                (photo.hasUsageConsent ? Tokens.Palette.success : Tokens.Palette.textSecondary)
                    .resolve(for: scheme)
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Tokens.Spacing.lg)
    }

    private func reset() {
        zoom = 1
        committedZoom = 1
        offset = .zero
        committedOffset = .zero
    }

    /**
     * Fetches the bytes into a temporary file so the share sheet can offer
     * "Save Image" and "Save to Files".
     *
     * Sharing the signed URL instead would hand somebody a link that stops
     * working in minutes, and anybody it reached would be reading clinical
     * data through a link the clinic never gave them.
     */
    private func prepareForSharing() async {
        guard let url else { return }

        downloading = true
        failed = false

        defer { downloading = false }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)

            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("photo-\(photo.id)")
                .appendingPathExtension(photo.mime == "image/png" ? "png" : "jpg")

            try data.write(to: destination, options: .atomic)
            saved = destination
        } catch {
            failed = true
        }
    }
}
