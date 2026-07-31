import * as vscode from "vscode";
import { URI_SCHEME } from "../constants";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { getXmlCleaningOptions } from "../utils/configurationUtils";
import { buildDiffResourceUri } from "../utils/UriUtils";
import { chooseTenant, withProgress } from "../utils/vsCodeHelpers";
import { cleanXml, getObjectInfoFromXml } from "../utils/xmlUtils";
import { TenantTreeItem } from "../views/IIQTreeItem";

/**
 * Commands working on local XML files: import into an environment, refresh
 * from an environment, compare with the environment version.
 */
export class FileCommands {

    constructor(private readonly tenantService: TenantService) { }

    /**
     * Imports XML file(s) into an environment.
     * Entry points:
     * - command palette / editor context menu: imports the active file
     * - environment context menu in the tree view: shows a file picker
     */
    public async importFile(arg?: vscode.Uri): Promise<void> {
        let tenant: TenantInfo | undefined;
        let uris: vscode.Uri[] = [arg];

        tenant ??= this.tenantService.getActiveTenant()
            ?? await chooseTenant(this.tenantService, "Import file(s)");
        if (!tenant) {
            return;
        }
        await this.doImport(tenant, uris);
    }

    /**
     * Imports XML file(s) into an environment.
     * Entry points: environment context menu in the tree view: shows a file picker
     */
    public async importFileFromView(arg: TenantTreeItem): Promise<void> {
        let tenant: TenantInfo = arg.tenant;
        let uris: vscode.Uri[] | undefined = await vscode.window.showOpenDialog({
            title: "Choose the XML file(s) to import",
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            filters: { "XML files": ["xml"] }
        });
        if (!uris || uris.length === 0) {
            return;
        }

        await this.doImport(tenant, uris);
    }

    /**
     * Imports XML file(s) and/or folder(s) from the file explorer.
     * Folders are scanned recursively for XML files.
     */
    public async importFileFromExplorer(uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
        const selection = uris && uris.length > 0 ? uris : (uri ? [uri] : []);
        if (selection.length === 0) {
            return;
        }
        const files = await withProgress("Collecting XML files...",
            () => this.collectXmlFiles(selection));
        if (files.length === 0) {
            vscode.window.showWarningMessage("No XML file found in the selection.");
            return;
        }
        const tenant = await chooseTenant(this.tenantService, `Import ${files.length} file(s)`);
        if (!tenant) {
            return;
        }
        await this.doImport(tenant, files);
    }

    /**
     * Refreshes a local XML file with the current version of the object in
     * the environment. The file content is replaced in the editor (not saved).
     */
    public async refreshFile(uri?: vscode.Uri): Promise<void> {
        const editor = await this.getXmlEditor(uri);
        if (!editor) {
            return;
        }
        if (editor.document.uri.scheme === URI_SCHEME) {
            // Virtual document: simply re-read it from the environment
            await vscode.commands.executeCommand("workbench.action.files.revert");
            return;
        }
        const objectInfo = getObjectInfoFromXml(editor.document.getText());
        if (!objectInfo) {
            vscode.window.showErrorMessage("Could not identify the IdentityIQ object (type and name) in this file.");
            return;
        }
        const tenant = this.tenantService.getActiveTenant()
            ?? await chooseTenant(this.tenantService, "Refresh file");
        if (!tenant) {
            return;
        }
        try {
            const xml = await withProgress(
                `Getting ${objectInfo.objectType} "${objectInfo.name}" from ${tenant.name}...`,
                () => new IIQClient(tenant, this.tenantService)
                    .getObjectIfExists(objectInfo.objectType, objectInfo.name));
            if (xml === undefined) {
                vscode.window.showWarningMessage(
                    `${objectInfo.objectType} "${objectInfo.name}" was not found on "${tenant.name}".`);
                return;
            }
            const cleaned = cleanXml(xml, getXmlCleaningOptions());
            const fullRange = new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(editor.document.getText().length));
            await editor.edit(editBuilder => editBuilder.replace(fullRange, cleaned));
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Compares a local XML file with its representation in an environment,
     * in a diff view (remote version on the left, local file on the right).
     */
    public async compareFile(uri?: vscode.Uri): Promise<void> {
        const editor = await this.getXmlEditor(uri);
        if (!editor) {
            return;
        }
        const objectInfo = getObjectInfoFromXml(editor.document.getText());
        if (!objectInfo) {
            vscode.window.showErrorMessage("Could not identify the IdentityIQ object (type and name) in this file.");
            return;
        }
        const tenant = this.tenantService.getActiveTenant()
            ?? await chooseTenant(this.tenantService, "Compare file");
        if (!tenant) {
            return;
        }
        const remoteUri = buildDiffResourceUri({
            tenantId: tenant.id,
            tenantName: tenant.name,
            objectType: objectInfo.objectType,
            objectId: objectInfo.name,
            objectName: objectInfo.name
        });
        await vscode.commands.executeCommand("vscode.diff",
            remoteUri,
            editor.document.uri,
            `${objectInfo.name} (${tenant.name}) ↔ ${objectInfo.name} (local)`);
    }

    private async doImport(tenant: TenantInfo, uris: vscode.Uri[]): Promise<void> {
        const client = new IIQClient(tenant, this.tenantService);
        const errors: string[] = [];
        let success = 0;

        await withProgress(`Importing into ${tenant.name}...`, async () => {
            for (const uri of uris) {
                try {
                    const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
                    const result = await client.importXml(content);
                    if (result.errors && result.errors.length > 0) {
                        errors.push(`${uri.fsPath}: ${result.errors.join(", ")}`);
                    } else {
                        success++;
                    }
                } catch (error) {
                    errors.push(`${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        });

        // Summary of the import: number of files in success and in error
        if (errors.length === 0) {
            vscode.window.showInformationMessage(
                `Import into "${tenant.name}" completed: ${success} file(s) imported successfully.`);
        } else {
            const detail = errors.join("\n");
            vscode.window.showWarningMessage(
                `Import into "${tenant.name}" completed: ${success} file(s) imported successfully, ${errors.length} file(s) in error.`,
                "Show details"
            ).then(action => {
                if (action === "Show details") {
                    vscode.workspace.openTextDocument({ content: detail, language: "text" })
                        .then(doc => vscode.window.showTextDocument(doc));
                }
            });
        }
    }

    /** Recursively collects the XML files of the given files/folders */
    private async collectXmlFiles(uris: vscode.Uri[]): Promise<vscode.Uri[]> {
        const files: vscode.Uri[] = [];
        for (const uri of uris) {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type === vscode.FileType.Directory) {
                const entries = await vscode.workspace.fs.readDirectory(uri);
                const children = entries.map(([name]) => vscode.Uri.joinPath(uri, name));
                files.push(...await this.collectXmlFiles(children));
            } else if (stat.type === vscode.FileType.File && uri.path.toLowerCase().endsWith(".xml")) {
                files.push(uri);
            }
        }
        return files;
    }

    private async getXmlEditor(uri?: vscode.Uri): Promise<vscode.TextEditor | undefined> {
        if (uri) {
            return await vscode.window.showTextDocument(uri);
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.uri.path.toLowerCase().endsWith(".xml")) {
            vscode.window.showWarningMessage("Please open an IdentityIQ XML file first.");
            return undefined;
        }
        return editor;
    }
}
