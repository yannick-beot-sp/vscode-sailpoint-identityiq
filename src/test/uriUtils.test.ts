import * as assert from "assert";
import { DIFF_SCHEME, URI_SCHEME } from "../constants";
import { buildDiffResourceUri, buildResourceUri, parseResourceUri } from "../utils/UriUtils";

suite("UriUtils Test Suite", () => {

    test("build and parse round-trip", () => {
        const parts = {
            tenantId: "6f2b8f74-0000-0000-0000-000000000000",
            tenantName: "Development",
            objectType: "Rule",
            objectName: "My Rule"
        };
        const uri = buildResourceUri(parts);
        assert.strictEqual(uri.scheme, URI_SCHEME);
        assert.strictEqual(uri.authority, parts.tenantId);
        // The display name is part of the path for readability
        assert.ok(uri.path.includes("Development"));
        assert.ok(uri.path.endsWith(".xml"));
        assert.deepStrictEqual(parseResourceUri(uri), parts);
    });

    test("round-trip with special characters in names", () => {
        const parts = {
            tenantId: "abc",
            tenantName: "Env / Prod (100%)",
            objectType: "TaskDefinition",
            objectName: "Refresh / Prune 50% Identities"
        };
        assert.deepStrictEqual(parseResourceUri(buildResourceUri(parts)), parts);
    });

    test("diff URIs use the read-only scheme", () => {
        const uri = buildDiffResourceUri({
            tenantId: "abc",
            tenantName: "Dev",
            objectType: "Rule",
            objectName: "R"
        });
        assert.strictEqual(uri.scheme, DIFF_SCHEME);
    });

    test("parse rejects malformed URIs", () => {
        const uri = buildResourceUri({
            tenantId: "abc",
            tenantName: "Dev",
            objectType: "Rule",
            objectName: "R"
        }).with({ path: "/only-one-segment" });
        assert.throws(() => parseResourceUri(uri));
    });
});
