import * as vscode from "vscode";
import { COMMANDS } from "../constants";
import { TenantService } from "./TenantService";

/**
 * Status bar item displaying the active environment.
 * Clicking it opens the environment picker.
 */
export class EnvironmentStatusBar implements vscode.Disposable {

    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(tenantService: TenantService) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = COMMANDS.selectEnvironment;
        this.disposables.push(
            this.statusBarItem,
            tenantService.onDidChangeActiveTenant(() => this.update(tenantService)),
            tenantService.onDidUpdateTree(() => this.update(tenantService))
        );
        this.update(tenantService);
        this.statusBarItem.show();
    }

    private update(tenantService: TenantService): void {
        const active = tenantService.getActiveTenant();
        if (active) {
            this.statusBarItem.text = `$(server-environment) IIQ: ${active.name}`;
            this.statusBarItem.tooltip = `Active IdentityIQ environment: ${active.name} (${active.url})\nClick to change`;
        } else {
            this.statusBarItem.text = "$(server-environment) IIQ: no environment";
            this.statusBarItem.tooltip = "No active IdentityIQ environment.\nClick to select one";
        }
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
