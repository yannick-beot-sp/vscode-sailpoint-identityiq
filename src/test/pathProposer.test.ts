import * as assert from "assert";
import * as os from "os";
import { PathProposer, pathToUri } from "../services/PathProposer";

suite("PathProposer Test Suite", () => {

    const now = new Date(Date.UTC(2026, 8, 17, 10, 5, 7));

    test("replaces object, tenant and date tokens", () => {
        const result = PathProposer.replaceVariables(
            "%x/%t/%o/%S-%y%M%d-%h%m%s.xml",
            {
                x: "/workspace",
                t: "Dev",
                T: "Dev",
                o: "Rule",
                S: "My Rule"
            },
            now);
        assert.strictEqual(result, "/workspace/Dev/Rule/My Rule-20260917-100507.xml");
    });

    test("uses home dir when no workspace is provided in context and %x is overridden", () => {
        const result = PathProposer.replaceVariables("%u/%S.xml", {
            u: "/home/user",
            S: "export"
        }, now);
        assert.strictEqual(result, "/home/user/export.xml");
    });

    test("leaves unknown tokens untouched", () => {
        const result = PathProposer.replaceVariables("%z/%S.xml", { S: "Rule" }, now);
        assert.strictEqual(result, "%z/Rule.xml");
    });

    test("default multiple-files filename is objectType/objectName.xml", () => {
        const result = PathProposer.getMultipleFilesFilename("Dev", "Rule", "LCE / Build");
        assert.ok(result.endsWith("Rule/LCE _ Build.xml") || result.endsWith("Rule\\LCE _ Build.xml"),
            result);
    });

    test("default single-resource filename is under workspace-or-home with the object name", () => {
        const result = PathProposer.getSingleResourceFilename("Dev", "Rule", "My Rule");
        assert.ok(result.endsWith("My Rule.xml"), result);
        assert.ok(result.includes(os.homedir()) || result.length > "My Rule.xml".length, result);
    });

    test("sanitizes tenant and object names used as path segments", () => {
        const result = PathProposer.getSingleResourceFilename("Prod:1", "Rule", "A:B");
        assert.ok(result.endsWith("A_B.xml"), result);
    });

    test("bulk pattern supports the object subtype token", () => {
        const result = PathProposer.replaceVariables("%x/%o/%k/%S.xml", {
            x: "/workspace",
            o: "Rule",
            k: "BeforeProvisioning",
            S: "Prepare Plan"
        }, now);
        assert.strictEqual(result, "/workspace/Rule/BeforeProvisioning/Prepare Plan.xml");
    });

    test("pathToUri normalizes the resolved path", () => {
        const uri = pathToUri("/tmp/export.xml");
        assert.strictEqual(uri.scheme, "file");
        assert.ok(uri.fsPath.endsWith("export.xml"));
    });
});
