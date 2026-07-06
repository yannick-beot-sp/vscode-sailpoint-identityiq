import * as assert from "assert";
import { nextElements } from "../../../xml/dtd/contentModelMatcher";
import { ContentModel } from "../../../xml/dtd/dtdModel";

function el(name: string): ContentModel {
    return { kind: "element", name, cardinality: "one" };
}

suite("Content model matcher Test Suite", () => {

    test("choice repeated with star (sailpoint-shaped): any order, any repetition", () => {
        const model: ContentModel = {
            kind: "choice",
            items: [el("A"), el("B"), el("C")],
            cardinality: "star"
        };
        assert.deepStrictEqual(nextElements(model, []), { nextElements: ["A", "B", "C"], canClose: true });
        assert.deepStrictEqual(nextElements(model, ["A"]), { nextElements: ["A", "B", "C"], canClose: true });
        assert.deepStrictEqual(nextElements(model, ["A", "B", "A"]), { nextElements: ["A", "B", "C"], canClose: true });
    });

    test("sequence of optionals (entry-shaped): order matters", () => {
        const model: ContentModel = {
            kind: "sequence",
            items: [
                { kind: "element", name: "key", cardinality: "optional" },
                { kind: "element", name: "value", cardinality: "optional" }
            ],
            cardinality: "one"
        };
        assert.deepStrictEqual(nextElements(model, []), { nextElements: ["key", "value"], canClose: true });
        assert.deepStrictEqual(nextElements(model, ["key"]), { nextElements: ["value"], canClose: true });
        assert.deepStrictEqual(nextElements(model, ["key", "value"]), { nextElements: [], canClose: true });
        // "value" typed alone (key skipped) is valid, and key must not be offered afterwards:
        // it can only precede value in document order.
        assert.deepStrictEqual(nextElements(model, ["value"]), { nextElements: [], canClose: true });
    });

    test("nested groups: choice of sequences", () => {
        const model: ContentModel = {
            kind: "choice",
            items: [
                { kind: "sequence", items: [el("a"), el("b")], cardinality: "one" },
                { kind: "sequence", items: [el("c"), el("d")], cardinality: "star" }
            ],
            cardinality: "one"
        };
        // Closing with zero children is valid: the second branch, (c,d)*, accepts zero repetitions.
        assert.deepStrictEqual(nextElements(model, []), { nextElements: ["a", "c"], canClose: true });
        assert.deepStrictEqual(nextElements(model, ["a"]), { nextElements: ["b"], canClose: false });
        assert.deepStrictEqual(nextElements(model, ["a", "b"]), { nextElements: [], canClose: true });
        assert.deepStrictEqual(nextElements(model, ["c", "d"]), { nextElements: ["c"], canClose: true });
        assert.deepStrictEqual(nextElements(model, ["c", "d", "c", "d"]), { nextElements: ["c"], canClose: true });
    });

    test("plus cardinality: satisfied once, then behaves like star", () => {
        const single: ContentModel = { kind: "element", name: "a", cardinality: "plus" };
        assert.deepStrictEqual(nextElements(single, []), { nextElements: ["a"], canClose: false });
        assert.deepStrictEqual(nextElements(single, ["a"]), { nextElements: ["a"], canClose: true });
        assert.deepStrictEqual(nextElements(single, ["a", "a", "a"]), { nextElements: ["a"], canClose: true });

        const seqWithPlus: ContentModel = {
            kind: "sequence",
            items: [el("a"), { kind: "element", name: "b", cardinality: "plus" }],
            cardinality: "one"
        };
        assert.deepStrictEqual(nextElements(seqWithPlus, ["a"]), { nextElements: ["b"], canClose: false });
        assert.deepStrictEqual(nextElements(seqWithPlus, ["a", "b"]), { nextElements: ["b"], canClose: true });
    });

    test("dead-state recovery: out-of-order children fail open to the root first set", () => {
        // Strict sequence, no star/choice: (a,b) only, "b" before "a" is invalid.
        const model: ContentModel = {
            kind: "sequence",
            items: [el("a"), el("b")],
            cardinality: "one"
        };
        assert.deepStrictEqual(nextElements(model, ["b"]), { nextElements: ["a"], canClose: false });
    });

    test("EMPTY/PCDATA/ANY offer no element children", () => {
        assert.deepStrictEqual(nextElements({ kind: "empty" }, []), { nextElements: [], canClose: true });
        assert.deepStrictEqual(nextElements({ kind: "pcdata" }, []), { nextElements: [], canClose: true });
        assert.deepStrictEqual(nextElements({ kind: "any" }, []), { nextElements: [], canClose: true });
    });
});
