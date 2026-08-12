import * as assert from "assert";
import * as vscode from "vscode";
import { TenantInfo } from "../models/TenantInfo";
import { getErrorStatus, IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { buildResourceUri } from "../utils/UriUtils";
import { MockPluginServer } from "./mockPluginServer";
import { getExtensionApi, makeTenant } from "./testHelpers";

/**
 * Integration tests of the plugin REST contract (docs/plugin-api.md) against
 * an in-memory mock server: IIQClient, and the iiq:// virtual file system
 * end-to-end through vscode.workspace.fs.
 * Covers UC-04 (test connection), UC-10 (paginated/sorted lists),
 * UC-11/12 (open & save through the virtual FS), UC-13 (delete),
 * UC-22 (import), UC-30 (run rule), UC-31 (run task), UC-32 (stream
 * server logs) and UC-33 (configure logger levels).
 */
suite("IIQClient & virtual FS Test Suite (mock plugin)", () => {

    let server: MockPluginServer;
    let tenantService: TenantService;
    let tenant: TenantInfo;
    let client: IIQClient;

    async function findObjectId(objectType: string, name: string): Promise<string> {
        const page = await client.listObjects(objectType);
        const found = page.objects.find(o => o.name === name);
        assert.ok(found, `${objectType} "${name}" not found`);
        return found!.id;
    }

    suiteSetup(async () => {
        tenantService = (await getExtensionApi()).tenantService;
        server = new MockPluginServer("spadmin", "admin");
        await server.start();

        tenant = makeTenant(server.baseUrl, "Mock");
        await tenantService.add(tenant);
        await tenantService.setCredentials(tenant.id, { username: "spadmin", password: "admin" });
        client = new IIQClient(tenant, tenantService);

        for (let i = 1; i <= 5; i++) {
            server.seed("Rule", `Rule ${i}`,
                `<Rule name="Rule ${i}" language="beanshell"><Source><![CDATA[return "${i}";]]></Source></Rule>`);
        }
        server.seed("Workflow", "WF 1");
    });

    suiteTeardown(async () => {
        await tenantService.remove(tenant.id);
        await server.stop();
    });

    test("UC-04: ping validates credentials, plugin and API version", async () => {
        const info = await client.ping();
        assert.strictEqual(info.identity, "spadmin");
        assert.strictEqual(info.version, "8.4p2");
    });

    test("UC-04: bad credentials produce an actionable error", async () => {
        const badTenant = makeTenant(server.baseUrl, "Bad");
        await tenantService.add(badTenant);
        await tenantService.setCredentials(badTenant.id, { username: "spadmin", password: "wrong" });
        try {
            const badClient = new IIQClient(badTenant, tenantService);
            await assert.rejects(() => badClient.ping(), /Authentication failed/);
        } finally {
            await tenantService.remove(badTenant.id);
        }
    });

    test("UC-04: unreachable server produces an actionable error", async () => {
        const downTenant = makeTenant("http://127.0.0.1:1/identityiq", "Down");
        await tenantService.add(downTenant);
        await tenantService.setCredentials(downTenant.id, { username: "u", password: "p" });
        try {
            const downClient = new IIQClient(downTenant, tenantService);
            await assert.rejects(() => downClient.ping(), /Could not reach/);
        } finally {
            await tenantService.remove(downTenant.id);
        }
    });

    test("UC-10: lists are paginated", async () => {
        const page = await client.listObjects("Rule", { start: 0, limit: 2 });
        assert.strictEqual(page.count, 5);
        assert.strictEqual(page.objects.length, 2);

        const lastPage = await client.listObjects("Rule", { start: 4, limit: 2 });
        assert.strictEqual(lastPage.objects.length, 1);
    });

    test("UC-10: lists are sorted by name or by last modification date", async () => {
        const byName = await client.listObjects("Rule", { sortBy: "name" });
        assert.deepStrictEqual(byName.objects.map(o => o.name),
            ["Rule 1", "Rule 2", "Rule 3", "Rule 4", "Rule 5"]);

        const byModified = await client.listObjects("Rule", { sortBy: "lastModified" });
        // Most recently modified first
        assert.strictEqual(byModified.objects[0].name, "Rule 5");
    });

    test("UC-10: excludeTypes keeps reports out of the task list", async () => {
        server.seed("TaskDefinition", "Plain Task");
        server.seed("TaskDefinition", "A Report", '<TaskDefinition name="A Report" type="LiveReport"/>');
        server.seed("TaskDefinition", "Legacy Report", '<TaskDefinition name="Legacy Report" type="Report"/>');
        server.seed("TaskDefinition", "Aggregation", '<TaskDefinition name="Aggregation" type="AccountAggregation"/>');

        const filtered = await client.listObjects("TaskDefinition", { excludeTypes: ["Report", "LiveReport"] });
        const names = filtered.objects.map(o => o.name);
        assert.ok(!names.includes("A Report") && !names.includes("Legacy Report"),
            `reports must be excluded, got: ${names}`);
        // Typed and untyped tasks are kept, and the count matches the filter
        assert.ok(names.includes("Plain Task") && names.includes("Aggregation"));
        assert.strictEqual(filtered.count, names.length);

        // Without excludeTypes, reports are listed (generic "Get object...")
        const all = await client.listObjects("TaskDefinition");
        assert.ok(all.objects.some(o => o.name === "A Report"));
    });

    test("UC-10: templates are never listed among tasks", async () => {
        server.seed("TaskDefinition", "Plain Task");
        server.seed("TaskDefinition", "Account Aggregation",
            '<TaskDefinition name="Account Aggregation" template="true"/>');

        const result = await client.listObjects("TaskDefinition");
        const names = result.objects.map(o => o.name);
        assert.ok(!names.includes("Account Aggregation"), `templates must be excluded, got: ${names}`);
        assert.ok(names.includes("Plain Task"));
        assert.strictEqual(result.count, names.length);
    });

    test("UC-10: workgroups are listed separately from identities", async () => {
        server.seed("Identity", "spadmin", '<Identity name="spadmin"/>');
        server.seed("Identity", "IIQWorkgroup",
            '<Identity name="IIQWorkgroup" workgroup="true"/>');

        const identities = await client.listObjects("Identity");
        const identityNames = identities.objects.map(o => o.name);
        assert.ok(identityNames.includes("spadmin"));
        assert.ok(!identityNames.includes("IIQWorkgroup"),
            `workgroups must be excluded from Identity list, got: ${identityNames}`);

        const workgroups = await client.listObjects("Workgroup");
        const workgroupNames = workgroups.objects.map(o => o.name);
        assert.deepStrictEqual(workgroupNames, ["IIQWorkgroup"]);
        assert.strictEqual(workgroups.count, 1);

        // Virtual type resolves to the same Identity XML
        const xml = await client.getObject("Workgroup", "IIQWorkgroup");
        assert.ok(xml.includes('workgroup="true"'));
    });

    test("UC-11: getObject returns the XML representation", async () => {
        const xml = await client.getObject("Rule", "Rule 1");
        assert.ok(xml.includes('<Rule name="Rule 1"'));
        assert.ok(xml.includes("<![CDATA["), "CDATA must be preserved");
        assert.strictEqual(await client.getObjectIfExists("Rule", "Nope"), undefined);
    });

    test("UC-11: getObjectMetadata (HEAD) returns size, date and etag without the body", async () => {
        const metadata = await client.getObjectMetadata("Rule", "Rule 1");
        assert.ok(metadata, "metadata expected for an existing object");
        assert.ok(metadata!.size > 0);
        assert.ok(metadata!.modified instanceof Date && !isNaN(metadata!.modified.getTime()));
        assert.ok(metadata!.etag);
        assert.strictEqual(await client.getObjectMetadata("Rule", "Nope"), undefined);
    });

    test("UC-12: stat through the FS uses HEAD, not GET", async () => {
        const ruleId = await findObjectId("Rule", "Rule 2");
        const uri = buildResourceUri({
            tenantId: tenant.id,
            tenantName: tenant.name,
            objectType: "Rule",
            objectId: ruleId,
            objectName: "Rule 2"
        });
        server.requests.length = 0;
        const stat = await vscode.workspace.fs.stat(uri);
        assert.strictEqual(stat.type, vscode.FileType.File);
        assert.ok(stat.size > 0);
        assert.ok(stat.mtime > 0, "mtime must come from Last-Modified for remote change detection");

        const objectRequests = server.requests.filter(r => r.path.endsWith(`/${encodeURIComponent(ruleId)}`));
        assert.ok(objectRequests.length > 0);
        assert.ok(objectRequests.every(r => r.method === "HEAD"),
            `stat must not transfer the object body, got: ${JSON.stringify(objectRequests)}`);
    });

    test("UC-22: importXml creates or updates objects, including bundles", async () => {
        const result = await client.importXml(
            `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE sailpoint PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<sailpoint>
  <Rule name="Imported Rule"><Source><![CDATA[return true;]]></Source></Rule>
  <TaskDefinition name="Imported Task"/>
</sailpoint>`);
        assert.deepStrictEqual(result.errors, []);
        assert.deepStrictEqual(result.imported.sort(),
            ["Rule:Imported Rule", "TaskDefinition:Imported Task"]);
        assert.ok(server.has("Rule", "Imported Rule"));
        assert.ok(server.has("TaskDefinition", "Imported Task"));
    });

    test("UC-30: runRule passes arguments and returns the result", async () => {
        const result = await client.runRule("Rule 1", { identityName: "spadmin" });
        assert.strictEqual(result.result, 'ran:Rule 1:{"identityName":"spadmin"}');
        await assert.rejects(() => client.runRule("Unknown rule"));
    });

    test("UC-31: runTask launches the task and getTaskStatus tracks completion", async () => {
        server.seed("TaskDefinition", "My Task");
        const taskResultId = await client.runTask("My Task");
        assert.ok(taskResultId, "the TaskResult id is returned at launch");

        // First poll: the task is still running
        let status = await client.getTaskStatus(taskResultId);
        assert.strictEqual(status.completed, null);
        assert.strictEqual(status.completionStatus, null);

        // Second poll: completed successfully
        status = await client.getTaskStatus(taskResultId);
        assert.ok(status.completed);
        assert.strictEqual(status.completionStatus, "Success");

        // The final TaskResult is a regular object, fetched through the
        // generic interface (used by the result preview)
        const xml = await client.getObject("TaskResult", taskResultId);
        assert.ok(xml.includes("<TaskResult"));

        await assert.rejects(() => client.runTask("Unknown task"));
    });

    test("UC-13: deleteObject removes the object", async () => {
        server.seed("Rule", "To delete");
        await client.deleteObject("Rule", "To delete");
        assert.ok(!server.has("Rule", "To delete"));
    });

    test("testConnectorObjects returns the preview objects of a schema", async () => {
        server.seedConnectorObjects("Active Directory", "account", [
            { sAMAccountName: "jdoe", displayName: "John Doe" },
            { sAMAccountName: "asmith", displayName: "Ann Smith" }
        ]);
        const objects = await client.testConnectorObjects("Active Directory", "account");
        assert.strictEqual(objects.length, 2);
        assert.strictEqual(objects[0]["sAMAccountName"], "jdoe");
    });

    test("testConnectorObjects surfaces a connector failure as an error", async () => {
        server.connectorFailure = "Could not connect to the directory server";
        try {
            await assert.rejects(
                () => client.testConnectorObjects("Active Directory", "account"),
                /Could not connect to the directory server/);
        } finally {
            server.connectorFailure = undefined;
        }
    });

    test("UC-11/12: the iiq:// virtual FS reads and writes objects", async () => {
        const ruleId = await findObjectId("Rule", "Rule 1");
        const uri = buildResourceUri({
            tenantId: tenant.id,
            tenantName: tenant.name,
            objectType: "Rule",
            objectId: ruleId,
            objectName: "Rule 1"
        });

        // Read through the virtual file system
        const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
        assert.ok(content.includes('<Rule name="Rule 1"'));

        // Write through the virtual file system = save back to IdentityIQ
        const updated = '<Rule name="Rule 1" language="beanshell"><Source><![CDATA[return "updated";]]></Source></Rule>';
        await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, "utf8"));
        const reread = await client.getObject("Rule", "Rule 1");
        assert.ok(reread.includes('return "updated";'));
    });

    test("UC-12: id-based URI stays valid after the object name changes in a save", async () => {
        const ruleId = await findObjectId("Rule", "Rule 3");
        const idUri = buildResourceUri({
            tenantId: tenant.id,
            tenantName: tenant.name,
            objectType: "Rule",
            objectId: ruleId,
            objectName: "Rule 3"
        });

        const renamed = '<Rule name="Rule 3 Renamed" language="beanshell"><Source><![CDATA[return "renamed";]]></Source></Rule>';
        await vscode.workspace.fs.writeFile(idUri, Buffer.from(renamed, "utf8"));

        // With an id in the path, stat/read keep working after a save that renames
        // the object in the XML (a name-based path would 404 on the next stat).
        await vscode.workspace.fs.stat(idUri);
        const content = Buffer.from(await vscode.workspace.fs.readFile(idUri)).toString("utf8");
        assert.ok(content.includes("<Rule"));
    });

    test("UC-12: reading a missing object through the FS raises FileNotFound", async () => {
        const uri = buildResourceUri({
            tenantId: tenant.id,
            tenantName: tenant.name,
            objectType: "Rule",
            objectId: "Does not exist",
            objectName: "Does not exist"
        });
        await assert.rejects(() => Promise.resolve(vscode.workspace.fs.readFile(uri)),
            (error: vscode.FileSystemError) => error.code === "FileNotFound");
    });

    test("UC-32: getLogFiles lists the file-backed appenders", async () => {
        server.seedLogFile("list-test", "sailpoint.log", "line 1\n");
        const files = await client.getLogFiles();
        const file = files.find(f => f.key === "list-test");
        assert.ok(file, "the seeded appender must be listed");
        assert.strictEqual(file!.fileName, "sailpoint.log");
        assert.ok(file!.path.endsWith("sailpoint.log"));
        assert.strictEqual(file!.size, Buffer.byteLength("line 1\n"));
        assert.strictEqual(file!.exists, true);
    });

    test("UC-32: the first tail call returns the trailing window, cut on a line boundary", async () => {
        server.seedLogFile("window-test", "sailpoint.log",
            "old line far in the past\nrecent line 1\nrecent line 2\n");
        server.logInitialWindowBytes = 32; // covers a partial line + the 2 recent ones
        try {
            const chunk = await client.getLogChunk("window-test");
            assert.strictEqual(chunk.content, "recent line 1\nrecent line 2\n",
                "the partial first line of the window must be skipped");
            assert.strictEqual(chunk.nextOffset, chunk.fileSize);
            assert.strictEqual(chunk.rotated, false);
        } finally {
            server.logInitialWindowBytes = 16 * 1024;
        }
    });

    test("UC-32: subsequent calls return exactly the new lines", async () => {
        server.seedLogFile("incr-test", "sailpoint.log", "initial\n");
        let chunk = await client.getLogChunk("incr-test");
        assert.strictEqual(chunk.nextOffset, chunk.fileSize);

        server.appendLog("incr-test", "new line 1\nnew line 2\n");
        chunk = await client.getLogChunk("incr-test", chunk.nextOffset);
        assert.strictEqual(chunk.content, "new line 1\nnew line 2\n");

        // Nothing new: empty chunk, same offset
        const empty = await client.getLogChunk("incr-test", chunk.nextOffset);
        assert.strictEqual(empty.content, "");
        assert.strictEqual(empty.nextOffset, chunk.nextOffset);
    });

    test("UC-32: a partial line is held back until its newline arrives", async () => {
        server.seedLogFile("partial-test", "sailpoint.log", "complete\n");
        let chunk = await client.getLogChunk("partial-test");

        server.appendLog("partial-test", "no newline yet");
        chunk = await client.getLogChunk("partial-test", chunk.nextOffset);
        assert.strictEqual(chunk.content, "", "a partial line must not be emitted");
        assert.ok(chunk.nextOffset < chunk.fileSize, "the cursor waits before the partial line");

        server.appendLog("partial-test", " — now complete\n");
        chunk = await client.getLogChunk("partial-test", chunk.nextOffset);
        assert.strictEqual(chunk.content, "no newline yet — now complete\n");
        assert.strictEqual(chunk.nextOffset, chunk.fileSize);
    });

    test("UC-32: a capped chunk lets the client catch up by polling again", async () => {
        server.seedLogFile("cap-test", "sailpoint.log");
        server.logMaxChunkBytes = 16;
        try {
            server.appendLog("cap-test", "0123456789\nabcdefghij\n");
            let chunk = await client.getLogChunk("cap-test", 0);
            assert.strictEqual(chunk.content, "0123456789\n", "the chunk is capped on a line boundary");
            assert.ok(chunk.nextOffset < chunk.fileSize, "more bytes are available");

            chunk = await client.getLogChunk("cap-test", chunk.nextOffset);
            assert.strictEqual(chunk.content, "abcdefghij\n");
            assert.strictEqual(chunk.nextOffset, chunk.fileSize);
        } finally {
            server.logMaxChunkBytes = 64 * 1024;
        }
    });

    test("UC-32: a shrunken file is detected as a rotation and re-tailed", async () => {
        server.seedLogFile("rotate-test", "sailpoint.log", "a long line before rotation\n");
        const before = await client.getLogChunk("rotate-test");
        assert.strictEqual(before.nextOffset, before.fileSize);

        server.truncateLog("rotate-test", "fresh start\n");
        const after = await client.getLogChunk("rotate-test", before.nextOffset);
        assert.strictEqual(after.rotated, true);
        assert.strictEqual(after.content, "fresh start\n");
        assert.strictEqual(after.nextOffset, after.fileSize);
    });

    test("UC-32: an unknown appender key is rejected with a 404", async () => {
        await assert.rejects(() => client.getLogChunk("no-such-appender"),
            (error: unknown) => getErrorStatus(error) === 404);
    });

    test("UC-33: setLoggerLevel sets a logger's level", async () => {
        const applied = await client.setLoggerLevel("sailpoint.connector.LDAPConnector", "debug");
        assert.strictEqual(applied, "DEBUG", "the level is normalized to uppercase");
        assert.strictEqual(server.getLoggerLevel("sailpoint.connector.LDAPConnector"), "DEBUG");
    });

    test("UC-33: setLoggerLevel rejects an unknown level", async () => {
        await assert.rejects(() => client.setLoggerLevel("sailpoint.api.Aggregator", "VERBOSE"),
            (error: unknown) => getErrorStatus(error) === 400);
    });

    test("UC-33: resetLoggerLevel removes the override", async () => {
        await client.setLoggerLevel("org.hibernate.SQL", "DEBUG");
        assert.strictEqual(server.getLoggerLevel("org.hibernate.SQL"), "DEBUG");

        await client.resetLoggerLevel("org.hibernate.SQL");
        assert.strictEqual(server.getLoggerLevel("org.hibernate.SQL"), undefined);
    });

    test("UC-11: opening a virtual document in the editor works end-to-end", async () => {
        const workflowId = await findObjectId("Workflow", "WF 1");
        const uri = buildResourceUri({
            tenantId: tenant.id,
            tenantName: tenant.name,
            objectType: "Workflow",
            objectId: workflowId,
            objectName: "WF 1"
        });
        const document = await vscode.workspace.openTextDocument(uri);
        assert.ok(document.getText().includes('<Workflow name="WF 1"'));
        assert.ok(document.uri.path.includes("WF 1.xml"));
    });
});
