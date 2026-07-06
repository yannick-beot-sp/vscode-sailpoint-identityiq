import * as assert from "assert";
import * as path from "path";
import { findBeanshellRegions } from "../../beanshell/beanshellRegions";
import { ClassIndexService } from "../../beanshell/java/ClassIndexService";
import { JdkClassSource } from "../../beanshell/java/jdkIndex";
import { getContextVariables } from "../../beanshell/ruleContexts";
import { analyzeScope, extractChainBeforeOffset, LocalVariable } from "../../beanshell/scopeAnalyzer";
import { inferChainType, inferChainTypeWithRecovery, resolveSimpleName } from "../../beanshell/typeResolver";

const FIXTURE_JAR = path.resolve(__dirname, "../../../src/test/fixtures/fixture.jar");
const JDK_INDEX = path.resolve(__dirname, "../../../resources/jdk-core-index.json");

suite("BeanShell type resolver Test Suite", () => {

    let index: ClassIndexService;

    suiteSetup(async () => {
        index = await ClassIndexService.build([FIXTURE_JAR], await JdkClassSource.load(JDK_INDEX));
    });

    suiteTeardown(() => index.dispose());

    /** Infers the type of the expression ending at the `|` marker */
    async function inferAt(snippet: string, contextVariables: LocalVariable[] = [],
        withRecovery = false) {
        const offset = snippet.indexOf("|");
        assert.ok(offset >= 0, "snippet must contain a | marker");
        const text = snippet.replace("|", "");
        const chain = extractChainBeforeOffset(text, offset);
        if (!chain) {
            return undefined;
        }
        const infer = withRecovery ? inferChainTypeWithRecovery : inferChainType;
        return infer(chain, analyzeScope(text, offset), contextVariables, index);
    }

    test("resolveSimpleName follows explicit, wildcard then default imports", () => {
        const scope = (source: string) => analyzeScope(source, source.length);

        assert.strictEqual(
            resolveSimpleName("Dog", scope("import com.example.fixture.Dog;"), index),
            "com.example.fixture.Dog");
        assert.strictEqual(
            resolveSimpleName("Dog", scope("import com.example.fixture.*;"), index),
            "com.example.fixture.Dog");
        // Default imports: java.util
        assert.strictEqual(resolveSimpleName("HashMap", scope(""), index), "java.util.HashMap");
        // Unique global match works without any import
        assert.strictEqual(resolveSimpleName("Animal", scope(""), index),
            "com.example.fixture.Animal");
        // Ambiguous names are not guessed: java.util.Date vs java.sql.Date...
        assert.strictEqual(resolveSimpleName("Date", scope("import java.sql.*;"), index),
            "java.sql.Date");
        // ... unless an import decides
        assert.strictEqual(resolveSimpleName("Missing", scope(""), index), undefined);
    });

    test("infers the type of a declared variable", async () => {
        const resolved = await inferAt("import com.example.fixture.Dog;\nDog dog = new Dog();\ndog.|");
        assert.deepStrictEqual(resolved, { typeName: "com.example.fixture.Dog", isStatic: false });
    });

    test("infers through method call chains and inherited members", async () => {
        // getPuppy() returns Dog, getName() is inherited from Animal
        const resolved = await inferAt(
            "import com.example.fixture.*;\nDog d = new Dog();\nd.getPuppy().getName().|");
        assert.deepStrictEqual(resolved, { typeName: "java.lang.String", isStatic: false });
    });

    test("infers construction and cast heads", async () => {
        assert.deepStrictEqual(await inferAt("new HashMap().|"),
            { typeName: "java.util.HashMap", isStatic: false });
        assert.deepStrictEqual(
            await inferAt("import com.example.fixture.Dog;\n((Dog) obj).|"),
            { typeName: "com.example.fixture.Dog", isStatic: false });
    });

    test("infers static access from class names, simple or qualified", async () => {
        assert.deepStrictEqual(await inferAt("import com.example.fixture.Animal;\nAnimal.|"),
            { typeName: "com.example.fixture.Animal", isStatic: true });
        assert.deepStrictEqual(await inferAt("com.example.fixture.Animal.|"),
            { typeName: "com.example.fixture.Animal", isStatic: true });
        // Static member then instance chain
        assert.deepStrictEqual(await inferAt("import com.example.fixture.Animal;\nAnimal.KINGDOM.|"),
            { typeName: "java.lang.String", isStatic: false });
    });

    test("infers rule context variables", async () => {
        const region = findBeanshellRegions(
            `<Rule name="R" type="Correlation"><Source><![CDATA[x]]></Source></Rule>`)[0];
        const variables = getContextVariables(region);
        const resolved = await inferAt("account.|", variables);
        // The index does not contain identityiq.jar here, so the type name
        // resolves but the class is unknown → undefined
        assert.strictEqual(resolved, undefined);

        // A JDK-typed context variable resolves end-to-end
        const withMap = await inferAt("environment.|", variables);
        assert.deepStrictEqual(withMap, { typeName: "java.util.Map", isStatic: false });
    });

    test("string literals and arrays", async () => {
        assert.deepStrictEqual(await inferAt('"admin".|'),
            { typeName: "java.lang.String", isStatic: false });
        assert.deepStrictEqual(await inferAt("String[] names = null;\nnames[0].|"),
            { typeName: "java.lang.String", isStatic: false });
        // The array type itself is returned: the completion provider only
        // offers `length` on it
        assert.deepStrictEqual(await inferAt("String[] names = null;\nnames.|"),
            { typeName: "java.lang.String[]", isStatic: false });
    });

    test("user methods resolve by their return type", async () => {
        const resolved = await inferAt(
            "String describe(int depth) { return \"\"; }\ndescribe(1).|");
        assert.deepStrictEqual(resolved, { typeName: "java.lang.String", isStatic: false });
    });

    test("a dangling dot on the previous line does not break the next statement", async () => {
        // `mystery.` is an unfinished statement: without recovery the merged
        // chain mystery.map fails; with recovery, map resolves alone
        const snippet = "HashMap map = new HashMap();\nmystery.\nmap.|";
        assert.strictEqual(await inferAt(snippet), undefined);
        assert.deepStrictEqual(await inferAt(snippet, [], true),
            { typeName: "java.util.HashMap", isStatic: false });
        // A resolvable multi-line chain is kept whole
        const multiline = "import com.example.fixture.Dog;\nDog d = new Dog();\nd.\ngetPuppy().|";
        assert.deepStrictEqual(await inferAt(multiline, [], true),
            { typeName: "com.example.fixture.Dog", isStatic: false });
    });

    test("unknown or untyped expressions give no type", async () => {
        assert.strictEqual(await inferAt("mystery.|"), undefined);
        assert.strictEqual(await inferAt("foo = compute();\nfoo.|"), undefined);
        // Terminal primitives are returned as-is (no members exist on them)
        assert.deepStrictEqual(await inferAt("int x = 5;\nx.|"),
            { typeName: "int", isStatic: false });
        // ... but a member access on a primitive never resolves
        assert.strictEqual(await inferAt("int x = 5;\nx.foo.|"), undefined);
    });
});
