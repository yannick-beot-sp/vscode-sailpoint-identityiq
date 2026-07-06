import * as vscode from "vscode";
import { ALL_OBJECT_TYPES, getOrCreateObjectTypeDefinition, ObjectSummary, ObjectTypeDefinition } from "../models/ObjectTypes";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { getXmlCleaningOptions } from "../utils/configurationUtils";
import { normalizeAsFilename } from "../utils/stringUtils";
import { buildResourceUri } from "../utils/UriUtils";
import { confirm, withProgress } from "../utils/vsCodeHelpers";
import { buildSailpointBundle, cleanXml } from "../utils/xmlUtils";
import { IIQTreeDataProvider } from "../views/IIQTreeDataProvider";
import { ObjectTreeItem, TenantTreeItem } from "../views/IIQTreeItem";
import { QuickPickObjectStep } from "../wizard/quickPickObjectStep";
import { QuickPickObjectTypeStep } from "../wizard/quickPickObjectTypeStep";
import { QuickPickTenantStep } from "../wizard/quickPickTenantStep";
import { runWizard } from "../wizard/wizard";
import { WizardContext } from "../wizard/wizardContext";
import { IWizardOptions } from "../wizard/wizardOptions";

/** Prefix of the context properties storing the objects picked for each type */
const OBJECTS_PREFIX = "objects:";

/**
 * Object type step that spawns one object-selection step per picked type.
 * Used by the export wizard.
 */
class ExportObjectTypeStep extends QuickPickObjectTypeStep {
    constructor(private readonly tenantService: TenantService) {
        super({ canPickMany: true });
    }

    public override async getSubWizard(wizardContext: WizardContext): Promise<IWizardOptions<WizardContext> | undefined> {
        const objectTypes = wizardContext.objectTypes as ObjectTypeDefinition[];
        if (!objectTypes || objectTypes.length === 0) {
            return undefined;
        }
        return {
            promptSteps: objectTypes.map(definition => new QuickPickObjectStep({
                tenantService: this.tenantService,
                name: OBJECTS_PREFIX + definition.objectType,
                canPickMany: true,
                getObjectType: () => definition
            }))
        };
    }
}

interface ExportedObject {
    definition: ObjectTypeDefinition;
    object: ObjectSummary;
}

/**
 * Commands working on IdentityIQ objects: open in the editor, export to
 * files, save a single object from the tree view, delete an object.
 */
export class ObjectCommands {

    constructor(
        private readonly tenantService: TenantService,
        private readonly treeDataProvider: IIQTreeDataProvider) { }

    /**
     * Opens an object in the editor through the virtual file system:
     * environment (active preselected) -> object type -> object.
     * Offers every object type supported by the plugin (ALL_OBJECT_TYPES,
     * mirror of ClassLists.MajorClasses).
     */
    public async openObject(node?: TenantTreeItem): Promise<void> {
        const definitions = ALL_OBJECT_TYPES
            .map(getOrCreateObjectTypeDefinition)
            .map(definition => ({ ...definition, excludeTypes: undefined }))
            .sort((a, b) => a.objectType.localeCompare(b.objectType));
        await this.openObjectWizard(node, "Open an IdentityIQ object", definitions);
    }

    private async openObjectWizard(node: TenantTreeItem | undefined, title: string,
        objectTypes?: ObjectTypeDefinition[]): Promise<void> {
        const context: WizardContext = {};
        if (node instanceof TenantTreeItem) {
            context.tenant = node.tenant;
        }
        const result = await runWizard({
            title,
            promptSteps: [
                new QuickPickTenantStep({ tenantService: this.tenantService }),
                new QuickPickObjectTypeStep({ objectTypes }),
                new QuickPickObjectStep({
                    tenantService: this.tenantService,
                    getObjectType: (c) => c.objectType as ObjectTypeDefinition
                })
            ]
        }, context);
        if (!result) {
            return;
        }
        const tenant = result.tenant as TenantInfo;
        const definition = result.objectType as ObjectTypeDefinition;
        const object = result.object as ObjectSummary;
        const uri = buildResourceUri({
            tenantId: tenant.id,
            tenantName: tenant.name,
            objectType: definition.objectType,
            objectName: object.name
        });
        await vscode.window.showTextDocument(uri, { preview: true });
    }

    /**
     * Exports one or several objects to XML file(s):
     * environment -> object types (multi) -> objects (multi, per type)
     * -> single file or one file per object -> destination.
     */
    public async exportObjects(node?: TenantTreeItem): Promise<void> {
        const context: WizardContext = {};
        if (node instanceof TenantTreeItem) {
            context.tenant = node.tenant;
        }
        const result = await runWizard({
            title: "Export IdentityIQ objects",
            promptSteps: [
                new QuickPickTenantStep({ tenantService: this.tenantService }),
                new ExportObjectTypeStep(this.tenantService)
            ]
        }, context);
        if (!result) {
            return;
        }
        const tenant = result.tenant as TenantInfo;
        const selection: ExportedObject[] = [];
        for (const definition of result.objectTypes as ObjectTypeDefinition[]) {
            const objects = (result[OBJECTS_PREFIX + definition.objectType] ?? []) as ObjectSummary[];
            selection.push(...objects.map(object => ({ definition, object })));
        }
        if (selection.length === 0) {
            vscode.window.showWarningMessage("No object selected.");
            return;
        }

        // Single object: straight to a save dialog
        if (selection.length === 1) {
            await this.exportToSingleFile(tenant, selection);
            return;
        }

        // Several objects: single file or one file per object?
        const mode = await vscode.window.showQuickPick([
            { label: "One file per object", description: "Choose a target folder", id: "multiple" },
            { label: "Single file", description: "All objects in one <sailpoint> file", id: "single" }
        ], { title: "Export IdentityIQ objects", placeHolder: "How should the objects be exported?", ignoreFocusOut: true });
        if (!mode) {
            return;
        }
        if (mode.id === "single") {
            await this.exportToSingleFile(tenant, selection);
        } else {
            await this.exportToMultipleFiles(tenant, selection);
        }
    }

    /** Saves a single object from the tree view to a local file */
    public async saveObject(node: ObjectTreeItem): Promise<void> {
        await this.exportToSingleFile(node.tenant, [{ definition: node.definition, object: node.object }]);
    }

    /** Deletes an object from the tree view, after confirmation */
    public async deleteObject(node: ObjectTreeItem): Promise<void> {
        if (!await confirm(
            `Are you sure you want to delete the ${node.definition.objectType} "${node.object.name}" from "${node.tenant.name}"?`,
            "Delete")) {
            return;
        }
        try {
            const client = new IIQClient(node.tenant, this.tenantService);
            await withProgress(`Deleting ${node.object.name}...`,
                () => client.deleteObject(node.definition.objectType, node.object.name));
            vscode.window.showInformationMessage(`${node.definition.objectType} "${node.object.name}" deleted.`);
            this.treeDataProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    private async exportToSingleFile(tenant: TenantInfo, selection: ExportedObject[]): Promise<void> {
        const defaultName = selection.length === 1
            ? `${normalizeAsFilename(selection[0].object.name)}.xml`
            : "export.xml";
        const target = await vscode.window.showSaveDialog({
            title: "Export IdentityIQ objects",
            defaultUri: this.getDefaultUri(defaultName),
            filters: { "XML files": ["xml"] }
        });
        if (!target) {
            return;
        }
        try {
            const content = await withProgress(`Exporting from ${tenant.name}...`, async () => {
                const xmls = await this.fetchCleanedXmls(tenant, selection);
                return selection.length === 1 ? xmls[0] : buildSailpointBundle(xmls);
            });
            await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
            // A single file export is opened in the editor
            await vscode.window.showTextDocument(target, { preview: false });
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    private async exportToMultipleFiles(tenant: TenantInfo, selection: ExportedObject[]): Promise<void> {
        const folders = await vscode.window.showOpenDialog({
            title: "Choose the export folder",
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Export here",
            defaultUri: this.getDefaultUri()
        });
        if (!folders || folders.length === 0) {
            return;
        }
        const folder = folders[0];
        try {
            await withProgress(`Exporting ${selection.length} objects from ${tenant.name}...`, async () => {
                const xmls = await this.fetchCleanedXmls(tenant, selection);
                for (let i = 0; i < selection.length; i++) {
                    const { definition, object } = selection[i];
                    // One sub-folder per object type
                    const fileUri = vscode.Uri.joinPath(folder,
                        definition.objectType,
                        `${normalizeAsFilename(object.name)}.xml`);
                    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(xmls[i], "utf8"));
                }
            });
            vscode.window.showInformationMessage(
                `${selection.length} objects exported to ${folder.fsPath}.`);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    private async fetchCleanedXmls(tenant: TenantInfo, selection: ExportedObject[]): Promise<string[]> {
        const client = new IIQClient(tenant, this.tenantService);
        const cleaningOptions = getXmlCleaningOptions();
        const xmls: string[] = [];
        for (const { definition, object } of selection) {
            const xml = await client.getObject(definition.objectType, object.name);
            xmls.push(cleanXml(xml, cleaningOptions));
        }
        return xmls;
    }

    private getDefaultUri(fileName?: string): vscode.Uri | undefined {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }
        return fileName ? vscode.Uri.joinPath(workspaceFolder.uri, fileName) : workspaceFolder.uri;
    }
}
