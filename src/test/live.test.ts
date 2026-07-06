import * as assert from "assert";
import * as vscode from "vscode";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { buildResourceUri } from "../utils/UriUtils";
import { getExtensionApi, makeTenant } from "./testHelpers";

/**
 * Live tests against a local IdentityIQ instance with the iiq-devtools
 * plugin installed:
 *
 *     URL:      http://localhost:8080/identityiq
 *     login:    spadmin
 *     password: admin
 *
 * The whole suite is skipped automatically when the instance (or the plugin)
 * is not reachable, so `npm test` stays green on machines without IIQ.
 */

const LIVE_URL = process.env.IIQ_TEST_URL ?? "http://localhost:8080/identityiq";
const LIVE_USERNAME = process.env.IIQ_TEST_USERNAME ?? "spadmin";
const LIVE_PASSWORD = process.env.IIQ_TEST_PASSWORD ?? "admin";

/** Rule created, run and deleted by this suite */
const TEST_RULE_NAME = "VSCode Extension Test Rule";

/** Rule used by the log stream test: logs a marker at ERROR (never filtered) */
const LOG_TEST_RULE_NAME = "VSCode Extension Log Stream Test Rule";
const logTestRuleXml = (marker: string) => `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Rule name="${LOG_TEST_RULE_NAME}" language="beanshell">
  <Description>Temporary rule created by the vscode-sailpoint-identityiq test suite. Safe to delete.</Description>
  <Source><![CDATA[
    log.error("${marker}");
    return null;
  ]]></Source>
</Rule>
`;
const TEST_RULE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Rule name="${TEST_RULE_NAME}" language="beanshell">
  <Description>Temporary rule created by the vscode-sailpoint-identityiq test suite. Safe to delete.</Description>
  <Source><![CDATA[
    return "hello from vscode test";
  ]]></Source>
</Rule>
`;

suite("Live IdentityIQ Test Suite (localhost)", function () {

    let tenantService: TenantService;
    let tenant: TenantInfo;
    let client: IIQClient;
    let available = false;

    suiteSetup(async function () {
        tenantService = (await getExtensionApi()).tenantService;
        tenant = makeTenant(LIVE_URL, "Local IIQ");
        await tenantService.add(tenant);
        await tenantService.setCredentials(tenant.id, {
            username: LIVE_USERNAME,
            password: LIVE_PASSWORD
        });
        client = new IIQClient(tenant, tenantService);
        try {
            await client.ping();
            available = true;
        } catch (error) {
            console.warn(`Live IdentityIQ not available at ${LIVE_URL}, skipping live tests: ${error}`);
        }
    });

    setup(function () {
        if (!available) {
            this.skip();
        }
    });

    suiteTeardown(async function () {
        if (available) {
            // Clean up the test rules if a test failed before deleting them
            for (const name of [TEST_RULE_NAME, LOG_TEST_RULE_NAME]) {
                try {
                    await client.deleteObject("Rule", name);
                } catch {
                    // already deleted: fine
                }
            }
        }
        await tenantService.remove(tenant.id);
    });

    test("UC-04: ping returns versions and identity", async () => {
        const info = await client.ping();
        assert.ok(info.version, "IdentityIQ version expected");
        assert.ok(info.pluginVersion, "plugin version expected");
        assert.strictEqual(info.identity, LIVE_USERNAME);
    });

    test("UC-10: rules are listed with pagination metadata", async () => {
        const page = await client.listObjects("Rule", { start: 0, limit: 5, sortBy: "name" });
        assert.ok(page.count > 0, "an out-of-the-box IIQ has rules");
        assert.ok(page.objects.length <= 5);
        assert.ok(page.objects.every(o => o.id && o.name));
        // Sorted by name
        const names = page.objects.map(o => o.name);
        assert.deepStrictEqual([...names].sort((a, b) => a.localeCompare(b)), names);
    });

    test("UC-22: import creates the test rule", async () => {
        const result = await client.importXml(TEST_RULE_XML);
        assert.deepStrictEqual(result.errors, []);
        assert.ok(result.imported.some(entry => entry.includes(TEST_RULE_NAME)));
    });

    test("UC-11: the imported rule can be fetched as XML", async () => {
        const xml = await client.getObject("Rule", TEST_RULE_NAME);
        assert.ok(xml.includes(`name="${TEST_RULE_NAME}"`));
        assert.ok(xml.includes("hello from vscode test"));
    });

    test("UC-11/12: the rule opens through the iiq:// virtual FS", async () => {
        const uri = buildResourceUri({
            tenantId: tenant.id,
            tenantName: tenant.name,
            objectType: "Rule",
            objectName: TEST_RULE_NAME
        });
        const document = await vscode.workspace.openTextDocument(uri);
        assert.ok(document.getText().includes(`name="${TEST_RULE_NAME}"`));
    });

    test("UC-30: the rule runs and returns its value", async () => {
        const result = await client.runRule(TEST_RULE_NAME);
        assert.strictEqual(result.result, "hello from vscode test");
    });

    test("UC-32: tailing a log file captures a rule's log output", async function () {
        this.timeout(30_000);
        const files = await client.getLogFiles();
        // Every entry must be a file-backed appender with a resolved path
        for (const file of files) {
            assert.ok(file.key && file.fileName && file.path);
        }
        const file = files.find(f => f.exists);
        if (!file) {
            // No active file appender on this instance (console-only logging)
            this.skip();
        }

        // First call: trailing window, cursor at the end of the file
        const initial = await client.getLogChunk(file!.key);
        assert.ok(initial.nextOffset <= initial.fileSize);
        assert.strictEqual(initial.rotated, false);

        const marker = `vscode log tail marker ${Date.now()}`;
        const imported = await client.importXml(logTestRuleXml(marker));
        assert.deepStrictEqual(imported.errors, []);
        try {
            await client.runRule(LOG_TEST_RULE_NAME);

            // The line is written synchronously; a few polls leave room for
            // buffered appenders and slow instances
            let offset = initial.nextOffset;
            let found = false;
            for (let attempt = 0; attempt < 10 && !found; attempt++) {
                const chunk = await client.getLogChunk(file!.key, offset);
                assert.ok(chunk.nextOffset >= 0, "the cursor is always valid");
                offset = chunk.nextOffset;
                found = chunk.content.includes(marker);
                if (!found) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            assert.ok(found, "the marker logged by the rule must appear in the tailed file");
        } finally {
            await client.deleteObject("Rule", LOG_TEST_RULE_NAME);
        }
    });

    test("UC-13: the test rule can be deleted", async () => {
        await client.deleteObject("Rule", TEST_RULE_NAME);
        assert.strictEqual(await client.getObjectIfExists("Rule", TEST_RULE_NAME), undefined);
    });
});
