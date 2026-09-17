import * as vscode from "vscode";
import { getAllObjectTypeDefinitions, ObjectSummary, ObjectTypeDefinition } from "../models/ObjectTypes";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient } from "../services/IIQClient";
import { PathProposer, pathToUri } from "../services/PathProposer";
import { TenantService } from "../services/TenantService";
import { getXmlCleaningOptions } from "../utils/configurationUtils";
import { extractObjectReferences, ObjectReference, referenceKey } from "../utils/dependencyUtils";
import { isEmpty } from "../utils/stringUtils";
import { buildObjectUiUrl } from "../utils/iiqUiUrls";
import { buildResourceUri } from "../utils/UriUtils";
import { confirm, chooseTenant, withProgress } from "../utils/vsCodeHelpers";
import { buildSailpointBundle, cleanXml, renameXmlObject } from "../utils/xmlUtils";
import { IIQTreeDataProvider } from "../views/IIQTreeDataProvider";
import { ObjectTreeItem, ObjectTypeTreeItem, TenantTreeItem } from "../views/IIQTreeItem";
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
        super({ canPickMany: true, objectTypes: getAllObjectTypeDefinitions() });
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

/** Parameters for copying an object from one environment to another */
interface CopyObjectParams {
    sourceTenant: TenantInfo;
    targetTenant: TenantInfo;
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
        await this.openObjectWizard(node, "Open an IdentityIQ object", getAllObjectTypeDefinitions());
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
            objectId: object.id,
            objectName: object.name
        });
        await vscode.window.showTextDocument(uri, { preview: true });
    }

    /**
     * Exports one or several objects to XML file(s):
     * environment -> object types (multi) -> objects (multi, per type)
     * -> single file or one file per object -> destination.
     * Invoked from an object type node, the environment and the object type
     * are preselected so the wizard starts directly on object selection.
     */
    public async exportObjects(node?: TenantTreeItem | ObjectTypeTreeItem): Promise<void> {
        const context: WizardContext = {};
        if (node instanceof ObjectTypeTreeItem) {
            context.tenant = node.tenant;
            context.objectTypes = [node.definition];
        } else if (node instanceof TenantTreeItem) {
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

    /**
     * Exports a single object from the tree view to a local file.
     * Tenant and object are taken from the leaf; the XML is cleaned
     * (ids removed by default) before the save dialog.
     */
    public async saveObject(node: ObjectTreeItem): Promise<void> {
        await this.exportToSingleFile(node.tenant, [{ definition: node.definition, object: node.object }]);
    }

    /**
     * Saves an object and its dependencies recursively to a single XML bundle.
     * The destination file is chosen before any export request is sent.
     */
    public async saveObjectWithDependencies(node: ObjectTreeItem): Promise<void> {
        const target = await vscode.window.showSaveDialog({
            title: "Save object with dependencies",
            defaultUri: pathToUri(PathProposer.getWithDependenciesFilename(
                node.tenant.name, node.definition.objectType, node.object.name)),
            filters: { "XML files": ["xml"] }
        });
        if (!target) {
            return;
        }

        try {
            const { xmls, missing } = await withProgress(
                `Collecting dependencies for ${node.object.name}...`,
                () => this.fetchWithDependencies(node.tenant, node.definition.objectType, node.object.name));

            if (missing.length > 0) {
                const detail = missing.map(ref => `${ref.objectType} "${ref.name}"`).join("\n");
                const action = await vscode.window.showWarningMessage(
                    `${missing.length} dependent object(s) could not be found and were skipped.`,
                    "Show details");
                if (action === "Show details") {
                    await vscode.workspace.openTextDocument({ content: detail, language: "text" })
                        .then(doc => vscode.window.showTextDocument(doc));
                }
            }

            const content = buildSailpointBundle(xmls);
            await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
            await vscode.window.showTextDocument(target, { preview: false });
            vscode.window.showInformationMessage(
                `Saved ${node.definition.objectType} "${node.object.name}" with ${xmls.length - 1} dependent object(s).`);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Clones an object under a new name: environment -> object type -> object
     * (skipped when invoked from an object node in the tree view) -> new name.
     * The object's XML is fetched, cleaned like an export (ids, timestamps...
     * removed) and renamed, then re-imported as a brand new object.
     */
    public async cloneObject(node?: ObjectTreeItem): Promise<void> {
        let tenant: TenantInfo;
        let definition: ObjectTypeDefinition;
        let object: ObjectSummary;

        if (node instanceof ObjectTreeItem) {
            tenant = node.tenant;
            definition = node.definition;
            object = node.object;
        } else {
            const result = await runWizard({
                title: "Clone an IdentityIQ object",
                promptSteps: [
                    new QuickPickTenantStep({ tenantService: this.tenantService }),
                    new QuickPickObjectTypeStep({ objectTypes: getAllObjectTypeDefinitions() }),
                    new QuickPickObjectStep({
                        tenantService: this.tenantService,
                        getObjectType: (c) => c.objectType as ObjectTypeDefinition
                    })
                ]
            }, {});
            if (!result) {
                return;
            }
            tenant = result.tenant as TenantInfo;
            definition = result.objectType as ObjectTypeDefinition;
            object = result.object as ObjectSummary;
        }

        const newName = await vscode.window.showInputBox({
            title: "Clone an IdentityIQ object",
            prompt: `Enter the name of the new ${definition.objectType}`,
            value: `${object.name} - Copy`,
            ignoreFocusOut: true,
            validateInput: (value) => isEmpty(value) ? "The name cannot be empty" : ""
        });
        if (newName === undefined) {
            return;
        }
        const clonedName = newName.trim();

        try {
            const client = new IIQClient(tenant, this.tenantService);
            await withProgress(`Cloning ${object.name}...`, async () => {
                const xml = await client.getObject(definition.objectType, object.name);
                const cleaned = cleanXml(xml, getXmlCleaningOptions());
                const cloned = renameXmlObject(cleaned, clonedName);
                await client.importXml(cloned);
            });
            vscode.window.showInformationMessage(
                `${definition.objectType} "${clonedName}" created from "${object.name}".`);
            if (node instanceof ObjectTreeItem) {
                this.treeDataProvider.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Copies an object to another environment.
     * Entry point: command palette — source environment, object type, object,
     * then target environment.
     */
    public async copyObjectToTenant(): Promise<void> {
        const result = await runWizard({
            title: "Copy an IdentityIQ object to another environment",
            promptSteps: [
                new QuickPickTenantStep({ tenantService: this.tenantService, name: "sourceTenant" }),
                new QuickPickObjectTypeStep({ objectTypes: getAllObjectTypeDefinitions() }),
                new QuickPickObjectStep({
                    tenantService: this.tenantService,
                    getTenant: (c) => c.sourceTenant as TenantInfo,
                    getObjectType: (c) => c.objectType as ObjectTypeDefinition
                }),
                new QuickPickTenantStep({
                    tenantService: this.tenantService,
                    name: "targetTenant",
                    skipIfOne: false,
                    excludeTenantIds: (c) => [(c.sourceTenant as TenantInfo).id]
                })
            ]
        }, {});
        if (!result) {
            return;
        }
        await this.doCopyObjectToTenant({
            sourceTenant: result.sourceTenant as TenantInfo,
            targetTenant: result.targetTenant as TenantInfo,
            definition: result.objectType as ObjectTypeDefinition,
            object: result.object as ObjectSummary
        });
    }

    /**
     * Copies an object to another environment.
     * Entry point: object context menu — the source object is known,
     * the user picks the target environment.
     */
    public async copyObjectToTenantFromView(node: ObjectTreeItem): Promise<void> {
        const targetTenant = await chooseTenant(this.tenantService,
            `Copy ${node.definition.objectType} "${node.object.name}" to...`,
            { excludeTenantIds: [node.tenant.id] });
        if (!targetTenant) {
            return;
        }
        await this.doCopyObjectToTenant({
            sourceTenant: node.tenant,
            targetTenant,
            definition: node.definition,
            object: node.object
        });
    }

    /**
     * Copies an object to another environment.
     * Entry point: drag-and-drop — source object and target environment
     * are both known from the tree interaction.
     */
    public async copyObjectToTenantFromDrag(source: ObjectTreeItem, target: TenantTreeItem): Promise<void> {
        await this.doCopyObjectToTenant({
            sourceTenant: source.tenant,
            targetTenant: target.tenant,
            definition: source.definition,
            object: source.object
        });
    }

    /**
     * Copies the name of the selected object(s) to the clipboard.
     * With a multiple selection, the names are copied one per line.
     */
    public async copyObjectName(node: ObjectTreeItem, selection?: ObjectTreeItem[]): Promise<void> {
        const nodes = selection?.length ? selection : (node ? [node] : []);
        const names = nodes.map(item => item.object.name);
        if (names.length === 0) {
            return;
        }
        await vscode.env.clipboard.writeText(names.join("\n"));
        vscode.window.setStatusBarMessage(names.length === 1
            ? `Copied "${names[0]}" to the clipboard.`
            : `Copied ${names.length} names to the clipboard.`, 3000);
    }

    /**
     * Opens the selected object in the IdentityIQ desktop UI (system browser).
     * Types without a deep-linkable page are rejected with a warning.
     */
    public async openObjectInUi(node: ObjectTreeItem): Promise<void> {
        if (!(node instanceof ObjectTreeItem)) {
            return;
        }
        const url = buildObjectUiUrl(node.tenant.url, node.definition.objectType, node.object.id);
        if (!url) {
            vscode.window.showWarningMessage(
                `IdentityIQ has no direct page for ${node.definition.objectType} objects.`);
            return;
        }
        await vscode.env.openExternal(vscode.Uri.parse(url));
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
        const proposed = selection.length === 1
            ? PathProposer.getSingleResourceFilename(
                tenant.name, selection[0].definition.objectType, selection[0].object.name)
            : PathProposer.getSingleFileFilename(tenant.name);
        const target = await vscode.window.showSaveDialog({
            title: "Export IdentityIQ objects",
            defaultUri: pathToUri(proposed),
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
            defaultUri: pathToUri(PathProposer.getMultipleFilesFolder(tenant.name))
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
                    const relative = PathProposer.getMultipleFilesFilename(
                        tenant.name, definition.objectType, object.name);
                    const segments = relative.split(/[/\\]+/).filter(part => part.length > 0);
                    const fileUri = vscode.Uri.joinPath(folder, ...segments);
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

    /**
     * Fetches an object and all its exportable dependencies recursively.
     * Returns cleaned XML fragments in discovery order (root first).
     */
    private async fetchWithDependencies(tenant: TenantInfo, rootObjectType: string, rootName: string)
        : Promise<{ xmls: string[]; missing: ObjectReference[] }> {
        const client = new IIQClient(tenant, this.tenantService);
        const cleaningOptions = getXmlCleaningOptions();
        const visited = new Set<string>();
        const queue: ObjectReference[] = [{ objectType: rootObjectType, name: rootName }];
        const xmls: string[] = [];
        const missing: ObjectReference[] = [];

        while (queue.length > 0) {
            const ref = queue.shift()!;
            const key = referenceKey(ref);
            if (visited.has(key)) {
                continue;
            }
            visited.add(key);

            const xml = await client.getObjectIfExists(ref.objectType, ref.name);
            if (xml === undefined) {
                if (ref.objectType === rootObjectType && ref.name === rootName) {
                    throw new Error(`${ref.objectType} "${ref.name}" was not found on "${tenant.name}".`);
                }
                missing.push(ref);
                continue;
            }

            const cleaned = cleanXml(xml, cleaningOptions);
            xmls.push(cleaned);

            for (const dependency of extractObjectReferences(cleaned)) {
                if (!visited.has(referenceKey(dependency))) {
                    queue.push(dependency);
                }
            }
        }

        return { xmls, missing };
    }

    /**
     * Shared implementation for copying an object between environments:
     * fetch from source, clean like an export, import into target.
     * Asks for confirmation before overwriting an existing object with the same name.
     */
    private async doCopyObjectToTenant(params: CopyObjectParams): Promise<void> {
        const { sourceTenant, targetTenant, definition, object } = params;

        if (sourceTenant.id === targetTenant.id) {
            vscode.window.showWarningMessage("Source and target environment are the same.");
            return;
        }

        const targetClient = new IIQClient(targetTenant, this.tenantService);
        const existing = await targetClient.getObjectIfExists(definition.objectType, object.name);
        if (existing !== undefined) {
            if (!await confirm(
                `A ${definition.label} named "${object.name}" already exists in "${targetTenant.name}". Overwrite it?`,
                "Overwrite")) {
                return;
            }
        }

        try {
            const sourceClient = new IIQClient(sourceTenant, this.tenantService);
            await withProgress(
                `Copying ${definition.objectType} "${object.name}" to ${targetTenant.name}...`,
                async () => {
                    const xml = await sourceClient.getObject(definition.objectType, object.name);
                    const cleaned = cleanXml(xml, getXmlCleaningOptions());
                    const result = await targetClient.importXml(cleaned);
                    if (result.errors.length > 0) {
                        throw new Error(result.errors.join(", "));
                    }
                });
            vscode.window.showInformationMessage(
                `${definition.objectType} "${object.name}" copied from "${sourceTenant.name}" to "${targetTenant.name}".`);
            this.treeDataProvider.refresh();
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }
}
