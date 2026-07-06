import * as assert from "assert";
import { parseDtd } from "../../../xml/dtd/dtdParser";
import { ContentModel } from "../../../xml/dtd/dtdModel";

suite("DTD parser Test Suite", () => {

    test("EMPTY element with no attributes", () => {
        const { model } = parseDtd(`<!ELEMENT null EMPTY>`);
        const decl = model.get("null");
        assert.ok(decl);
        assert.deepStrictEqual(decl.contentModel, { kind: "empty" });
        assert.deepStrictEqual(decl.attributes, []);
    });

    test("#PCDATA-only element", () => {
        const { model } = parseDtd(`<!ELEMENT String (#PCDATA)>`);
        assert.deepStrictEqual(model.get("String")?.contentModel, { kind: "pcdata" });
    });

    test("ANY content spec", () => {
        const { model } = parseDtd(`<!ELEMENT Freeform ANY>`);
        assert.deepStrictEqual(model.get("Freeform")?.contentModel, { kind: "any" });
    });

    test("sequence of optional elements, e.g. entry", () => {
        const { model } = parseDtd(`<!ELEMENT entry ((key)?,(value)?)>`);
        const contentModel = model.get("entry")?.contentModel as ContentModel;
        assert.strictEqual(contentModel.kind, "sequence");
        if (contentModel.kind !== "sequence") {
            return;
        }
        assert.strictEqual(contentModel.items.length, 2);
        assert.deepStrictEqual(contentModel.items[0], { kind: "element", name: "key", cardinality: "optional" });
        assert.deepStrictEqual(contentModel.items[1], { kind: "element", name: "value", cardinality: "optional" });
    });

    test("choice repeated with star, e.g. sailpoint root", () => {
        const { model } = parseDtd(`<!ELEMENT sailpoint ((Bundle|Identity|Rule)*)>`);
        const contentModel = model.get("sailpoint")?.contentModel as ContentModel;
        assert.strictEqual(contentModel.kind, "choice");
        if (contentModel.kind !== "choice") {
            return;
        }
        assert.strictEqual(contentModel.cardinality, "star");
        assert.deepStrictEqual(contentModel.items.map(i => (i.kind === "element" ? i.name : i.kind)),
            ["Bundle", "Identity", "Rule"]);
    });

    test("nested groups: choice of sequences", () => {
        const { model } = parseDtd(`<!ELEMENT Mix (((a,b)|(c,d)*))>`);
        const contentModel = model.get("Mix")?.contentModel as ContentModel;
        assert.strictEqual(contentModel.kind, "choice");
        if (contentModel.kind !== "choice") {
            return;
        }
        assert.strictEqual(contentModel.items.length, 2);
        assert.strictEqual(contentModel.items[0].kind, "sequence");
        assert.strictEqual(contentModel.items[1].kind, "sequence");
        assert.strictEqual((contentModel.items[1] as ContentModel & { kind: "sequence" }).cardinality, "star");
    });

    test("plus cardinality on an element", () => {
        const { model } = parseDtd(`<!ELEMENT Steps (Step+)>`);
        assert.deepStrictEqual(model.get("Steps")?.contentModel,
            { kind: "element", name: "Step", cardinality: "plus" });
    });

    test("multiple ATTLIST blocks for the same element accumulate", () => {
        const { model } = parseDtd(`
            <!ELEMENT Foo EMPTY>
            <!ATTLIST Foo a CDATA #IMPLIED>
            <!ATTLIST Foo b CDATA #IMPLIED>
        `);
        const attrs = model.get("Foo")?.attributes ?? [];
        assert.deepStrictEqual(attrs.map(a => a.name), ["a", "b"]);
    });

    test("enumeration attribute type", () => {
        const { model } = parseDtd(`
            <!ELEMENT AbstractChangeEvent EMPTY>
            <!ATTLIST AbstractChangeEvent
              operation (Add | Modify | Remove) #IMPLIED
            >
        `);
        const attr = model.get("AbstractChangeEvent")?.attributes[0];
        assert.strictEqual(attr?.name, "operation");
        assert.deepStrictEqual(attr?.type, { kind: "enumeration", values: ["Add", "Modify", "Remove"] });
        assert.deepStrictEqual(attr?.default, { kind: "implied" });
    });

    test("#REQUIRED and #FIXED defaults (not used by the real DTD, but must parse)", () => {
        const { model } = parseDtd(`
            <!ELEMENT Foo EMPTY>
            <!ATTLIST Foo
              mandatory CDATA #REQUIRED
              locked CDATA #FIXED "always"
            >
        `);
        const attrs = model.get("Foo")?.attributes ?? [];
        assert.deepStrictEqual(attrs[0].default, { kind: "required" });
        assert.deepStrictEqual(attrs[1].default, { kind: "fixed", value: "always" });
    });

    test("stray <!ENTITY> and comments are skipped without corrupting subsequent parsing", () => {
        const { model } = parseDtd(`
            <!-- a comment -->
            <!ENTITY foo "bar">
            <!ELEMENT AfterEntity (#PCDATA)>
        `);
        assert.deepStrictEqual(model.get("AfterEntity")?.contentModel, { kind: "pcdata" });
    });

    test("an <!ATTLIST> appearing before its <!ELEMENT> still merges", () => {
        const { model } = parseDtd(`
            <!ATTLIST Foo a CDATA #IMPLIED>
            <!ELEMENT Foo EMPTY>
        `);
        const decl = model.get("Foo");
        assert.deepStrictEqual(decl?.contentModel, { kind: "empty" });
        assert.strictEqual(decl?.attributes.length, 1);
    });

    test("malformed declaration is skipped with a warning, not thrown, and does not corrupt the next one", () => {
        const { model, warnings } = parseDtd(`
            <!ELEMENT Bad ???>
            <!ELEMENT Good (#PCDATA)>
        `);
        assert.ok(warnings.length > 0);
        assert.deepStrictEqual(model.get("Bad")?.contentModel, { kind: "empty" });
        assert.deepStrictEqual(model.get("Good")?.contentModel, { kind: "pcdata" });
    });
});
