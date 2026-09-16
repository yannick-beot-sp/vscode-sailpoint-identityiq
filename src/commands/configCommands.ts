import * as vscode from "vscode";
import { IIQClient } from "../services/IIQClient";
import { TenantInfo } from "../models/TenantInfo";
import { TenantService } from "../services/TenantService";
import { buildConfigUri } from "../utils/UriUtils";
import { chooseTenant, withProgress } from "../utils/vsCodeHelpers";
import { Log4jConfigTreeItem, TenantTreeItem } from "../views/IIQTreeItem";

/**
 * Open / download / upload the environment's Log4j2 configuration file.
 * Saving the virtual document also writes the file and reconfigures the
 * live logger context server-side.
 */
export class ConfigCommands {

    constructor(
        private readonly tenantService: TenantService,
        private readonly onConfigWritten?: (uri: vscode.Uri) => void
    ) { }

    /**
     * Opens the Log4j2 configuration through the virtual file system. The
     * file name comes from the server (log4j2.properties, log4j2.xml...)
     * so the editor tab and its syntax highlighting match the real file.
     */
    public async openLog4jConfig(node?: TenantTreeItem | Log4jConfigTreeItem): Promise<void> {
        const tenant = node?.tenant ?? await chooseTenant(this.tenantService, "Open the Log4j2 configuration");
        if (!tenant) {
            return;
        }
        try {
            const metadata = await withProgress(`Opening the Log4j2 configuration of ${tenant.name}...`,
                () => new IIQClient(tenant, this.tenantService).getLog4jConfigMetadata());
            if (!metadata) {
                vscode.window.showErrorMessage(
                    `No Log4j2 configuration file is exposed by "${tenant.name}".`);
                return;
            }
            await vscode.window.showTextDocument(
                await vscode.workspace.openTextDocument(
                    buildConfigUri(tenant.id, tenant.name, metadata.fileName)));
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Downloads the Log4j2 configuration to a local file (does not change
     * anything on the server).
     */
    public async downloadLog4jConfig(node?: TenantTreeItem | Log4jConfigTreeItem): Promise<void> {
        const tenant = node?.tenant
            ?? await chooseTenant(this.tenantService, "Download the Log4j2 configuration");
        if (!tenant) {
            return;
        }
        try {
            const config = await withProgress(`Downloading the Log4j2 configuration of ${tenant.name}...`,
                () => new IIQClient(tenant, this.tenantService).getLog4jConfig());
            const uri = await vscode.window.showSaveDialog({
                title: `Save ${config.fileName} from ${tenant.name}`,
                defaultUri: vscode.Uri.file(config.fileName),
                filters: { "Log4j2 configuration": ["properties", "xml", "yaml", "yml", "json"], "All files": ["*"] }
            });
            if (!uri) {
                return;
            }
            await vscode.workspace.fs.writeFile(uri, Buffer.from(config.content, "utf8"));
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Uploads a local Log4j2 configuration to the environment. The server
     * writes the file and reconfigures logging immediately.
     */
    public async uploadLog4jConfig(arg?: TenantTreeItem | Log4jConfigTreeItem | vscode.Uri): Promise<void> {
        let tenant: TenantInfo | undefined;
        let source: vscode.Uri | undefined;
        if (arg instanceof TenantTreeItem || arg instanceof Log4jConfigTreeItem) {
            tenant = arg.tenant;
        } else if (arg instanceof vscode.Uri && arg.scheme === "file") {
            source = arg;
        }
        tenant ??= await chooseTenant(this.tenantService, "Upload a Log4j2 configuration");
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
                title: `Upload a Log4j2 configuration to ${target.name}`,
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { "Log4j2 configuration": ["properties", "xml", "yaml", "yml", "json"], "All files": ["*"] }
            });
            if (!picked || picked.length === 0) {
                return;
            }
            source = picked[0];
        }

        try {
            const content = Buffer.from(await vscode.workspace.fs.readFile(source)).toString("utf8");
            const written = await withProgress(`Uploading the Log4j2 configuration to ${target.name}...`,
                () => new IIQClient(target, this.tenantService).putLog4jConfig(content));
            this.onConfigWritten?.(buildConfigUri(target.id, target.name, written.fileName));
            vscode.window.showInformationMessage(
                `Log4j2 configuration uploaded to "${target.name}"; logging was reconfigured.`);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }
}
