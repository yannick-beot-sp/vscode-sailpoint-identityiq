import * as assert from "assert";
import * as vscode from "vscode";
import { ObjectCommands } from "../commands/objectCommands";
import { COMMANDS } from "../constants";
import { IIQExtensionApi } from "../extension";
import { TenantInfo } from "../models/TenantInfo";
import { TenantService } from "../services/TenantService";
import { IIQTreeDataProvider } from "../views/IIQTreeDataProvider";
import { ObjectTreeItem, TenantTreeItem } from "../views/IIQTreeItem";
import { MockPluginServer } from "./mockPluginServer";
import { getExtensionApi, makeTenant } from "./testHelpers";

const SOURCE_RULE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Rule name="Cross Tenant Rule" language="beanshell">
  <Source><![CDATA[return "source";]]></Source>
</Rule>`;

const EXISTING_RULE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Rule name="Cross Tenant Rule" language="beanshell">
  <Source><![CDATA[return "old";]]></Source>
</Rule>`;

/**
 * Command-layer tests for copying objects between environments.
 */
suite("ObjectCommands copy-to-tenant Test Suite", () => {

    let tenantService: TenantService;
    let treeDataProvider: IIQTreeDataProvider;

    suiteSetup(async () => {
        const api: IIQExtensionApi = await getExtensionApi();
        tenantService = api.tenantService;
        treeDataProvider = api.treeDataProvider;
    });

    test("copy-to-tenant commands are registered at activation", async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes(COMMANDS.copyObjectToTenant));
        assert.ok(commands.includes(COMMANDS.copyObjectToTenantView));
    });

    suite("copyObjectToTenantFromView (mock plugin)", () => {

        let sourceServer: MockPluginServer;
        let targetServer: MockPluginServer;
        let sourceTenant: TenantInfo;
        let targetTenant: TenantInfo;
        let objectCommands: ObjectCommands;
        let sourceNode: ObjectTreeItem;

        suiteSetup(async () => {
            sourceServer = new MockPluginServer("spadmin", "admin");
            targetServer = new MockPluginServer("spadmin", "admin");
            await sourceServer.start();
            await targetServer.start();

            sourceTenant = makeTenant(sourceServer.baseUrl, "Copy Source");
            targetTenant = makeTenant(targetServer.baseUrl, "Copy Target");
            await tenantService.add(sourceTenant);
            await tenantService.add(targetTenant);
            await tenantService.setCredentials(sourceTenant.id, { username: "spadmin", password: "admin" });
            await tenantService.setCredentials(targetTenant.id, { username: "spadmin", password: "admin" });

            sourceServer.seed("Rule", "Cross Tenant Rule", SOURCE_RULE_XML);
            objectCommands = new ObjectCommands(tenantService, treeDataProvider);
            sourceNode = new ObjectTreeItem(sourceTenant,
                { objectType: "Rule", label: "Rules", icon: "code" },
                { id: "rule-id", name: "Cross Tenant Rule" });
        });

        suiteTeardown(async () => {
            await tenantService.remove(sourceTenant.id);
            await tenantService.remove(targetTenant.id);
            await sourceServer.stop();
            await targetServer.stop();
        });

        test("copies an object to the chosen target environment", async () => {
            const originalShowQuickPick = vscode.window.showQuickPick;
            vscode.window.showQuickPick = (async () => ({
                label: targetTenant.name,
                description: targetTenant.url,
                picked: true,
                tenant: targetTenant
            })) as unknown as typeof vscode.window.showQuickPick;
            try {
                await objectCommands.copyObjectToTenantFromView(sourceNode);
            } finally {
                vscode.window.showQuickPick = originalShowQuickPick;
            }

            assert.ok(targetServer.has("Rule", "Cross Tenant Rule"),
                "the rule should be imported into the target environment");
        });

        test("asks for confirmation before overwriting an existing object", async () => {
            targetServer.seed("Rule", "Cross Tenant Rule", EXISTING_RULE_XML);
            const confirmMessages: string[] = [];
            const originalShowWarningMessage = vscode.window.showWarningMessage;
            const originalShowQuickPick = vscode.window.showQuickPick;
            vscode.window.showWarningMessage = (async (message: string, _options?: vscode.MessageOptions, ...items: string[]) => {
                confirmMessages.push(String(message));
                return items.includes("Overwrite") ? "Overwrite" : undefined;
            }) as typeof vscode.window.showWarningMessage;
            vscode.window.showQuickPick = (async () => ({
                label: targetTenant.name,
                description: targetTenant.url,
                picked: true,
                tenant: targetTenant
            })) as unknown as typeof vscode.window.showQuickPick;
            try {
                await objectCommands.copyObjectToTenantFromView(sourceNode);
            } finally {
                vscode.window.showWarningMessage = originalShowWarningMessage;
                vscode.window.showQuickPick = originalShowQuickPick;
            }

            assert.ok(confirmMessages.some(m => m.includes("already exists")),
                "should warn before overwriting");
            assert.ok(targetServer.has("Rule", "Cross Tenant Rule"),
                "the object should still exist after overwrite");
        });

        test("does not overwrite when the user declines confirmation", async () => {
            targetServer.seed("Rule", "Cross Tenant Rule", EXISTING_RULE_XML);
            const importsBefore = targetServer.requests.filter(r => r.method === "POST" && r.path.endsWith("/import")).length;
            const originalShowWarningMessage = vscode.window.showWarningMessage;
            const originalShowQuickPick = vscode.window.showQuickPick;
            vscode.window.showWarningMessage = async () => undefined;
            vscode.window.showQuickPick = (async () => ({
                label: targetTenant.name,
                description: targetTenant.url,
                picked: true,
                tenant: targetTenant
            })) as unknown as typeof vscode.window.showQuickPick;
            try {
                await objectCommands.copyObjectToTenantFromView(sourceNode);
            } finally {
                vscode.window.showWarningMessage = originalShowWarningMessage;
                vscode.window.showQuickPick = originalShowQuickPick;
            }
            const importsAfter = targetServer.requests.filter(r => r.method === "POST" && r.path.endsWith("/import")).length;
            assert.strictEqual(importsAfter, importsBefore,
                "declining overwrite should not trigger an import");
        });
    });

    suite("copyObjectToTenantFromDrag (mock plugin)", () => {

        let sourceServer: MockPluginServer;
        let targetServer: MockPluginServer;
        let sourceTenant: TenantInfo;
        let targetTenant: TenantInfo;
        let objectCommands: ObjectCommands;

        suiteSetup(async () => {
            sourceServer = new MockPluginServer("spadmin", "admin");
            targetServer = new MockPluginServer("spadmin", "admin");
            await sourceServer.start();
            await targetServer.start();

            sourceTenant = makeTenant(sourceServer.baseUrl, "Drag Source");
            targetTenant = makeTenant(targetServer.baseUrl, "Drag Target");
            await tenantService.add(sourceTenant);
            await tenantService.add(targetTenant);
            await tenantService.setCredentials(sourceTenant.id, { username: "spadmin", password: "admin" });
            await tenantService.setCredentials(targetTenant.id, { username: "spadmin", password: "admin" });

            sourceServer.seed("Rule", "Dragged Rule", SOURCE_RULE_XML.replace("Cross Tenant Rule", "Dragged Rule"));
            objectCommands = new ObjectCommands(tenantService, treeDataProvider);
        });

        suiteTeardown(async () => {
            await tenantService.remove(sourceTenant.id);
            await tenantService.remove(targetTenant.id);
            await sourceServer.stop();
            await targetServer.stop();
        });

        test("copies an object when dropped onto a target environment", async () => {
            const sourceNode = new ObjectTreeItem(sourceTenant,
                { objectType: "Rule", label: "Rules", icon: "code" },
                { id: "rule-id", name: "Dragged Rule" });
            const targetNode = new TenantTreeItem(targetTenant, false);

            await objectCommands.copyObjectToTenantFromDrag(sourceNode, targetNode);

            assert.ok(targetServer.has("Rule", "Dragged Rule"),
                "the dragged rule should be copied to the target environment");
        });
    });
});

/**
 * Command-layer tests for copying object names to the clipboard.
 */
suite("ObjectCommands copy-name Test Suite", () => {

    const RULE_DEFINITION = { objectType: "Rule", label: "Rules", icon: "code" };
    let objectCommands: ObjectCommands;
    let tenant: TenantInfo;

    suiteSetup(async () => {
        const api: IIQExtensionApi = await getExtensionApi();
        objectCommands = new ObjectCommands(api.tenantService, api.treeDataProvider);
        tenant = makeTenant("https://localhost:8080/identityiq", "Clipboard");
    });

    const node = (name: string) => new ObjectTreeItem(tenant, RULE_DEFINITION, { id: name, name });

    test("the copy-name command is registered at activation", async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes(COMMANDS.copyObjectName));
    });

    test("copies the name of the object to the clipboard", async () => {
        await objectCommands.copyObjectName(node("My Rule"));

        assert.strictEqual(await vscode.env.clipboard.readText(), "My Rule");
    });

    test("copies one name per line for a multiple selection", async () => {
        await objectCommands.copyObjectName(node("First Rule"), [node("First Rule"), node("Second Rule")]);

        assert.strictEqual(await vscode.env.clipboard.readText(), "First Rule\nSecond Rule");
    });
});
