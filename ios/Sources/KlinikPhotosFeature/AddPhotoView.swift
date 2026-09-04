import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * Adding a follow-up photograph (spec M7).
 *
 * The body area is required, and that is the whole point of the screen rather
 * than a validation nicety. A before/after pair only means something if the two
 * pictures are of the same thing from roughly the same angle; an untagged photo
 * cannot be paired with anything, so it becomes a picture nobody ever compares.
 *
 * The camera itself lives in the app shell — this screen asks for a file and
 * knows nothing about UIKit, which is what lets it be built and reasoned about
 * without a device.
 */
public struct AddPhotoView: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    private let model: PhotoGalleryModel

    /**
     * Takes or picks a photograph, given the reference to line it up against.
     *
     * The reference is passed in rather than fetched here so the shell can put
     * it under a live camera as a translucent guide where the device has one,
     * and simply ignore it where it does not.
     */
    private let capture: (_ reference: ClinicalPhoto?) async -> URL?

    @State private var category: PhotoCategory = .after
    @State private var bodyArea = ""
    @State private var state = GalleryState()
    @State private var sent = false

    public init(
        model: PhotoGalleryModel,
        capture: @escaping (_ reference: ClinicalPhoto?) async -> URL?
    ) {
        self.model = model
        self.capture = capture
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                Text(L10n.string("photo.chooseCategory"))
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                Picker(L10n.string("photo.chooseCategory"), selection: $category) {
                    ForEach(PhotoCategory.allCases, id: \.rawValue) { option in
                        Text(option.localizedName).tag(option)
                    }
                }
                .pickerStyle(.segmented)

                VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                    Text(L10n.string("photo.bodyArea"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                    TextField(L10n.string("photo.bodyAreaHint"), text: $bodyArea)
                        .textFieldStyle(.roundedBorder)
                        .frame(minHeight: Tokens.minimumTouchTarget)
                }

                // Said before the button rather than after a rejected attempt:
                // somebody who has already taken the photo and been refused is
                // being asked to take it again.
                if trimmedArea.isEmpty {
                    Text(L10n.string("photo.needBodyArea"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }

                Text(L10n.string("photo.overlayHint"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                if let error = state.error {
                    ErrorBanner(message: error)
                }

                if state.uploading {
                    HStack(spacing: Tokens.Spacing.md) {
                        ProgressView().accessibilityHidden(true)
                        Text(L10n.string("photo.uploading"))
                            .font(Tokens.Typography.bodyRelative)
                    }
                } else if sent {
                    Label(L10n.string("photo.uploaded"), systemImage: "checkmark.circle")
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.success.resolve(for: scheme))
                }

                Button(L10n.string("photo.capture")) {
                    Task { await takeAndSend() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(trimmedArea.isEmpty || state.uploading)
                .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)

                Text(L10n.string("photo.clinicalUseOnly"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("photo.add"))
    }

    private var trimmedArea: String {
        bodyArea.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func takeAndSend() async {
        sent = false

        // Fetched before the camera opens so the guide is already there when it
        // does. Nil is normal — the first photo of an area has nothing to line
        // up against.
        let reference = await model.overlayReference(bodyArea: trimmedArea)

        guard let fileURL = await capture(reference) else { return }

        let uploaded = await model.upload(
            fileURL: fileURL,
            category: category,
            bodyArea: trimmedArea,
            phaseLabel: nil
        )

        state = await model.currentState()

        if uploaded {
            sent = true
            // Reload so the new photograph is in the gallery behind this screen
            // rather than appearing only after the next launch.
            await model.load()
            state = await model.currentState()
        }
    }
}
