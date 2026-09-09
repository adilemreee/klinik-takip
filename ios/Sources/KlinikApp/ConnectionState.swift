import Foundation
import Observation
import SwiftUI
import KlinikAPI
import KlinikCore
import KlinikDesign

/// What the app is currently able to tell the reader about its data.
public enum Freshness: Sendable, Equatable {
    /// Reads are reaching the clinic. Nothing is shown.
    case live
    /// Reads are failing and the screen is showing what was last seen.
    case stale(since: Date)
    /// Reads are failing and there is nothing to fall back on.
    case unreachable
}

/**
 * The offline indicator the spec asks every screen to have (M15).
 *
 * Derived from what actually happened to the requests rather than from a
 * reachability API: a phone can be on a hotel network that resolves DNS,
 * answers pings and drops everything else, and a green tick over a screen full
 * of yesterday's numbers is worse than no indicator at all.
 *
 * Two deliberate asymmetries. A single success clears the warning, because one
 * request getting through means the connection is back. A single failure does
 * not raise it — a request can fail for its own reasons while everything else
 * works — so it takes two in a row, which is the difference between a blip and
 * being offline.
 */
@MainActor
@Observable
public final class ConnectionState {
    public private(set) var freshness: Freshness = .live

    /// Consecutive failures. Reset by any success.
    private var failures = 0

    /// How many failures in a row before saying so.
    private let threshold: Int

    /// Told whenever a read reaches the clinic, so the offline queue gets a
    /// chance to drain on proof of a connection rather than on a promise of
    /// one. Set by the composition root; nil everywhere else.
    public var whenReachable: (@MainActor () -> Void)?

    public init(threshold: Int = 2) {
        self.threshold = threshold
    }

    func succeeded() {
        failures = 0
        freshness = .live
        whenReachable?()
    }

    func fellBackToCache(storedAt: Date) {
        failures += 1

        guard failures >= threshold else { return }

        freshness = .stale(since: storedAt)
    }

    func failed() {
        failures += 1

        guard failures >= threshold else { return }

        freshness = .unreachable
    }

    /// The adapter the API client talks to. Separate from the class so the
    /// client depends on a protocol in `KlinikAPI` and not on the shell.
    public var observer: ConnectionObserver { Observer(state: self) }

    private struct Observer: ConnectionObserver {
        let state: ConnectionState

        func reachedServer() async {
            await MainActor.run { state.succeeded() }
        }

        func servedFromCache(storedAt: Date) async {
            await MainActor.run { state.fellBackToCache(storedAt: storedAt) }
        }

        func couldNotReachServer() async {
            await MainActor.run { state.failed() }
        }
    }
}

/**
 * The bar under the navigation bar.
 *
 * Says which of the three states the app is in, in words, and when the data on
 * screen was last true. "Çevrimdışı" alone would leave somebody guessing
 * whether the weight they are reading is this morning's or last Tuesday's.
 */
struct FreshnessBanner: View {
    @Environment(\.colorScheme) private var scheme

    let freshness: Freshness

    var body: some View {
        switch freshness {
        case .live:
            EmptyView()

        case .stale(let since):
            banner(
                symbol: "wifi.slash",
                text: String(
                    format: L10n.string("connection.showingCached"),
                    Moment.text(since)
                ),
                tone: .warning
            )

        case .unreachable:
            banner(
                symbol: "wifi.exclamationmark",
                text: L10n.string("connection.unreachable"),
                tone: .critical
            )
        }
    }

    private func banner(symbol: String, text: String, tone: Tone) -> some View {
        HStack(spacing: Tokens.Spacing.sm) {
            Image(systemName: symbol)
                .font(Tokens.Typography.captionRelative)
                // The sentence beside it says the same thing.
                .accessibilityHidden(true)

            Text(text)
                .font(Tokens.Typography.captionRelative)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
        .foregroundStyle(tone.foreground.resolve(for: scheme))
        .padding(.horizontal, Tokens.Spacing.lg)
        .padding(.vertical, Tokens.Spacing.sm)
        .frame(maxWidth: .infinity)
        .background(tone.surface.resolve(for: scheme))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
    }
}
