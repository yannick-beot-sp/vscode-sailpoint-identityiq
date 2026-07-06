import * as assert from "assert";
import * as vscode from "vscode";

const SAMPLE_WORKFLOW = `<?xml version='1.0' encoding='UTF-8'?>
<Workflow explicitTransitions="true" name="Preview Test">
  <Step icon="Start" name="Start">
    <Transition to="Stop"/>
  </Step>
  <Step icon="Stop" name="Stop"/>
</Workflow>`;

/** The tab model is updated asynchronously after createWebviewPanel: poll for it. */
async function waitForWebviewTab(timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs);
        if (tabs.some(t => t.input instanceof vscode.TabInputWebview && t.label.startsWith("Workflow:"))) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
}

suite("Workflow preview Test Suite", () => {

    test("preview command opens a webview panel for a workflow document", async () => {
        const document = await vscode.workspace.openTextDocument({ language: "xml", content: SAMPLE_WORKFLOW });
        await vscode.window.showTextDocument(document);

        await vscode.commands.executeCommand("iiq.preview-workflow");

        assert.ok(
            await waitForWebviewTab(),
            "Expected a workflow preview tab, got: "
            + vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => t.label).join(", ")
        );
    });

    test("preview command warns and does not open a panel on a non-workflow document", async () => {
        const document = await vscode.workspace.openTextDocument({ language: "xml", content: "<Rule name='x'/>" });
        await vscode.window.showTextDocument(document);

        const before = vscode.window.tabGroups.all.flatMap(g => g.tabs)
            .filter(t => t.input instanceof vscode.TabInputWebview).length;
        await vscode.commands.executeCommand("iiq.preview-workflow");
        const after = vscode.window.tabGroups.all.flatMap(g => g.tabs)
            .filter(t => t.input instanceof vscode.TabInputWebview).length;
        assert.strictEqual(after, before);
    });
});
