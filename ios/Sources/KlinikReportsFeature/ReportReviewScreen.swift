import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * What a clinician signs off before a patient sees it (spec M5).
 *
 * Both renderings are on the card, in this order: the clinical one first,
 * because that is what the decision is made on, and the plain-language one
 * below it, because that is what will actually be sent. A screen that showed
 * only the clinical text would be asking somebody to release words they have
 * not read.
 */
public struct ReportReviewScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: ReportReviewModel
    private let openPatient: (String, String) -> Void

    @State private var state = ReportReviewState()
    @State private var expanded: Set<String> = []

    public init(model: ReportReviewModel, openPatient: @escaping (String, String) -> Void) {
        self.model = model
        self.openPatient = openPatient
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.actionError)

                switch state.phase {
                case .loading:
                    VStack(spacing: Tokens.Spacing.lg) {
                        SkeletonCard(lines: 5)
                        SkeletonCard(lines: 4)
                    }
                    .accessibilityElement()
                    .accessibilityLabel(L10n.string("common.loading"))

                case .empty:
                    MessageState(
                        icon: "checkmark.circle",
                        text: L10n.string("report.pendingEmpty")
                    )
                    .frame(minHeight: 320)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .loaded:
                    ForEach(model.ordered()) { view in
                        card(view)
                    }
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("report.pendingTitle"))
        .refreshable { await reload() }
        .task { await reload() }
    }

    private func card(_ view: ReportView) -> some View {
        Card(tone: view.report.riskLevel?.needsAttention == true ? .warning : .neutral) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                header(view)
                clinical(view)
                patientFacing(view)
                disclaimer(view)
                actions(view)
            }
        }
    }

    private func header(_ view: ReportView) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
            Button {
                openPatient(view.patient.id, view.patient.fullName)
            } label: {
                HStack(spacing: Tokens.Spacing.md) {
                    InitialsAvatar(name: view.patient.fullName, diameter: 40)

                    VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                        Text(view.patient.fullName)
                            .font(Tokens.Typography.subheadingRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                        Text("\(L10n.string("patient.fileNumber")) \(view.patient.mrn)")
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    }

                    Spacer(minLength: Tokens.Spacing.sm)

                    Image(systemName: "chevron.right")
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textDisabled.resolve(for: scheme))
                        .accessibilityHidden(true)
                }
                .frame(minHeight: Tokens.minimumTouchTarget)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)

            HStack(spacing: Tokens.Spacing.sm) {
                if let risk = view.report.riskLevel {
                    Badge(
                        risk.localizedName,
                        tone: ReportReviewScreen.tone(for: risk),
                        symbol: risk.needsAttention
                            ? Tokens.State.labCritical.iconName
                            : "circle.fill"
                    )
                }

                Badge(view.report.source, tone: .info, symbol: "testtube.2")

                Spacer(minLength: 0)

                Text(view.report.generatedAt.formatted(date: .abbreviated, time: .shortened))
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }

    private func clinical(_ view: ReportView) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(L10n.string("report.doctorView"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            Markdown(view.report.contentMd)
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                .lineLimit(expanded.contains(view.id) ? nil : 8)

            Button(
                expanded.contains(view.id)
                    ? L10n.string("common.showLess")
                    : L10n.string("common.showMore")
            ) {
                if expanded.contains(view.id) {
                    expanded.remove(view.id)
                } else {
                    expanded.insert(view.id)
                }
            }
            .font(Tokens.Typography.calloutRelative)
            .frame(minHeight: Tokens.minimumTouchTarget)
            .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
        }
    }

    /// The half that would actually be sent. Tinted differently so nobody
    /// mistakes the clinical text for what the patient will read.
    @ViewBuilder
    private func patientFacing(_ view: ReportView) -> some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            Text(L10n.string("report.patientView"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            if let text = view.report.patientFacingMd, !text.isEmpty {
                Markdown(text)
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .padding(Tokens.Spacing.md)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Tokens.Palette.infoSurface.resolve(for: scheme))
                    .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
            } else {
                Text(L10n.string("report.noPatientText"))
                    .font(Tokens.Typography.calloutRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func disclaimer(_ view: ReportView) -> some View {
        HStack(alignment: .top, spacing: Tokens.Spacing.sm) {
            Image(systemName: "sparkles")
                .font(Tokens.Typography.footnoteRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                .accessibilityHidden(true)

            // The server writes this in the patient's language; it is not the
            // client's to compose.
            Text(view.disclaimer)
                .font(Tokens.Typography.footnoteRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func actions(_ view: ReportView) -> some View {
        VStack(spacing: Tokens.Spacing.sm) {
            PrimaryButton(
                title: L10n.string("report.releaseAction"),
                isBusy: state.busyId == view.id,
                isEnabled: state.busyId == nil && view.report.patientFacingMd?.isEmpty == false
            ) {
                await review(view.id, release: true)
            }

            Button(L10n.string("report.holdAction")) {
                Task { await review(view.id, release: false) }
            }
            .font(Tokens.Typography.calloutRelative)
            .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            .disabled(state.busyId != nil)
        }
    }

    static func tone(for risk: RiskLevel) -> Tone {
        switch risk {
        case .critical: return .critical
        case .high: return .warning
        case .medium: return .info
        case .low: return .success
        }
    }

    private func review(_ id: String, release: Bool) async {
        await model.review(id, release: release)
        state = model.currentState()
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

/**
 * Markdown, rendered rather than shown as asterisks.
 *
 * The AI layer writes headings and bullet lists; `AttributedString`'s inline
 * parsing would collapse them onto one line, so the full-document option is
 * used and paragraphs are laid out here. A string that fails to parse is shown
 * verbatim — losing a clinician's report to a stray character would be worse
 * than showing them a stray character.
 */
struct Markdown: View {
    private let source: String

    init(_ source: String) {
        self.source = source
    }

    var body: some View {
        Text(Markdown.attributed(source))
            .fixedSize(horizontal: false, vertical: true)
            .multilineTextAlignment(.leading)
    }

    /// `nonisolated` because it is a pure function of its argument. A `View` is
    /// implicitly main-actor isolated, and older toolchains carry that to its
    /// static members — which made this compile here and fail in CI.
    nonisolated static func attributed(_ source: String) -> AttributedString {
        (try? AttributedString(
            markdown: source,
            options: .init(interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)
        )) ?? AttributedString(source)
    }
}
