import * as vscode from "vscode";
import { IIQClient } from "../services/IIQClient";
import { TenantInfo } from "../models/TenantInfo";
import { TenantService } from "../services/TenantService";
import { IIQ_CONFIG_FILE, buildConfigUri } from "../utils/UriUtils";
import { chooseTenant, withProgress } from "../utils/vsCodeHelpers";
import { ConfigFileTreeItem, TenantTreeItem } from "../views/IIQTreeItem";

/**
 * Download / upload / open the environment's `iiq.properties` file.
 * Saving the virtual document also writes the file and reloads it server-side.
 */
export class ConfigCommands {

    constructor(
        private readonly tenantService: TenantService,
        private readonly onConfigWritten?: (uri: vscode.Uri) => void
    ) { }

    /**
     * Downloads `iiq.properties` to a local file (does not reload anything
     * on the server).
     */
    public async downloadConfig(node?: TenantTreeItem | ConfigFileTreeItem): Promise<void> {
        const tenant = node instanceof ConfigFileTreeItem
            ? node.tenant
            : node?.tenant ?? await chooseTenant(this.tenantService, "Download iiq.properties");
        if (!tenant) {
            return;
        }
        const uri = await vscode.window.showSaveDialog({
            title: `Save iiq.properties from ${tenant.name}`,
            defaultUri: vscode.Uri.file(IIQ_CONFIG_FILE),
            filters: { "Properties": ["properties"], "All files": ["*"] }
        });
        if (!uri) {
            return;
        }
        try {
            const content = await withProgress(`Downloading iiq.properties from ${tenant.name}...`,
                () => new IIQClient(tenant, this.tenantService).getIiqProperties());
            await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Uploads a local `iiq.properties` to the environment. The server writes
     * the file and reloads it immediately.
     */
    public async uploadConfig(arg?: TenantTreeItem | ConfigFileTreeItem | vscode.Uri): Promise<void> {
        let tenant: TenantInfo | undefined;
        let source: vscode.Uri | undefined;
        if (arg instanceof TenantTreeItem || arg instanceof ConfigFileTreeItem) {
            tenant = arg.tenant;
        } else if (arg instanceof vscode.Uri && arg.scheme === "file") {
            source = arg;
        }
        tenant ??= await chooseTenant(this.tenantService, "Upload iiq.properties");
        if (!tenant) {
            return;
        }
        const target = tenant;
        if (target.readOnly) {
            vscode.window.showErrorMessage(`Environment "${target.name}" is read-only.`);
            return;
        }

        if (!source) {
            const picked = await vscode.window.showOpenDialog({
                title: `Upload iiq.properties to ${target.name}`,
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { "Properties": ["properties"], "All files": ["*"] }
            });
            if (!picked || picked.length === 0) {
                return;
            }
            source = picked[0];
        }

        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(source)).toString("utf8");
            await withProgress(`Uploading iiq.properties to ${target.name}...`,
                () => new IIQClient(target, this.tenantService).putIiqProperties(content));
            const virtualUri = buildConfigUri(target.id, target.name);
            this.onConfigWritten?.(virtualUri);
            vscode.window.showInformationMessage(
                `iiq.properties uploaded to "${target.name}" and reloaded.`);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }
}
