import * as vscode from "vscode";
import { TenantInfo } from "../models/TenantInfo";
import { TenantService } from "../services/TenantService";

/** Shows a modal confirmation dialog. Returns true if the user confirmed. */
export async function confirm(message: string, confirmLabel = "Yes"): Promise<boolean> {
    const answer = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        confirmLabel);
    return answer === confirmLabel;
}

export interface ChooseTenantOptions {
    /** Environment ids to exclude from the picker (e.g. the source when copying) */
    excludeTenantIds?: string[];
    /** Return the only environment without prompting. Defaults to true */
    skipIfOne?: boolean;
}

/**
 * Asks the user to pick an environment. The active environment, if any,
 * is preselected. Returns undefined if the user cancelled.
 */
export async function chooseTenant(tenantService: TenantService, title: string,
    options?: ChooseTenantOptions): Promise<TenantInfo | undefined> {
    const excludeIds = new Set(options?.excludeTenantIds ?? []);
    const tenants = tenantService.getTenants().filter(t => !excludeIds.has(t.id));
    if (tenants.length === 0) {
        vscode.window.showWarningMessage("No IdentityIQ environment defined. Please add an environment first.");
        return undefined;
    }
    if (tenants.length === 1 && (options?.skipIfOne ?? true)) {
        return tenants[0];
    }
    const active = tenantService.getActiveTenant();
    const items = tenants.map(tenant => ({
        label: tenant.name,
        description: tenant.url + (active?.id === tenant.id ? " (active)" : ""),
        picked: active?.id === tenant.id,
        tenant
    }));
    // Put the active environment first so it is selected by default
    items.sort((a, b) => Number(b.picked) - Number(a.picked));
    const choice = await vscode.window.showQuickPick(items, {
        title,
        placeHolder: "Choose an environment",
        ignoreFocusOut: true,
        matchOnDescription: true
    });
    return choice?.tenant;
}

/** Runs a task with a progress notification */
export function withProgress<T>(title: string, task: () => Promise<T>): Thenable<T> {
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: false },
        task);
}
