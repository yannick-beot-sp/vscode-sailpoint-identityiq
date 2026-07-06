/**
 * Computes, for a DTD content model and the ordered list of child elements
 * already present under a parent, which element names may validly appear
 * next (respecting sequence order and the "?", "*", "+" cardinality
 * operators) and whether the parent could be validly closed at this position.
 *
 * Implemented via Brzozowski derivatives over the content-model AST: the AST
 * *is* the regular expression, so "what remains to be matched after
 * consuming one more child" is computed structurally, without ever needing
 * to enumerate every possible element name.
 *
 * Recovery policy: if the children typed so far do not correspond to any
 * valid path through the content model (e.g. a document being hand-edited
 * into a temporarily invalid state), this fails open — it falls back to the
 * root content model's first set rather than returning no suggestions at
 * all. Over-suggesting is never actively harmful; refusing to help on a
 * not-yet-valid document would be.
 */

import { Cardinality, ContentModel } from "./dtdModel";

export interface MatchResult {
    /** Element names that may validly appear next, in DTD declaration order */
    nextElements: string[];
    /** Whether the parent element could be validly closed at this position */
    canClose: boolean;
}

/** Internal, matcher-only representation. Cardinality is normalized away into these five shapes. */
type MNode =
    | { kind: "epsilon" }
    | { kind: "dead" }
    | { kind: "element"; name: string }
    | { kind: "sequence"; items: MNode[] }
    | { kind: "choice"; items: MNode[] }
    | { kind: "repeat"; item: MNode };

export function nextElements(contentModel: ContentModel, childrenSoFar: readonly string[]): MatchResult {
    const root = toMNode(contentModel);
    let node = root;
    for (const child of childrenSoFar) {
        const derived = derivative(node, child);
        if (isDead(derived)) {
            // Fail-open: this child sequence is not a valid path through the
            // model (out of order, or from a foreign/extension element) —
            // fall back to the root's own possibilities instead of {}.
            return { nextElements: firstSet(root), canClose: nullable(root) };
        }
        node = derived;
    }
    return { nextElements: firstSet(node), canClose: nullable(node) };
}

/**
 * Whether `node` can never lead to a valid completion, however it is
 * derived further. Needed because `derivative` does not always canonicalize
 * a dead sub-part all the way up to a literal `{kind:"dead"}` root (e.g. a
 * sequence with a dead first item keeps its "sequence" shape) — without this
 * structural check the fail-open recovery in `nextElements` would miss
 * exactly the out-of-order case it exists to catch.
 */
function isDead(node: MNode): boolean {
    switch (node.kind) {
        case "dead":
            return true;
        case "epsilon":
        case "element":
        case "repeat":
            return false;
        case "choice":
            return node.items.every(isDead);
        case "sequence":
            return node.items.some(isDead);
    }
}

function toMNode(node: ContentModel): MNode {
    switch (node.kind) {
        case "empty":
        case "pcdata":
        case "any":
            // None of these admit child elements; text-only/no-content models
            // simply offer no element completions.
            return { kind: "epsilon" };
        case "element":
            return applyCardinality({ kind: "element", name: node.name }, node.cardinality);
        case "sequence":
            return applyCardinality({ kind: "sequence", items: node.items.map(toMNode) }, node.cardinality);
        case "choice":
            return applyCardinality({ kind: "choice", items: node.items.map(toMNode) }, node.cardinality);
    }
}

function applyCardinality(base: MNode, cardinality: Cardinality): MNode {
    switch (cardinality) {
        case "one":
            return base;
        case "optional":
            return simplifyChoice([base, { kind: "epsilon" }]);
        case "star":
            return { kind: "repeat", item: base };
        case "plus":
            // X+ = X, X* : matched once, then any number of further times.
            return simplifySequence([base, { kind: "repeat", item: base }]);
    }
}

function nullable(node: MNode): boolean {
    switch (node.kind) {
        case "epsilon":
        case "repeat":
            return true;
        case "dead":
        case "element":
            return false;
        case "sequence":
            return node.items.every(nullable);
        case "choice":
            return node.items.some(nullable);
    }
}

function derivative(node: MNode, name: string): MNode {
    switch (node.kind) {
        case "epsilon":
        case "dead":
            // Nothing left to consume (or already dead): consuming another
            // element here is invalid.
            return { kind: "dead" };
        case "element":
            return node.name === name ? { kind: "epsilon" } : { kind: "dead" };
        case "choice":
            return simplifyChoice(node.items.map(item => derivative(item, name)));
        case "sequence": {
            const [first, ...rest] = node.items;
            const restNode = simplifySequence(rest);
            const branch1 = simplifySequence([derivative(first, name), ...rest]);
            if (!nullable(first)) {
                return branch1;
            }
            const branch2 = derivative(restNode, name);
            return simplifyChoice([branch1, branch2]);
        }
        case "repeat": {
            // d(X*) = d(X) ; X*  (consumed one iteration, the loop remains available)
            const dItem = derivative(node.item, name);
            if (dItem.kind === "dead") {
                return { kind: "dead" };
            }
            return simplifySequence([dItem, node]);
        }
    }
}

/** Ordered, de-duplicated element names for which `derivative(node, name)` would be non-dead. */
function firstSet(node: MNode, seen: Set<string> = new Set(), out: string[] = []): string[] {
    switch (node.kind) {
        case "epsilon":
        case "dead":
            break;
        case "element":
            if (!seen.has(node.name)) {
                seen.add(node.name);
                out.push(node.name);
            }
            break;
        case "choice":
            for (const item of node.items) {
                firstSet(item, seen, out);
            }
            break;
        case "sequence":
            for (const item of node.items) {
                firstSet(item, seen, out);
                if (!nullable(item)) {
                    // Later items are unreachable without matching this one first.
                    break;
                }
            }
            break;
        case "repeat":
            firstSet(node.item, seen, out);
            break;
    }
    return out;
}

function simplifySequence(items: MNode[]): MNode {
    if (items.length === 0) {
        return { kind: "epsilon" };
    }
    if (items.length === 1) {
        return items[0];
    }
    return { kind: "sequence", items };
}

function simplifyChoice(items: MNode[]): MNode {
    const alive = items.filter(item => item.kind !== "dead");
    if (alive.length === 0) {
        return { kind: "dead" };
    }
    if (alive.length === 1) {
        return alive[0];
    }
    return { kind: "choice", items: alive };
}
