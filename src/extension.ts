import * as vscode from "vscode";
import { registerBeanshellLanguageSupport } from "./beanshell";
import { ApplicationCommands } from "./commands/applicationCommands";
import { FileCommands } from "./commands/fileCommands";
import { FolderCommands } from "./commands/folderCommands";
import { LogCommands } from "./commands/logCommands";
import { LoggingCommands } from "./commands/loggingCommands";
import { ObjectCommands } from "./commands/objectCommands";
import { RuleCommands } from "./commands/ruleCommands";
import { TaskCommands } from "./commands/taskCommands";
import { TenantCommands } from "./commands/tenantCommands";
import { COMMANDS, DIFF_SCHEME, URI_SCHEME, VIEW_ID } from "./constants";
import { IIQRemoteContentProvider, IIQResourceProvider } from "./files/IIQResourceProvider";
import { registerIdentityIqMcp } from "./mcp/register";
import { EnvironmentStatusBar } from "./services/EnvironmentStatusBar";
import { TenantService } from "./services/TenantService";
import { IIQTreeDataProvider, IIQTreeDragAndDropController } from "./views/IIQTreeDataProvider";
import { ObjectTypeTreeItem } from "./views/IIQTreeItem";
import { registerWorkflowPreview } from "./workflow";
import { registerXmlCompletionSupport } from "./xml";

/**
 * Public API returned by {@link activate}.
 * Used by the integration tests to access the services of the running extension.
 */
export interface IIQExtensionApi {
    tenantService: TenantService;
    treeDataProvider: IIQTreeDataProvider;
    resourceProvider: IIQResourceProvider;
}

export async function activate(context: vscode.ExtensionContext): Promise<IIQExtensionApi> {
    console.log("Activating extension vscode-sailpoint-identityiq");

    // Services
    const tenantService = new TenantService(context.globalState, context.secrets);
    const statusBar = new EnvironmentStatusBar(tenantService);

    // Tree view
    const treeDataProvider = new IIQTreeDataProvider(tenantService);
    const objectCommands = new ObjectCommands(tenantService, treeDataProvider);
    const treeView = vscode.window.createTreeView(VIEW_ID, {
        treeDataProvider,
        canSelectMany: true,
        dragAndDropController: new IIQTreeDragAndDropController(
            tenantService,
            (source, target) => objectCommands.copyObjectToTenantFromDrag(source, target))
    });

    // Virtual file system (live edit of IdentityIQ objects) and diff content
    const resourceProvider = new IIQResourceProvider(tenantService);
    const remoteContentProvider = new IIQRemoteContentProvider(tenantService);

    // Commands
    const tenantCommands = new TenantCommands(tenantService);
    const folderCommands = new FolderCommands(tenantService);
    const fileCommands = new FileCommands(tenantService);
    const ruleCommands = new RuleCommands(tenantService);
    const taskCommands = new TaskCommands(tenantService);
    const applicationCommands = new ApplicationCommands(tenantService);
    const logCommands = new LogCommands(tenantService);
    const loggingCommands = new LoggingCommands(tenantService);

    context.subscriptions.push(
        statusBar,
        ruleCommands,
        logCommands,
        treeView,
        vscode.workspace.registerFileSystemProvider(URI_SCHEME, resourceProvider, { isCaseSensitive: true }),
        vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, remoteContentProvider),

        // BeanShell language assistance (completion, hover, signature help)
        registerBeanshellLanguageSupport(context),

        // DTD-driven XML completion (elements, attributes, enumerated values)
        registerXmlCompletionSupport(context),

        // Workflow graphical preview
        registerWorkflowPreview(context),

        // Environments
        vscode.commands.registerCommand(COMMANDS.addTenant, tenantCommands.addTenant, tenantCommands),
        vscode.commands.registerCommand(COMMANDS.removeTenant, tenantCommands.removeTenant, tenantCommands),
        vscode.commands.registerCommand(COMMANDS.renameTenant, tenantCommands.renameTenant, tenantCommands),
        vscode.commands.registerCommand(COMMANDS.testConnection, tenantCommands.testConnection, tenantCommands),
        vscode.commands.registerCommand(COMMANDS.setActiveTenant, tenantCommands.setActiveTenant, tenantCommands),
        vscode.commands.registerCommand(COMMANDS.selectEnvironment, tenantCommands.selectEnvironment, tenantCommands),

        // Folders
        vscode.commands.registerCommand(COMMANDS.addFolder, folderCommands.addFolder, folderCommands),
        vscode.commands.registerCommand(COMMANDS.renameFolder, folderCommands.renameFolder, folderCommands),
        vscode.commands.registerCommand(COMMANDS.removeFolder, folderCommands.removeFolder, folderCommands),

        // Objects
        vscode.commands.registerCommand(COMMANDS.openObject, objectCommands.openObject, objectCommands),
        vscode.commands.registerCommand(COMMANDS.exportObjects, objectCommands.exportObjects, objectCommands),
        vscode.commands.registerCommand(COMMANDS.saveObject, objectCommands.saveObject, objectCommands),
        vscode.commands.registerCommand(COMMANDS.saveObjectWithDependencies,
            objectCommands.saveObjectWithDependencies, objectCommands),
        vscode.commands.registerCommand(COMMANDS.cloneObject, objectCommands.cloneObject, objectCommands),
        vscode.commands.registerCommand(COMMANDS.copyObjectToTenant, objectCommands.copyObjectToTenant, objectCommands),
        vscode.commands.registerCommand(COMMANDS.copyObjectToTenantView,
            objectCommands.copyObjectToTenantFromView, objectCommands),
        vscode.commands.registerCommand(COMMANDS.copyObjectName, objectCommands.copyObjectName, objectCommands),
        vscode.commands.registerCommand(COMMANDS.deleteObject, objectCommands.deleteObject, objectCommands),

        // Files
        vscode.commands.registerCommand(COMMANDS.importFile, fileCommands.importFile, fileCommands),
        vscode.commands.registerCommand(COMMANDS.importFileExplorer, fileCommands.importFileFromExplorer, fileCommands),
        vscode.commands.registerCommand(COMMANDS.importFileView, fileCommands.importFileFromView, fileCommands),
        vscode.commands.registerCommand(COMMANDS.refreshFile, fileCommands.refreshFile, fileCommands),
        vscode.commands.registerCommand(COMMANDS.compareFile, fileCommands.compareFile, fileCommands),

        // Rules & tasks
        vscode.commands.registerCommand(COMMANDS.addRule, ruleCommands.addRule, ruleCommands),
        vscode.commands.registerCommand(COMMANDS.runRule, ruleCommands.runRule, ruleCommands),
        vscode.commands.registerCommand(COMMANDS.runTask, taskCommands.runTask, taskCommands),

        // Applications
        vscode.commands.registerCommand(COMMANDS.testApplicationConnection,
            applicationCommands.testConnection, applicationCommands),
        vscode.commands.registerCommand(COMMANDS.peekApplicationObjects,
            applicationCommands.peekObjects, applicationCommands),

        // Server logs
        vscode.commands.registerCommand(COMMANDS.tailLogs, logCommands.tailLogs, logCommands),
        vscode.commands.registerCommand(COMMANDS.stopTailLogs, logCommands.stopTailLogs, logCommands),
        vscode.commands.registerCommand(COMMANDS.configureLogging,
            loggingCommands.configureLoggerLevel, loggingCommands),

        // Tree view helpers
        vscode.commands.registerCommand(COMMANDS.refresh, () => treeDataProvider.refresh()),
        vscode.commands.registerCommand(COMMANDS.refreshNode,
            (node: ObjectTypeTreeItem) => treeDataProvider.refresh(node)),
        vscode.commands.registerCommand(COMMANDS.loadMore,
            (node: ObjectTypeTreeItem) => treeDataProvider.loadMore(node)),
        vscode.commands.registerCommand(COMMANDS.sortByName,
            (node: ObjectTypeTreeItem) => treeDataProvider.sortBy(node, "name")),
        vscode.commands.registerCommand(COMMANDS.sortByLastModified,
            (node: ObjectTypeTreeItem) => treeDataProvider.sortBy(node, "lastModified")),
        vscode.commands.registerCommand(COMMANDS.filterObjects, async (node: ObjectTypeTreeItem) => {
            const query = await vscode.window.showInputBox({
                prompt: `Filter ${node.definition.label} by name`,
                placeHolder: "Name contains...",
                value: treeDataProvider.getFilter(node),
                ignoreFocusOut: true
            });
            if (query === undefined) {
                return;
            }
            treeDataProvider.setFilter(node, query.trim() || undefined);
        }),
        vscode.commands.registerCommand(COMMANDS.clearFilter,
            (node: ObjectTypeTreeItem) => treeDataProvider.setFilter(node, undefined))
    );

    try {
        context.subscriptions.push(await registerIdentityIqMcp(context, tenantService));
    } catch (error) {
        console.error("Failed to start the IdentityIQ MCP bridge", error);
    }

    return { tenantService, treeDataProvider, resourceProvider };
}

export function deactivate() { }
