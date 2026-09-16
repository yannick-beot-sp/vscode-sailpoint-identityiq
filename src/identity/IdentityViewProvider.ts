import * as vscode from "vscode";
import { COMMANDS } from "../constants";
import { TenantService } from "../services/TenantService";
import { buildResourceUri, parseResourceUri } from "../utils/UriUtils";
import { ObjectTreeItem } from "../views/IIQTreeItem";
import { identityReferenceUri, loadIdentityView, loadObjectSummary } from "./identityViewLoader";
import {
    IdentitySection,
    IdentityView,
    isDetailObjectType,
    isIdentitySection,
    ObjectSummaryView
} from "./identityViewModel";

export const IDENTITY_VIEW_TYPE = "iiq.identityViewer";

/**
 * The identity commands are triggered from the editor title bar (a Uri is
 * passed), from the tree view context menu (the leaf is passed) or from the
 * command palette (no argument).
 */
type IdentityCommandArg = vscode.Uri | ObjectTreeItem;

function resolveUri(arg?: IdentityCommandArg): vscode.Uri | undefined {
    if (arg instanceof vscode.Uri) {
        return arg;
    }
    if (arg instanceof ObjectTreeItem) {
        return arg.getResourceUri();
    }
    return undefined;
}

interface IdentityViewMessage {
    type: "ready" | "refresh" | "copy" | "openXml" | "openIdentity" | "loadDetail";
    section?: unknown;
    value?: unknown;
    objectType?: unknown;
    nameOrId?: unknown;
    name?: unknown;
    id?: unknown;
}

interface PanelState {
    document: IdentityViewDocument;
    panel: vscode.WebviewPanel;
    model?: IdentityView;
}

class IdentityViewDocument implements vscode.CustomDocument {
    constructor(public readonly uri: vscode.Uri) { }
    dispose(): void { }
}

/**
 * Read-only Identity custom editor. It talks directly to the JSON view
 * endpoints and deliberately never asks the virtual file system for XML.
 */
export class IdentityViewProvider implements vscode.CustomReadonlyEditorProvider<IdentityViewDocument>, vscode.Disposable {
    private readonly panels = new Map<string, PanelState>();
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly tenantService: TenantService
    ) { }

    register(context: vscode.ExtensionContext): void {
        this.disposables.push(
            vscode.window.registerCustomEditorProvider(IDENTITY_VIEW_TYPE, this, {
                supportsMultipleEditorsPerDocument: false,
                webviewOptions: { retainContextWhenHidden: true }
            }),
            vscode.commands.registerCommand(COMMANDS.viewIdentity,
                (arg?: IdentityCommandArg) => this.openIdentity(resolveUri(arg))),
            vscode.commands.registerCommand(COMMANDS.viewIdentityXml,
                (arg?: IdentityCommandArg) => this.openXml(resolveUri(arg))),
            vscode.commands.registerCommand(COMMANDS.refreshIdentity,
                (arg?: IdentityCommandArg) => this.refresh(resolveUri(arg)))
        );
        context.subscriptions.push(this);
    }

    openCustomDocument(uri: vscode.Uri): IdentityViewDocument {
        this.assertIdentityUri(uri);
        return new IdentityViewDocument(uri);
    }

    resolveCustomEditor(document: IdentityViewDocument, panel: vscode.WebviewPanel): void {
        const key = document.uri.toString();
        const state: PanelState = { document, panel };
        this.panels.set(key, state);

        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, "dist"),
                vscode.Uri.joinPath(this.extensionUri, "resources")
            ]
        };
        panel.webview.html = this.buildHtml(panel.webview);

        const receive = panel.webview.onDidReceiveMessage((message: IdentityViewMessage) =>
            this.handleMessage(state, message));
        panel.onDidDispose(() => {
            receive.dispose();
            this.panels.delete(key);
        });
    }

    async openIdentity(uri?: vscode.Uri): Promise<void> {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) {
            return;
        }
        this.assertIdentityUri(target);
        await vscode.commands.executeCommand("vscode.openWith", target, IDENTITY_VIEW_TYPE);
    }

    async openXml(uri?: vscode.Uri): Promise<void> {
        const target = uri ?? this.activePanel()?.document.uri;
        if (target) {
            await vscode.commands.executeCommand("vscode.openWith", target, "default");
        }
    }

    async refresh(uri?: vscode.Uri): Promise<void> {
        const state = uri ? this.panels.get(uri.toString()) : this.activePanel();
        if (state) {
            await this.load(state);
        }
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    private async handleMessage(state: PanelState, message: IdentityViewMessage): Promise<void> {
        switch (message.type) {
            case "ready":
                await this.load(state);
                break;
            case "refresh":
                await this.load(state, isIdentitySection(message.section) ? message.section : undefined);
                break;
            case "copy":
                if (typeof message.value === "string") {
                    await vscode.env.clipboard.writeText(message.value);
                }
                break;
            case "openXml":
                await this.openObjectXml(state, message);
                break;
            case "openIdentity":
                await this.openReferencedIdentity(state, message);
                break;
            case "loadDetail":
                await this.loadDetail(state, message);
                break;
        }
    }

    private async load(state: PanelState, section?: IdentitySection): Promise<void> {
        await state.panel.webview.postMessage({ type: "loading", section });
        try {
            const loaded = await loadIdentityView(this.tenantService, state.document.uri, section);
            state.model = section && state.model
                ? { ...state.model, [section]: loaded[section] }
                : loaded;
            await state.panel.webview.postMessage({
                type: "update",
                section,
                model: state.model
            });
        } catch (error) {
            await state.panel.webview.postMessage({
                type: "error",
                section,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async loadDetail(state: PanelState, message: IdentityViewMessage): Promise<void> {
        if (!isDetailObjectType(message.objectType) || typeof message.nameOrId !== "string") {
            return;
        }
        await state.panel.webview.postMessage({ type: "detailLoading" });
        try {
            const detail: ObjectSummaryView = await loadObjectSummary(
                this.tenantService, state.document.uri, message.objectType, message.nameOrId);
            await state.panel.webview.postMessage({
                type: "detail",
                objectType: message.objectType,
                detail
            });
        } catch (error) {
            await state.panel.webview.postMessage({
                type: "detailError",
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    private async openReferencedIdentity(state: PanelState, message: IdentityViewMessage): Promise<void> {
        if (typeof message.name !== "string" || !message.name) {
            return;
        }
        const uri = identityReferenceUri(state.document.uri, {
            id: typeof message.id === "string" ? message.id : undefined,
            name: message.name
        });
        await vscode.commands.executeCommand("vscode.openWith", uri, IDENTITY_VIEW_TYPE);
    }

    private async openObjectXml(state: PanelState, message: IdentityViewMessage): Promise<void> {
        if (typeof message.objectType !== "string" || typeof message.name !== "string") {
            return;
        }
        const current = parseResourceUri(state.document.uri);
        const uri = buildResourceUri({
            tenantId: current.tenantId,
            tenantName: current.tenantName,
            objectType: message.objectType,
            objectId: typeof message.id === "string" && message.id ? message.id : message.name,
            objectName: message.name
        });
        await vscode.commands.executeCommand("vscode.openWith", uri, "default");
    }

    private activePanel(): PanelState | undefined {
        return [...this.panels.values()].find(state => state.panel.active)
            ?? [...this.panels.values()].find(state => state.panel.visible);
    }

    private assertIdentityUri(uri: vscode.Uri): void {
        const parts = parseResourceUri(uri);
        if (uri.scheme !== "iiq" || parts.objectType !== "Identity") {
            throw new Error("Identity View only supports iiq:// Identity resources.");
        }
    }

    private buildHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "identityView.js"));
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "resources", "webview", "identityView.css"));
        const nonce = getNonce();
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Identity View</title>
</head>
<body>
    <div id="app" aria-live="polite"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let index = 0; index < 32; index++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}
