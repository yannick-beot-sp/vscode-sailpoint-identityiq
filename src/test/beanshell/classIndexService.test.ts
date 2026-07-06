import * as assert from "assert";
import * as path from "path";
import { ClassIndexService } from "../../beanshell/java/ClassIndexService";
import { JdkClassSource } from "../../beanshell/java/jdkIndex";

const FIXTURES_DIR = path.resolve(__dirname, "../../../src/test/fixtures");
const FIXTURE_JAR = path.join(FIXTURES_DIR, "fixture.jar");
const JDK_INDEX = path.resolve(__dirname, "../../../resources/jdk-core-index.json");

suite("Class index service Test Suite", () => {

    let index: ClassIndexService;

    suiteSetup(async () => {
        index = await ClassIndexService.build([FIXTURE_JAR], await JdkClassSource.load(JDK_INDEX));
    });

    suiteTeardown(() => index.dispose());

    test("indexes jar and JDK classes by simple name", () => {
        assert.deepStrictEqual(index.findBySimpleName("Dog"), ["com.example.fixture.Dog"]);
        assert.deepStrictEqual(index.findBySimpleName("HashMap"), ["java.util.HashMap"]);
        assert.deepStrictEqual(index.findBySimpleName("Nonexistent"), []);
    });

    test("reports simple-name collisions", () => {
        const dates = index.findBySimpleName("Date");
        assert.ok(dates.includes("java.util.Date") && dates.includes("java.sql.Date"),
            `expected both Date classes, got ${dates}`);
    });

    test("prefix search over simple names is capped", () => {
        const matches = index.findSimpleNamesByPrefix("Ha", 3);
        assert.ok(matches.size <= 3);
        const all = index.findSimpleNamesByPrefix("HashM", 50);
        assert.ok(all.has("HashMap"));
    });

    test("exposes the package tree for import completion", () => {
        const root = index.getPackageChildren("");
        assert.ok(root.packages.includes("com") && root.packages.includes("java"));

        assert.deepStrictEqual(index.getPackageChildren("com.example").packages, ["fixture"]);
        assert.deepStrictEqual(index.getPackageChildren("com.example.fixture").classes,
            ["Animal", "Dog", "Helper"]);
        assert.ok(index.getPackageChildren("java.util").classes.includes("ArrayList"));
        assert.ok(index.getPackageChildren("java.util").packages.includes("regex"));

        assert.deepStrictEqual(index.getPackageChildren("no.such.pkg"),
            { packages: [], classes: [] });
    });

    test("loads class metadata lazily and caches it", async () => {
        const dog = await index.getClass("com.example.fixture.Dog");
        assert.ok(dog);
        assert.strictEqual(dog!.superclass, "com.example.fixture.Animal");
        // Second call resolves from the cache to the same instance
        assert.strictEqual(await index.getClass("com.example.fixture.Dog"), dog);
        assert.strictEqual(await index.getClass("does.not.Exist"), undefined);
    });

    test("getAllMembers walks the whole hierarchy including the JDK", async () => {
        const members = await index.getAllMembers("com.example.fixture.Dog");
        const names = members.methods.map(m => m.name);

        // Own methods, including both overloads
        assert.strictEqual(names.filter(n => n === "bark").length, 2);
        // Inherited from Animal
        const getName = members.methods.find(m => m.name === "getName")!;
        assert.strictEqual(getName.declaringClass, "com.example.fixture.Animal");
        // Inherited from java.lang.Object through the JDK index
        const toString = members.methods.find(m => m.name === "toString")!;
        assert.strictEqual(toString.declaringClass, "java.lang.Object");
        // Interface members (Comparable) are reachable. Deduplication is by
        // erased signature, so the typed override compareTo(Dog) and the
        // erased interface variant compareTo(Object) both remain — same-arity
        // overloads across classes are legitimate (e.g. List.remove(int) vs
        // Collection.remove(Object)) and cannot be merged blindly.
        const compareTo = members.methods.filter(m => m.name === "compareTo");
        assert.deepStrictEqual(compareTo.map(m => m.declaringClass).sort(),
            ["com.example.fixture.Dog", "java.lang.Comparable"]);

        // Only Dog constructors are reported, Animal's are not inherited
        const constructors = members.methods.filter(m => m.name === "<init>");
        assert.ok(constructors.every(c => c.declaringClass === "com.example.fixture.Dog"));

        // Inherited field
        const kingdom = members.fields.find(f => f.name === "KINGDOM")!;
        assert.strictEqual(kingdom.declaringClass, "com.example.fixture.Animal");
    });

    test("the hierarchy walk stops silently on classes missing from the classpath", async () => {
        const withoutJdk = await ClassIndexService.build([FIXTURE_JAR]);
        try {
            const members = await withoutJdk.getAllMembers("com.example.fixture.Dog");
            assert.ok(members.methods.some(m => m.name === "getName"), "Animal is reachable");
            assert.ok(!members.methods.some(m => m.name === "toString"),
                "java.lang.Object is unknown without the JDK index");
        } finally {
            withoutJdk.dispose();
        }
    });

    test("a folder classpath entry is expanded to the jars it contains", async () => {
        const fromFolder = await ClassIndexService.build([FIXTURES_DIR]);
        try {
            assert.deepStrictEqual(fromFolder.findBySimpleName("Dog"),
                ["com.example.fixture.Dog"]);
            assert.deepStrictEqual(fromFolder.invalidPaths, []);
        } finally {
            fromFolder.dispose();
        }
    });

    test("unreadable classpath entries are reported, not fatal", async () => {
        const broken = await ClassIndexService.build(["/does/not/exist", FIXTURE_JAR]);
        try {
            assert.deepStrictEqual(broken.invalidPaths, ["/does/not/exist"]);
            assert.strictEqual(broken.findBySimpleName("Dog").length, 1);
        } finally {
            broken.dispose();
        }
    });

    test("inner classes are not indexed", () => {
        assert.deepStrictEqual(index.findBySimpleName("Entry"), []);
    });
});
