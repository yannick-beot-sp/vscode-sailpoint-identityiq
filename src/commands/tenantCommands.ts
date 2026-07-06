import * as crypto from "crypto";
import * as vscode from "vscode";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient, SystemInfo } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { isEmpty } from "../utils/stringUtils";
import { chooseTenant, confirm, withProgress } from "../utils/vsCodeHelpers";
import { InputPromptStep } from "../wizard/inputPromptStep";
import { runWizard } from "../wizard/wizard";
import { QuickPickTenantStep } from "../wizard/quickPickTenantStep";
import { FolderTreeItem, TenantTreeItem } from "../views/IIQTreeItem";

/**
 * Commands to manage environments: add, remove, rename, test connection,
 * select the active environment.
 */
export class TenantCommands {

    constructor(private readonly tenantService: TenantService) { }

    /**
     * Adds a new environment: display name, base URL, login and password are
     * prompted, then the whole configuration is validated with an API call.
     */
    public async addTenant(node?: FolderTreeItem): Promise<void> {
        const context = await runWizard({
            title: "Add an IdentityIQ environment",
            promptSteps: [
                new InputPromptStep({
                    name: "displayName",
                    options: {
                        prompt: "Enter a unique display name for the environment",
                        placeHolder: "Development",
                        validateInput: (value) => {
                            if (isEmpty(value)) {
                                return "The display name cannot be empty";
                            }
                            if (this.tenantService.getTenantByName(value.trim())) {
                                return `An environment named "${value.trim()}" already exists`;
                            }
                            return "";
                        }
                    }
                }),
                new InputPromptStep({
                    name: "url",
                    displayName: "base URL",
                    options: {
                        prompt: "Enter the base URL of IdentityIQ",
                        placeHolder: "http://localhost:8080/identityiq",
                        validateInput: (value) => {
                            try {
                                const url = new URL(value);
                                return url.protocol === "http:" || url.protocol === "https:"
                                    ? "" : "The URL must use http or https";
                            } catch {
                                return "Invalid URL";
                            }
                        }
                    }
                }),
                new InputPromptStep({
                    name: "username",
                    displayName: "login",
                    options: {
                        prompt: "Enter the login",
                        placeHolder: "spadmin",
                        validateInput: (value) => isEmpty(value) ? "The login cannot be empty" : ""
                    }
                }),
                new InputPromptStep({
                    name: "password",
                    options: {
                        prompt: "Enter the password",
                        password: true,
                        validateInput: (value) => isEmpty(value) ? "The password cannot be empty" : ""
                    }
                })
            ]
        });
        if (!context) {
            return;
        }

        const tenant: TenantInfo = {
            id: crypto.randomUUID(),
            name: (context.displayName as string).trim(),
            url: (context.url as string).trim().replace(/\/+$/, ""),
            type: "TENANT"
        };
        await this.tenantService.setCredentials(tenant.id, {
            username: context.username as string,
            password: context.password as string
        });

        // Validate the settings with an API call before saving
        let info: SystemInfo | undefined;
        try {
            info = await withProgress(`Testing connection to ${tenant.name}...`,
                () => new IIQClient(tenant, this.tenantService).ping());
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const answer = await vscode.window.showWarningMessage(
                `The connection test failed: ${message}`,
                { modal: true },
                "Save anyway");
            if (answer !== "Save anyway") {
                await this.tenantService.removeCredentials(tenant.id);
                return;
            }
        }

        await this.tenantService.add(tenant, node instanceof FolderTreeItem ? node.folder.id : undefined);
        // The first environment automatically becomes the active one
        if (this.tenantService.getTenants().length === 1) {
            await this.tenantService.setActiveTenant(tenant);
        }
        if (info) {
            vscode.window.showInformationMessage(
                `Environment "${tenant.name}" added. IdentityIQ ${info.version}, plugin ${info.pluginVersion} (API v${info.apiVersion}).`);
        }
    }

    /** Removes an environment after confirmation. Credentials are removed from the secret storage. */
    public async removeTenant(node?: TenantTreeItem): Promise<void> {
        const tenant = node?.tenant ?? await chooseTenant(this.tenantService, "Remove environment");
        if (!tenant) {
            return;
        }
        if (!await confirm(`Are you sure you want to remove the environment "${tenant.name}"?`, "Remove")) {
            return;
        }
        await this.tenantService.remove(tenant.id);
        vscode.window.showInformationMessage(`Environment "${tenant.name}" removed.`);
    }

    /** Renames an environment. The name must stay unique. */
    public async renameTenant(node?: TenantTreeItem): Promise<void> {
        const tenant = node?.tenant ?? await chooseTenant(this.tenantService, "Rename environment");
        if (!tenant) {
            return;
        }
        const newName = await vscode.window.showInputBox({
            prompt: "Enter the new display name",
            value: tenant.name,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (isEmpty(value)) {
                    return "The display name cannot be empty";
                }
                const existing = this.tenantService.getTenantByName(value.trim());
                if (existing && existing.id !== tenant.id) {
                    return `An environment named "${value.trim()}" already exists`;
                }
                return "";
            }
        });
        if (newName === undefined) {
            return;
        }
        await this.tenantService.update({ ...tenant, name: newName.trim() });
    }

    /** Tests URL, credentials, plugin availability and API version compatibility */
    public async testConnection(node?: TenantTreeItem): Promise<void> {
        const tenant = node?.tenant ?? await chooseTenant(this.tenantService, "Test connection");
        if (!tenant) {
            return;
        }
        try {
            const info = await withProgress(`Testing connection to ${tenant.name}...`,
                () => new IIQClient(tenant, this.tenantService).ping());
            vscode.window.showInformationMessage(
                `Successfully connected to "${tenant.name}" as ${info.identity}. IdentityIQ ${info.version}, plugin ${info.pluginVersion} (API v${info.apiVersion}).`);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    /** Sets the active environment from the tree view */
    public async setActiveTenant(node?: TenantTreeItem): Promise<void> {
        if (node?.tenant) {
            await this.tenantService.setActiveTenant(node.tenant);
        }
    }

    /**
     * Selects the active environment from a list.
     * A "None" entry allows to deselect the current environment.
     * Available from the command palette and from the status bar.
     */
    public async selectEnvironment(): Promise<void> {
        const context = await runWizard({
            title: "Select the active environment",
            hideStepCount: true,
            promptSteps: [
                new QuickPickTenantStep({
                    tenantService: this.tenantService,
                    allowNone: true
                })
            ]
        });
        if (!context) {
            return;
        }
        await this.tenantService.setActiveTenant(context.tenant as TenantInfo | undefined);
    }
}
