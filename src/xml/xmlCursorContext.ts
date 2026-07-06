/**
 * Determines what kind of completion is relevant at a cursor offset in an
 * XML document: inside a start tag (attribute name), inside an attribute
 * value, or in element content (child element), or none of the above
 * (comments, CDATA, PI, DOCTYPE, closing tags, element/attribute names
 * themselves). Pure text/offset scanning, no vscode dependency, in the same
 * spirit as xmlUtils.ts/beanshellRegions.ts — never a full DOM parser.
 *
 * Implemented as a single left-to-right pass tracking a stack of open
 * element names (with, for each, the direct children already closed before
 * the cursor) rather than one big regex: the three completion kinds each
 * need "where is the cursor relative to tag boundaries," which is naturally
 * a small state machine, not a single alternation pattern.
 */

export type CursorContext =
    | { kind: "none" }
    | { kind: "startTag"; elementName: string; existingAttributes: string[] }
    | { kind: "attributeValue"; elementName: string; attributeName: string; valueSoFar: string }
    | {
        kind: "elementContent"; parentElementName: string | undefined; siblingsSoFar: string[];
        /**
         * Offset of a '<' (optionally followed by a partial element name)
         * already typed immediately before the cursor, if any. A completion
         * whose insertText starts with '<' must replace this span instead of
         * inserting at the cursor, or the '<' would be duplicated.
         */
        openBracketOffset?: number;
    };

interface StackFrame {
    name: string;
    children: string[];
}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[\w.:-]/;

export function getCursorContext(text: string, offset: number): CursorContext {
    const stack: StackFrame[] = [];
    let i = 0;
    const length = Math.min(offset, text.length);

    while (i < length) {
        const lt = text.indexOf("<", i);
        if (lt === -1 || lt >= length) {
            break;
        }

        if (text.startsWith("<!--", lt)) {
            const end = text.indexOf("-->", lt + 4);
            if (end === -1 || offset <= end + 3) {
                return { kind: "none" };
            }
            i = end + 3;
            continue;
        }
        if (text.startsWith("<![CDATA[", lt)) {
            const end = text.indexOf("]]>", lt + 9);
            if (end === -1 || offset <= end + 3) {
                return { kind: "none" };
            }
            i = end + 3;
            continue;
        }
        if (text.startsWith("<?", lt)) {
            const end = text.indexOf("?>", lt + 2);
            if (end === -1 || offset <= end + 2) {
                return { kind: "none" };
            }
            i = end + 2;
            continue;
        }
        if (text.startsWith("<!", lt)) {
            // <!DOCTYPE ...> and any other markup declaration
            const end = findTagEnd(text, lt);
            if (offset <= end) {
                return { kind: "none" };
            }
            i = end + 1;
            continue;
        }
        if (text[lt + 1] === "/") {
            const end = text.indexOf(">", lt);
            if (end === -1 || offset <= end) {
                return { kind: "none" };
            }
            const nameMatch = /^<\/\s*([A-Za-z_][\w.:-]*)/.exec(text.substring(lt, end + 1));
            if (nameMatch && stack.length > 0) {
                // Whatever is currently open is considered closed by this tag
                // (defensive recovery if the name doesn't actually match), and
                // becomes a completed child of its own parent.
                const popped = stack.pop();
                if (popped && stack.length > 0) {
                    stack[stack.length - 1].children.push(popped.name);
                }
            }
            i = end + 1;
            continue;
        }

        const tagEnd = findTagEnd(text, lt);
        if (offset <= tagEnd) {
            return classifyInsideStartTag(text, lt, tagEnd, offset, stack[stack.length - 1]);
        }

        const tagText = text.substring(lt, Math.min(tagEnd + 1, text.length));
        const nameMatch = /^<([A-Za-z_][\w.:-]*)/.exec(tagText);
        const name = nameMatch ? nameMatch[1] : undefined;
        const selfClosing = /\/\s*>$/.test(tagText);
        if (name) {
            if (selfClosing) {
                if (stack.length > 0) {
                    stack[stack.length - 1].children.push(name);
                }
            } else {
                stack.push({ name, children: [] });
            }
        }
        i = tagEnd + 1;
    }

    const top = stack[stack.length - 1];
    return { kind: "elementContent", parentElementName: top?.name, siblingsSoFar: top ? [...top.children] : [] };
}

/** Finds the unquoted '>' closing a tag starting at `start` (index of '<'). Returns text.length if unterminated (still being typed). */
function findTagEnd(text: string, start: number): number {
    let i = start + 1;
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

function classifyInsideStartTag(text: string, tagStart: number, tagEnd: number, offset: number, parentFrame: StackFrame | undefined): CursorContext {
    const elementContentFallback: CursorContext = {
        kind: "elementContent",
        parentElementName: parentFrame?.name,
        siblingsSoFar: parentFrame ? [...parentFrame.children] : [],
        // The '<' (and any partial name after it) must be replaced by the
        // accepted completion, not left in place next to it.
        openBracketOffset: tagStart
    };

    const nameMatch = /^<([A-Za-z_][\w.:-]*)/.exec(text.substring(tagStart, Math.min(tagStart + 200, text.length)));
    if (!nameMatch) {
        // Cursor is right after a bare '<' with no name typed yet: this is
        // the moment a child element name is about to be typed.
        return elementContentFallback;
    }
    const elementName = nameMatch[1];
    const nameEnd = tagStart + 1 + elementName.length;
    if (offset <= nameEnd) {
        // Cursor is still inside/at the element name itself: still typing
        // (or extending) the child element's name.
        return elementContentFallback;
    }

    const existingAttributes: string[] = [];
    let i = nameEnd;

    while (i < tagEnd) {
        while (i < tagEnd && /\s/.test(text[i])) {
            i++;
        }
        if (i >= tagEnd || text[i] === "/") {
            break;
        }
        if (!NAME_START.test(text[i])) {
            // Unexpected character where an attribute name was expected: bail out defensively.
            break;
        }
        const attrStart = i;
        while (i < tagEnd && NAME_CHAR.test(text[i])) {
            i++;
        }
        const attrName = text.substring(attrStart, i);

        while (i < tagEnd && /\s/.test(text[i])) {
            i++;
        }
        if (text[i] !== "=") {
            // Attribute without '=' yet, or cursor lands right after the bare name: attribute-name context.
            if (offset >= attrStart && offset <= i) {
                return { kind: "startTag", elementName, existingAttributes };
            }
            continue;
        }
        i++; // consume '='
        while (i < tagEnd && /\s/.test(text[i])) {
            i++;
        }
        const quote = text[i];
        if (quote === "\"" || quote === "'") {
            const valueStart = i + 1;
            let j = valueStart;
            while (j < tagEnd && text[j] !== quote) {
                j++;
            }
            if (offset >= valueStart && offset <= j) {
                return {
                    kind: "attributeValue",
                    elementName,
                    attributeName: attrName,
                    valueSoFar: text.substring(valueStart, offset)
                };
            }
            existingAttributes.push(attrName);
            i = j < tagEnd ? j + 1 : j;
        } else {
            // '=' present but no opening quote yet (mid-typing): attribute-name/value context, treat as start tag.
            if (offset >= attrStart) {
                return { kind: "startTag", elementName, existingAttributes };
            }
        }
    }
    return { kind: "startTag", elementName, existingAttributes };
}
