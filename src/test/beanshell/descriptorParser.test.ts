import * as assert from "assert";
import {
    formatGenericMethodSignature,
    formatGenericTypeSignature,
    parseFieldDescriptor,
    parseMethodDescriptor
} from "../../beanshell/java/descriptorParser";

suite("JVM descriptor parser Test Suite", () => {

    test("parses field descriptors", () => {
        assert.strictEqual(parseFieldDescriptor("I"), "int");
        assert.strictEqual(parseFieldDescriptor("Z"), "boolean");
        assert.strictEqual(parseFieldDescriptor("Ljava/lang/String;"), "java.lang.String");
        assert.strictEqual(parseFieldDescriptor("[I"), "int[]");
        assert.strictEqual(parseFieldDescriptor("[[Ljava/lang/Object;"), "java.lang.Object[][]");
    });

    test("parses method descriptors", () => {
        assert.deepStrictEqual(parseMethodDescriptor("()V"),
            { parameterTypes: [], returnType: "void" });
        assert.deepStrictEqual(parseMethodDescriptor("(Ljava/lang/String;I)V"),
            { parameterTypes: ["java.lang.String", "int"], returnType: "void" });
        assert.deepStrictEqual(parseMethodDescriptor("(JD)Ljava/util/List;"),
            { parameterTypes: ["long", "double"], returnType: "java.util.List" });
        assert.deepStrictEqual(parseMethodDescriptor("([Ljava/lang/String;)[B"),
            { parameterTypes: ["java.lang.String[]"], returnType: "byte[]" });
    });

    test("rejects malformed descriptors", () => {
        assert.throws(() => parseMethodDescriptor("Ljava/lang/String;"));
        assert.throws(() => parseFieldDescriptor("Q"));
        assert.throws(() => parseFieldDescriptor("Ljava/lang/String"));
    });

    test("formats generic method signatures for display", () => {
        assert.strictEqual(
            formatGenericMethodSignature(
                "(Ljava/util/List<Lsailpoint/object/Filter;>;)Ljava/util/Iterator<Lsailpoint/object/Identity;>;"),
            "(List<Filter>) : Iterator<Identity>");
        assert.strictEqual(
            formatGenericMethodSignature("(TT;)TT;"),
            "(T) : T");
        assert.strictEqual(
            formatGenericMethodSignature(
                "<T:Ljava/lang/Object;>(Ljava/lang/Class<TT;>;Ljava/lang/String;)TT;"),
            "(Class<T>, String) : T");
        assert.strictEqual(
            formatGenericMethodSignature("(Ljava/util/Map<**>;)V"),
            "(Map<?, ?>) : void");
        assert.strictEqual(
            formatGenericMethodSignature(
                "(Ljava/util/List<+Lsailpoint/object/SailPointObject;>;)V"),
            "(List<? extends SailPointObject>) : void");
    });

    test("formats generic field signatures for display", () => {
        assert.strictEqual(
            formatGenericTypeSignature("Ljava/util/List<Lsailpoint/object/Link;>;"),
            "List<Link>");
        assert.strictEqual(
            formatGenericTypeSignature("Ljava/util/Map<Ljava/lang/String;[I>;"),
            "Map<String, int[]>");
    });

    test("returns undefined on unparsable generic signatures", () => {
        assert.strictEqual(formatGenericMethodSignature("garbage"), undefined);
        assert.strictEqual(formatGenericTypeSignature("Lunclosed"), undefined);
    });
});
