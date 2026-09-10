import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

public enum LabPanelsPhase: Sendable, Equatable {
    case loading
    case loaded([LabPanel])
    /// No confirmed result yet. Not a failure — an uploaded report that the
    /// clinic has not signed off is deliberately not shown here.
    case empty
    case notFound
    case failed(String)
}

public struct LabPanelsState: Sendable, Equatable {
    public var phase: LabPanelsPhase = .loading
    /// The report being fetched for preview, so only its row spins.
    public var openingId: String?

    public init() {}
}

/// Lab reports as they were printed (spec M16).
public actor LabPanelsModel {
    private let api: LabAPI
    private let documents: DocumentsAPI
    private let subject: RecordSubject

    private(set) public var state = LabPanelsState()

    public init(api: LabAPI, documents: DocumentsAPI, subject: RecordSubject) {
        self.api = api
        self.documents = documents
        self.subject = subject
    }

    public func currentState() -> LabPanelsState { state }

    public func load() async {
        state.phase = .loading

        do {
            let panels = try await api.panels(subject: subject)
            state.phase = panels.isEmpty ? .empty : .loaded(panels)
        } catch let error as APIError {
            if case .notFound = error {
                state.phase = .notFound
            } else {
                state.phase = .failed(L10n.message(for: error))
            }
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    /// A short-lived link to the report itself. Fetched when somebody taps
    /// rather than kept beside the row: the URL expires.
    public func reportURL(documentId: String) async -> URL? {
        state.openingId = documentId
        defer { state.openingId = nil }

        guard let link = try? await documents.downloadLink(documentId: documentId) else {
            return nil
        }

        return URL(string: link.url)
    }
}

/**
 * The lab report, as a table (spec M16).
 *
 * A chart answers "is this getting better". Somebody holding a report is
 * asking a different question — what did the blood test say — and the answer
 * to that is every analyte at once, each beside its reference range, with the
 * ones outside it marked. Opening eight charts to read one morning's bloods is
 * not reading a report.
 *
 * Collapsed by date, newest open. A patient with a year of follow-up has ten
 * of these, and a screen that opened all of them would bury this morning's
 * under last spring's.
 *
 * The original document is one tap away from each group's header. The table is
 * what OCR read and a clinician confirmed; the PDF is what the laboratory
 * printed, and the second is the one that settles an argument.
 */
@MainActor
public struct LabPanelsScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: LabPanelsModel
    /// Opening the report. Supplied by the caller, which owns presentation.
    private let openReport: ((URL) -> Void)?
    /// The chart, for the analyte somebody wants to follow over time.
    private let openTrends: (() -> Void)?

    @State private var state = LabPanelsState()
    @State private var collapsed: Set<String> = []

    public init(
        model: LabPanelsModel,
        openReport: ((URL) -> Void)? = nil,
        openTrends: (() -> Void)? = nil
    ) {
        self.model = model
        self.openReport = openReport
        self.openTrends = openTrends
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                content
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("lab.title"))
        .toolbar {
            if let openTrends {
                ToolbarItem(placement: .primaryAction) {
                    Button(L10n.string("lab.trends"), systemImage: "chart.xyaxis.line") {
                        openTrends()
                    }
                }
            }
        }
        .task { await reload() }
        .refreshable { await reload() }
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .loading:
            SkeletonCard(lines: 6)
                .accessibilityElement()
                .accessibilityLabel(L10n.string("common.loading"))

        case .empty:
            MessageState(icon: "testtube.2", text: L10n.string("lab.noResults"))

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

        case .loaded(let panels):
            ForEach(Array(panels.enumerated()), id: \.element.id) { index, panel in
                PanelSection(
                    panel: panel,
                    // The newest is open; the rest wait to be asked for.
                    isCollapsed: collapsed.contains(panel.id) || (index > 0 && !collapsed.contains("open:\(panel.id)")),
                    isOpening: state.openingId == panel.documentId,
                    toggle: { toggle(panel, isCollapsed: index > 0) },
                    openReport: openReport == nil ? nil : {
                        guard let documentId = panel.documentId else { return }

                        state.openingId = documentId

                        if let url = await model.reportURL(documentId: documentId) {
                            openReport?(url)
                        }

                        state.openingId = nil
                    }
                )
            }
        }
    }

    /// Newest open, older closed — and either can be reversed by tapping. The
    /// two sets say "closed although it would be open" and "open although it
    /// would be closed", which is what lets one rule cover both.
    private func toggle(_ panel: LabPanel, isCollapsed: Bool) {
        let openKey = "open:\(panel.id)"

        if isCollapsed {
            if collapsed.contains(openKey) {
                collapsed.remove(openKey)
            } else {
                collapsed.insert(openKey)
            }
        } else if collapsed.contains(panel.id) {
            collapsed.remove(panel.id)
        } else {
            collapsed.insert(panel.id)
        }
    }

    private func reload() async {
        await model.load()
        state = await model.currentState()
    }
}

/// One report: a date header that folds, and the rows under it.
struct PanelSection: View {
    @Environment(\.colorScheme) private var scheme

    let panel: LabPanel
    let isCollapsed: Bool
    let isOpening: Bool
    let toggle: () -> Void
    let openReport: (() async -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            header

            if !isCollapsed {
                ForEach(panel.results) { result in
                    ResultRow(result: result)
                }

                if let openReport, panel.documentId != nil {
                    Button {
                        Task { await openReport() }
                    } label: {
                        HStack(spacing: Tokens.Spacing.sm) {
                            if isOpening {
                                ProgressView()
                                    .accessibilityHidden(true)
                            } else {
                                Image(systemName: "doc.text")
                                    // The words beside it say the same thing.
                                    .accessibilityHidden(true)
                            }

                            Text(L10n.string("lab.openReport"))
                                .font(Tokens.Typography.calloutRelative)

                            Spacer(minLength: 0)
                        }
                        .padding(Tokens.Spacing.md)
                        .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                    .disabled(isOpening)
                }
            }
        }
        .background(Tokens.Palette.surface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous)
                .strokeBorder(Tokens.Palette.border.resolve(for: scheme))
        )
    }

    private var header: some View {
        Button(action: toggle) {
            HStack(spacing: Tokens.Spacing.sm) {
                Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                    .font(Tokens.Typography.captionRelative)
                    // The label says open or closed; the arrow repeats it.
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                    Text(PanelSection.moment(panel.measuredAt))
                        .font(Tokens.Typography.subheadingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                    Text(
                        String(
                            format: L10n.string("lab.resultCount"),
                            panel.results.count
                        )
                    )
                    .font(Tokens.Typography.footnoteRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }

                Spacer(minLength: 0)

                // The number somebody opens a report for. Absent rather than
                // zero: "0 abnormal" is a badge that teaches people to read
                // badges instead of rows.
                if panel.abnormal > 0 {
                    Badge(
                        String(format: L10n.string("lab.abnormalCount"), panel.abnormal),
                        tone: .critical,
                        symbol: "exclamationmark.circle.fill"
                    )
                }
            }
            .padding(Tokens.Spacing.md)
            .frame(minHeight: Tokens.minimumTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue(
            L10n.string(isCollapsed ? "lab.collapsed" : "lab.expanded")
        )
        .accessibilityHint(L10n.string("lab.toggleHint"))
    }

    /// The moment the sample was taken, to the minute. Two draws on one
    /// morning are two reports, and the day alone would merge them on screen
    /// while the data keeps them apart.
    ///
    /// `nonisolated` because a static on a `View` otherwise inherits the
    /// view's main-actor isolation, and the tests call it directly.
    nonisolated static func moment(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short

        return formatter.string(from: date)
    }
}

/// One analyte: what it was, against what it should have been.
struct ResultRow: View {
    @Environment(\.colorScheme) private var scheme

    let result: LabResult

    var body: some View {
        HStack(alignment: .top, spacing: Tokens.Spacing.md) {
            Image(systemName: ResultRow.symbol(for: result))
                .font(Tokens.Typography.calloutRelative)
                .foregroundStyle(ResultRow.tone(for: result).foreground.resolve(for: scheme))
                // The value and the word beside it carry the same meaning.
                .accessibilityHidden(true)

            Text(result.analyteName)
                .font(Tokens.Typography.calloutRelative)
                .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .trailing, spacing: Tokens.Spacing.xxs) {
                HStack(spacing: Tokens.Spacing.xxs) {
                    Text(result.value)
                        .font(Tokens.Typography.calloutRelative)
                        .monospacedDigit()
                        // Out of range is said in weight as well as colour: a
                        // colour a reader cannot distinguish says nothing
                        // (spec section 7).
                        .fontWeight(result.isOutOfRange ? .semibold : .regular)
                        .foregroundStyle(
                            ResultRow.tone(for: result).foreground.resolve(for: scheme)
                        )

                    Text(result.unit)
                        .font(Tokens.Typography.footnoteRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }

                // The range is the whole point of the table: a number without
                // one is a number nobody can read.
                Text(result.referenceText ?? L10n.string("lab.noRange"))
                    .font(Tokens.Typography.footnoteRelative)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
        .padding(.horizontal, Tokens.Spacing.md)
        .padding(.vertical, Tokens.Spacing.sm)
        .frame(minHeight: Tokens.minimumTouchTarget)
        .background(
            result.isOutOfRange
                ? ResultRow.tone(for: result).surface.resolve(for: scheme)
                : Color.clear
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ResultRow.spoken(result))
    }

    /// `nonisolated` because statics on a `View` otherwise inherit the view's
    /// main-actor isolation, and the tests call these directly.
    nonisolated static func tone(for result: LabResult) -> Tone {
        switch result.flag {
        case .critical: return .critical
        case .high, .low: return .warning
        case .normal: return .success
        // No range on the report: unclassified, not normal.
        case nil: return .neutral
        }
    }

    nonisolated static func symbol(for result: LabResult) -> String {
        switch result.flag {
        case .critical: return "exclamationmark.triangle.fill"
        case .high: return "arrow.up.circle.fill"
        case .low: return "arrow.down.circle.fill"
        case .normal: return "checkmark.circle.fill"
        case nil: return "questionmark.circle"
        }
    }

    /// What VoiceOver reads: the name, the value with its unit, whether it is
    /// in range, and what the range was. An icon it cannot see is no use.
    nonisolated static func spoken(_ result: LabResult) -> String {
        var parts = ["\(result.analyteName): \(result.value) \(result.unit)"]

        if let flag = result.flag {
            parts.append(flag.localizedName)
        }

        if let reference = result.referenceText {
            parts.append("\(L10n.string("lab.reference")): \(reference)")
        }

        return parts.joined(separator: ", ")
    }
}
