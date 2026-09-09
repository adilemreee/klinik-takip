import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * What the assistant is allowed to say (spec M4).
 *
 * The assistant answers only from these documents, which makes this the screen
 * where a clinic decides what a machine may tell somebody recovering from
 * surgery. So it is blunt about reachability: a document stored without an
 * embedding is stored and invisible to retrieval, and listing it beside the
 * working ones would let a clinic believe it had answered a question it cannot
 * answer.
 */
public struct ProtocolsScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: ProtocolsModel

    @State private var state = ProtocolsState()
    @State private var adding = false

    public init(model: ProtocolsModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.error)

                explanation

                switch state.phase {
                case .loading:
                    SkeletonCard(lines: 4)
                        .accessibilityElement()
                        .accessibilityLabel(L10n.string("common.loading"))

                case .notPermitted:
                    MessageState(icon: "lock", text: L10n.string("protocol.notPermitted"))
                        .frame(minHeight: 240)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .empty:
                    MessageState(icon: "doc.text", text: L10n.string("protocol.empty"))
                        .frame(minHeight: 200)

                case .loaded:
                    group(L10n.string("protocol.usable"), state.usable, tone: .neutral)
                    group(L10n.string("protocol.unusable"), state.unusable, tone: .warning)
                }

                Toggle(L10n.string("protocol.showRetired"), isOn: retiredBinding)
                    .font(Tokens.Typography.bodyRelative)
                    .frame(minHeight: Tokens.minimumTouchTarget)
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("protocol.title"))
        .refreshable { await reload() }
        .task { await reload() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: {
                    Label(L10n.string("protocol.add"), systemImage: "plus")
                }
                .frame(minHeight: Tokens.minimumTouchTarget)
            }
        }
        .sheet(isPresented: $adding) {
            AddProtocolSheet { title, content, procedure, language in
                let ok = await model.add(
                    title: title,
                    content: content,
                    procedureType: procedure,
                    language: language
                )
                state = model.currentState()

                if ok { adding = false }
            }
        }
    }

    private var explanation: some View {
        Card(tone: .info) {
            Text(L10n.string("protocol.explanation"))
                .font(Tokens.Typography.calloutRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var retiredBinding: Binding<Bool> {
        Binding(
            get: { state.includeRetired },
            set: { include in
                Task {
                    await model.showRetired(include)
                    state = model.currentState()
                }
            }
        )
    }

    @ViewBuilder
    private func group(_ title: String, _ documents: [ProtocolSummary], tone: Tone) -> some View {
        if !documents.isEmpty {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: title, subtitle: "\(documents.count)")

                ForEach(documents) { summary in
                    card(summary, tone: tone)
                }
            }
        }
    }

    private func card(_ summary: ProtocolSummary, tone: Tone) -> some View {
        Card(tone: tone) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                Text(summary.document.title)
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: Tokens.Spacing.sm) {
                    Badge(
                        summary.document.language.localizedUppercase,
                        tone: .info,
                        symbol: "globe"
                    )

                    if let procedure = summary.document.procedureType {
                        Badge(procedure, symbol: "scissors")
                    } else {
                        Badge(L10n.string("protocol.allPatients"), symbol: "person.2")
                    }

                    Spacer(minLength: 0)
                }

                // Why it cannot be quoted, in words. A greyed card with no
                // explanation is a card somebody re-uploads three times.
                if !summary.document.isActive {
                    Label(L10n.string("protocol.retired"), systemImage: "archivebox")
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                } else if !summary.embedded {
                    Label(L10n.string("protocol.notEmbedded"), systemImage: "exclamationmark.circle")
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(String(format: L10n.string("protocol.chunks"), summary.chunks))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }

                Text(summary.document.content)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)

                if summary.document.isActive {
                    Button(L10n.string("protocol.retire")) {
                        Task {
                            await model.retire(summary.document.id)
                            state = model.currentState()
                        }
                    }
                    .font(Tokens.Typography.calloutRelative)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))
                    .disabled(state.busyId != nil)
                }
            }
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

/// Adding a document the assistant may quote.
struct AddProtocolSheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let submit: (String, String, String, String) async -> Void

    @State private var title = ""
    @State private var content = ""
    @State private var procedure = ""
    @State private var language = "tr"
    @State private var busy = false

    var body: some View {
        FormScaffold(
            title: L10n.string("protocol.add"),
            subtitle: L10n.string("protocol.addHint")
        ) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                LabelledField(
                    label: L10n.string("protocol.documentTitle"),
                    text: $title,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                    Text(L10n.string("protocol.content"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                    TextField("", text: $content, axis: .vertical)
                        .textFieldStyle(.plain)
                        .lineLimit(6...20)
                        .padding(Tokens.Spacing.md)
                        .background(Tokens.Palette.surface.resolve(for: scheme))
                        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
                        .accessibilityLabel(L10n.string("protocol.content"))
                }

                LabelledField(
                    label: L10n.string("protocol.procedureType"),
                    text: $procedure,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                    Text(L10n.string("file.language"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                    Picker(L10n.string("file.language"), selection: $language) {
                        Text("TR").tag("tr")
                        Text("EN").tag("en")
                    }
                    .pickerStyle(.segmented)
                }

                PrimaryButton(
                    title: L10n.string("protocol.add"),
                    isBusy: busy,
                    isEnabled: ProtocolsModel.problem(title: title, content: content) == nil
                ) {
                    busy = true
                    await submit(title, content, procedure, language)
                    busy = false
                }

                Button(L10n.string("common.cancel")) { dismiss() }
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }
}
