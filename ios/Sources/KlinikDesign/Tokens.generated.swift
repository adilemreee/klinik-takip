// Generated from design/tokens.json — do not edit.
// Regenerate with: node design/scripts/generate-tokens.mjs
import SwiftUI

/// Design tokens shared with the Android client.
public enum Tokens {
    /// The smallest tappable area, in points (spec section 7).
    public static let minimumTouchTarget: CGFloat = 44

    public enum Spacing {
        public static let xxs: CGFloat = 2
        public static let xs: CGFloat = 4
        public static let sm: CGFloat = 8
        public static let md: CGFloat = 12
        public static let lg: CGFloat = 16
        public static let xl: CGFloat = 24
        public static let xxl: CGFloat = 32
        public static let xxxl: CGFloat = 48
    }

    public enum Radius {
        public static let sm: CGFloat = 6
        public static let md: CGFloat = 10
        public static let lg: CGFloat = 16
        public static let pill: CGFloat = 999
    }

    /// Each colour carries both schemes; a view resolves it from the
    /// environment. Kept in pure SwiftUI rather than bridging through UIColor,
    /// so the package builds and its tests run on any platform.
    public enum Palette {
        public static let background = ThemedColor(
            light: Color(red: 1.0000, green: 1.0000, blue: 1.0000),
            dark: Color(red: 0.0549, green: 0.0667, blue: 0.0863)
        )
        public static let surface = ThemedColor(
            light: Color(red: 0.9608, green: 0.9647, blue: 0.9725),
            dark: Color(red: 0.0863, green: 0.1020, blue: 0.1294)
        )
        public static let surfaceRaised = ThemedColor(
            light: Color(red: 1.0000, green: 1.0000, blue: 1.0000),
            dark: Color(red: 0.1176, green: 0.1412, blue: 0.1765)
        )
        public static let border = ThemedColor(
            light: Color(red: 0.8471, green: 0.8627, blue: 0.8902),
            dark: Color(red: 0.2000, green: 0.2314, blue: 0.2745)
        )
        public static let textPrimary = ThemedColor(
            light: Color(red: 0.0667, green: 0.0784, blue: 0.0941),
            dark: Color(red: 0.9490, green: 0.9569, blue: 0.9686)
        )
        public static let textSecondary = ThemedColor(
            light: Color(red: 0.2902, green: 0.3255, blue: 0.3804),
            dark: Color(red: 0.7020, green: 0.7373, blue: 0.7882)
        )
        public static let textDisabled = ThemedColor(
            light: Color(red: 0.5412, green: 0.5765, blue: 0.6275),
            dark: Color(red: 0.4235, green: 0.4627, blue: 0.5176)
        )
        public static let accent = ThemedColor(
            light: Color(red: 0.0431, green: 0.3725, blue: 0.6902),
            dark: Color(red: 0.4902, green: 0.7098, blue: 0.9412)
        )
        public static let accentText = ThemedColor(
            light: Color(red: 1.0000, green: 1.0000, blue: 1.0000),
            dark: Color(red: 0.0549, green: 0.0667, blue: 0.0863)
        )
        public static let critical = ThemedColor(
            light: Color(red: 0.7020, green: 0.1490, blue: 0.1176),
            dark: Color(red: 0.9490, green: 0.7216, blue: 0.7098)
        )
        public static let criticalSurface = ThemedColor(
            light: Color(red: 0.9882, green: 0.9333, blue: 0.9255),
            dark: Color(red: 0.2314, green: 0.1216, blue: 0.1137)
        )
        public static let warning = ThemedColor(
            light: Color(red: 0.5412, green: 0.3255, blue: 0.0000),
            dark: Color(red: 0.9608, green: 0.7843, blue: 0.4784)
        )
        public static let warningSurface = ThemedColor(
            light: Color(red: 1.0000, green: 0.9569, blue: 0.8902),
            dark: Color(red: 0.2275, green: 0.1647, blue: 0.0549)
        )
        public static let success = ThemedColor(
            light: Color(red: 0.0588, green: 0.4196, blue: 0.2706),
            dark: Color(red: 0.4980, green: 0.8196, blue: 0.6588)
        )
        public static let successSurface = ThemedColor(
            light: Color(red: 0.9098, green: 0.9608, blue: 0.9333),
            dark: Color(red: 0.0706, green: 0.1882, blue: 0.1216)
        )
        public static let info = ThemedColor(
            light: Color(red: 0.0431, green: 0.3725, blue: 0.6902),
            dark: Color(red: 0.4902, green: 0.7098, blue: 0.9412)
        )
        public static let infoSurface = ThemedColor(
            light: Color(red: 0.9098, green: 0.9451, blue: 0.9804),
            dark: Color(red: 0.0745, green: 0.1412, blue: 0.2078)
        )
    }

    /// Base sizes. `relativeTo` keeps every style scaling with the reader's
    /// text-size setting rather than freezing at a fixed size.
    public enum Typography {
        public static let display = Font.system(size: 34, weight: .bold, design: .default)
        public static let displayRelative = Font.custom("", size: 34, relativeTo: .largeTitle).weight(.bold)
        public static let title = Font.system(size: 28, weight: .bold, design: .default)
        public static let titleRelative = Font.custom("", size: 28, relativeTo: .largeTitle).weight(.bold)
        public static let heading = Font.system(size: 22, weight: .semibold, design: .default)
        public static let headingRelative = Font.custom("", size: 22, relativeTo: .title2).weight(.semibold)
        public static let subheading = Font.system(size: 17, weight: .semibold, design: .default)
        public static let subheadingRelative = Font.custom("", size: 17, relativeTo: .body).weight(.semibold)
        public static let body = Font.system(size: 17, weight: .regular, design: .default)
        public static let bodyRelative = Font.custom("", size: 17, relativeTo: .body).weight(.regular)
        public static let callout = Font.system(size: 16, weight: .regular, design: .default)
        public static let calloutRelative = Font.custom("", size: 16, relativeTo: .body).weight(.regular)
        public static let caption = Font.system(size: 13, weight: .regular, design: .default)
        public static let captionRelative = Font.custom("", size: 13, relativeTo: .caption).weight(.regular)
        public static let footnote = Font.system(size: 12, weight: .regular, design: .default)
        public static let footnoteRelative = Font.custom("", size: 12, relativeTo: .caption).weight(.regular)
    }

    /// A clinical state is a colour *and* an icon: critical information is
    /// never carried by colour alone (spec section 7).
    public struct ClinicalState: Sendable, Equatable {
        public let color: ThemedColor
        public let iconName: String
    }

    public enum State {
        public static let labNormal = ClinicalState(color: Palette.success, iconName: "checkmark.circle")
        public static let labLow = ClinicalState(color: Palette.warning, iconName: "arrow.down.circle")
        public static let labHigh = ClinicalState(color: Palette.warning, iconName: "arrow.up.circle")
        public static let labCritical = ClinicalState(color: Palette.critical, iconName: "exclamationmark.triangle.fill")
        public static let triageInfo = ClinicalState(color: Palette.info, iconName: "info.circle")
        public static let triageRoutine = ClinicalState(color: Palette.success, iconName: "clock")
        public static let triageUrgent = ClinicalState(color: Palette.warning, iconName: "exclamationmark.circle")
        public static let triageEmergency = ClinicalState(color: Palette.critical, iconName: "exclamationmark.triangle.fill")
    }
}

/// A colour with a variant for each scheme.
public struct ThemedColor: Sendable, Equatable {
    public let light: Color
    public let dark: Color

    public init(light: Color, dark: Color) {
        self.light = light
        self.dark = dark
    }

    public func resolve(for scheme: ColorScheme) -> Color {
        scheme == .dark ? dark : light
    }
}

public extension View {
    /// Applies a themed foreground colour without the caller branching on scheme.
    func foreground(_ color: ThemedColor, scheme: ColorScheme) -> some View {
        foregroundStyle(color.resolve(for: scheme))
    }
}
