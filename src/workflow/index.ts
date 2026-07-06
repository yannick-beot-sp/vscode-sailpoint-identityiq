/**
 * Workflow preview: registers the preview command and maintains the
 * `iiq.isWorkflow` context key used by the menu contributions (editor title
 * button, context menu) so they only show up on Workflow XML documents.
 */

import * as vscode from "vscode";
import { COMMANDS } from "../constants";
import { looksLikeWorkflow } from "./workflowParser";
import { WorkflowPreviewPanel } from "./WorkflowPreviewPanel";

const IS_WORKFLOW_CONTEXT_KEY = "iiq.isWorkflow";

function isWorkflowDocument(document: vscode.TextDocument | undefined): boolean {
    return document !== undefined
        && document.languageId === "xml"
        && looksLikeWorkflow(document.getText());
}

function updateContextKey(editor: vscode.TextEditor | undefined): void {
    void vscode.commands.executeCommand("setContext", IS_WORKFLOW_CONTEXT_KEY, isWorkflowDocument(editor?.document));
}

export function registerWorkflowPreview(context: vscode.ExtensionContext): vscode.Disposable {
    updateContextKey(vscode.window.activeTextEditor);

    let sniffTimer: NodeJS.Timeout | undefined;
    return vscode.Disposable.from(
        vscode.window.onDidChangeActiveTextEditor(updateContextKey),
        vscode.workspace.onDidChangeTextDocument(e => {
            const active = vscode.window.activeTextEditor;
            // Re-evaluate (debounced: the sniff reads the document text) when
            // the edited document is the active one.
            if (active && e.document === active.document) {
                if (sniffTimer) {
                    clearTimeout(sniffTimer);
                }
                sniffTimer = setTimeout(() => updateContextKey(vscode.window.activeTextEditor), 500);
            }
        }),
        new vscode.Disposable(() => {
            if (sniffTimer) {
                clearTimeout(sniffTimer);
            }
        }),
        vscode.commands.registerCommand(COMMANDS.previewWorkflow, (uri?: vscode.Uri) => {
            const editor = vscode.window.activeTextEditor;
            const document = uri
                ? vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())
                : editor?.document;
            if (!document || !looksLikeWorkflow(document.getText())) {
                void vscode.window.showWarningMessage("The current document does not contain a Workflow.");
                return;
            }
            WorkflowPreviewPanel.createOrShow(context.extensionUri, document);
        })
    );
}
