import SwiftUI

/**
 * The five ways a clinical screen can feel about something.
 *
 * A tone is a colour *and* a word *and* an icon. The type exists so that the
 * three cannot drift apart: a caller picks `.critical` and gets all of it, and
 * there is no way to reach for the red without also getting the triangle.
 */
public enum Tone: Sendable, Equatable, CaseIterable {
    case neutral
    case info
    case success
    case warning
    case critical

    public var foreground: ThemedColor {
        switch self {
        case .neutral: return Tokens.Palette.textSecondary
        case .info: return Tokens.Palette.info
        case .success: return Tokens.Palette.success
        case .warning: return Tokens.Palette.warning
        case .critical: return Tokens.Palette.critical
        }
    }

    public var surface: ThemedColor {
        switch self {
        case .neutral: return Tokens.Palette.surface
        case .info: return Tokens.Palette.infoSurface
        case .success: return Tokens.Palette.successSurface
        case .warning: return Tokens.Palette.warningSurface
        case .critical: return Tokens.Palette.criticalSurface
        }
    }

    public var iconName: String {
        switch self {
        case .neutral: return "circle"
        case .info: return "info.circle.fill"
        case .success: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.circle.fill"
        case .critical: return "exclamationmark.triangle.fill"
        }
    }
}

/**
 * The surface everything on a dense screen sits on.
 *
 * A doctor's screen carries more than a patient's, and the spec allows that as
 * long as the hierarchy is legible (section 7). Cards are how the hierarchy is
 * drawn: one card is one thing, and the eye can skip a whole card without
 * reading it.
 */
public struct Card<Content: View>: View {
    @Environment(\.colorScheme) private var scheme

    private let tone: Tone
    private let content: Content

    public init(tone: Tone = .neutral, @ViewBuilder content: () -> Content) {
        self.tone = tone
        self.content = content()
    }

    public var body: some View {
        content
            .padding(Tokens.Spacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: Tokens.Radius.lg)
                    .stroke(border, lineWidth: tone == .neutral ? 1 : 1.5)
            )
    }

    private var background: Color {
        tone == .neutral
            ? Tokens.Palette.surfaceRaised.resolve(for: scheme)
            : tone.surface.resolve(for: scheme)
    }

    private var border: Color {
        tone == .neutral
            ? Tokens.Palette.border.resolve(for: scheme)
            : tone.foreground.resolve(for: scheme).opacity(0.35)
    }
}

/// A heading over a group of cards, with an optional action on the right.
public struct SectionHeader: View {
    @Environment(\.colorScheme) private var scheme

    private let title: String
    private let subtitle: String?
    private let actionTitle: String?
    private let action: (() -> Void)?

    public init(
        title: String,
        subtitle: String? = nil,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.actionTitle = actionTitle
        self.action = action
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                Text(title)
                    .font(Tokens.Typography.headingRelative)
                    .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))
                    .accessibilityAddTraits(.isHeader)

                if let subtitle {
                    Text(subtitle)
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                }
            }

            Spacer(minLength: Tokens.Spacing.sm)

            if let actionTitle, let action {
                Button(actionTitle) { action() }
                    .font(Tokens.Typography.calloutRelative)
                    .frame(minHeight: Tokens.minimumTouchTarget)
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
            }
        }
    }
}

/**
 * One number, large, with the word for what it counts.
 *
 * The number is the point, so it is the biggest thing in the tile; the label
 * under it is what stops the number from being a riddle. A tile with a tone
 * also carries that tone's icon, because a doctor scanning for red must find
 * the same tiles whether or not they see red.
 */
public struct StatTile: View {
    @Environment(\.colorScheme) private var scheme

    private let value: String
    private let label: String
    private let tone: Tone
    private let symbol: String?

    public init(value: String, label: String, tone: Tone = .neutral, symbol: String? = nil) {
        self.value = value
        self.label = label
        self.tone = tone
        self.symbol = symbol
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
            HStack(spacing: Tokens.Spacing.xs) {
                Image(systemName: symbol ?? tone.iconName)
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(tone.foreground.resolve(for: scheme))
                    // The tile announces its value and label as one string.
                    .accessibilityHidden(true)

                Spacer(minLength: 0)
            }

            Text(value)
                .font(Tokens.Typography.titleRelative)
                .foregroundStyle(
                    (tone == .neutral ? Tokens.Palette.textPrimary : tone.foreground)
                        .resolve(for: scheme)
                )
                .lineLimit(1)
                .minimumScaleFactor(0.6)

            Text(label)
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(Tokens.Spacing.md)
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .leading)
        .background(
            (tone == .neutral ? Tokens.Palette.surface : tone.surface).resolve(for: scheme)
        )
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md))
        // One announcement — "3, kritik değer" — rather than an icon, a digit
        // and a word arriving as three separate stops.
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value), \(label)")
    }
}

/// A small pill: a status, a count, a category.
public struct Badge: View {
    @Environment(\.colorScheme) private var scheme

    private let text: String
    private let tone: Tone
    private let symbol: String?

    public init(_ text: String, tone: Tone = .neutral, symbol: String? = nil) {
        self.text = text
        self.tone = tone
        self.symbol = symbol
    }

    public var body: some View {
        HStack(spacing: Tokens.Spacing.xxs) {
            if let symbol {
                Image(systemName: symbol)
                    .font(Tokens.Typography.footnoteRelative)
                    // Paired with the word beside it; announcing both would
                    // read as "image, yanıtlanmadı".
                    .accessibilityHidden(true)
            }

            Text(text)
                .font(Tokens.Typography.footnoteRelative)
                .lineLimit(1)
        }
        .padding(.horizontal, Tokens.Spacing.sm)
        .padding(.vertical, Tokens.Spacing.xxs)
        .foregroundStyle(tone.foreground.resolve(for: scheme))
        .background(tone.surface.resolve(for: scheme))
        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.pill))
        .overlay(
            RoundedRectangle(cornerRadius: Tokens.Radius.pill)
                .stroke(tone.foreground.resolve(for: scheme).opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(text)
    }
}

/**
 * A row that leads somewhere and says what is waiting there.
 *
 * This replaces a list of bare words. "Tahliller" tells a doctor nothing;
 * "Tahliller · 2 bekliyor" tells them whether to tap. The count is the reason
 * this component exists.
 */
public struct NavigationRow: View {
    @Environment(\.colorScheme) private var scheme

    private let symbol: String
    private let title: String
    private let detail: String?
    private let badge: String?
    private let badgeTone: Tone
    private let action: () -> Void

    public init(
        symbol: String,
        title: String,
        detail: String? = nil,
        badge: String? = nil,
        badgeTone: Tone = .neutral,
        action: @escaping () -> Void
    ) {
        self.symbol = symbol
        self.title = title
        self.detail = detail
        self.badge = badge
        self.badgeTone = badgeTone
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: Tokens.Spacing.md) {
                Image(systemName: symbol)
                    .font(Tokens.Typography.bodyRelative)
                    .frame(width: 28)
                    .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                    Text(title)
                        .font(Tokens.Typography.subheadingRelative)
                        .foregroundStyle(Tokens.Palette.textPrimary.resolve(for: scheme))

                    if let detail {
                        Text(detail)
                            .font(Tokens.Typography.captionRelative)
                            .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                }

                Spacer(minLength: Tokens.Spacing.sm)

                if let badge {
                    Badge(badge, tone: badgeTone)
                }

                Image(systemName: "chevron.right")
                    .font(Tokens.Typography.captionRelative)
                    .foregroundStyle(Tokens.Palette.textDisabled.resolve(for: scheme))
                    // Decoration: the row already carries the button trait.
                    .accessibilityHidden(true)
            }
            .padding(.vertical, Tokens.Spacing.sm)
            .frame(minHeight: Tokens.minimumTouchTarget)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // The chevron and the leading symbol are decoration; the row already
        // announces its title, its detail and its badge.
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// A label above its value. The unit of every detail screen.
public struct FieldRow: View {
    @Environment(\.colorScheme) private var scheme

    private let label: String
    private let value: String?
    private let tone: Tone

    public init(label: String, value: String?, tone: Tone = .neutral) {
        self.label = label
        self.value = value
        self.tone = tone
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
            Text(label)
                .font(Tokens.Typography.captionRelative)
                .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))

            Text(value ?? "—")
                .font(Tokens.Typography.bodyRelative)
                .foregroundStyle(
                    value == nil
                        ? Tokens.Palette.textDisabled.resolve(for: scheme)
                        : (tone == .neutral ? Tokens.Palette.textPrimary : tone.foreground)
                            .resolve(for: scheme)
                )
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value ?? "—")")
    }
}

/// Initials in a circle. Used where a photograph would be, because the clinic
/// has photographs of surgical sites and none of faces.
public struct InitialsAvatar: View {
    @Environment(\.colorScheme) private var scheme

    private let name: String
    private let diameter: CGFloat

    public init(name: String, diameter: CGFloat = 44) {
        self.name = name
        self.diameter = diameter
    }

    public var body: some View {
        Text(InitialsAvatar.initials(from: name))
            .font(Tokens.Typography.subheadingRelative)
            .foregroundStyle(Tokens.Palette.accent.resolve(for: scheme))
            .frame(width: diameter, height: diameter)
            .background(Tokens.Palette.infoSurface.resolve(for: scheme))
            .clipShape(Circle())
            // The name is written beside it on every screen that uses this.
            .accessibilityHidden(true)
    }

    /// First letter of the first two words. Turkish letters keep their own
    /// upper-case forms, so `localizedUppercase` rather than `uppercased()`.
    public static func initials(from name: String) -> String {
        let letters = name
            .split(separator: " ")
            .prefix(2)
            .compactMap { $0.first.map(String.init) }

        return letters.joined().localizedUppercase
    }
}

/**
 * What a screen shows while it is loading.
 *
 * Grey blocks in the shape of the content, rather than a spinner in the middle
 * of an empty page (spec section 7 asks for skeletons by name). The point is
 * that the layout does not jump when the data lands.
 */
public struct SkeletonBlock: View {
    @Environment(\.colorScheme) private var scheme

    private let height: CGFloat
    private let widthFraction: CGFloat

    @State private var dim = false

    public init(height: CGFloat = 16, widthFraction: CGFloat = 1) {
        self.height = height
        self.widthFraction = widthFraction
    }

    public var body: some View {
        GeometryReader { proxy in
            RoundedRectangle(cornerRadius: Tokens.Radius.sm)
                .fill(Tokens.Palette.surface.resolve(for: scheme))
                .frame(width: proxy.size.width * widthFraction, height: height)
                .opacity(dim ? 0.45 : 1)
        }
        .frame(height: height)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                dim = true
            }
        }
        .accessibilityHidden(true)
    }
}

/// A card-shaped skeleton, for lists that load a handful of rows.
public struct SkeletonCard: View {
    private let lines: Int

    public init(lines: Int = 3) {
        self.lines = lines
    }

    public var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Tokens.Spacing.sm) {
                SkeletonBlock(height: 20, widthFraction: 0.55)

                ForEach(0..<max(1, lines - 1), id: \.self) { index in
                    SkeletonBlock(height: 14, widthFraction: index.isMultiple(of: 2) ? 0.9 : 0.7)
                }
            }
        }
        // One "yükleniyor" for the whole placeholder, spoken by the screen.
        .accessibilityHidden(true)
    }
}
