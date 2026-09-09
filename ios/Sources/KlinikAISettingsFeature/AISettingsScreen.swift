import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

public enum AISettingsPhase: Sendable, Equatable {
    case loading
    case loaded
    case notPermitted
    case failed(String)
}

public struct AISettingsState: Sendable, Equatable {
    public var phase: AISettingsPhase = .loading
    public var settings: AISettings?
    public var providers: [AIProviderInfo] = []
    public var testResult: AIConnectionTest?
    public var saving = false
    public var error: String?

    public init() {}

    public func provider(_ choice: AIProviderChoice?) -> AIProviderInfo? {
        providers.first { $0.id == choice }
    }
}

/**
 * Which model the clinic uses, and on what terms (spec §3.4).
 *
 * Two gates, and the screen exists mostly to keep them visible. A provider with
 * a key and a model is *ready*; a provider whose zero-retention terms somebody
 * has confirmed is ready for **clinical** work, and the layer refuses clinical
 * prompts without the second. A screen that showed only the first would tell a
 * clinic it was finished while the half that matters stayed switched off.
 *
 * Prices are typed in, not fetched. A price this app carried would go stale in
 * a quarter and stay authoritative-looking while it did.
 */
@MainActor
public final class AISettingsModel {
    private let api: AISettingsAPI
    private var state = AISettingsState()

    public init(api: AISettingsAPI) {
        self.api = api
    }

    public func currentState() -> AISettingsState { state }

    public func load() async {
        do {
            async let settings = api.settings()
            async let providers = api.providers()

            state.settings = try await settings
            state.providers = try await providers
            state.phase = .loaded
        } catch APIError.forbidden {
            state.phase = .notPermitted
        } catch let error as APIError {
            state.phase = .failed(L10n.message(for: error))
        } catch {
            state.phase = .failed(L10n.string("error.server"))
        }
    }

    public func save(
        provider: AIProviderChoice?,
        model: String?,
        apiKey: String?,
        inputPrice: String?,
        outputPrice: String?,
        budget: String?
    ) async -> Bool {
        state.saving = true
        state.error = nil

        defer { state.saving = false }

        do {
            // An empty key means "leave the stored one alone" — which is what
            // changing a price should do, and what a write-only field has to
            // mean if it is not to wipe a credential by omission.
            state.settings = try await api.update(
                provider: provider,
                model: model,
                apiKey: apiKey?.isEmpty == true ? nil : apiKey,
                inputPricePerMTok: inputPrice,
                outputPricePerMTok: outputPrice,
                monthlyBudgetUsd: budget
            )

            return true
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }

        return false
    }

    /// Confirming the provider's zero-retention terms. Recorded with a note,
    /// because "somebody ticked a box" is not a contract and the record should
    /// say who checked what.
    public func confirmRetention(_ confirmed: Bool, note: String) async {
        state.saving = true
        state.error = nil

        defer { state.saving = false }

        do {
            state.settings = try await api.update(
                zeroRetentionConfirmed: confirmed,
                zeroRetentionNote: note.isEmpty ? nil : note
            )
        } catch let error as APIError {
            state.error = L10n.message(for: error)
        } catch {
            state.error = L10n.string("error.server")
        }
    }

    public func test() async {
        state.saving = true
        state.testResult = nil

        defer { state.saving = false }

        state.testResult = try? await api.test()
    }

    public func switchOff() async {
        state.saving = true

        defer { state.saving = false }

        state.settings = try? await api.clear()
        state.testResult = nil
    }
}

/// The AI provider settings screen.
public struct AISettingsScreen: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.openURL) private var openURL

    private let model: AISettingsModel

    @State private var state = AISettingsState()
    @State private var provider: AIProviderChoice?
    @State private var chosenModel = ""
    @State private var apiKey = ""
    @State private var inputPrice = ""
    @State private var outputPrice = ""
    @State private var budget = ""
    @State private var retentionNote = ""

    public init(model: AISettingsModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Tokens.Spacing.lg) {
                ErrorBanner(message: state.error)

                switch state.phase {
                case .loading:
                    SkeletonCard(lines: 5)
                        .accessibilityElement()
                        .accessibilityLabel(L10n.string("common.loading"))

                case .notPermitted:
                    MessageState(icon: "lock", text: L10n.string("ai.notPermitted"))
                        .frame(minHeight: 240)

                case .failed(let message):
                    MessageState(
                        icon: Tokens.State.labCritical.iconName,
                        text: message,
                        retryTitle: L10n.string("common.retry")
                    ) {
                        await reload()
                    }

                case .loaded:
                    status
                    chooser
                    pricing
                    retention
                    actions
                }
            }
            .padding(Tokens.Spacing.lg)
        }
        .background(Tokens.Palette.background.resolve(for: scheme))
        .navigationTitle(L10n.string("ai.settings.title"))
        .task { await reload() }
    }

    /// The two gates, said apart.
    @ViewBuilder
    private var status: some View {
        if let settings = state.settings {
            Card(tone: settings.readyForClinicalUse ? .success : .warning) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                    Label(
                        L10n.string(settings.ready ? "ai.ready" : "ai.notReady"),
                        systemImage: settings.ready ? "checkmark.circle" : "exclamationmark.circle"
                    )
                    .font(Tokens.Typography.subheadingRelative)
                    .foregroundStyle(
                        (settings.ready ? Tokens.Palette.success : Tokens.Palette.warning)
                            .resolve(for: scheme)
                    )

                    if settings.ready, !settings.zeroRetentionConfirmed {
                        Text(L10n.string("ai.settings.notClinicalReady"))
                            .font(Tokens.Typography.calloutRelative)
                            .foregroundStyle(Tokens.Palette.warning.resolve(for: scheme))
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    ForEach(settings.localizedMissing, id: \.self) { missing in
                        Label(missing, systemImage: "circle")
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                    }

                    if let test = state.testResult {
                        Text(
                            test.ok
                                ? L10n.string("ai.settings.testOk")
                                    .replacingOccurrences(of: "{model}", with: test.model ?? "")
                                : "\(L10n.string("ai.settings.testFailed")): \(test.error ?? "")"
                        )
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(
                            (test.ok ? Tokens.Palette.success : Tokens.Palette.critical)
                                .resolve(for: scheme)
                        )
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private var chooser: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(title: L10n.string("ai.provider"))

            ForEach(state.providers) { info in
                Button {
                    provider = info.id
                    chosenModel = info.models.first ?? ""
                } label: {
                    Card(tone: provider == info.id ? .info : .neutral) {
                        VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                            HStack {
                                Text(info.label)
                                    .font(Tokens.Typography.subheadingRelative)
                                    .foregroundStyle(
                                        Tokens.Palette.textPrimary.resolve(for: scheme)
                                    )

                                Spacer(minLength: Tokens.Spacing.sm)

                                if provider == info.id {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(
                                            Tokens.Palette.accent.resolve(for: scheme)
                                        )
                                        .accessibilityHidden(true)
                                }
                            }

                            // The provider's own words about what it keeps.
                            // Rendered rather than summarised: the clinic is
                            // confirming these terms, not our reading of them.
                            Text(info.retentionNote)
                                .font(Tokens.Typography.captionRelative)
                                .foregroundStyle(
                                    Tokens.Palette.textSecondary.resolve(for: scheme)
                                )
                                .fixedSize(horizontal: false, vertical: true)

                            if let url = URL(string: info.pricingUrl) {
                                Button(L10n.string("ai.pricingPage")) { openURL(url) }
                                    .font(Tokens.Typography.captionRelative)
                                    .frame(minHeight: Tokens.minimumTouchTarget)
                                    .foregroundStyle(
                                        Tokens.Palette.accent.resolve(for: scheme)
                                    )
                            }
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(
                    provider == info.id ? [.isButton, .isSelected] : .isButton
                )
            }

            if let info = state.provider(provider), !info.models.isEmpty {
                Picker(L10n.string("ai.model"), selection: $chosenModel) {
                    ForEach(info.models, id: \.self) { name in
                        Text(name).tag(name)
                    }
                }
                .pickerStyle(.menu)
                .frame(minHeight: Tokens.minimumTouchTarget)
                .accessibilityLabel(L10n.string("ai.model"))
            }

            LabelledField(
                label: L10n.string("ai.settings.apiKey"),
                text: $apiKey,
                isSecure: true,
                contentType: .password,
                keyboard: .default
            )

            if let last4 = state.settings?.apiKeyLast4 {
                Text(
                    L10n.string("ai.settings.apiKeyStored")
                        .replacingOccurrences(of: "{last4}", with: last4)
                )
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
            }

            Text(L10n.string("ai.settings.apiKeyWriteOnly"))
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var pricing: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            SectionHeader(
                title: L10n.string("ai.settings.price"),
                subtitle: L10n.string("ai.settings.priceHint")
            )

            LabelledField(
                label: L10n.string("ai.inputPrice"),
                text: $inputPrice,
                isSecure: false,
                contentType: .plain,
                keyboard: .decimal
            )

            LabelledField(
                label: L10n.string("ai.outputPrice"),
                text: $outputPrice,
                isSecure: false,
                contentType: .plain,
                keyboard: .decimal
            )

            LabelledField(
                label: L10n.string("ai.settings.budget"),
                text: $budget,
                isSecure: false,
                contentType: .plain,
                keyboard: .decimal
            )
        }
    }

    /// The gate that decides whether clinical prompts run at all.
    @ViewBuilder
    private var retention: some View {
        if let settings = state.settings {
            VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                SectionHeader(title: L10n.string("ai.retention"))

                Card(tone: settings.zeroRetentionConfirmed ? .success : .warning) {
                    VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
                        Toggle(
                            L10n.string("ai.settings.zeroRetention"),
                            isOn: Binding(
                                get: { settings.zeroRetentionConfirmed },
                                set: { confirmed in
                                    Task {
                                        await model.confirmRetention(confirmed, note: retentionNote)
                                        state = model.currentState()
                                    }
                                }
                            )
                        )
                        .font(Tokens.Typography.bodyRelative)
                        .frame(minHeight: Tokens.minimumTouchTarget)
                        .disabled(state.saving)

                        LabelledField(
                            label: L10n.string("ai.retentionNote"),
                            text: $retentionNote,
                            isSecure: false,
                            contentType: .plain,
                            keyboard: .default
                        )

                        if let note = settings.zeroRetentionNote, let at = settings.zeroRetentionAt {
                            FieldRow(
                                label: L10n.string("ai.retentionRecorded"),
                                value: "\(note) · \(at.formatted(date: .abbreviated, time: .omitted))"
                            )
                        }
                    }
                }
            }
        }
    }

    private var actions: some View {
        VStack(spacing: Tokens.Spacing.sm) {
            PrimaryButton(
                title: L10n.string("common.save"),
                isBusy: state.saving,
                isEnabled: !state.saving
            ) {
                _ = await model.save(
                    provider: provider,
                    model: chosenModel.isEmpty ? nil : chosenModel,
                    apiKey: apiKey,
                    inputPrice: inputPrice.isEmpty ? nil : inputPrice,
                    outputPrice: outputPrice.isEmpty ? nil : outputPrice,
                    budget: budget.isEmpty ? nil : budget
                )
                apiKey = ""
                state = model.currentState()
            }

            Button(L10n.string("ai.settings.test")) {
                Task {
                    await model.test()
                    state = model.currentState()
                }
            }
            .font(Tokens.Typography.calloutRelative)
            .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
            .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
            .disabled(state.saving)

            Button(L10n.string("ai.settings.clear")) {
                Task {
                    await model.switchOff()
                    state = model.currentState()
                }
            }
            .font(Tokens.Typography.calloutRelative)
            .frame(maxWidth: .infinity, minHeight: Tokens.minimumTouchTarget)
            .foregroundStyle(Tokens.Palette.critical.resolve(for: scheme))
            .disabled(state.saving)
        }
    }

    private func reload() async {
        await model.load()
        state = model.currentState()

        provider = state.settings?.provider
        chosenModel = state.settings?.model ?? ""
        inputPrice = state.settings?.inputPricePerMTok ?? ""
        outputPrice = state.settings?.outputPricePerMTok ?? ""
        budget = state.settings?.monthlyBudgetUsd ?? ""
    }
}
