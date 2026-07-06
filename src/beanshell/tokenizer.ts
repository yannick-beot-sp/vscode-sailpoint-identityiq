/**
 * Minimal BeanShell/Java lexer. Strings and comments are single tokens so
 * that a '.' inside them can never be mistaken for a member access.
 * Offsets are relative to the tokenized text (the BeanShell region).
 */

export type TokenKind = "identifier" | "keyword" | "string" | "char" | "number" | "punct" | "comment";

export interface Token {
    kind: TokenKind;
    text: string;
    /** Offset of the first character */
    start: number;
    /** Offset after the last character */
    end: number;
}

export const JAVA_KEYWORDS = new Set([
    "abstract", "assert", "boolean", "break", "byte", "case", "catch", "char",
    "class", "const", "continue", "default", "do", "double", "else", "enum",
    "extends", "final", "finally", "float", "for", "goto", "if", "implements",
    "import", "instanceof", "int", "interface", "long", "native", "new",
    "package", "private", "protected", "public", "return", "short", "static",
    "strictfp", "super", "switch", "synchronized", "this", "throw", "throws",
    "transient", "try", "void", "volatile", "while",
    // literals, treated as keywords for simplicity
    "true", "false", "null"
]);

const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/** Tokenizes BeanShell source. Never throws, even on malformed input. */
export function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const length = text.length;

    while (i < length) {
        const c = text[i];

        // Whitespace
        if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f") {
            i++;
            continue;
        }

        // Comments
        if (c === "/" && text[i + 1] === "/") {
            const end = text.indexOf("\n", i);
            const stop = end === -1 ? length : end;
            tokens.push({ kind: "comment", text: text.substring(i, stop), start: i, end: stop });
            i = stop;
            continue;
        }
        if (c === "/" && text[i + 1] === "*") {
            const end = text.indexOf("*/", i + 2);
            const stop = end === -1 ? length : end + 2;
            tokens.push({ kind: "comment", text: text.substring(i, stop), start: i, end: stop });
            i = stop;
            continue;
        }

        // String and char literals (backslash escapes handled)
        if (c === "\"" || c === "'") {
            let j = i + 1;
            while (j < length && text[j] !== c) {
                j += text[j] === "\\" ? 2 : 1;
            }
            const stop = Math.min(j + 1, length);
            tokens.push({
                kind: c === "\"" ? "string" : "char",
                text: text.substring(i, stop), start: i, end: stop
            });
            i = stop;
            continue;
        }

        // Numbers (loose: 12, 1.5f, 0xFF, 1_000L...)
        if (DIGIT.test(c) || (c === "." && DIGIT.test(text[i + 1] ?? ""))) {
            let j = i + 1;
            while (j < length && /[0-9A-Za-z._]/.test(text[j])) {
                j++;
            }
            tokens.push({ kind: "number", text: text.substring(i, j), start: i, end: j });
            i = j;
            continue;
        }

        // Identifiers and keywords
        if (IDENTIFIER_START.test(c)) {
            let j = i + 1;
            while (j < length && IDENTIFIER_PART.test(text[j])) {
                j++;
            }
            const word = text.substring(i, j);
            tokens.push({
                kind: JAVA_KEYWORDS.has(word) ? "keyword" : "identifier",
                text: word, start: i, end: j
            });
            i = j;
            continue;
        }

        // Everything else: single-character punctuation/operator
        tokens.push({ kind: "punct", text: c, start: i, end: i + 1 });
        i++;
    }
    return tokens;
}
