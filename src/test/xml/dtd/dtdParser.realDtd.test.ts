import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseDtd } from "../../../xml/dtd/dtdParser";

suite("DTD parser Test Suite (real bundled sailpoint.dtd)", () => {

    const dtdPath = path.resolve(__dirname, "../../../../resources/sailpoint.dtd");
    const dtdText = fs.readFileSync(dtdPath, "utf8");
    const { model, warnings } = parseDtd(dtdText);

    test("parses several hundred elements without throwing", () => {
        assert.ok(model.size > 900, `expected >900 elements, got ${model.size}`);
        assert.deepStrictEqual(warnings, []);
    });

    test("entry is a sequence of two optional elements with two CDATA attributes", () => {
        const entry = model.get("entry");
        assert.ok(entry);
        assert.strictEqual(entry.contentModel.kind, "sequence");
        if (entry.contentModel.kind === "sequence") {
            assert.deepStrictEqual(entry.contentModel.items, [
                { kind: "element", name: "key", cardinality: "optional" },
                { kind: "element", name: "value", cardinality: "optional" }
            ]);
        }
        assert.deepStrictEqual(entry.attributes.map(a => a.name), ["key", "value"]);
        assert.ok(entry.attributes.every(a => a.type.kind === "cdata"));
    });

    test("sailpoint root is a large choice repeated with star, and contains known object types", () => {
        const root = model.get("sailpoint");
        assert.ok(root);
        assert.strictEqual(root.contentModel.kind, "choice");
        if (root.contentModel.kind === "choice") {
            assert.strictEqual(root.contentModel.cardinality, "star");
            const names = root.contentModel.items.map(i => (i.kind === "element" ? i.name : undefined));
            assert.ok(names.includes("Bundle"));
            assert.ok(names.includes("Identity"));
            assert.ok(names.includes("Rule"));
        }
    });

    test("AccountIconConfig is EMPTY with four CDATA attributes", () => {
        const decl = model.get("AccountIconConfig");
        assert.ok(decl);
        assert.deepStrictEqual(decl.contentModel, { kind: "empty" });
        assert.deepStrictEqual(decl.attributes.map(a => a.name).sort(), ["attribute", "source", "title", "value"]);
    });

    test("AbstractChangeEvent has an enumerated 'operation' attribute", () => {
        const decl = model.get("AbstractChangeEvent");
        assert.ok(decl);
        const operation = decl.attributes.find(a => a.name === "operation");
        assert.ok(operation);
        assert.deepStrictEqual(operation.type, { kind: "enumeration", values: ["Add", "Modify", "Remove"] });
    });
});
