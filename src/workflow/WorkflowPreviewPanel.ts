/**
 * Webview panel showing a graphical preview of the Workflow XML of a text
 * document. One panel per document; the graph is re-rendered (debounced) as
 * the document is edited. The rendering itself lives in the webview script
 * (src/webview/workflowPreview), which receives the parsed model and the
 * analysis issues through postMessage.
 */

import * as vscode from "vscode";
import { analyzeWorkflow } from "./workflowAnalyzer";
import { parseWorkflow } from "./workflowParser";

const UPDATE_DEBOUNCE_MS = 300;

/** Message sent by the webview script. */
interface WebviewMessage {
    type: "ready" | "reveal";
    start?: number;
    end?: number;
}

export class WorkflowPreviewPanel {
    private static readonly panels = new Map<string, WorkflowPreviewPanel>();

    private readonly disposables: vscode.Disposable[] = [];
    private updateTimer: NodeJS.Timeout | undefined;

    static createOrShow(extensionUri: vscode.Uri, document: vscode.TextDocument): void {
        const key = document.uri.toString();
        const existing = this.panels.get(key);
        if (existing) {
            existing.panel.reveal(undefined, true);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            "iiq.workflowPreview",
            `Workflow: ${documentLabel(document)}`,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                // Keep zoom/pan/selection state when the tab goes to the background.
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, "dist"),
                    vscode.Uri.joinPath(extensionUri, "resources")
                ]
            }
        );
        this.panels.set(key, new WorkflowPreviewPanel(panel, extensionUri, document));
    }

    private constructor(
        private readonly panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private readonly document: vscode.TextDocument
    ) {
        panel.iconPath = vscode.Uri.joinPath(extensionUri, "resources", "iiq.svg");
        panel.webview.html = this.buildHtml(panel.webview, extensionUri);

        this.disposables.push(
            panel.onDidDispose(() => this.dispose()),
            panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message)),
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document.uri.toString() === this.document.uri.toString()) {
                    this.scheduleUpdate();
                }
            }),
            vscode.workspace.onDidCloseTextDocument(closed => {
                if (closed.uri.toString() === this.document.uri.toString()) {
                    this.panel.dispose();
                }
            })
        );
    }

    private dispose(): void {
        WorkflowPreviewPanel.panels.delete(this.document.uri.toString());
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }

    private scheduleUpdate(): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        this.updateTimer = setTimeout(() => this.update(), UPDATE_DEBOUNCE_MS);
    }

    private update(): void {
        const model = parseWorkflow(this.document.getText());
        const issues = model ? analyzeWorkflow(model) : [];
        if (model) {
            this.panel.title = `Workflow: ${model.name}`;
        }
        void this.panel.webview.postMessage({ type: "update", model: model ?? null, issues });
    }

    private async handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case "ready":
                this.update();
                break;
            case "reveal":
                await this.reveal(message.start ?? 0, message.end ?? 0);
                break;
        }
    }

    /** Shows the source document and selects the given offset range. */
    private async reveal(start: number, end: number): Promise<void> {
        const range = new vscode.Range(this.document.positionAt(start), this.document.positionAt(end));
        const visible = vscode.window.visibleTextEditors
            .find(e => e.document.uri.toString() === this.document.uri.toString());
        const editor = visible
            ? await vscode.window.showTextDocument(this.document, { viewColumn: visible.viewColumn })
            : await vscode.window.showTextDocument(this.document, { viewColumn: vscode.ViewColumn.One });
        // Select the start tag only: selecting a whole multi-hundred-line
        // step would be more distracting than helpful.
        const selection = new vscode.Range(range.start, this.document.lineAt(range.start.line).range.end);
        editor.selection = new vscode.Selection(selection.start, selection.end);
        editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "workflowPreview.js"));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "resources", "webview", "workflowPreview.css"));
        const nonce = getNonce();
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Workflow preview</title>
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function documentLabel(document: vscode.TextDocument): string {
    const path = document.uri.path;
    return path.substring(path.lastIndexOf("/") + 1);
}

function getNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i++) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}
