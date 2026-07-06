import * as assert from "assert";
import * as vscode from "vscode";
import { CONFIGURATION } from "../../constants";
import { getExtensionApi } from "../testHelpers";

/**
 * End-to-end tests of the DTD-driven XML completion provider, through the
 * real VS Code language APIs, against the actual bundled sailpoint.dtd.
 */
suite("XML completion providers Test Suite (end-to-end)", () => {

    suiteSetup(async function () {
        this.timeout(30_000);
        await getExtensionApi();
    });

    async function completionsIn(content: string, markerEnd: string): Promise<vscode.CompletionItem[]> {
        const document = await vscode.workspace.openTextDocument({ language: "xml", content });
        const offset = content.indexOf(markerEnd) + markerEnd.length;
        assert.ok(offset >= markerEnd.length, `marker not found: ${markerEnd}`);
        const list = await vscode.commands.executeCommand<vscode.CompletionList>(
            "vscode.executeCompletionItemProvider", document.uri, document.positionAt(offset));
        return list.items;
    }

    function labelsOf(items: vscode.CompletionItem[]): string[] {
        return items.map(item => (typeof item.label === "string" ? item.label : item.label.label));
    }

    test("child element completion offers both optional children when none is typed yet", async () => {
        const items = await completionsIn("<Map><entry><", "<Map><entry><");
        const labels = labelsOf(items);
        assert.ok(labels.includes("key"), `key expected in ${labels}`);
        assert.ok(labels.includes("value"), `value expected in ${labels}`);
    });

    test("child element completion respects order: key already typed, only value is offered", async () => {
        const content = "<Map><entry><key><String>x</String></key><";
        const items = await completionsIn(content, content);
        const labels = labelsOf(items);
        assert.ok(labels.includes("value"), `value expected in ${labels}`);
        assert.ok(!labels.includes("key"), `key should not be offered again, got ${labels}`);
    });

    test("selecting an EMPTY element inserts a self-closing snippet", async () => {
        const items = await completionsIn("<List><", "<List><");
        const item = items.find(i => (typeof i.label === "string" ? i.label : i.label.label) === "AccountIconConfig");
        assert.ok(item, "AccountIconConfig expected as a completion of <List>");
        assert.ok(item.insertText instanceof vscode.SnippetString, "expected a snippet insertion");
        assert.strictEqual((item.insertText as vscode.SnippetString).value, "<AccountIconConfig/>$0");
    });

    test("selecting a non-EMPTY element inserts an open/close snippet", async () => {
        const items = await completionsIn("<List><", "<List><");
        const item = items.find(i => (typeof i.label === "string" ? i.label : i.label.label) === "Bundle");
        assert.ok(item, "Bundle expected as a completion of <List>");
        assert.ok(item.insertText instanceof vscode.SnippetString);
        assert.strictEqual((item.insertText as vscode.SnippetString).value, "<Bundle>$0</Bundle>");
    });

    test("the '<' already typed to trigger the completion is replaced, not duplicated", async () => {
        const content = "<List><";
        const document = await vscode.workspace.openTextDocument({ language: "xml", content });
        const position = document.positionAt(content.length);
        const list = await vscode.commands.executeCommand<vscode.CompletionList>(
            "vscode.executeCompletionItemProvider", document.uri, position, "<");
        const item = list.items.find(i =>
            (typeof i.label === "string" ? i.label : i.label.label) === "ObjectAttribute");
        assert.ok(item, "ObjectAttribute expected as a completion of <List>");
        assert.ok(item.range instanceof vscode.Range,
            "a replace range is required so the already-typed '<' is not duplicated");
        assert.strictEqual(document.getText(item.range as vscode.Range), "<");
        assert.strictEqual((item.insertText as vscode.SnippetString).value, "<ObjectAttribute>$0</ObjectAttribute>");
        // filterText must include the leading '<' (which the range covers but
        // the label does not), otherwise VS Code drops the item as soon as
        // further characters are typed after '<' (e.g. "<O").
        assert.strictEqual(item.filterText, "<ObjectAttribute");
    });

    test("suggestions survive typing further characters after '<' (e.g. \"<O\")", async () => {
        const content = "<List><O";
        const document = await vscode.workspace.openTextDocument({ language: "xml", content });
        const position = document.positionAt(content.length);
        const list = await vscode.commands.executeCommand<vscode.CompletionList>(
            "vscode.executeCompletionItemProvider", document.uri, position);
        const item = list.items.find(i =>
            (typeof i.label === "string" ? i.label : i.label.label) === "ObjectAttribute");
        assert.ok(item, "ObjectAttribute expected as a completion of <List> even after typing '<O'");
        assert.strictEqual(item.filterText, "<ObjectAttribute");
    });

    test("attribute name completion excludes attributes already present", async () => {
        const content = '<AccountIconConfig attribute="x" ';
        const items = await completionsIn(content, content);
        const labels = labelsOf(items);
        assert.ok(labels.includes("source") && labels.includes("title") && labels.includes("value"),
            `source/title/value expected in ${labels}`);
        assert.ok(!labels.includes("attribute"), `attribute should be excluded, got ${labels}`);
    });

    test("enumerated attribute value completion", async () => {
        const content = '<AbstractChangeEvent operation="';
        const items = await completionsIn(content, content);
        const labels = labelsOf(items);
        assert.deepStrictEqual(labels.sort(), ["Add", "Modify", "Remove"]);
    });

    test("no element completion inside a BeanShell CDATA region", async () => {
        const content = "<Rule name=\"R\"><Source><![CDATA[\nBundle\n]]></Source></Rule>";
        const items = await completionsIn(content, "<Rule name=\"R\"><Source><![CDATA[\nBundle");
        // Other providers (e.g. word-based suggestions matching the literal
        // "Bundle" text already typed) may still contribute plain-word items;
        // ours is the only one that inserts a "<Tag>...' snippet.
        const ourItems = items.filter(item =>
            item.insertText instanceof vscode.SnippetString && item.insertText.value.startsWith("<"));
        assert.deepStrictEqual(ourItems, []);
    });

    test("iiq.xml.completion.enabled = false disables all XML completion", async () => {
        await vscode.workspace.getConfiguration().update(
            CONFIGURATION.xmlCompletionEnabled, false, vscode.ConfigurationTarget.Global);
        try {
            const items = await completionsIn("<List><", "<List><");
            // Other providers (e.g. word-based suggestions pulling words from
            // other open test documents) may still contribute plain-word
            // items; ours is the only one that inserts a "<Tag>...' snippet.
            const ourItems = items.filter(item =>
                item.insertText instanceof vscode.SnippetString && item.insertText.value.startsWith("<"));
            assert.deepStrictEqual(ourItems, []);
        } finally {
            await vscode.workspace.getConfiguration().update(
                CONFIGURATION.xmlCompletionEnabled, undefined, vscode.ConfigurationTarget.Global);
        }
    });
});
