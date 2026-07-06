import * as assert from "assert";
import { analyzeScope, ChainSegment, extractChainBeforeOffset } from "../../beanshell/scopeAnalyzer";
import { tokenize } from "../../beanshell/tokenizer";

/** Chain of the expression ending at the `|` marker of the snippet */
function chainAt(snippet: string): ChainSegment[] | undefined {
    const offset = snippet.indexOf("|");
    assert.ok(offset >= 0, "snippet must contain a | marker");
    return extractChainBeforeOffset(snippet.replace("|", ""), offset);
}

suite("BeanShell tokenizer Test Suite", () => {

    test("tokenizes identifiers, keywords, punctuation and numbers", () => {
        const tokens = tokenize("int x = identity.getAge() + 0x1F;");
        assert.deepStrictEqual(
            tokens.map(t => `${t.kind}:${t.text}`),
            ["keyword:int", "identifier:x", "punct:=", "identifier:identity",
                "punct:.", "identifier:getAge", "punct:(", "punct:)", "punct:+",
                "number:0x1F", "punct:;"]);
    });

    test("strings and comments are single tokens, dots inside are inert", () => {
        const tokens = tokenize(`s = "a.b(c"; // trailing.dot\n/* block . */ t.u();`);
        const kinds = tokens.map(t => t.kind);
        assert.ok(kinds.includes("string") && kinds.includes("comment"));
        const stringToken = tokens.find(t => t.kind === "string")!;
        assert.strictEqual(stringToken.text, '"a.b(c"');
        // Escapes do not close the string
        assert.strictEqual(tokenize('"a\\"b"')[0].text, '"a\\"b"');
    });

    test("offsets point into the source text", () => {
        const source = "  foo.bar  ";
        const tokens = tokenize(source);
        for (const token of tokens) {
            assert.strictEqual(source.substring(token.start, token.end), token.text);
        }
    });

    test("never throws on malformed input", () => {
        tokenize('"unterminated');
        tokenize("/* unterminated");
        tokenize("@#§");
    });
});

suite("BeanShell scope analyzer Test Suite", () => {

    test("collects explicit and wildcard imports", () => {
        const scope = analyzeScope(
            "import sailpoint.object.Identity;\nimport sailpoint.api.*;\n", 100);
        assert.deepStrictEqual(scope.imports, ["sailpoint.object.Identity"]);
        assert.deepStrictEqual(scope.wildcardImports, ["sailpoint.api"]);
    });

    test("collects typed declarations, loops and catches", () => {
        const source = `
            Identity id = context.getObjectByName(Identity.class, "spadmin");
            java.util.Map map;
            String[] names = null;
            for (Link link : id.getLinks()) { }
            try { } catch (GeneralException e) { }
        `;
        const scope = analyzeScope(source, source.length);
        const byName = new Map(scope.variables.map(v => [v.name, v.type]));
        assert.strictEqual(byName.get("id"), "Identity");
        assert.strictEqual(byName.get("map"), "java.util.Map");
        assert.strictEqual(byName.get("names"), "String[]");
        assert.strictEqual(byName.get("link"), "Link");
        assert.strictEqual(byName.get("e"), "GeneralException");
    });

    test("declarations with generics are recorded with their raw type", () => {
        const source = "Map<String, List<String>> result = new HashMap();";
        const scope = analyzeScope(source, source.length);
        assert.strictEqual(scope.variables[0].name, "result");
        assert.strictEqual(scope.variables[0].type, "Map");
    });

    test("untyped assignments are inferred from the right-hand side", () => {
        const source = `map = new HashMap();\nname = "spadmin";\nmystery = compute();`;
        const scope = analyzeScope(source, source.length);
        const byName = new Map(scope.variables.map(v => [v.name, v.type]));
        assert.strictEqual(byName.get("map"), "HashMap");
        assert.strictEqual(byName.get("name"), "java.lang.String");
        assert.strictEqual(byName.get("mystery"), undefined);
        assert.ok(scope.variables.some(v => v.name === "mystery"));
    });

    test("only declarations before the cursor are visible", () => {
        const source = "String before = null;\nString after = null;";
        const scope = analyzeScope(source, source.indexOf("after") - 8);
        assert.deepStrictEqual(scope.variables.map(v => v.name), ["before"]);
    });

    test("user methods are collected with their parameters", () => {
        const source = `
            String describe(Identity identity, int depth) {
                return identity.getName();
            }
        `;
        const scope = analyzeScope(source, source.length);
        assert.strictEqual(scope.methods.length, 1);
        assert.strictEqual(scope.methods[0].name, "describe");
        assert.strictEqual(scope.methods[0].returnType, "String");
        assert.deepStrictEqual(scope.methods[0].parameters,
            [{ name: "identity", type: "Identity" }, { name: "depth", type: "int" }]);
        // Flat scope: parameters are offered as variables too
        assert.ok(scope.variables.some(v => v.name === "identity"));
    });

    test("comparisons are not declarations", () => {
        const source = "if (a == b) { }";
        const scope = analyzeScope(source, source.length);
        assert.deepStrictEqual(scope.variables, []);
    });
});

suite("BeanShell chain extraction Test Suite", () => {

    test("simple variable chain", () => {
        assert.deepStrictEqual(chainAt("identity.|"), [{ kind: "name", name: "identity" }]);
    });

    test("chain with calls and partially typed member", () => {
        assert.deepStrictEqual(chainAt("context.getObjectByName(a, b).getNa|"), [
            { kind: "name", name: "context" },
            { kind: "call", name: "getObjectByName" }
        ]);
    });

    test("qualified static chain", () => {
        assert.deepStrictEqual(chainAt("sailpoint.tools.Util.|"), [
            { kind: "name", name: "sailpoint" },
            { kind: "name", name: "tools" },
            { kind: "name", name: "Util" }
        ]);
    });

    test("construction chains", () => {
        assert.deepStrictEqual(chainAt("new HashMap().|"), [{ kind: "new", typeName: "HashMap" }]);
        assert.deepStrictEqual(chainAt("new java.util.HashMap().keySet().|"), [
            { kind: "new", typeName: "java.util.HashMap" },
            { kind: "call", name: "keySet" }
        ]);
    });

    test("cast chain", () => {
        assert.deepStrictEqual(chainAt("((Identity) obj).|"), [
            { kind: "cast", typeName: "Identity" }
        ]);
        assert.deepStrictEqual(chainAt("((sailpoint.object.Identity) obj).getLinks().|"), [
            { kind: "cast", typeName: "sailpoint.object.Identity" },
            { kind: "call", name: "getLinks" }
        ]);
    });

    test("string literal and array access chains", () => {
        assert.deepStrictEqual(chainAt('"hello".|'), [{ kind: "string" }]);
        assert.deepStrictEqual(chainAt("names[0].|"), [
            { kind: "name", name: "names" },
            { kind: "index" }
        ]);
    });

    test("no chain outside a member access", () => {
        assert.strictEqual(chainAt("return |"), undefined);
        assert.strictEqual(chainAt("identity|"), undefined);
        // A dot inside a string is not a member access
        assert.strictEqual(chainAt('"a.b|'), undefined);
    });

    test("unresolvable heads give no chain", () => {
        assert.strictEqual(chainAt("(a + b).|"), undefined);
        assert.strictEqual(chainAt("new Identity.|"), undefined);
    });
});
