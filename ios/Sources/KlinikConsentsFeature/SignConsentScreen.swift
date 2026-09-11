import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

public enum ConsentFormPhase: Sendable, Equatable {
    case loading
    case loaded(ConsentForm)
    /// The clinic has not published a consent form.
    case unpublished
    /// The clinic has not recorded which operation this is. A different
    /// problem with a different person to chase, so a different message: a
    /// consent form that does not name the operation is not informed consent,
    /// and the app refuses to show one rather than filling the gap itself.
    case procedureUnknown
    case failed(String)
}

public struct SignConsentState: Sendable, Equatable {
    public var phase: ConsentFormPhase = .loading
    public var submitting = false
    public var error: String?
    /// Set once the clinic has it, so the screen can say so and close.
    public var signed = false

    public init() {}
}

/**
 * Reading and signing the treatment consent (spec M17).
 *
 * A model rather than logic in the view, for the two rules that matter: the
 * form cannot be signed before it has been read to the end, and a submission
 * carries the version of the wording that was actually on screen. A consent
 * recorded against "version 1" that the patient never saw is worth nothing in
 * the argument it exists for.
 */
public actor SignConsentModel {
    private let consents: ConsentsAPI

    private(set) public var state = SignConsentState()

    public init(consents: ConsentsAPI) {
        self.consents = consents
    }

    /// What the server calls "we have not recorded your operation".
    static let procedureMissing = "PROCEDURE_NOT_RECORDED"

    public func currentState() -> SignConsentState { state }

    public func load() async {
        state.phase = .loading

        do {
            state.phase = .loaded(try await consents.treatmentForm())
        } catch let error as APIError {
            if case .notFound(let body) = error {
                // The server says which of the two it is; guessing would send
                // the patient to the wrong person.
                state.phase = body.message == SignConsentModel.procedureMissing
                    ? .procedureUnknown
                    : .unpublished
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    /**
     * Records the consent with the signature drawn for it.
     *
     * The version comes from the document on screen, never from a constant:
     * the clinic can change the wording between one patient reading it and the
     * next, and a record that names the wrong version names nothing.
     */
    @discardableResult
    public func sign(_ signature: Data) async -> Bool {
        guard case .loaded(let document) = state.phase, !state.submitting else { return false }

        state.submitting = true
        state.error = nil
        defer { state.submitting = false }

        do {
            _ = try await consents.give(
                type: .treatment,
                version: document.version,
                documentText: document.body,
                signature: signature
            )
        } catch let error as APIError {
            state.error = L10n.message(for: error)
            return false
        } catch {
            state.error = L10n.string("error.server")
            return false
        }

        state.signed = true

        return true
    }
}

/**
 * The consent form, and the line to sign it on.
 *
 * The button is refused until something has actually been drawn — a single tap
 * leaves one point, which is not a signature — and the pad offers exactly two
 * verbs: clear it, or accept it. No eraser: a signature somebody can partially
 * rub out is one nobody can rely on.
 */
@MainActor
public struct SignConsentScreen: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    private let model: SignConsentModel

    @State private var state = SignConsentState()
    @State private var strokes: [[CGPoint]] = []
    @State private var padSize: CGSize = .zero
    /// True once the end of the wording has been on screen. The button waits
    /// for it — see `form(_:)`.
    @State private var readToEnd = false
    /// True while a stroke is in progress, so the document holds still.
    @State private var drawing = false

    public init(model: SignConsentModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                content
            }
            .padding(Tokens.Spacing.lg)
        }
        // The pad below is a drag surface inside this scroll view. The pad
        // takes the gesture first, and this stops the page moving under the
        // hand that is drawing on it.
        .scrollDisabled(drawing)
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("consent.type.TREATMENT"))
        .task {
            await model.load()
            state = await model.currentState()
        }
        .refreshable {
            await model.load()
            state = await model.currentState()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            SkeletonCard(lines: 6)
                .accessibilityElement()
                .accessibilityLabel(L10n.string("common.loading"))

        case .unpublished:
            Card(tone: .info) {
                Text(L10n.string("consent.formUnpublished"))
                    .font(Tokens.Typography.bodyRelative)
                    .fixedSize(horizontal: false, vertical: true)
            }

        case .procedureUnknown:
            Card(tone: .warning) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                    Text(L10n.string("consent.procedureUnknown"))
                        .font(Tokens.Typography.bodyRelative)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(L10n.string("consent.procedureUnknownWhy"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

        case .failed(let message):
            Card(tone: .critical) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                    Text(message)
                        .font(Tokens.Typography.bodyRelative)
                        .fixedSize(horizontal: false, vertical: true)

                    Button(L10n.string("common.retry")) {
                        Task {
                            await model.load()
                            state = await model.currentState()
                        }
                    }
                    .frame(minHeight: Tokens.minimumTouchTarget)
                }
            }

        case .loaded(let document):
            form(document)
        }
    }

    @ViewBuilder
    private func form(_ document: ConsentForm) -> some View {
        if state.signed {
            Card(tone: .success) {
                Text(L10n.string("consent.signedThanks"))
                    .font(Tokens.Typography.bodyRelative)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            Card {
                Markdown(document.body)
                    .font(Tokens.Typography.bodyRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
            }

            /*
             * The end of the wording.
             *
             * Nothing is drawn; what matters is that it has been on screen,
             * which is the closest an app can get to "read it". A consent
             * recorded against a document the patient never scrolled through
             * is worth nothing in the argument it exists for — and a document
             * short enough to fit on one screen satisfies this immediately,
             * which is also correct.
             */
            Color.clear
                .frame(height: 1)
                .onAppear { readToEnd = true }
                .accessibilityHidden(true)

            SectionHeader(
                title: L10n.string("consent.signature"),
                subtitle: L10n.string("consent.signHint")
            )

            SignaturePad(
                strokes: $strokes,
                labels: SignConsentScreen.labels,
                onDrawing: { drawing = $0 }
            )
            .background(
                // Measured rather than assumed, and watched rather than read
                // once: the PNG is rendered at the size the strokes were drawn
                // at, and a rotation or a text-size change after `onAppear`
                // would leave that number stale and the signature stretched.
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { padSize = proxy.size }
                        .onChange(of: proxy.size) { _, size in padSize = size }
                }
            )

            HStack(spacing: Tokens.Spacing.md) {
                Button(L10n.string("consent.clearSignature")) { strokes = [] }
                    .disabled(strokes.isEmpty || state.submitting)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)

                PrimaryButton(
                    title: L10n.string("consent.give"),
                    isBusy: state.submitting,
                    isEnabled: SignConsentScreen.canSign(
                        strokes: strokes,
                        readToEnd: readToEnd,
                        submitting: state.submitting
                    )
                ) {
                    await submit()
                }
            }

            // One reason at a time, and the one that is actually in the way.
            if !readToEnd {
                Text(L10n.string("consent.readToEndFirst"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
            } else if !SignaturePad.isSigned(strokes) {
                Text(L10n.string("consent.signatureRequired"))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let error = state.error {
                ErrorBanner(message: error)
            }

            Text(String(format: L10n.string("consent.version"), document.version))
                .font(Tokens.Typography.footnoteRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
        }
    }

    private func submit() async {
        #if canImport(UIKit)
        guard let png = SignaturePad.png(strokes: strokes, size: padSize) else {
            state.error = L10n.string("consent.signatureRequired")
            return
        }

        _ = await model.sign(png)
        state = await model.currentState()
        #endif
    }

    /**
     * Whether the consent may be given.
     *
     * Both conditions, not either: a signature on a document nobody scrolled
     * through is a mark, not consent. `nonisolated` so the tests can hold the
     * rule directly rather than through a screen.
     */
    nonisolated static func canSign(
        strokes: [[CGPoint]],
        readToEnd: Bool,
        submitting: Bool
    ) -> Bool {
        readToEnd && SignaturePad.isSigned(strokes) && !submitting
    }

    /// `nonisolated` because a static on a `View` otherwise inherits the
    /// view's main-actor isolation, and the tests read it directly.
    nonisolated static var labels: SignaturePad.Labels {
        SignaturePad.Labels(
            name: L10n.string("consent.signature"),
            hint: L10n.string("consent.signHint"),
            signed: L10n.string("consent.signed"),
            notSigned: L10n.string("consent.notSigned")
        )
    }
}
