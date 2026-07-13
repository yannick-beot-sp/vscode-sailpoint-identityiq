import * as vscode from "vscode";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { withProgress } from "../utils/vsCodeHelpers";
import { TenantTreeItem } from "../views/IIQTreeItem";
import { QuickPickTenantStep } from "../wizard/quickPickTenantStep";
import { runWizard } from "../wizard/wizard";

/** Log4j2 levels offered by the "Configure logging..." command */
const LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "OFF"];

const RESET_LABEL = "Reset to default (remove override)";

/**
 * Commands to change the level of a server-side Log4j2 logger at runtime,
 * without restarting IdentityIQ. The change is in-memory only: it is not
 * persisted to log4j2.properties and does not survive a restart.
 */
export class LoggingCommands {

    constructor(private readonly tenantService: TenantService) { }

    /**
     * Sets or resets a logger's level. Entry points: environment context
     * menu in the tree view (tenant known), or command palette (environment
     * picker). The logger name is always typed in: there is no listing of
     * the loggers currently overridden on the server.
     */
    public async configureLoggerLevel(arg?: TenantTreeItem): Promise<void> {
        const tenant = await this.resolveTenant(arg);
        if (!tenant) {
            return;
        }
        const client = new IIQClient(tenant, this.tenantService);

        const logger = await vscode.window.showInputBox({
            title: "Configure logging",
            prompt: "Logger name",
            placeHolder: "e.g. sailpoint.connector.LDAPConnector",
            ignoreFocusOut: true,
            validateInput: value => value.trim().length === 0 ? "A logger name is required" : undefined
        });
        if (!logger) {
            return;
        }
        const loggerName = logger.trim();

        const levelPick = await vscode.window.showQuickPick(
            [...LEVELS.map(label => ({ label })), { label: RESET_LABEL }],
            { title: `Level for "${loggerName}"`, ignoreFocusOut: true });
        if (!levelPick) {
            return;
        }

        try {
            if (levelPick.label === RESET_LABEL) {
                await withProgress(
                    `Resetting "${loggerName}" on ${tenant.name}...`,
                    () => client.resetLoggerLevel(loggerName));
                vscode.window.showInformationMessage(
                    `Logger "${loggerName}" reset to its default level on ${tenant.name}.`);
            } else {
                await withProgress(
                    `Setting "${loggerName}" to ${levelPick.label} on ${tenant.name}...`,
                    () => client.setLoggerLevel(loggerName, levelPick.label));
                vscode.window.showInformationMessage(
                    `Logger "${loggerName}" set to ${levelPick.label} on ${tenant.name}.`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    private async resolveTenant(arg: TenantTreeItem | undefined): Promise<TenantInfo | undefined> {
        if (arg instanceof TenantTreeItem) {
            return arg.tenant;
        }
        const context = await runWizard({
            title: "Configure logging",
            promptSteps: [new QuickPickTenantStep({ tenantService: this.tenantService })]
        });
        return context?.tenant as TenantInfo | undefined;
    }
}
