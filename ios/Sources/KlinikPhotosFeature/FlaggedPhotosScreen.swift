import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * The photographs a machine thought somebody should look at (spec M5).
 *
 * Every card says the same three things in the same order: what was seen, that
 * it was a machine that saw it, and that it is not a diagnosis. The findings
 * come from a closed vocabulary the server enforces — "kızarıklık", not
 * "selülit" — because the difference between describing and diagnosing is the
 * whole of what makes this safe to show a clinician.
 */
public struct FlaggedPhotosScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: FlaggedPhotosModel
    private let linkFor: (String) async -> URL?
    private let openPatient: ((String) -> Void)?

    @State private var state = FlaggedState()

    public init(
        model: FlaggedPhotosModel,
        linkFor: @escaping (String) async -> URL?,
        openPatient: ((String) -> Void)? = nil
    ) {
        self.model = model
        self.linkFor = linkFor
        self.openPatient = openPatient
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.error)

                switch state.phase {
                case .loading:
                    SkeletonCard(lines: 4)
                        .accessibilityElement()
                        .accessibilityLabel(L10n.string("common.loading"))

                case .notPermitted:
                    MessageState(icon: "lock", text: L10n.string("photo.notPermitted"))
                        .frame(minHeight: 240)

                case .empty:
                    MessageState(icon: "checkmark.circle", text: L10n.string("photo.noneFlagged"))
                        .frame(minHeight: 280)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .loaded:
                    ForEach(model.ordered()) { photo in
                        card(photo)
                    }
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("photo.flaggedTitle"))
        .refreshable { await reload() }
        .task { await reload() }
    }

    private func card(_ photo: ClinicalPhoto) -> some View {
        Card(tone: photo.needsReview ? .warning : .neutral) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                RemotePhoto(photoId: photo.id, linkFor: linkFor)
                    .frame(maxWidth: .infinity)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))

                HStack(spacing: Tokens.Spacing.sm) {
                    Badge(
                        photo.phaseLabel ?? photo.category.localizedName,
                        symbol: "photo"
                    )

                    if let area = photo.bodyArea {
                        Badge(area, symbol: "figure.stand")
                    }

                    Spacer(minLength: 0)

                    Text(photo.takenAt.formatted(date: .abbreviated, time: .omitted))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }

                if !photo.localizedFindings.isEmpty {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                        ForEach(photo.localizedFindings, id: \.self) { finding in
                            Label(finding, systemImage: "eye.trianglebadge.exclamationmark")
                                .font(Tokens.Typography.calloutRelative)
                                .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                // Required under every AI output (spec M5), and load-bearing
                // here: the difference between "kızarıklık görüldü" and a
                // diagnosis is the reason this screen is safe to show at all.
                Text(L10n.string("photo.assessment.disclaimer"))
                    .font(Tokens.Typography.footnoteRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)

                if let note = photo.note, !note.isEmpty {
                    FieldRow(label: L10n.string("photo.patientNote"), value: note)
                }

                Button(L10n.string("photo.assessAgain")) {
                    Task {
                        _ = await model.assess(photo.id)
                        state = model.currentState()
                    }
                }
                .font(Tokens.Typography.calloutRelative)
                .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                .disabled(state.busyId != nil)
            }
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

/// A photograph fetched through a short-lived signed link.
struct RemotePhoto: View {
    let photoId: String
    let linkFor: (String) async -> URL?

    @State private var url: URL?

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFit()
                    case .failure:
                        // Nothing rather than a placeholder: a wrong picture on
                        // a clinical card is worse than no picture.
                        Color.clear
                    default:
                        ProgressView().accessibilityLabel(L10n.string("common.loading"))
                    }
                }
            } else {
                ProgressView().accessibilityLabel(L10n.string("common.loading"))
            }
        }
        .task { url = await linkFor(photoId) }
        .accessibilityLabel(L10n.string("photo.image"))
    }
}
