import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * A patient's consents, as a clinician sees them (spec M17, KVKK §8).
 *
 * Read-only, and that is the whole design: consenting on somebody else's
 * behalf is not a thing this app does, so there is no button here that could
 * be mistaken for one. What a clinician needs before an operation is whether
 * the treatment consent is signed, when, against which wording — and to be
 * able to look at the signature.
 *
 * Withdrawn consents are shown rather than hidden. Proving a consent existed
 * while it was relied on is the controller's burden, and a list that quietly
 * drops the withdrawn ones cannot do that.
 */
@MainActor
public struct PatientConsentsView: View {
    @Environment(\.colorScheme) private var scheme

    private let model: ConsentsModel
    /// Opens the signature image. The link is short-lived and the bucket is
    /// private, so this is a URL to hand to a viewer, not to keep.
    private let openSignature: (URL) -> Void

    @State private var state = ConsentsState()
    @State private var loadingSignature: String?

    public init(model: ConsentsModel, openSignature: @escaping (URL) -> Void) {
        self.model = model
        self.openSignature = openSignature
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                content
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("consent.staffTitle"))
        .task { await reload() }
        .refreshable { await reload() }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            SkeletonCard(lines: 4)
                .accessibilityElement()
                .accessibilityLabel(L10n.string("common.loading"))

        case .notFound:
            MessageState(icon: "questionmark.folder", text: L10n.string("error.notFound"))

        case .failed(let message):
            MessageState(
                icon: Tokens.State.labCritical.iconName,
                text: message,
                retryTitle: L10n.string("common.retry")
            ) {
                await reload()
            }

        case .loaded:
            if state.consents.isEmpty {
                MessageState(icon: "doc.text", text: L10n.string("consent.noneRecorded"))
            } else {
                ForEach(state.consents) { consent in
                    row(consent)
                }
            }
        }
    }

    private func row(_ consent: Consent) -> some View {
        Card(tone: consent.active ? .success : .neutral) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                Text(consent.type.localizedName)
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                HStack(spacing: Tokens.Spacing.sm) {
                    // In words as well as colour (spec section 7).
                    Badge(
                        L10n.string(consent.active ? "consent.given" : "consent.withdrawn"),
                        tone: consent.active ? .success : .neutral
                    )

                    if consent.hasSignature {
                        Badge(
                            L10n.string("consent.signed"),
                            tone: .info,
                            symbol: "signature"
                        )
                    }
                }

                FieldRow(
                    label: L10n.string("consent.signedAt"),
                    value: consent.signedAt.formatted(date: .abbreviated, time: .shortened)
                )

                // Which wording, because "they consented" names nothing without
                // it — and a text that changed later must not silently inherit
                // an agreement to the old one.
                FieldRow(
                    label: L10n.string("consent.versionLabel"),
                    value: String(consent.version)
                )

                if let revokedAt = consent.revokedAt {
                    FieldRow(
                        label: L10n.string("consent.withdrawnAt"),
                        value: revokedAt.formatted(date: .abbreviated, time: .shortened),
                        tone: .warning
                    )
                }

                if consent.hasSignature {
                    Button(L10n.string("consent.viewSignature")) {
                        Task { await open(consent) }
                    }
                    .buttonStyle(.bordered)
                    .disabled(loadingSignature == consent.id)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func open(_ consent: Consent) async {
        loadingSignature = consent.id
        defer { loadingSignature = nil }

        if let url = await model.signatureURL(for: consent.id) {
            openSignature(url)
        }
    }

    private func reload() async {
        await model.load()
        state = await model.currentState()
    }
}
