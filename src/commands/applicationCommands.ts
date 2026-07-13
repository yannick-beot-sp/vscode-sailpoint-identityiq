import * as vscode from "vscode";
import { getObjectTypeDefinition, ObjectSummary } from "../models/ObjectTypes";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { withProgress } from "../utils/vsCodeHelpers";
import { extractApplicationSchemas } from "../utils/xmlUtils";
import { ObjectTreeItem } from "../views/IIQTreeItem";
import { QuickPickObjectStep } from "../wizard/quickPickObjectStep";
import { QuickPickTenantStep } from "../wizard/quickPickTenantStep";
import { runWizard } from "../wizard/wizard";

/**
 * Commands acting on an Application on an environment: test connectivity,
 * preview objects returned by its connector.
 */
export class ApplicationCommands {

    constructor(private readonly tenantService: TenantService) { }

    /**
     * Resolves the environment and application name of a command. Entry
     * points: application context menu in the tree view (both known), or
     * command palette (environment then application pickers).
     */
    private async resolveApplication(
        arg: ObjectTreeItem | undefined, wizardTitle: string
    ): Promise<{ tenant: TenantInfo; applicationName: string } | undefined> {
        if (arg instanceof ObjectTreeItem) {
            return { tenant: arg.tenant, applicationName: arg.object.name };
        }
        const context = await runWizard({
            title: wizardTitle,
            promptSteps: [
                new QuickPickTenantStep({ tenantService: this.tenantService }),
                new QuickPickObjectStep({
                    tenantService: this.tenantService,
                    name: "application",
                    getObjectType: () => getObjectTypeDefinition("Application")!
                })
            ]
        });
        if (!context) {
            return undefined;
        }
        return {
            tenant: context.tenant as TenantInfo,
            applicationName: (context.application as ObjectSummary).name
        };
    }

    /** Tests the connection of an application. */
    public async testConnection(arg?: ObjectTreeItem): Promise<void> {
        const resolved = await this.resolveApplication(arg, "Test an application connection");
        if (!resolved) {
            return;
        }
        const { tenant, applicationName } = resolved;

        try {
            const message = await withProgress(
                `Testing connection of "${applicationName}" on ${tenant.name}...`,
                () => new IIQClient(tenant, this.tenantService).testApplicationConnection(applicationName));
            vscode.window.showInformationMessage(message);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Previews objects returned live by an application's connector: picks
     * one of the application's schemas (Account, Group...) and displays the
     * objects returned by the "Test Connector" preview call in a read-only
     * JSON document.
     */
    public async peekObjects(arg?: ObjectTreeItem): Promise<void> {
        const resolved = await this.resolveApplication(arg, "Peek objects of an application");
        if (!resolved) {
            return;
        }
        const { tenant, applicationName } = resolved;
        const client = new IIQClient(tenant, this.tenantService);

        let schemaObjectType: string;
        try {
            const xml = await withProgress(
                `Reading the schemas of "${applicationName}" on ${tenant.name}...`,
                () => client.getObject("Application", applicationName));
            const schemas = extractApplicationSchemas(xml);
            if (schemas.length === 0) {
                vscode.window.showWarningMessage(`Application "${applicationName}" has no schema defined.`);
                return;
            }
            if (schemas.length === 1) {
                schemaObjectType = schemas[0].objectType;
            } else {
                const pick = await vscode.window.showQuickPick(
                    schemas.map(schema => ({
                        label: schema.objectType,
                        description: schema.nativeObjectType,
                        schemaObjectType: schema.objectType
                    })),
                    { title: `Object type to peek on "${applicationName}"`, ignoreFocusOut: true });
                if (!pick) {
                    return;
                }
                schemaObjectType = pick.schemaObjectType;
            }
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
            return;
        }

        try {
            const objects = await withProgress(
                `Fetching a preview of "${schemaObjectType}" objects for "${applicationName}" on ${tenant.name}...`,
                () => client.testConnectorObjects(applicationName, schemaObjectType));
            const document = await vscode.workspace.openTextDocument({
                content: JSON.stringify(objects, null, 2),
                language: "json"
            });
            await vscode.window.showTextDocument(document, { preview: true });
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }
}
