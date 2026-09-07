import * as assert from "assert";
import { McpBridgeServer } from "../../mcp/bridgeServer";
import { McpTenantSource, McpToolExecutor } from "../../mcp/toolHandlers";
import { TenantCredentials, TenantInfo } from "../../models/TenantInfo";
import { MockPluginServer } from "../mockPluginServer";

interface NdjsonLine {
    type: string;
    result?: unknown;
    error?: string;
    message?: string;
}

function makeTenant(url: string, name: string): TenantInfo {
    return { id: name, name, url, type: "TENANT" };
}

suite("MCP HTTP bridge", () => {

    let plugin: MockPluginServer;
    let tenant: TenantInfo;
    let other: TenantInfo;
    let bridge: McpBridgeServer;
    let tenants: TenantInfo[];
    let active: TenantInfo;
    const credentials = new Map<string, TenantCredentials>();

    const tenantSource: McpTenantSource = {
        getTenants: () => tenants,
        getActiveTenant: () => active,
        getCredentials: async id => credentials.get(id)
    };

    suiteSetup(async () => {
        plugin = new MockPluginServer("spadmin", "admin");
        await plugin.start();

        tenant = makeTenant(plugin.baseUrl, "Mock");
        other = makeTenant("http://redhatenterpriselinux92.example.com:8080/identityiq", "POC");
        tenants = [tenant, other];
        active = tenant;
        credentials.set(tenant.id, { username: "spadmin", password: "admin" });
        credentials.set(other.id, { username: "spadmin", password: "admin" });

        plugin.seed("Rule", "Hello",
            `<Rule name="Hello" language="beanshell"><Source><![CDATA[return 1;]]></Source></Rule>`);
        plugin.seed("TaskDefinition", "My Task");

        bridge = new McpBridgeServer(new McpToolExecutor(tenantSource, {
            taskPollIntervalMs: 20,
            taskWaitCapMs: 250
        }));
        await bridge.start();
    });

    suiteTeardown(async () => {
        await bridge.stop();
        await plugin.stop();
    });

    test("rejects calls without the bearer token", async () => {
        const response = await fetch(`${bridge.url}/tools`);
        assert.strictEqual(response.status, 401);
    });

    test("lists tools", async () => {
        const response = await fetch(`${bridge.url}/tools`, {
            headers: { Authorization: `Bearer ${bridge.bearerToken}` }
        });
        assert.strictEqual(response.status, 200);
        const body = await response.json() as { tools: Array<{ name: string }> };
        const names = body.tools.map(t => t.name);
        assert.ok(names.includes("iiq_get_object"));
        assert.ok(names.includes("iiq_run_task"));
        assert.ok(names.includes("iiq_list_tenants"));
    });

    test("get_object uses the active tenant by default", async () => {
        const { result } = await callTool(bridge, "iiq_get_object", {
            objectType: "Rule",
            nameOrId: "Hello"
        });
        assert.ok(typeof result === "string" && result.includes("<Rule"));
    });

    test("tenant URL substring selects the environment", async () => {
        const { result } = await callTool(bridge, "iiq_list_tenants", {});
        const listed = result as Array<{ name: string; active: boolean }>;
        assert.ok(listed.some(t => t.active));

        const { error } = await callTool(bridge, "iiq_ping", { tenant: "redhatenterpriselinux92" });
        assert.ok(error, "POC has no plugin; ping must fail");
        assert.match(error!, /Could not reach|POC/);
    });

    test("unknown tenant returns an error line", async () => {
        const { error } = await callTool(bridge, "iiq_ping", { tenant: "no-such-env" });
        assert.match(error ?? "", /No environment matches/);
    });

    test("iiq_run_task wait=false returns the TaskResult id immediately", async () => {
        plugin.taskPollsBeforeCompletion = 50;
        const { result, progress } = await callTool(bridge, "iiq_run_task", {
            name: "My Task",
            wait: false
        });
        const body = result as { status: string; taskResultId: string };
        assert.strictEqual(body.status, "running");
        assert.ok(body.taskResultId);
        assert.strictEqual(progress.length, 0);
        plugin.taskPollsBeforeCompletion = 1;
    });

    test("iiq_run_task wait cap reports running after progress ticks", async () => {
        plugin.taskPollsBeforeCompletion = 50;
        const { result, progress } = await callTool(bridge, "iiq_run_task", { name: "My Task" });
        const body = result as { status: string; taskResultId: string; hint: string };
        assert.strictEqual(body.status, "running");
        assert.ok(body.taskResultId);
        assert.match(body.hint, /iiq_get_task_status/);
        assert.ok(progress.length >= 1, "expected at least one progress tick before the cap");
        plugin.taskPollsBeforeCompletion = 1;
    });

    test("iiq_run_task wait completes before the cap", async () => {
        plugin.taskPollsBeforeCompletion = 1;
        const executor = new McpToolExecutor(tenantSource, {
            taskPollIntervalMs: 10,
            taskWaitCapMs: 2000
        });
        const shortBridge = new McpBridgeServer(executor);
        await shortBridge.start();
        try {
            const { result } = await callTool(shortBridge, "iiq_run_task", { name: "My Task" });
            const body = result as { status: string; completionStatus: string };
            assert.strictEqual(body.status, "completed");
            assert.strictEqual(body.completionStatus, "Success");
        } finally {
            await shortBridge.stop();
        }
    });
});

async function callTool(
    bridge: McpBridgeServer,
    name: string,
    args: Record<string, unknown>
): Promise<{ result?: unknown; error?: string; progress: string[] }> {
    const response = await fetch(`${bridge.url}/tools/${name}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${bridge.bearerToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ arguments: args })
    });
    const text = await response.text();
    const lines: NdjsonLine[] = text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    const resultLine = lines.find(l => l.type === "result");
    const errorLine = lines.find(l => l.type === "error");
    return {
        result: resultLine?.result,
        error: errorLine?.error,
        progress: lines.filter(l => l.type === "progress").map(l => l.message ?? "")
    };
}
