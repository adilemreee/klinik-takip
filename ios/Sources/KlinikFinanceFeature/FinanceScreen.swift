import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/**
 * The money (spec M11).
 *
 * Two questions at the top because they are the two a clinic asks: what is
 * still owed, and what came in this month. The ledger is underneath, filtered
 * by status, because working through it is a different job from checking on it.
 *
 * The client performs no arithmetic. Every figure on this screen is a string
 * the server produced from a decimal; a balance recomputed here would be a
 * second opinion, and the two would eventually differ in front of a patient.
 */
public struct FinanceScreen: View {
    @Environment(\.colorScheme) private var scheme

    private let model: FinanceModel
    private let openPatient: (String, String) -> Void

    @State private var state = FinanceState()
    @State private var paying: FinanceRecord?
    @State private var reversing: PaymentEntry?

    public init(model: FinanceModel, openPatient: @escaping (String, String) -> Void) {
        self.model = model
        self.openPatient = openPatient
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xl) {
                ErrorBanner(message: state.error)

                currencyPicker

                switch state.phase {
                case .loading:
                    VStack(spacing: Tokens.Spacing.lg) {
                        SkeletonCard(lines: 3)
                        SkeletonCard(lines: 4)
                    }
                    .accessibilityElement()
                    .accessibilityLabel(L10n.string("common.loading"))

                case .notPermitted:
                    MessageState(icon: "lock", text: L10n.string("finance.notPermitted"))
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
                    headline
                    ageing
                    ledger
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("finance.title"))
        .refreshable { await reload() }
        .task { await reload() }
        .sheet(item: $reversing) { payment in
            ReversalSheet(payment: payment) { reason in
                let ok = await model.reverse(paymentId: payment.id, reason: reason)
                state = model.currentState()

                if ok { reversing = nil }
            }
        }
        .sheet(item: $paying) { record in
            PaymentSheet(record: record) { amount, method, reference in
                let ok = await model.pay(
                    recordId: record.id,
                    amount: amount,
                    method: method,
                    reference: reference
                )
                state = model.currentState()

                if ok { paying = nil }
            }
        }
    }

    private var currencyPicker: some View {
        Picker(L10n.string("finance.currency"), selection: currencyBinding) {
            ForEach(Currency.allCases, id: \.self) { currency in
                Text("\(currency.symbol) \(currency.rawValue)").tag(currency)
            }
        }
        .pickerStyle(.segmented)
        .accessibilityLabel(L10n.string("finance.currency"))
    }

    private var currencyBinding: Binding<Currency> {
        Binding(
            get: { state.currency },
            set: { currency in
                Task {
                    await model.choose(currency: currency)
                    state = model.currentState()
                }
            }
        )
    }

    // MARK: - The two questions

    @ViewBuilder
    private var headline: some View {
        HStack(spacing: Tokens.Spacing.md) {
            if let outstanding = state.outstanding {
                StatTile(
                    value: outstanding.outstanding.converted.display(state.currency),
                    label: L10n.string("finance.outstanding"),
                    tone: outstanding.outstanding.converted.isZero ? .success : .warning,
                    symbol: "hourglass"
                )
            }

            if let collections = state.collections {
                StatTile(
                    value: collections.net.converted.display(state.currency),
                    label: L10n.string("finance.collectedThisMonth"),
                    tone: .success,
                    symbol: "arrow.down.circle"
                )
            }
        }

        // A total assembled from three currencies where one had no rate for its
        // day is not a total. Said beside the figure, not under it.
        if let outstanding = state.outstanding, !outstanding.outstanding.complete {
            Card(tone: .warning) {
                Label(
                    L10n.string("finance.totals.incomplete"),
                    systemImage: "exclamationmark.circle"
                )
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private var ageing: some View {
        if let report = state.outstanding, !report.ageing.isEmpty {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(
                    title: L10n.string("finance.ageing"),
                    subtitle: String(format: L10n.string("finance.recordCount"), report.recordCount)
                )

                Card {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                        ForEach(report.ageing) { bucket in
                            HStack {
                                Text(L10n.string("finance.ageing.\(bucket.bucket)"))
                                    .font(Tokens.Typography.calloutRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.textPrimary.resolve(for: scheme)
                                    )

                                Spacer(minLength: Tokens.Spacing.sm)

                                Text(bucket.totals.converted.display(state.currency))
                                    .font(Tokens.Typography.subheadingRelative)
                                    .foregroundStyle(
                                        FinanceScreen.ageingTone(bucket.bucket)
                                            .foreground.resolve(for: scheme)
                                    )

                                Badge("\(bucket.recordCount)")
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
        }
    }

    // MARK: - The ledger

    private var ledger: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("finance.records"))

            Picker(L10n.string("finance.status"), selection: statusBinding) {
                Text(L10n.string("finance.allStatuses")).tag(PaymentStatus?.none)

                ForEach(PaymentStatus.allCases, id: \.self) { status in
                    Text(status.localizedName).tag(PaymentStatus?.some(status))
                }
            }
            .pickerStyle(.menu)
            .frame(minHeight: Tokens.minimumTouchTarget)
            .accessibilityLabel(L10n.string("finance.status"))

            if state.records.isEmpty {
                Card {
                    Text(L10n.string("finance.noRecords"))
                        .font(Tokens.Typography.bodyRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }
            } else {
                ForEach(state.records) { record in
                    card(record)
                }

                if state.hasMore {
                    Button(L10n.string("finance.loadMore")) {
                        Task {
                            await model.loadMore()
                            state = model.currentState()
                        }
                    }
                    .font(Tokens.Typography.calloutRelative)
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                }
            }
        }
    }

    private var statusBinding: Binding<PaymentStatus?> {
        Binding(
            get: { state.status },
            set: { status in
                Task {
                    await model.choose(status: status)
                    state = model.currentState()
                }
            }
        )
    }

    private func card(_ record: FinanceRecord) -> some View {
        Card(tone: record.balance.isZero ? .neutral : .warning) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                if let patient = record.patient {
                    Button {
                        openPatient(patient.id, patient.fullName)
                    } label: {
                        HStack(spacing: Tokens.Spacing.md) {
                            InitialsAvatar(name: patient.fullName, diameter: 36)

                            VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                                Text(patient.fullName)
                                    .font(Tokens.Typography.subheadingRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.textPrimary.resolve(for: scheme)
                                    )

                                Text("\(patient.mrn) · \(record.procedureName)")
                                    .font(Tokens.Typography.captionRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.textSecondary.resolve(for: scheme)
                                    )
                            }

                            Spacer(minLength: Tokens.Spacing.sm)

                            Image(systemName: "chevron.right")
                                .font(Tokens.Typography.captionRelative)
                                .foregroundStyle(
                                    Tokens.Palette.textDisabled.resolve(for: scheme)
                                )
                                .accessibilityHidden(true)
                        }
                        .frame(minHeight: Tokens.minimumTouchTarget)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isButton)
                }

                LazyVGrid(
                    columns: [
                        GridItem(.flexible(), alignment: .topLeading),
                        GridItem(.flexible(), alignment: .topLeading),
                    ],
                    spacing: Tokens.Spacing.md
                ) {
                    FieldRow(
                        label: L10n.string("finance.net"),
                        value: record.netAmount.display(record.currency)
                    )
                    FieldRow(
                        label: L10n.string("finance.paid"),
                        value: record.paidAmount.display(record.currency)
                    )
                    FieldRow(
                        label: L10n.string("finance.balance"),
                        value: record.balance.display(record.currency),
                        tone: record.balance.isZero ? .success : .warning
                    )
                    FieldRow(
                        label: L10n.string("finance.agency"),
                        value: record.agencyName
                    )
                }

                HStack(spacing: Tokens.Spacing.sm) {
                    Badge(
                        record.paymentStatus.localizedName,
                        tone: FinanceScreen.statusTone(record.paymentStatus),
                        symbol: record.balance.isZero ? "checkmark.circle" : "hourglass"
                    )

                    Spacer(minLength: 0)
                }

                if !record.livePayments.isEmpty {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                        Text(L10n.string("finance.payments.title"))
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                        ForEach(record.payments) { payment in
                            HStack(spacing: Tokens.Spacing.sm) {
                                Text(payment.amount.display(payment.currency))
                                    .font(Tokens.Typography.calloutRelative)
                                    .foregroundStyle(
                                        (payment.isReversed
                                            ? Tokens.Palette.textDisabled
                                            : Tokens.Palette.textPrimary).resolve(for: scheme)
                                    )
                                    .strikethrough(payment.isReversed)

                                Text(payment.method.localizedName)
                                    .font(Tokens.Typography.captionRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.textSecondary.resolve(for: scheme)
                                    )

                                Spacer(minLength: Tokens.Spacing.sm)

                                if payment.isReversed {
                                    Badge(
                                        L10n.string("finance.payment.reversed"),
                                        tone: .neutral,
                                        symbol: "arrow.uturn.backward"
                                    )
                                } else {
                                    Button(L10n.string("finance.reverse")) { reversing = payment }
                                        .font(Tokens.Typography.captionRelative)
                                        .frame(minHeight: Tokens.minimumTouchTarget)
                                        .foregroundStyle(
                                            Tokens.Palette.critical.resolve(for: scheme)
                                        )
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }

                if !record.balance.isZero, record.cancelledAt == nil {
                    PrimaryButton(
                        title: L10n.string("finance.recordPayment"),
                        isBusy: state.busyId == record.id,
                        isEnabled: state.busyId == nil
                    ) {
                        paying = record
                    }
                }
            }
        }
    }

    // MARK: - Helpers

    static func statusTone(_ status: PaymentStatus) -> Tone {
        switch status {
        case .paid: return .success
        case .partial: return .warning
        case .pending: return .info
        case .refunded, .cancelled: return .neutral
        }
    }

    /// Older debt is redder. The label beside it says which bucket it is, so
    /// the colour is emphasis rather than the message.
    static func ageingTone(_ bucket: String) -> Tone {
        switch bucket {
        case "current": return .info
        case "d30": return .warning
        default: return .critical
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()
    }
}

/// Taking a payment against one invoice.
struct PaymentSheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let record: FinanceRecord
    let submit: (String, PaymentMethod, String?) async -> Void

    @State private var amount = ""
    @State private var method: PaymentMethod = .bankTransfer
    @State private var reference = ""
    @State private var busy = false

    var body: some View {
        FormScaffold(
            title: L10n.string("finance.recordPayment"),
            subtitle: record.patient?.fullName
        ) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                Card(tone: .info) {
                    FieldRow(
                        label: L10n.string("finance.balance"),
                        value: record.balance.display(record.currency)
                    )
                }

                LabelledField(
                    label: L10n.string("finance.amount"),
                    text: $amount,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .decimal
                )

                VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                    Text(L10n.string("finance.method"))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

                    Picker(L10n.string("finance.method"), selection: $method) {
                        ForEach(PaymentMethod.allCases, id: \.self) { option in
                            Text(option.localizedName).tag(option)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                }

                LabelledField(
                    label: L10n.string("finance.reference"),
                    text: $reference,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                PrimaryButton(
                    title: L10n.string("finance.recordPayment"),
                    isBusy: busy,
                    isEnabled: PaymentSheet.normalised(amount) != nil
                ) {
                    guard let normalised = PaymentSheet.normalised(amount) else { return }

                    busy = true
                    await submit(
                        normalised,
                        method,
                        reference.isEmpty ? nil : reference
                    )
                    busy = false
                }

                Button(L10n.string("common.cancel")) { dismiss() }
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }

    /**
     * The amount as the server wants it: a decimal string with a full stop.
     *
     * A Turkish keyboard produces a comma, and sending "1.250,00" would be read
     * as one thousand two hundred and fifty *point* nothing — or refused. The
     * conversion is a normalisation, not arithmetic: the digits are unchanged.
     */
    static func normalised(_ input: String) -> String? {
        let trimmed = input
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: ",", with: ".")

        guard !trimmed.isEmpty, let value = Decimal(string: trimmed), value > 0 else { return nil }

        return trimmed
    }
}


/**
 * Undoing a payment.
 *
 * A reason is required and the row is kept: a payment entered and undone is
 * part of what happened, and a ledger that forgets its corrections is one
 * nobody can audit. The server enforces both; this asks for the sentence while
 * whoever is undoing it still remembers why.
 */
struct ReversalSheet: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    let payment: PaymentEntry
    let submit: (String) async -> Void

    @State private var reason = ""
    @State private var busy = false

    var body: some View {
        FormScaffold(
            title: L10n.string("finance.reverse"),
            subtitle: payment.amount.display(payment.currency)
        ) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                LabelledField(
                    label: L10n.string("finance.reverseReason"),
                    text: $reason,
                    isSecure: false,
                    contentType: .plain,
                    keyboard: .default
                )

                PrimaryButton(
                    title: L10n.string("finance.reverse"),
                    isBusy: busy,
                    isEnabled: !reason.trimmingCharacters(in: .whitespaces).isEmpty && !busy
                ) {
                    busy = true
                    await submit(reason)
                    busy = false
                }

                Button(L10n.string("common.cancel")) { dismiss() }
                    .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }
        }
    }
}
