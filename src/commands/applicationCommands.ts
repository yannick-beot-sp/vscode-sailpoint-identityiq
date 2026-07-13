import * as vscode from "vscode";
import { getObjectTypeDefinition, ObjectSummary } from "../models/ObjectTypes";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { withProgress } from "../utils/vsCodeHelpers";
import { ObjectTreeItem } from "../views/IIQTreeItem";
import { QuickPickObjectStep } from "../wizard/quickPickObjectStep";
import { QuickPickTenantStep } from "../wizard/quickPickTenantStep";
import { runWizard } from "../wizard/wizard";

/**
 * Command to test the connectivity of an Application on an environment.
 */
export class ApplicationCommands {

    constructor(private readonly tenantService: TenantService) { }

    /**
     * Tests the connection of an application. Entry points:
     * - application context menu in the tree view (environment and application known),
     * - command palette (environment and application pickers).
     */
    public async testConnection(arg?: ObjectTreeItem): Promise<void> {
        let tenant: TenantInfo | undefined;
        let applicationName: string | undefined;

        if (arg instanceof ObjectTreeItem) {
            // From the tree view
            tenant = arg.tenant;
            applicationName = arg.object.name;
        } else {
            // From the command palette: environment then application pickers
            const context = await runWizard({
                title: "Test an application connection",
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
                return;
            }
            tenant = context.tenant as TenantInfo;
            applicationName = (context.application as ObjectSummary).name;
        }
        if (!tenant || !applicationName) {
            return;
        }

        try {
            const message = await withProgress(
                `Testing connection of "${applicationName}" on ${tenant.name}...`,
                () => new IIQClient(tenant!, this.tenantService).testApplicationConnection(applicationName!));
            vscode.window.showInformationMessage(message);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }
}
