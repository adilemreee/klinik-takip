import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// The before/after gallery, and the comparison it opens into (spec M7).
public struct PhotoGalleryView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: PhotoGalleryModel
    private let linkFor: @Sendable (String) async -> URL?

    @State private var state = GalleryState()
    @State private var comparing = false

    /// - Parameter linkFor: mints a short-lived signed URL for a photo. Supplied
    ///   by the caller so the screen never holds a URL longer than it draws it.
    public init(
        model: PhotoGalleryModel,
        linkFor: @escaping @Sendable (String) async -> URL?
    ) {
        self.model = model
        self.linkFor = linkFor
    }

    public var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task { await refresh { await model.load() } }
        .sheet(isPresented: $comparing) {
            if let pair = state.comparison {
                PhotoComparisonView(pair: pair, linkFor: linkFor)
            }
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
            MessageState(icon: "photo.on.rectangle", text: L10n.string("photo.empty"))

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
            gallery
        }
    }

    private var gallery: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                if let error = state.error {
                    ErrorBanner(message: error)
                }

                Picker("", selection: areaSelection) {
                    ForEach(state.groups) { group in
                        Text(group.bodyArea ?? L10n.string("photo.noBodyArea")).tag(group.id)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityLabel(L10n.string("photo.bodyArea"))

                if let group = state.selectedGroup {
                    ForEach(group.photos) { photo in
                        PhotoRow(photo: photo, linkFor: linkFor)
                    }
                }

                // Offered only when there are two photos to compare: a slider
                // over a single image does nothing and suggests there is a
                // change to see.
                if state.comparison != nil {
                    PrimaryButton(
                        title: L10n.string("photo.compare"),
                        isBusy: false,
                        isEnabled: true
                    ) {
                        comparing = true
                    }
                }
            }
            .padding(Tokens.Spacing.lg)
        }
    }

    private var areaSelection: Binding<String> {
        Binding(
            get: { state.selectedArea ?? state.groups.first?.id ?? "" },
            set: { area in Task { await refresh { await model.select(area: area) } } }
        )
    }

    private func refresh(_ work: () async -> Void) async {
        await work()
        state = await model.currentState()
    }
}

struct PhotoRow: View {
    @Environment(\.colorScheme) private var scheme

    let photo: ClinicalPhoto
    let linkFor: @Sendable (String) async -> URL?

    @State private var url: URL?

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            SignedImage(url: url)
                .frame(height: 200)
                .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))

            HStack(spacing: Tokens.Spacing.sm) {
                Text(photo.phaseLabel ?? photo.category.localizedName)
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Spacer()

                Text(photo.takenAt, style: .date)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            // Said on the photo itself rather than buried in a settings screen:
            // whether this image may be used outside the clinic is a fact about
            // the image, and the person looking at it is the one who might.
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
        .task { url = await linkFor(photo.id) }
        .accessibilityElement(children: .combine)
    }
}

/// Two photos with a divider the reader drags (spec M7: slider comparison).
public struct PhotoComparisonView: View {
    @Environment(\.colorScheme) private var scheme

    private let pair: ComparisonPair
    private let linkFor: @Sendable (String) async -> URL?

    @State private var beforeURL: URL?
    @State private var afterURL: URL?
    @State private var split: CGFloat = 0.5

    public init(pair: ComparisonPair, linkFor: @escaping @Sendable (String) async -> URL?) {
        self.pair = pair
        self.linkFor = linkFor
    }

    public var body: some View {
        VStack(spacing: Tokens.Spacing.lg) {
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    SignedImage(url: afterURL)

                    SignedImage(url: beforeURL)
                        .frame(width: geometry.size.width * split, alignment: .leading)
                        .clipped()

                    Rectangle()
                        .fill(Tokens.Palette.accent.resolve(for: scheme))
                        .frame(width: 2)
                        .offset(x: geometry.size.width * split - 1)
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            split = min(max(value.location.x / geometry.size.width, 0), 1)
                        }
                )
            }
            .frame(height: 360)
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))

            // The slider is a drag gesture, which VoiceOver cannot perform. The
            // same comparison is reachable as a value a rotor can adjust.
            Slider(value: $split, in: 0...1)
                .accessibilityLabel(L10n.string("photo.compareSlider"))
                .accessibilityValue("\(Int(split * 100))%")

            HStack {
                label(pair.before, key: "photo.before")
                Spacer()
                label(pair.after, key: "photo.after")
            }
        }
        .padding(Tokens.Spacing.lg)
        .background(Tokens.Palette.background.resolve(for: scheme))
        .task {
            beforeURL = await linkFor(pair.before.id)
            afterURL = await linkFor(pair.after.id)
        }
    }

    private func label(_ photo: ClinicalPhoto, key: String) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
            Text(L10n.string(key))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            Text(photo.phaseLabel ?? photo.category.localizedName)
                .font(Tokens.Typography.calloutRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
        }
        .accessibilityElement(children: .combine)
    }
}

/// An image behind a short-lived signed URL, with a placeholder while it loads.
struct SignedImage: View {
    @Environment(\.colorScheme) private var scheme

    let url: URL?

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        placeholder(icon: "exclamationmark.triangle")
                    default:
                        placeholder(icon: "photo")
                    }
                }
            } else {
                placeholder(icon: "photo")
            }
        }
        .frame(maxWidth: .infinity)
        .clipped()
    }

    private func placeholder(icon: String) -> some View {
        ZStack {
            Tokens.Palette.surface.resolve(for: scheme)
            Image(systemName: icon)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                // A stand-in for a photograph that has not loaded. The photo's
                // own row carries the description; this is the empty frame.
                .accessibilityHidden(true)
        }
    }
}
