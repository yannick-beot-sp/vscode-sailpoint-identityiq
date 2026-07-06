/**
 * Parses an IdentityIQ Workflow XML document into a {@link WorkflowModel}.
 *
 * Contains a minimal, forgiving XML element-tree scanner (comments, CDATA,
 * PIs and DOCTYPE aware, offset-tracking) in the same self-contained spirit
 * as xmlUtils.ts/xmlCursorContext.ts. It is enough for well-formed-ish
 * documents being edited: mismatched or missing end tags never throw, the
 * tree is simply recovered defensively.
 */

import { StepKind, WorkflowArg, WorkflowModel, WorkflowStep, WorkflowTransition, WorkflowVariable } from "./workflowModel";

// ---------------------------------------------------------------------------
// Minimal XML element tree
// ---------------------------------------------------------------------------

export interface XmlElement {
    name: string;
    attributes: Record<string, string>;
    children: XmlElement[];
    /** Concatenated direct text and CDATA content. */
    text: string;
    /** Offset of the '<' of the start tag. */
    start: number;
    /** Offset just past the '>' that closes the element (end tag or self-closing tag). */
    end: number;
}

const NAME_RE = /^<([A-Za-z_][\w.:-]*)/;

function decodeEntities(value: string): string {
    if (!value.includes("&")) {
        return value;
    }
    return value.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (match, entity: string) => {
        switch (entity) {
            case "amp": return "&";
            case "lt": return "<";
            case "gt": return ">";
            case "quot": return "\"";
            case "apos": return "'";
        }
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
            const code = parseInt(entity.substring(2), 16);
            return Number.isNaN(code) ? match : String.fromCodePoint(code);
        }
        if (entity.startsWith("#")) {
            const code = parseInt(entity.substring(1), 10);
            return Number.isNaN(code) ? match : String.fromCodePoint(code);
        }
        return match;
    });
}

/** Finds the unquoted '>' closing a tag starting at `start` (index of '<'). Returns text.length if unterminated. */
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

function parseAttributes(tagText: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    const attrRe = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let match: RegExpExecArray | null;
    while ((match = attrRe.exec(tagText)) !== null) {
        attributes[match[1]] = decodeEntities(match[3] ?? match[4] ?? "");
    }
    return attributes;
}

/**
 * Parses the document into a forest of root-level elements.
 * Never throws: unterminated constructs simply end the scan.
 */
export function parseXmlElements(text: string): XmlElement[] {
    const roots: XmlElement[] = [];
    const stack: XmlElement[] = [];
    let i = 0;

    const appendText = (value: string) => {
        const top = stack[stack.length - 1];
        if (top && value) {
            top.text += value;
        }
    };

    while (i < text.length) {
        const lt = text.indexOf("<", i);
        if (lt === -1) {
            appendText(decodeEntities(text.substring(i)));
            break;
        }
        appendText(decodeEntities(text.substring(i, lt)));

        if (text.startsWith("<!--", lt)) {
            const end = text.indexOf("-->", lt + 4);
            if (end === -1) { break; }
            i = end + 3;
            continue;
        }
        if (text.startsWith("<![CDATA[", lt)) {
            const end = text.indexOf("]]>", lt + 9);
            if (end === -1) {
                appendText(text.substring(lt + 9));
                break;
            }
            appendText(text.substring(lt + 9, end));
            i = end + 3;
            continue;
        }
        if (text.startsWith("<?", lt)) {
            const end = text.indexOf("?>", lt + 2);
            if (end === -1) { break; }
            i = end + 2;
            continue;
        }
        if (text.startsWith("<!", lt)) {
            // <!DOCTYPE ...> or other markup declaration
            const end = findTagEnd(text, lt);
            i = end + 1;
            continue;
        }
        if (text[lt + 1] === "/") {
            const end = text.indexOf(">", lt);
            const tagEnd = end === -1 ? text.length : end;
            const nameMatch = /^<\/\s*([A-Za-z_][\w.:-]*)/.exec(text.substring(lt, tagEnd + 1));
            const name = nameMatch?.[1];
            if (name) {
                // Close the matching open element; recover from missing end
                // tags by closing everything opened after it.
                const openIndex = stack.map(e => e.name).lastIndexOf(name);
                if (openIndex !== -1) {
                    while (stack.length > openIndex) {
                        const closed = stack.pop()!;
                        closed.end = tagEnd + 1;
                    }
                }
            }
            i = tagEnd + 1;
            continue;
        }

        const tagEnd = findTagEnd(text, lt);
        const tagText = text.substring(lt, Math.min(tagEnd + 1, text.length));
        const nameMatch = NAME_RE.exec(tagText);
        if (!nameMatch) {
            // Stray '<' in text content: keep it as text.
            appendText("<");
            i = lt + 1;
            continue;
        }
        const element: XmlElement = {
            name: nameMatch[1],
            attributes: parseAttributes(tagText),
            children: [],
            text: "",
            start: lt,
            end: tagEnd + 1
        };
        const parent = stack[stack.length - 1];
        if (parent) {
            parent.children.push(element);
        } else {
            roots.push(element);
        }
        if (!/\/\s*>$/.test(tagText) && tagEnd < text.length) {
            stack.push(element);
        }
        i = tagEnd + 1;
    }

    // Unterminated elements extend to the end of the scanned text.
    for (const open of stack) {
        open.end = Math.max(open.end, text.length);
    }
    return roots;
}

/** Depth-first search for the first element with the given name. */
export function findElement(elements: XmlElement[], name: string): XmlElement | undefined {
    for (const element of elements) {
        if (element.name === name) {
            return element;
        }
        const found = findElement(element.children, name);
        if (found) {
            return found;
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Workflow model extraction
// ---------------------------------------------------------------------------

const STOP_NAMES = new Set(["stop", "end"]);
const SCRIPT_PREVIEW_MAX_LINES = 30;
const SCRIPT_PREVIEW_MAX_CHARS = 1500;

function child(element: XmlElement, name: string): XmlElement | undefined {
    return element.children.find(c => c.name === name);
}

function detectKind(element: XmlElement, name: string, action: string | undefined): StepKind {
    const icon = element.attributes["icon"];
    if (icon === "Start" || name.toLowerCase() === "start") {
        return "start";
    }
    if (icon === "Stop" || STOP_NAMES.has(name.toLowerCase())) {
        return "stop";
    }
    if (child(element, "Approval")) {
        return "approval";
    }
    if (child(element, "WorkflowRef")) {
        return "subprocess";
    }
    if (action) {
        if (action.startsWith("call:")) {
            return "call";
        }
        if (action.startsWith("rule:")) {
            return "rule";
        }
        if (action.startsWith("script:")) {
            return "script";
        }
        return "action";
    }
    if (child(element, "Script")?.children.some(c => c.name === "Source")) {
        return "script";
    }
    return "generic";
}

function actionLabel(action: string): string {
    const colon = action.indexOf(":");
    return colon === -1 ? action : action.substring(colon + 1).trim();
}

function scriptPreview(element: XmlElement): string | undefined {
    const source = child(element, "Script")?.children.find(c => c.name === "Source");
    if (!source) {
        return undefined;
    }
    // Strip a common leading indentation so the preview reads naturally.
    const lines = source.text.replace(/^\s*\n/, "").trimEnd().split("\n");
    const indents = lines.filter(l => l.trim().length > 0).map(l => /^\s*/.exec(l)![0].length);
    const commonIndent = indents.length > 0 ? Math.min(...indents) : 0;
    let preview = lines.slice(0, SCRIPT_PREVIEW_MAX_LINES).map(l => l.substring(commonIndent)).join("\n");
    if (lines.length > SCRIPT_PREVIEW_MAX_LINES) {
        preview += "\n…";
    }
    if (preview.length > SCRIPT_PREVIEW_MAX_CHARS) {
        preview = preview.substring(0, SCRIPT_PREVIEW_MAX_CHARS) + "…";
    }
    return preview;
}

function parseArgs(parent: XmlElement): WorkflowArg[] {
    return parent.children
        .filter(c => c.name === "Arg" && c.attributes["name"])
        .map(c => ({
            name: c.attributes["name"],
            value: c.attributes["value"],
            script: child(c, "Script") !== undefined ? true : undefined
        }));
}

function parseStep(element: XmlElement, index: number): WorkflowStep {
    const name = element.attributes["name"] ?? `(step ${index + 1})`;
    const action = element.attributes["action"];
    const kind = detectKind(element, name, action);

    const transitions: WorkflowTransition[] = element.children
        .filter(c => c.name === "Transition" && c.attributes["to"] !== undefined)
        .map(c => ({
            to: c.attributes["to"],
            when: c.attributes["when"],
            start: c.start,
            end: c.end
        }));

    const approval = child(element, "Approval");
    const workflowRef = child(element, "WorkflowRef");
    const subprocess = workflowRef ? child(workflowRef, "Reference")?.attributes["name"] : undefined;

    return {
        id: `step-${index}`,
        name,
        kind,
        icon: element.attributes["icon"],
        action,
        actionLabel: action ? actionLabel(action) : undefined,
        condition: element.attributes["condition"],
        resultVariable: element.attributes["resultVariable"],
        catches: element.attributes["catches"],
        subprocess,
        approvalOwner: approval?.attributes["owner"],
        approvalForm: approval ? parseArgs(approval).find(a => a.name === "workItemForm")?.value : undefined,
        replicator: child(element, "Replicator") !== undefined ? true : undefined,
        scriptPreview: scriptPreview(element),
        args: parseArgs(element),
        transitions,
        start: element.start,
        end: element.end
    };
}

function parseVariable(element: XmlElement): WorkflowVariable {
    return {
        name: element.attributes["name"] ?? "",
        input: element.attributes["input"] === "true" ? true : undefined,
        output: element.attributes["output"] === "true" ? true : undefined,
        required: element.attributes["required"] === "true" ? true : undefined,
        initializer: element.attributes["initializer"],
        description: child(element, "Description")?.text.trim() || undefined
    };
}

/**
 * Parses the first Workflow element of the document (root or nested, e.g.
 * inside a <sailpoint> import file). Returns undefined when there is none.
 */
export function parseWorkflow(text: string): WorkflowModel | undefined {
    const workflow = findElement(parseXmlElements(text), "Workflow");
    if (!workflow) {
        return undefined;
    }

    const explicitTransitions = workflow.attributes["explicitTransitions"] === "true";
    const steps = workflow.children.filter(c => c.name === "Step").map(parseStep);

    if (!explicitTransitions) {
        // A step without transitions falls through to the next step in
        // document order; materialize that edge so the graph shows it.
        for (let i = 0; i < steps.length - 1; i++) {
            const step = steps[i];
            if (step.transitions.length === 0 && step.kind !== "stop") {
                step.transitions.push({
                    to: steps[i + 1].name,
                    implicit: true,
                    start: step.start,
                    end: step.end
                });
            }
        }
    }

    return {
        name: workflow.attributes["name"] ?? "(unnamed workflow)",
        type: workflow.attributes["type"],
        libraries: workflow.attributes["libraries"],
        description: child(workflow, "Description")?.text.trim() || undefined,
        explicitTransitions,
        variables: workflow.children.filter(c => c.name === "Variable").map(parseVariable),
        steps,
        start: workflow.start,
        end: workflow.end
    };
}

/**
 * Cheap sniff used to decide whether a document looks like a workflow,
 * without a full parse (drives the `iiq.isWorkflow` context key).
 */
export function looksLikeWorkflow(text: string): boolean {
    return /<Workflow[\s>]/.test(text.substring(0, 10_000));
}
