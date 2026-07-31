import * as assert from "assert";
import * as os from "os";
import * as vscode from "vscode";
import { FileCommands } from "../commands/fileCommands";
import { COMMANDS } from "../constants";
import { TenantInfo } from "../models/TenantInfo";
import { TenantService } from "../services/TenantService";
import { TenantTreeItem } from "../views/IIQTreeItem";
import { MockPluginServer } from "./mockPluginServer";
import { getExtensionApi, makeTenant } from "./testHelpers";

const VIEW_IMPORT_RULE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Rule name="View Import Rule" language="beanshell">
  <Source><![CDATA[return true;]]></Source>
</Rule>`;

/**
 * UC-22 command-layer tests for local XML import entry points.
 * The REST contract itself is covered in iiqClient.test.ts.
 */
suite("FileCommands Test Suite", () => {

    let tenantService: TenantService;

    suiteSetup(async () => {
        tenantService = (await getExtensionApi()).tenantService;
    });

    test("import-file-view command is registered at activation", async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes(COMMANDS.importFileView),
            `Expected ${COMMANDS.importFileView} to be registered`);
    });

    suite("importFileFromView (mock plugin)", () => {

        let server: MockPluginServer;
        let tenant: TenantInfo;
        let fileCommands: FileCommands;
        let tempFile: vscode.Uri;

        suiteSetup(async () => {
            server = new MockPluginServer("spadmin", "admin");
            await server.start();

            tenant = makeTenant(server.baseUrl, "View Import");
            await tenantService.add(tenant);
            await tenantService.setCredentials(tenant.id, { username: "spadmin", password: "admin" });
            fileCommands = new FileCommands(tenantService);

            tempFile = vscode.Uri.joinPath(vscode.Uri.file(os.tmpdir()),
                `iiq-view-import-${Date.now()}.xml`);
            await vscode.workspace.fs.writeFile(tempFile, Buffer.from(VIEW_IMPORT_RULE_XML, "utf8"));
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

        test("UC-22: imports files chosen in the dialog into the selected environment", async () => {
            const originalShowOpenDialog = vscode.window.showOpenDialog;
            vscode.window.showOpenDialog = async () => [tempFile];
            try {
                await fileCommands.importFileFromView(new TenantTreeItem(tenant, false));
            } finally {
                vscode.window.showOpenDialog = originalShowOpenDialog;
            }

            assert.ok(server.has("Rule", "View Import Rule"),
                "the rule from the picked file should be imported into the environment");
        });

        test("UC-22: cancelling the file dialog does not import anything", async () => {
            const importsBefore = server.requests.filter(r => r.method === "POST" && r.path.endsWith("/import")).length;
            const originalShowOpenDialog = vscode.window.showOpenDialog;
            vscode.window.showOpenDialog = async () => undefined;
            try {
                await fileCommands.importFileFromView(new TenantTreeItem(tenant, false));
            } finally {
                vscode.window.showOpenDialog = originalShowOpenDialog;
            }
            const importsAfter = server.requests.filter(r => r.method === "POST" && r.path.endsWith("/import")).length;
            assert.strictEqual(importsAfter, importsBefore,
                "cancelling the dialog should not trigger any import request");
        });
    });
});
