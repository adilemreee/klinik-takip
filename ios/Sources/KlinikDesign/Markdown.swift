import SwiftUI

/**
 * Markdown, rendered rather than shown as asterisks.
 *
 * The AI layer writes headings and bullet lists; `AttributedString`'s inline
 * parsing would collapse them onto one line, so the full-document option is
 * used and paragraphs are laid out here. A string that fails to parse is shown
 * verbatim — losing a clinician's report to a stray character would be worse
 * than showing them a stray character.
 */
public struct Markdown: View {
    private let source: String

    public init(_ source: String) {
        self.source = source
    }

    public var body: some View {
        Text(Markdown.attributed(source))
            .fixedSize(horizontal: false, vertical: true)
            .multilineTextAlignment(.leading)
    }

    /// `nonisolated` because it is a pure function of its argument. A `View` is
    /// implicitly main-actor isolated, and older toolchains carry that to its
    /// static members — which made this compile here and fail in CI.
    nonisolated public static func attributed(_ source: String) -> AttributedString {
        (try? AttributedString(
            markdown: source,
            options: .init(interpretedSyntax: .full, failurePolicy: .returnPartiallyParsedIfPossible)
        )) ?? AttributedString(source)
    }
}
