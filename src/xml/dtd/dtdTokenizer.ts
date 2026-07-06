/**
 * Minimal tokenizer for the body of a single <!ELEMENT>/<!ATTLIST>
 * declaration (the surrounding markup and declaration dispatch is handled by
 * dtdParser.ts). Never throws, even on malformed input.
 */

export type DtdTokenKind = "identifier" | "punct" | "string" | "special";

export interface DtdToken {
    kind: DtdTokenKind;
    /** Token text. For "string" tokens, the quotes are stripped. */
    text: string;
    start: number;
    end: number;
}

const IDENTIFIER_CHAR = /[A-Za-z0-9_.:-]/;
const GROUP_PUNCT = new Set(["(", ")", ",", "|", "?", "*", "+"]);

export function tokenizeDtd(text: string): DtdToken[] {
    const tokens: DtdToken[] = [];
    let i = 0;
    const length = text.length;

    while (i < length) {
        const c = text[i];

        if (/\s/.test(c)) {
            i++;
            continue;
        }

        if (GROUP_PUNCT.has(c)) {
            tokens.push({ kind: "punct", text: c, start: i, end: i + 1 });
            i++;
            continue;
        }

        if (c === "\"" || c === "'") {
            let j = i + 1;
            while (j < length && text[j] !== c) {
                j++;
            }
            const stop = Math.min(j + 1, length);
            tokens.push({ kind: "string", text: text.substring(i + 1, Math.min(j, length)), start: i, end: stop });
            i = stop;
            continue;
        }

        // Reserved keywords like #PCDATA, #IMPLIED, #REQUIRED, #FIXED
        if (c === "#") {
            let j = i + 1;
            while (j < length && /[A-Za-z]/.test(text[j])) {
                j++;
            }
            tokens.push({ kind: "special", text: text.substring(i, j), start: i, end: j });
            i = j;
            continue;
        }

        if (IDENTIFIER_CHAR.test(c)) {
            let j = i + 1;
            while (j < length && IDENTIFIER_CHAR.test(text[j])) {
                j++;
            }
            tokens.push({ kind: "identifier", text: text.substring(i, j), start: i, end: j });
            i = j;
            continue;
        }

        // Unknown character: skip defensively rather than throwing
        i++;
    }
    return tokens;
}
