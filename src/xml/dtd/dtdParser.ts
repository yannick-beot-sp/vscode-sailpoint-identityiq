/**
 * Parser for external DTD subsets (as used by sailpoint.dtd): <!ELEMENT> and
 * <!ATTLIST> declarations. <!ENTITY>/<!NOTATION>/<!DOCTYPE>/comments/PIs are
 * skipped rather than interpreted. Never throws: a malformed declaration is
 * skipped with a warning so one bad line cannot blank out the rest of a
 * 5000-line file.
 */

import { AttributeDecl, AttributeDefault, AttributeType, Cardinality, ContentModel, DtdModel, ElementDecl } from "./dtdModel";
import { DtdToken, tokenizeDtd } from "./dtdTokenizer";

export interface DtdParseResult {
    model: DtdModel;
    warnings: string[];
}

interface MutableElementEntry {
    contentModel?: ContentModel;
    attributes: AttributeDecl[];
}

export function parseDtd(text: string): DtdParseResult {
    const entries = new Map<string, MutableElementEntry>();
    const warnings: string[] = [];
    let i = 0;
    const length = text.length;

    while (i < length) {
        const lt = text.indexOf("<", i);
        if (lt === -1) {
            break;
        }
        if (text.startsWith("<!--", lt)) {
            const end = text.indexOf("-->", lt + 4);
            i = end === -1 ? length : end + 3;
            continue;
        }
        if (text.startsWith("<?", lt)) {
            const end = text.indexOf("?>", lt + 2);
            i = end === -1 ? length : end + 2;
            continue;
        }
        if (text.startsWith("<!ELEMENT", lt)) {
            const end = findDeclarationEnd(text, lt + "<!ELEMENT".length);
            const body = text.substring(lt + "<!ELEMENT".length, end);
            parseElementDecl(body, entries, warnings, lt);
            i = end < length ? end + 1 : length;
            continue;
        }
        if (text.startsWith("<!ATTLIST", lt)) {
            const end = findDeclarationEnd(text, lt + "<!ATTLIST".length);
            const body = text.substring(lt + "<!ATTLIST".length, end);
            parseAttlistDecl(body, entries, warnings, lt);
            i = end < length ? end + 1 : length;
            continue;
        }
        if (text.startsWith("<!ENTITY", lt) || text.startsWith("<!NOTATION", lt) || text.startsWith("<!DOCTYPE", lt)) {
            const end = findDeclarationEnd(text, lt);
            i = end < length ? end + 1 : length;
            continue;
        }
        // Unknown '<' construct: skip past it defensively, do not get stuck
        i = lt + 1;
    }

    const model: DtdModel = new Map();
    for (const [name, entry] of entries) {
        const decl: ElementDecl = {
            name,
            // An element only ever referenced by an <!ATTLIST> without a
            // matching <!ELEMENT> (malformed DTD) degrades to EMPTY rather
            // than crashing downstream consumers.
            contentModel: entry.contentModel ?? { kind: "empty" },
            attributes: entry.attributes
        };
        model.set(name, decl);
    }
    return { model, warnings };
}

/** Finds the unquoted '>' that closes a declaration starting search at `from`. */
function findDeclarationEnd(text: string, from: number): number {
    let i = from;
    let quote: string | undefined;
    while (i < text.length) {
        const c = text[i];
        if (quote) {
            if (c === quote) {
                quote = undefined;
            }
        } else if (c === "\"" || c === "'") {
            quote = c;
        } else if (c === ">") {
            return i;
        }
        i++;
    }
    return text.length;
}

function getOrCreateEntry(entries: Map<string, MutableElementEntry>, name: string): MutableElementEntry {
    let entry = entries.get(name);
    if (!entry) {
        entry = { attributes: [] };
        entries.set(name, entry);
    }
    return entry;
}

function parseElementDecl(body: string, entries: Map<string, MutableElementEntry>, warnings: string[], offset: number): void {
    const tokens = tokenizeDtd(body);
    if (tokens.length === 0 || tokens[0].kind !== "identifier") {
        warnings.push(`<!ELEMENT> without a name near offset ${offset}`);
        return;
    }
    const name = tokens[0].text;
    const contentModel = parseContentSpec(tokens.slice(1), warnings, name);
    getOrCreateEntry(entries, name).contentModel = contentModel;
}

function parseContentSpec(tokens: DtdToken[], warnings: string[], elementName: string): ContentModel {
    if (tokens.length === 0) {
        warnings.push(`<!ELEMENT ${elementName}> has no content spec`);
        return { kind: "empty" };
    }
    if (tokens.length === 1 && tokens[0].kind === "identifier" && tokens[0].text === "EMPTY") {
        return { kind: "empty" };
    }
    if (tokens.length === 1 && tokens[0].kind === "identifier" && tokens[0].text === "ANY") {
        return { kind: "any" };
    }
    if (tokens[0].text !== "(") {
        warnings.push(`<!ELEMENT ${elementName}> has an unrecognized content spec`);
        return { kind: "empty" };
    }

    // Mixed content: (#PCDATA) or (#PCDATA|a|b)*
    if (tokens[1] && tokens[1].kind === "special" && tokens[1].text === "#PCDATA") {
        let pos = 2;
        const names: string[] = [];
        while (tokens[pos] && tokens[pos].text === "|") {
            pos++;
            if (tokens[pos] && tokens[pos].kind === "identifier") {
                names.push(tokens[pos].text);
                pos++;
            }
        }
        if (tokens[pos] && tokens[pos].text === ")") {
            pos++;
        }
        // A trailing '*' is expected by the spec when child names are present; tolerate its absence.
        if (tokens[pos] && tokens[pos].text === "*") {
            pos++;
        }
        if (names.length === 0) {
            return { kind: "pcdata" };
        }
        // Best-effort: this DTD never mixes text with elements, but degrade
        // gracefully by offering the named elements as a repeatable choice.
        return {
            kind: "choice",
            items: names.map((n): ContentModel => ({ kind: "element", name: n, cardinality: "one" })),
            cardinality: "star"
        };
    }

    const { node, pos } = parseGroup(tokens, 0, warnings, elementName);
    if (pos !== tokens.length) {
        warnings.push(`<!ELEMENT ${elementName}> has trailing tokens after its content model`);
    }
    return node;
}

function parseCardinalitySuffix(tokens: DtdToken[], pos: number): { cardinality: Cardinality; pos: number } {
    const token = tokens[pos];
    if (token && token.kind === "punct") {
        if (token.text === "?") {
            return { cardinality: "optional", pos: pos + 1 };
        }
        if (token.text === "*") {
            return { cardinality: "star", pos: pos + 1 };
        }
        if (token.text === "+") {
            return { cardinality: "plus", pos: pos + 1 };
        }
    }
    return { cardinality: "one", pos };
}

/** Parses one content particle: an element name or a nested group, each with an optional cardinality suffix. */
function parseParticle(tokens: DtdToken[], pos: number, warnings: string[], elementName: string): { node: ContentModel; pos: number } {
    if (tokens[pos] && tokens[pos].text === "(") {
        return parseGroup(tokens, pos, warnings, elementName);
    }
    const token = tokens[pos];
    if (!token || token.kind !== "identifier") {
        warnings.push(`<!ELEMENT ${elementName}> expected an element name in its content model`);
        return { node: { kind: "empty" }, pos: pos + 1 };
    }
    const suffix = parseCardinalitySuffix(tokens, pos + 1);
    return { node: { kind: "element", name: token.text, cardinality: suffix.cardinality }, pos: suffix.pos };
}

/** Parses a parenthesized group of comma/pipe separated particles, with its own trailing cardinality suffix. */
function parseGroup(tokens: DtdToken[], pos: number, warnings: string[], elementName: string): { node: ContentModel; pos: number } {
    // Caller guarantees tokens[pos].text === "("
    pos++;
    const items: ContentModel[] = [];
    let separator: "," | "|" | undefined;

    while (true) {
        const particle = parseParticle(tokens, pos, warnings, elementName);
        items.push(particle.node);
        pos = particle.pos;

        const next = tokens[pos];
        if (!next) {
            warnings.push(`<!ELEMENT ${elementName}> has an unterminated group`);
            break;
        }
        if (next.text === ")") {
            break;
        }
        if (next.text === "," || next.text === "|") {
            if (separator === undefined) {
                separator = next.text;
            } else if (separator !== next.text) {
                warnings.push(`<!ELEMENT ${elementName}> mixes ',' and '|' in the same group`);
            }
            pos++;
            continue;
        }
        warnings.push(`<!ELEMENT ${elementName}> has an unexpected token in its content model`);
        break;
    }
    if (tokens[pos] && tokens[pos].text === ")") {
        pos++;
    }
    const suffix = parseCardinalitySuffix(tokens, pos);

    if (items.length === 1) {
        // A single-item group only differs from the bare item by its own
        // cardinality suffix, which is applied on top of the item's own.
        return { node: applyGroupCardinality(items[0], suffix.cardinality, "sequence"), pos: suffix.pos };
    }
    const kind = separator === "|" ? "choice" : "sequence";
    return { node: { kind, items, cardinality: suffix.cardinality }, pos: suffix.pos };
}

/**
 * Applies a single-item group's own cardinality suffix, e.g. the `?` in
 * `(key)?`. When the inner particle has no cardinality of its own (the
 * common case), the suffix is folded directly onto it instead of adding an
 * extra sequence-of-one wrapper, keeping the tree flat.
 */
function applyGroupCardinality(item: ContentModel, cardinality: Cardinality, kind: "sequence" | "choice"): ContentModel {
    if (cardinality === "one") {
        return item;
    }
    if ("cardinality" in item && item.cardinality === "one") {
        return { ...item, cardinality };
    }
    return { kind, items: [item], cardinality };
}

function parseAttlistDecl(body: string, entries: Map<string, MutableElementEntry>, warnings: string[], offset: number): void {
    const tokens = tokenizeDtd(body);
    if (tokens.length === 0 || tokens[0].kind !== "identifier") {
        warnings.push(`<!ATTLIST> without a name near offset ${offset}`);
        return;
    }
    const elementName = tokens[0].text;
    const attributes: AttributeDecl[] = [];
    let pos = 1;

    while (pos < tokens.length) {
        const nameToken = tokens[pos];
        if (nameToken.kind !== "identifier") {
            warnings.push(`<!ATTLIST ${elementName}> has an unexpected token instead of an attribute name`);
            break;
        }
        const attrName = nameToken.text;
        pos++;

        const typeResult = parseAttributeType(tokens, pos, warnings, elementName, attrName);
        pos = typeResult.pos;

        const defaultResult = parseAttributeDefault(tokens, pos);
        pos = defaultResult.pos;

        attributes.push({ name: attrName, type: typeResult.type, default: defaultResult.value });
    }

    getOrCreateEntry(entries, elementName).attributes.push(...attributes);
}

function parseAttributeType(tokens: DtdToken[], pos: number, warnings: string[], elementName: string, attrName: string): { type: AttributeType; pos: number } {
    const token = tokens[pos];
    if (token && token.text === "(") {
        pos++;
        const values: string[] = [];
        while (tokens[pos] && tokens[pos].text !== ")") {
            if (tokens[pos].kind === "identifier") {
                values.push(tokens[pos].text);
            }
            pos++;
        }
        if (tokens[pos] && tokens[pos].text === ")") {
            pos++;
        }
        return { type: { kind: "enumeration", values }, pos };
    }
    if (token && token.kind === "identifier") {
        pos++;
        // NOTATION (a|b|c) — skip the enumeration, treat as opaque CDATA-like
        if (token.text === "NOTATION" && tokens[pos] && tokens[pos].text === "(") {
            pos++;
            while (tokens[pos] && tokens[pos].text !== ")") {
                pos++;
            }
            if (tokens[pos] && tokens[pos].text === ")") {
                pos++;
            }
        }
        // CDATA, ID, IDREF, IDREFS, ENTITY, ENTITIES, NMTOKEN, NMTOKENS all
        // degrade to "cdata" — none of them offer a fixed value set to complete.
        return { type: { kind: "cdata" }, pos };
    }
    warnings.push(`<!ATTLIST ${elementName}> attribute ${attrName} has no recognizable type`);
    return { type: { kind: "cdata" }, pos: pos + 1 };
}

function parseAttributeDefault(tokens: DtdToken[], pos: number): { value: AttributeDefault; pos: number } {
    const token = tokens[pos];
    if (token && token.kind === "special") {
        pos++;
        if (token.text === "#REQUIRED") {
            return { value: { kind: "required" }, pos };
        }
        if (token.text === "#FIXED") {
            const literal = tokens[pos];
            if (literal && literal.kind === "string") {
                pos++;
                return { value: { kind: "fixed", value: literal.text }, pos };
            }
            return { value: { kind: "fixed", value: "" }, pos };
        }
        // #IMPLIED, or any other unrecognized keyword
        return { value: { kind: "implied" }, pos };
    }
    if (token && token.kind === "string") {
        return { value: { kind: "default", value: token.text }, pos: pos + 1 };
    }
    return { value: { kind: "implied" }, pos };
}
