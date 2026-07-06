import * as assert from "assert";
import * as path from "path";
import { parseClassFile } from "../../beanshell/java/classFileParser";
import { JarFile } from "../../beanshell/java/jarReader";
import { JavaClassInfo } from "../../beanshell/java/model";

/** Compiled from src/test/fixtures/java-src (see the README in fixtures) */
const FIXTURE_JAR = path.resolve(__dirname, "../../../src/test/fixtures/fixture.jar");

suite("Class file parser Test Suite", () => {

    let jar: JarFile;
    const classes = new Map<string, JavaClassInfo>();

    suiteSetup(async () => {
        jar = await JarFile.open(FIXTURE_JAR);
        for (const name of ["Animal", "Dog", "Helper"]) {
            const buffer = await jar.readEntry(`com/example/fixture/${name}.class`);
            assert.ok(buffer, `entry for ${name} must exist`);
            classes.set(name, parseClassFile(buffer!));
        }
    });

    suiteTeardown(() => jar.close());

    test("jar lists its entries", () => {
        const names = jar.listEntryNames();
        assert.ok(names.includes("com/example/fixture/Dog.class"));
        assert.ok(!names.includes("com/"), "directories are excluded");
        assert.ok(jar.hasEntry("com/example/fixture/Animal.class"));
    });

    test("reading a missing entry resolves undefined", async () => {
        assert.strictEqual(await jar.readEntry("does/not/Exist.class"), undefined);
    });

    test("parses class identity, kind and hierarchy", () => {
        const dog = classes.get("Dog")!;
        assert.strictEqual(dog.fqcn, "com.example.fixture.Dog");
        assert.strictEqual(dog.packageName, "com.example.fixture");
        assert.strictEqual(dog.simpleName, "Dog");
        assert.strictEqual(dog.kind, "class");
        assert.strictEqual(dog.isPublic, true);
        assert.strictEqual(dog.superclass, "com.example.fixture.Animal");
        assert.deepStrictEqual(dog.interfaces, ["java.lang.Comparable"]);

        const animal = classes.get("Animal")!;
        assert.strictEqual(animal.superclass, "java.lang.Object");

        assert.strictEqual(classes.get("Helper")!.isPublic, false);
    });

    test("parses fields with flags", () => {
        const animal = classes.get("Animal")!;
        const kingdom = animal.fields.find(f => f.name === "KINGDOM")!;
        assert.strictEqual(kingdom.type, "java.lang.String");
        assert.strictEqual(kingdom.isStatic, true);
        assert.strictEqual(kingdom.isFinal, true);
        assert.strictEqual(kingdom.isPublic, true);

        const name = animal.fields.find(f => f.name === "name")!;
        assert.strictEqual(name.isPublic, false);
        const age = animal.fields.find(f => f.name === "age")!;
        assert.strictEqual(age.type, "int");
    });

    test("parses methods, overloads and constructors", () => {
        const dog = classes.get("Dog")!;
        const barks = dog.methods.filter(m => m.name === "bark");
        assert.strictEqual(barks.length, 2);
        assert.deepStrictEqual(barks.map(m => m.descriptor).sort(), ["()V", "(I)V"]);

        const constructors = dog.methods.filter(m => m.name === "<init>");
        assert.strictEqual(constructors.length, 2);

        const getPuppy = dog.methods.find(m => m.name === "getPuppy")!;
        assert.strictEqual(getPuppy.returnType, "com.example.fixture.Dog");

        const count = classes.get("Animal")!.methods.find(m => m.name === "count")!;
        assert.strictEqual(count.isStatic, true);
        assert.strictEqual(count.returnType, "int");
    });

    test("parameter names come from the LocalVariableTable (-g)", () => {
        const dog = classes.get("Dog")!;
        const constructor = dog.methods.find(
            m => m.name === "<init>" && m.parameters.length === 2)!;
        assert.deepStrictEqual(constructor.parameters, [
            { name: "name", type: "java.lang.String" },
            { name: "weight", type: "double" }
        ]);

        const bark = dog.methods.find(m => m.descriptor === "(I)V" && m.name === "bark")!;
        assert.deepStrictEqual(bark.parameters, [{ name: "times", type: "int" }]);

        const setName = classes.get("Animal")!.methods.find(m => m.name === "setName")!;
        assert.deepStrictEqual(setName.parameters,
            [{ name: "name", type: "java.lang.String" }]);
    });

    test("exposes the generic signature for display", () => {
        const dog = classes.get("Dog")!;
        const getTricks = dog.methods.find(m => m.name === "getTricks")!;
        assert.strictEqual(getTricks.returnType, "java.util.List");
        assert.strictEqual(getTricks.genericSignature, "() : List<String>");
    });

    test("reports deprecation", () => {
        const dog = classes.get("Dog")!;
        assert.strictEqual(dog.methods.find(m => m.name === "oldMethod")!.isDeprecated, true);
        assert.strictEqual(dog.methods.find(m => m.name === "getPuppy")!.isDeprecated, false);
    });

    test("bridge methods are skipped", () => {
        // Comparable<Dog> generates a bridge compareTo(Object): only the
        // real compareTo(Dog) must be reported.
        const compareTo = classes.get("Dog")!.methods.filter(m => m.name === "compareTo");
        assert.strictEqual(compareTo.length, 1);
        assert.strictEqual(compareTo[0].parameters[0].type, "com.example.fixture.Dog");
    });

    test("non-public members keep their visibility flag", () => {
        const internalOnly = classes.get("Animal")!.methods.find(
            m => m.name === "internalOnly")!;
        assert.strictEqual(internalOnly.isPublic, false);
    });

    test("rejects a non-class buffer", () => {
        assert.throws(() => parseClassFile(Buffer.from("not a class file")));
    });
});
