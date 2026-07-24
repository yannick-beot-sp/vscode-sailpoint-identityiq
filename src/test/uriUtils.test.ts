import * as assert from "assert";
import { DIFF_SCHEME, URI_SCHEME } from "../constants";
import { buildDiffResourceUri, buildResourceUri, parseResourceUri } from "../utils/UriUtils";

suite("UriUtils Test Suite", () => {

    const baseParts = {
        tenantId: "6f2b8f74-0000-0000-0000-000000000000",
        tenantName: "Development",
        objectType: "Rule",
        objectId: "0a0000018123456789abcdef01234567",
        objectName: "My Rule"
    };

    test("build and parse round-trip", () => {
        const uri = buildResourceUri(baseParts);
        assert.strictEqual(uri.scheme, URI_SCHEME);
        assert.strictEqual(uri.authority, baseParts.tenantId);
        assert.ok(uri.path.includes("Development"));
        assert.ok(uri.path.includes(baseParts.objectId));
        assert.ok(uri.path.endsWith("My Rule.xml"));
        assert.deepStrictEqual(parseResourceUri(uri), baseParts);
    });

    test("round-trip with special characters in names", () => {
        const parts = {
            tenantId: "abc",
            tenantName: "Env / Prod (100%)",
            objectType: "TaskDefinition",
            objectId: "0a0000018123456789abcdef01234567",
            objectName: "Refresh / Prune 50% Identities"
        };
        assert.deepStrictEqual(parseResourceUri(buildResourceUri(parts)), parts);
    });

    test("legacy 3-segment URIs still parse", () => {
        const legacy = buildResourceUri(baseParts).with({
            path: "/Development/Rule/0a0000018123456789abcdef01234567.xml"
        });
        assert.deepStrictEqual(parseResourceUri(legacy), {
            ...baseParts,
            objectName: baseParts.objectId
        });
    });

    test("diff URIs use the read-only scheme", () => {
        const uri = buildDiffResourceUri({
            tenantId: "abc",
            tenantName: "Dev",
            objectType: "Rule",
            objectId: "id",
            objectName: "R"
        });
        assert.strictEqual(uri.scheme, DIFF_SCHEME);
    });

    test("parse rejects malformed URIs", () => {
        const uri = buildResourceUri(baseParts).with({ path: "/only-one-segment" });
        assert.throws(() => parseResourceUri(uri));
    });
});
