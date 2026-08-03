import * as assert from "assert";
import * as os from "os";
import * as vscode from "vscode";
import { ObjectCommands } from "../commands/objectCommands";
import { COMMANDS } from "../constants";
import { IIQExtensionApi } from "../extension";
import { TenantInfo } from "../models/TenantInfo";
import { TenantService } from "../services/TenantService";
import { IIQTreeDataProvider } from "../views/IIQTreeDataProvider";
import { ObjectTreeItem } from "../views/IIQTreeItem";
import { MockPluginServer } from "./mockPluginServer";
import { getExtensionApi, makeTenant } from "./testHelpers";

const ROOT_RULE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Rule name="Root Rule" language="beanshell">
  <ReferencedRules>
    <Reference class="sailpoint.object.Rule" name="Dependency Rule"/>
  </ReferencedRules>
</Rule>`;

const DEP_RULE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Rule name="Dependency Rule" language="beanshell">
  <Source><![CDATA[return true;]]></Source>
</Rule>`;

suite("ObjectCommands save-with-dependencies Test Suite", () => {

    let tenantService: TenantService;
    let treeDataProvider: IIQTreeDataProvider;

    suiteSetup(async () => {
        const api: IIQExtensionApi = await getExtensionApi();
        tenantService = api.tenantService;
        treeDataProvider = api.treeDataProvider;
    });

    test("save-with-dependencies command is registered at activation", async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes(COMMANDS.saveObjectWithDependencies));
    });

    suite("saveObjectWithDependencies (mock plugin)", () => {

        let server: MockPluginServer;
        let tenant: TenantInfo;
        let objectCommands: ObjectCommands;
        let tempFile: vscode.Uri;

        suiteSetup(async () => {
            server = new MockPluginServer("spadmin", "admin");
            await server.start();

            tenant = makeTenant(server.baseUrl, "Deps Export");
            await tenantService.add(tenant);
            await tenantService.setCredentials(tenant.id, { username: "spadmin", password: "admin" });

            server.seed("Rule", "Root Rule", ROOT_RULE_XML);
            server.seed("Rule", "Dependency Rule", DEP_RULE_XML);

            objectCommands = new ObjectCommands(tenantService, treeDataProvider);
            tempFile = vscode.Uri.joinPath(vscode.Uri.file(os.tmpdir()),
                `iiq-deps-export-${Date.now()}.xml`);
        });

        suiteTeardown(async () => {
            try {
                await vscode.workspace.fs.delete(tempFile);
            } catch {
                // already removed
            }
            await tenantService.remove(tenant.id);
            await server.stop();
        });

        test("exports the root object and its dependencies into a single bundle", async () => {
            const originalShowSaveDialog = vscode.window.showSaveDialog;
            vscode.window.showSaveDialog = async () => tempFile;
            const originalShowTextDocument = vscode.window.showTextDocument;
            vscode.window.showTextDocument = async () => ({}) as vscode.TextEditor;
            try {
                await objectCommands.saveObjectWithDependencies(new ObjectTreeItem(tenant,
                    { objectType: "Rule", label: "Rules", icon: "code" },
                    { id: "root-id", name: "Root Rule" }));
            } finally {
                vscode.window.showSaveDialog = originalShowSaveDialog;
                vscode.window.showTextDocument = originalShowTextDocument;
            }

            const content = Buffer.from(await vscode.workspace.fs.readFile(tempFile)).toString("utf8");
            assert.ok(content.includes('name="Root Rule"'), "bundle should contain the root object");
            assert.ok(content.includes('name="Dependency Rule"'), "bundle should contain the dependency");
            assert.ok(content.includes("<sailpoint>"), "output should be a sailpoint bundle");
        });
    });
});
