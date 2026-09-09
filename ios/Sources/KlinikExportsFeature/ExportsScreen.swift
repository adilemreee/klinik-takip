import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * Taking data out of the clinic (spec M12).
 *
 * Two halves: asking for a spreadsheet, and the list of what has been asked
 * for. The list is not a convenience — every export is written to the audit log
 * with who took it and when, and a screen that hid the history would make the
 * log the only place the clinic could see its own exports.
 *
 * Columns this viewer may not export are shown and disabled rather than hidden.
 * A column simply missing from the list looks like data that does not exist,
 * and somebody would go looking for it somewhere less careful.
 */
public struct ExportsScreen: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.openURL) private var openURL

    private let model: ExportsModel

    @State private var state = ExportsState()
    @State private var country = ""
    @State private var useRange = false
    @State private var from = Calendar.current.date(byAdding: .month, value: -12, to: Date()) ?? Date()
    @State private var to = Date()

    public init(model: ExportsModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xl) {
                ErrorBanner(message: state.error)

                switch state.phase {
                case .loading:
                    VStack(spacing: Tokens.Spacing.lg) {
                        SkeletonCard(lines: 4)
                        SkeletonCard(lines: 3)
                    }
                    .accessibilityElement()
                    .accessibilityLabel(L10n.string("common.loading"))

                case .notPermitted:
                    MessageState(icon: "lock", text: L10n.string("export.notPermitted"))
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
                    request
                    history
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("export.title"))
        .refreshable { await reload() }
        .task { await reload() }
        .task { await pollWhileWorking() }
    }

    // MARK: - Asking

    private var request: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(
                title: L10n.string("export.newTitle"),
                subtitle: L10n.string("export.auditNote")
            )

            Card {
                VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                    Picker(L10n.string("export.format"), selection: formatBinding) {
                        ForEach(ExportFormat.allCases, id: \.self) { format in
                            Text(format.rawValue).tag(format)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityLabel(L10n.string("export.format"))

                    LabelledField(
                        label: L10n.string("export.country"),
                        text: $country,
                        isSecure: false,
                        contentType: .plain,
                        keyboard: .default
                    )

                    Toggle(L10n.string("export.useRange"), isOn: $useRange)
                        .font(Tokens.Typography.bodyRelative)
                        .frame(minHeight: Tokens.minimumTouchTarget)

                    if useRange {
                        DatePicker(
                            L10n.string("export.from"),
                            selection: $from,
                            displayedComponents: .date
                        )
                        .font(Tokens.Typography.bodyRelative)
                        .frame(minHeight: Tokens.minimumTouchTarget)

                        DatePicker(
                            L10n.string("export.to"),
                            selection: $to,
                            displayedComponents: .date
                        )
                        .font(Tokens.Typography.bodyRelative)
                        .frame(minHeight: Tokens.minimumTouchTarget)
                    }
                }
            }

            columns

            PrimaryButton(
                title: L10n.string("export.request"),
                isBusy: state.busy,
                isEnabled: !state.busy && !state.chosen.isEmpty
            ) {
                await model.requestPatientList(
                    from: useRange ? from : nil,
                    to: useRange ? to : nil,
                    country: country.trimmingCharacters(in: .whitespaces)
                )
                state = model.currentState()
            }
        }
    }

    private var formatBinding: Binding<ExportFormat> {
        Binding(
            get: { state.format },
            set: { format in
                model.choose(format: format)
                state = model.currentState()
            }
        )
    }

    private var columns: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(
                title: L10n.string("export.columns"),
                subtitle: String(format: L10n.string("export.chosenCount"), state.chosen.count)
            )

            ForEach(state.groupedColumns, id: \.group) { section in
                Card {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                        Text(L10n.string("export.group.\(section.group)"))
                            .font(Tokens.Typography.subheadingRelative)
                            .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                        ForEach(section.columns) { column in
                            Button {
                                guard column.available else { return }

                                model.toggle(column.key)
                                state = model.currentState()
                            } label: {
                                HStack(spacing: Tokens.Spacing.md) {
                                    Image(
                                        systemName: state.chosen.contains(column.key)
                                            ? "checkmark.square.fill"
                                            : "square"
                                    )
                                    .foregroundStyle(
                                        (column.available
                                            ? Tokens.Palette.accent
                                            : Tokens.Palette.textDisabled).resolve(for: scheme)
                                    )
                                    .accessibilityHidden(true)

                                    Text(column.header)
                                        .font(Tokens.Typography.bodyRelative)
                                        .foregroundStyle(
                                            (column.available
                                                ? Tokens.Palette.textPrimary
                                                : Tokens.Palette.textDisabled)
                                                .resolve(for: scheme)
                                        )

                                    Spacer(minLength: Tokens.Spacing.sm)

                                    // Says why, rather than leaving a greyed
                                    // row somebody taps at repeatedly.
                                    if !column.available {
                                        Badge(
                                            L10n.string("export.notAllowed"),
                                            tone: .neutral,
                                            symbol: "lock"
                                        )
                                    }
                                }
                                .frame(minHeight: Tokens.minimumTouchTarget)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(!column.available)
                            .accessibilityElement(children: .combine)
                            .accessibilityAddTraits(
                                state.chosen.contains(column.key) ? [.isButton, .isSelected] : .isButton
                            )
                        }
                    }
                }
            }
        }
    }

    // MARK: - What has been taken

    private var history: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("export.history"))

            if state.requests.isEmpty {
                Card {
                    Text(L10n.string("export.noHistory"))
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }
            } else {
                ForEach(state.requests) { request in
                    card(request)
                }
            }
        }
    }

    private func card(_ request: ExportRequest) -> some View {
        Card(tone: request.status == .failed ? .critical : .neutral) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                HStack(spacing: Tokens.Spacing.sm) {
                    Badge(
                        request.status.localizedName,
                        tone: ExportsScreen.tone(for: request.status),
                        symbol: ExportsScreen.symbol(for: request.status)
                    )

                    Spacer(minLength: Tokens.Spacing.sm)

                    Text(request.createdAt.formatted(date: .abbreviated, time: .shortened))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }

                if let contents = request.contents {
                    LazyVGrid(
                        columns: [
                            GridItem(.flexible(), alignment: .topLeading),
                            GridItem(.flexible(), alignment: .topLeading),
                        ],
                        spacing: Tokens.Spacing.md
                    ) {
                        if let rows = contents.rows {
                            FieldRow(label: L10n.string("export.rows"), value: "\(rows)")
                        }

                        if let format = contents.format {
                            FieldRow(label: L10n.string("export.format"), value: format.rawValue)
                        }
                    }

                    // The server says what it left out and why. Hiding it would
                    // let somebody take a partial file for a whole one.
                    if let omissions = contents.omissions, !omissions.isEmpty {
                        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                            ForEach(omissions) { omission in
                                Label(omission.localizedNote, systemImage: "exclamationmark.circle")
                                    .font(Tokens.Typography.captionRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.warning.resolve(for: scheme)
                                    )
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }

                if let error = request.error {
                    Text(error)
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if request.status == .done {
                    PrimaryButton(
                        title: L10n.string("export.download"),
                        isBusy: false,
                        isEnabled: true
                    ) {
                        if let url = await model.download(request.id) {
                            openURL(url)
                        }

                        state = model.currentState()
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    static func tone(for status: ExportStatus) -> Tone {
        switch status {
        case .done: return .success
        case .failed: return .critical
        case .queued, .processing: return .info
        }
    }

    static func symbol(for status: ExportStatus) -> String {
        switch status {
        case .done: return "checkmark.circle"
        case .failed: return Tokens.State.labCritical.iconName
        case .queued: return "clock"
        case .processing: return "gearshape"
        }
    }

    /// Bounded rather than open-ended: an export that has not finished in two
    /// minutes will not finish because the screen asked again.
    private func pollWhileWorking() async {
        for _ in 0..<40 {
            try? await Task.sleep(for: .seconds(3))

            if Task.isCancelled { return }

            await model.refreshUnfinished()
            state = model.currentState()

            if !state.hasUnfinished { return }
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}
