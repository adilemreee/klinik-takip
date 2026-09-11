import SwiftUI

/**
 * Markdown, rendered as blocks rather than as one run-on line.
 *
 * `AttributedString(markdown:)` with `.full` records block structure as
 * `presentationIntent` and drops the line breaks that carried it — and `Text`
 * ignores presentation intent entirely. A heading, three paragraphs and a
 * bullet list therefore arrive on screen as a single sentence with no gaps in
 * it. That is not a cosmetic loss on a consent form: it is the difference
 * between a document somebody can read and a wall they scroll past.
 *
 * So the block structure is parsed here and laid out, and only the *inline*
 * markup — bold, italic, code, links — is handed to `AttributedString`, which
 * is the job it does correctly. A line that fails to parse is shown verbatim;
 * losing a clinician's report to a stray asterisk would be worse than showing
 * them a stray asterisk.
 */
public struct Markdown: View {
    private let source: String

    public init(_ source: String) {
        self.source = source
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Spacing.md) {
            ForEach(Markdown.blocks(in: source)) { block in
                view(for: block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func view(for block: Block) -> some View {
        switch block.kind {
        case .heading(let level, let text):
            Text(Markdown.attributed(text))
                .font(Markdown.font(forHeadingLevel: level))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, level <= 2 ? Tokens.Spacing.sm : 0)

        case .paragraph(let text):
            Text(Markdown.attributed(text))
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

        case .quote(let text):
            HStack(alignment: .top, spacing: Tokens.Spacing.sm) {
                Rectangle()
                    .frame(width: 3)
                    .accessibilityHidden(true)

                Text(Markdown.attributed(text))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .opacity(0.85)

        case .list(let items, let ordered):
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: Tokens.Spacing.sm) {
                        // A real marker, because the list's shape is part of
                        // what the sentence means.
                        Text(ordered ? "\(index + 1)." : "•")
                            .monospacedDigit()
                            .accessibilityHidden(true)

                        Text(Markdown.attributed(item))
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }

        case .table(let rows):
            TableBlock(rows: rows)

        case .rule:
            Divider()
        }
    }

    /// `nonisolated` because it is a pure function of its argument. A `View` is
    /// implicitly main-actor isolated, and older toolchains carry that to its
    /// static members — which made this compile here and fail in CI.
    nonisolated public static func attributed(_ source: String) -> AttributedString {
        // Inline only: the block structure is this type's own job, and `.full`
        // would swallow the line breaks the parser above depends on.
        (try? AttributedString(
            markdown: source,
            options: .init(
                interpretedSyntax: .inlineOnlyPreservingWhitespace,
                failurePolicy: .returnPartiallyParsedIfPossible
            )
        )) ?? AttributedString(source)
    }

    nonisolated static func font(forHeadingLevel level: Int) -> Font {
        switch level {
        case 1: return Tokens.Typography.titleRelative
        case 2: return Tokens.Typography.headingRelative
        default: return Tokens.Typography.subheadingRelative
        }
    }
}

// MARK: - Parsing

public extension Markdown {
    /// One piece of the document, with an identity so `ForEach` can hold it.
    struct Block: Identifiable, Equatable {
        public let id: Int
        public let kind: Kind
    }

    enum Kind: Equatable {
        case heading(level: Int, text: String)
        case paragraph(String)
        case quote(String)
        case list(items: [String], ordered: Bool)
        /// Rows of cells, first row being the header when the source had one.
        case table(rows: [[String]])
        case rule
    }

    /**
     * The document, split into blocks.
     *
     * Deliberately small: headings, paragraphs, quotes, bullet and numbered
     * lists, pipe tables and horizontal rules. That is what the clinic's
     * documents and the AI layer's reports actually contain, and a fuller
     * parser would be more surface than this needs.
     *
     * `nonisolated` and pure, so the tests can hold it to the one rule that
     * matters — that a heading and the paragraph under it do not become one
     * line.
     */
    nonisolated static func blocks(in source: String) -> [Block] {
        var kinds: [Kind] = []
        var paragraph: [String] = []
        var quote: [String] = []
        var list: [String] = []
        var ordered = false
        var table: [[String]] = []

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            kinds.append(.paragraph(paragraph.joined(separator: " ")))
            paragraph = []
        }

        func flushQuote() {
            guard !quote.isEmpty else { return }
            kinds.append(.quote(quote.joined(separator: " ")))
            quote = []
        }

        func flushList() {
            guard !list.isEmpty else { return }
            kinds.append(.list(items: list, ordered: ordered))
            list = []
        }

        func flushTable() {
            guard !table.isEmpty else { return }
            kinds.append(.table(rows: table))
            table = []
        }

        func flushAll() {
            flushParagraph()
            flushQuote()
            flushList()
            flushTable()
        }

        for rawLine in source.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)

            if line.isEmpty {
                flushAll()
                continue
            }

            // An HTML comment is a note to whoever maintains the document, not
            // to whoever reads it.
            if line.hasPrefix("<!--") { continue }

            if let heading = Markdown.heading(in: line) {
                flushAll()
                kinds.append(heading)
                continue
            }

            if Markdown.isRule(line) {
                flushAll()
                kinds.append(.rule)
                continue
            }

            if let cells = Markdown.tableCells(in: line) {
                flushParagraph()
                flushQuote()
                flushList()

                // The `|---|---|` line under a header carries no content; it
                // only says the row above it was a header.
                if !Markdown.isTableDivider(cells) { table.append(cells) }
                continue
            }

            flushTable()

            if line.hasPrefix(">") {
                flushParagraph()
                flushList()
                quote.append(String(line.dropFirst()).trimmingCharacters(in: .whitespaces))
                continue
            }

            if let item = Markdown.bullet(in: line) {
                flushParagraph()
                flushQuote()
                if !list.isEmpty && ordered { flushList() }
                ordered = false
                list.append(item)
                continue
            }

            if let item = Markdown.numbered(in: line) {
                flushParagraph()
                flushQuote()
                if !list.isEmpty && !ordered { flushList() }
                ordered = true
                list.append(item)
                continue
            }

            flushQuote()
            flushList()
            paragraph.append(line)
        }

        flushAll()

        return kinds.enumerated().map { Block(id: $0.offset, kind: $0.element) }
    }

    private nonisolated static func heading(in line: String) -> Kind? {
        guard line.hasPrefix("#") else { return nil }

        let level = line.prefix(while: { $0 == "#" }).count
        guard level <= 6 else { return nil }

        let text = String(line.dropFirst(level)).trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }

        return .heading(level: level, text: text)
    }

    private nonisolated static func isRule(_ line: String) -> Bool {
        let stripped = line.replacingOccurrences(of: " ", with: "")

        return stripped.count >= 3
            && (stripped.allSatisfy { $0 == "-" } || stripped.allSatisfy { $0 == "*" })
    }

    private nonisolated static func bullet(in line: String) -> String? {
        for marker in ["- ", "* ", "+ "] where line.hasPrefix(marker) {
            return String(line.dropFirst(marker.count)).trimmingCharacters(in: .whitespaces)
        }

        // A marker on its own line is an empty item, not a paragraph beginning
        // with a dash.
        return ["-", "*", "+"].contains(line) ? "" : nil
    }

    private nonisolated static func numbered(in line: String) -> String? {
        let digits = line.prefix(while: \.isNumber)
        guard !digits.isEmpty else { return nil }

        let rest = line.dropFirst(digits.count)
        guard rest.hasPrefix(". ") || rest.hasPrefix(") ") else { return nil }

        return String(rest.dropFirst(2)).trimmingCharacters(in: .whitespaces)
    }

    private nonisolated static func tableCells(in line: String) -> [String]? {
        guard line.hasPrefix("|") else { return nil }

        var body = line
        if body.hasSuffix("|") { body = String(body.dropLast()) }
        body = String(body.dropFirst())

        return body
            .split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private nonisolated static func isTableDivider(_ cells: [String]) -> Bool {
        !cells.isEmpty && cells.allSatisfy { cell in
            !cell.isEmpty && cell.allSatisfy { $0 == "-" || $0 == ":" }
        }
    }
}

// MARK: - Tables

/**
 * A pipe table.
 *
 * Two columns are drawn as label-and-value rows rather than as a grid: that is
 * what a two-column table in these documents always is ("Planlanan işlem:
 * …"), and it survives the largest accessibility text size, which a grid on a
 * phone does not. Anything wider keeps its shape and scrolls sideways — a
 * clinical table squeezed to fit is a table that has been altered.
 */
struct TableBlock: View {
    @Environment(\.colorScheme) private var scheme

    let rows: [[String]]

    private var isPairs: Bool { rows.allSatisfy { $0.count <= 2 } }

    var body: some View {
        if isPairs {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    pair(row)
                }
            }
            .padding(Tokens.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Tokens.Palette.surface.resolve(for: scheme))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.md, style: .continuous))
        } else {
            ScrollView(.horizontal) {
                VStack(alignment: .leading, spacing: Tokens.Spacing.xs) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                        HStack(alignment: .top, spacing: Tokens.Spacing.md) {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(Markdown.attributed(cell))
                                    .font(
                                        index == 0
                                            ? Tokens.Typography.subheadingRelative
                                            : Tokens.Typography.bodyRelative
                                    )
                                    .frame(width: 140, alignment: .leading)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                .padding(Tokens.Spacing.md)
            }
        }
    }

    @ViewBuilder
    private func pair(_ row: [String]) -> some View {
        let label = row.first ?? ""
        let value = row.count > 1 ? row[1] : ""

        if label.isEmpty && value.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: Tokens.Spacing.xxs) {
                if !label.isEmpty {
                    Text(Markdown.attributed(label))
                        .font(Tokens.Typography.captionRelative)
                        .foregroundStyle(Tokens.Palette.textSecondary.resolve(for: scheme))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !value.isEmpty {
                    Text(Markdown.attributed(value))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }
}
