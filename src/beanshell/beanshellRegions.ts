/**
 * Locates the BeanShell code regions of an IdentityIQ XML document.
 *
 * BeanShell source lives in CDATA sections inside <Source> elements:
 * - <Rule ...><Source><![CDATA[...]]></Source></Rule>
 * - <Script><Source><![CDATA[...]]></Source></Script> (workflow steps...)
 *
 * The module is pure (no vscode dependency): it works on the document text
 * and returns character offsets, so it can be unit-tested and reused by all
 * language providers. Offsets always refer to the ORIGINAL text.
 */

import { decodeXmlEntities } from "../utils/xmlUtils";

/** An argument declared in a <Signature><Inputs> block */
export interface SignatureArgument {
    name: string;
    /** Java type, as declared in the Signature (may be a simple or fully qualified name) */
    type?: string;
}

/** A BeanShell code region (the content of a <Source> CDATA section) */
export interface BeanshellRegion {
    /** Offset of the first character of the CDATA content in the document */
    start: number;
    /** Offset after the last character of the CDATA content */
    end: number;
    /** Element owning the <Source>: a Rule, a Script or something else */
    container: "Rule" | "Script" | "other";
    /** Value of the type attribute of the owning <Rule>, if any */
    ruleType?: string;
    /** Arguments of the <Signature><Inputs> of the owning <Rule>, if any */
    signatureInputs?: SignatureArgument[];
    /** returnType attribute of the <Signature>, if any */
    signatureReturnType?: string;
}

/**
 * Single left-to-right scan: XML comments are consumed first so that a
 * commented-out rule never yields a region; bare CDATA sections (not preceded
 * by <Source>) are consumed so their content cannot be misinterpreted; a
 * <Source> without CDATA (rule being hand-written) yields a plain-text region.
 * CDATA sections still being typed (no ]]> yet) end at </Source> or at the
 * end of the document.
 */
const REGION_REGEX = /<!--[\s\S]*?-->|<Source\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)(?:\]\]>|(?=<\/Source>)|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<Source\b[^>]*>([^<]*)/g;

const CDATA_OPEN = "<![CDATA[";

/** Finds all BeanShell regions of an XML document, sorted by position */
export function findBeanshellRegions(xml: string): BeanshellRegion[] {
    const regions: BeanshellRegion[] = [];
    // Comments and CDATA contents replaced by spaces: safe to search for
    // enclosing elements with regexes while keeping offsets unchanged.
    let masked: string | undefined;

    const regex = new RegExp(REGION_REGEX.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
        let contentStart: number;
        let contentEnd: number;
        if (match[1] !== undefined) {
            // <Source> with CDATA (possibly still unclosed)
            contentStart = match.index + match[0].indexOf(CDATA_OPEN) + CDATA_OPEN.length;
            contentEnd = contentStart + match[1].length;
        } else if (match[2] !== undefined) {
            // <Source> without CDATA: plain text content, ends at the match
            contentEnd = match.index + match[0].length;
            contentStart = contentEnd - match[2].length;
        } else {
            continue; // comment or bare CDATA
        }

        masked ??= maskXml(xml);
        regions.push(buildRegion(masked, contentStart, contentEnd));

        // Zero-width plain regions (<Source></Source>) must not stall the scan
        if (regex.lastIndex === match.index) {
            regex.lastIndex++;
        }
    }
    return regions;
}

/** Returns the region containing the given document offset, if any */
export function getRegionAtOffset(regions: BeanshellRegion[], offset: number): BeanshellRegion | undefined {
    // Regions are sorted and never overlap
    let low = 0, high = regions.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const region = regions[mid];
        if (offset < region.start) {
            high = mid - 1;
        } else if (offset > region.end) {
            low = mid + 1;
        } else {
            return region;
        }
    }
    return undefined;
}

/** Replaces comments and CDATA contents with spaces, preserving offsets */
function maskXml(xml: string): string {
    return xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?(?:\]\]>|(?=<\/Source>)|$)/g,
        (m) => " ".repeat(m.length));
}

function buildRegion(masked: string, start: number, end: number): BeanshellRegion {
    const rule = findEnclosingElement(masked, "Rule", start, end);
    if (rule) {
        const region: BeanshellRegion = { start, end, container: "Rule" };
        const openTag = masked.substring(rule.openStart, rule.openEnd);
        region.ruleType = getAttribute(openTag, "type");
        const signature = parseSignature(masked.substring(rule.openEnd, rule.closeStart));
        if (signature) {
            region.signatureInputs = signature.inputs;
            region.signatureReturnType = signature.returnType;
        }
        return region;
    }
    if (findEnclosingElement(masked, "Script", start, end)) {
        return { start, end, container: "Script" };
    }
    return { start, end, container: "other" };
}

interface ElementSpan {
    openStart: number;
    openEnd: number;
    /** Offset of the matching closing tag */
    closeStart: number;
}

/**
 * Finds the element of the given name enclosing [regionStart, regionEnd).
 * IdentityIQ exports never nest Rule inside Rule or Script inside Script,
 * so the nearest opening tag before the region is the candidate.
 */
function findEnclosingElement(masked: string, tagName: string,
    regionStart: number, regionEnd: number): ElementSpan | undefined {

    const openRegex = new RegExp(`<${tagName}\\b[^>]*>`, "g");
    let lastOpen: RegExpExecArray | undefined;
    let match: RegExpExecArray | null;
    while ((match = openRegex.exec(masked)) !== null && match.index < regionStart) {
        if (!match[0].endsWith("/>")) {
            lastOpen = match;
        }
    }
    if (!lastOpen) {
        return undefined;
    }
    const openEnd = lastOpen.index + lastOpen[0].length;
    const closeStart = masked.indexOf(`</${tagName}>`, openEnd);
    if (closeStart === -1 || closeStart < regionEnd) {
        return undefined;
    }
    return { openStart: lastOpen.index, openEnd, closeStart };
}

/** Extracts an attribute value from an opening tag (single or double quotes) */
function getAttribute(tag: string, name: string): string | undefined {
    const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
    if (!match) {
        return undefined;
    }
    return decodeXmlEntities(match[1] ?? match[2]);
}

function parseSignature(ruleBody: string):
    { inputs: SignatureArgument[]; returnType?: string } | undefined {

    const signatureMatch = ruleBody.match(/(<Signature\b[^>]*>)([\s\S]*?)<\/Signature>/);
    if (!signatureMatch) {
        return undefined;
    }
    const returnType = getAttribute(signatureMatch[1], "returnType");

    const inputs: SignatureArgument[] = [];
    const inputsMatch = signatureMatch[2].match(/<Inputs\b[^>]*>([\s\S]*?)<\/Inputs>/);
    if (inputsMatch) {
        const argumentRegex = /<Argument\b[^>]*>/g;
        let argument: RegExpExecArray | null;
        while ((argument = argumentRegex.exec(inputsMatch[1])) !== null) {
            const name = getAttribute(argument[0], "name");
            if (name) {
                inputs.push({ name, type: getAttribute(argument[0], "type") });
            }
        }
    }
    return { inputs, returnType };
}
