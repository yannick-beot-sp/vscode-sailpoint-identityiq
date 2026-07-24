import * as vscode from "vscode";
import { getObjectTypeDefinition, ObjectSummary } from "../models/ObjectTypes";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient, TaskStatus } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { buildDiffResourceUri } from "../utils/UriUtils";
import { ObjectTreeItem } from "../views/IIQTreeItem";
import { QuickPickObjectStep } from "../wizard/quickPickObjectStep";
import { QuickPickTenantStep } from "../wizard/quickPickTenantStep";
import { runWizard } from "../wizard/wizard";

/** Interval between two polls of the task status while a task is running */
const POLL_INTERVAL_MS = 2000;

/**
 * Command to run a task on an environment and display its TaskResult.
 */
export class TaskCommands {

    constructor(private readonly tenantService: TenantService) { }

    /**
     * Runs a task. Entry points:
     * - task context menu in the tree view (environment and task known),
     * - command palette (environment and task pickers).
     * The task is launched asynchronously on the server; a progress
     * notification stays visible while it runs (status polled), then the
     * outcome is reported and the final TaskResult is opened as a read-only
     * preview.
     */
    public async runTask(arg?: ObjectTreeItem): Promise<void> {
        let tenant: TenantInfo | undefined;
        let taskName: string | undefined;

        if (arg instanceof ObjectTreeItem) {
            // From the tree view
            tenant = arg.tenant;
            taskName = arg.object.name;
        } else {
            // From the command palette: environment then task pickers
            const context = await runWizard({
                title: "Run a task",
                promptSteps: [
                    new QuickPickTenantStep({ tenantService: this.tenantService }),
                    new QuickPickObjectStep({
                        tenantService: this.tenantService,
                        name: "task",
                        getObjectType: () => getObjectTypeDefinition("TaskDefinition")!
                    })
                ]
            });
            if (!context) {
                return;
            }
            tenant = context.tenant as TenantInfo;
            taskName = (context.task as ObjectSummary).name;
        }
        if (!tenant || !taskName) {
            return;
        }

        const client = new IIQClient(tenant, this.tenantService);
        try {
            const status = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Running task "${taskName}" on ${tenant.name}...`,
                cancellable: true
            }, (_progress, token) => this.launchAndWait(client, taskName!, token));

            if (!status) {
                // The user cancelled the notification: stop waiting only,
                // the task keeps running server-side.
                vscode.window.showInformationMessage(
                    `Stopped waiting for task "${taskName}". The task keeps running on ${tenant.name}.`);
                return;
            }
            this.reportOutcome(tenant, taskName, status);
            await this.openTaskResultPreview(tenant, status);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    /** Launches the task and polls its status until completion or cancellation */
    private async launchAndWait(client: IIQClient, taskName: string,
        token: vscode.CancellationToken): Promise<TaskStatus | undefined> {
        const taskResultId = await client.runTask(taskName);
        while (!token.isCancellationRequested) {
            const status = await client.getTaskStatus(taskResultId);
            if (status.completed) {
                return status;
            }
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
        return undefined;
    }

    /** Reports whether the task completed successfully or not */
    private reportOutcome(tenant: TenantInfo, taskName: string, status: TaskStatus): void {
        const details = (status.messages ?? []).join(" ");
        switch (status.completionStatus) {
            case "Success":
                vscode.window.showInformationMessage(
                    `Task "${taskName}" completed successfully on ${tenant.name}.`);
                break;
            case "Warning":
                vscode.window.showWarningMessage(
                    `Task "${taskName}" completed with warnings on ${tenant.name}. ${details}`.trim());
                break;
            default:
                vscode.window.showErrorMessage(
                    `Task "${taskName}" ended with status "${status.completionStatus}" on ${tenant.name}. ${details}`.trim());
        }
    }

    /**
     * Opens the final TaskResult as a read-only XML preview, through the
     * iiq-remote:// content provider (same provider as the diff views).
     */
    private async openTaskResultPreview(tenant: TenantInfo, status: TaskStatus): Promise<void> {
        const uri = buildDiffResourceUri({
            tenantId: tenant.id,
            tenantName: tenant.name,
            objectType: "TaskResult",
            objectId: status.id ?? status.name,
            objectName: status.name ?? status.id
        });
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: true });
    }
}
