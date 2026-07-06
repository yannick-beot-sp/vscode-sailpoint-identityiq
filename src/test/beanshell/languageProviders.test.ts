import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { CONFIGURATION } from "../../constants";
import { getExtensionApi } from "../testHelpers";

const FIXTURE_JAR = path.resolve(__dirname, "../../../src/test/fixtures/fixture.jar");

/**
 * End-to-end tests of the BeanShell language providers, through the real
 * VS Code language APIs on an untitled XML document. The classpath points at
 * the fixture jar; JDK classes come from the bundled core index.
 */
suite("BeanShell language providers Test Suite (end-to-end)", () => {

    const content = `<?xml version='1.0' encoding='UTF-8'?>
<Rule name="Test rule" language="beanshell" type="Correlation">
  <Source><![CDATA[
import com.example.fixture.Dog;
import com.
Dog dog = new Dog();
dog.
environment.
new Dog(
dog.getName();
Anim
  ]]></Source>
</Rule>
`;

    let document: vscode.TextDocument;

    /** Position right after the first occurrence of the marker */
    function positionAfter(marker: string): vscode.Position {
        const offset = content.indexOf(marker);
        assert.ok(offset >= 0, `marker not found: ${marker}`);
        return document.positionAt(offset + marker.length);
    }

    async function completeAfter(marker: string, trigger?: string): Promise<string[]> {
        const list = await vscode.commands.executeCommand<vscode.CompletionList>(
            "vscode.executeCompletionItemProvider",
            document.uri, positionAfter(marker), trigger);
        return list.items.map(item =>
            typeof item.label === "string" ? item.label : item.label.label);
    }

    suiteSetup(async function () {
        this.timeout(30_000);
        await getExtensionApi();
        await vscode.workspace.getConfiguration().update(
            CONFIGURATION.beanshellClasspath, [FIXTURE_JAR], vscode.ConfigurationTarget.Global);
        document = await vscode.workspace.openTextDocument({ language: "xml", content });
        // The class index builds in the background; completion answers with an
        // incomplete list until it is ready — wait for readiness
        for (let attempt = 0; attempt < 50; attempt++) {
            if ((await completeAfter("\ndog.", ".")).includes("bark")) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        assert.fail("the class index never became ready");
    });

    suiteTeardown(async () => {
        await vscode.workspace.getConfiguration().update(
            CONFIGURATION.beanshellClasspath, undefined, vscode.ConfigurationTarget.Global);
    });

    test("member completion after a declared variable", async () => {
        const labels = await completeAfter("\ndog.", ".");
        assert.ok(labels.includes("bark"), `bark expected in ${labels.slice(0, 20)}`);
        assert.ok(labels.includes("getTricks"));
        // Inherited from Animal and from java.lang.Object (JDK index)
        assert.ok(labels.includes("getName"));
        assert.ok(labels.includes("toString"));
        // Constructors are not offered as members
        assert.ok(!labels.includes("<init>"));
    });

    test("member completion on a rule context variable (Correlation)", async () => {
        const labels = await completeAfter("environment.", ".");
        assert.ok(labels.includes("put") && labels.includes("get"),
            `Map members expected, got ${labels.slice(0, 20)}`);
    });

    test("import completion walks the package tree", async () => {
        const labels = await completeAfter("import com.", ".");
        assert.ok(labels.includes("example"), `got ${labels}`);
        assert.ok(labels.includes("*"));
    });

    test("class-name completion on a bare identifier", async () => {
        const labels = await completeAfter("Anim");
        assert.ok(labels.includes("Animal"), `Animal expected in ${labels.length} items`);
        // Context variables of the Correlation rule are offered too
        assert.ok(labels.includes("context") && labels.includes("account"));
    });

    test("no completion outside BeanShell regions", async () => {
        const list = await vscode.commands.executeCommand<vscode.CompletionList>(
            "vscode.executeCompletionItemProvider",
            document.uri, new vscode.Position(1, 4));
        // Other providers (XML/words) may answer; ours must not add classes
        const labels = list.items.map(item =>
            typeof item.label === "string" ? item.label : item.label.label);
        assert.ok(!labels.includes("context"));
    });

    test("hover on a member shows its signature and declaring class", async () => {
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
            "vscode.executeHoverProvider", document.uri, positionAfter("dog.getNa"));
        const text = hovers.map(h => h.contents
            .map(c => (c as vscode.MarkdownString).value ?? String(c)).join("\n")).join("\n");
        assert.ok(text.includes("String getName()"), `unexpected hover: ${text}`);
        assert.ok(text.includes("com.example.fixture.Animal"));
    });

    test("hover on a context variable shows its type and origin", async () => {
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
            "vscode.executeHoverProvider", document.uri, positionAfter("environ"));
        const text = hovers.map(h => h.contents
            .map(c => (c as vscode.MarkdownString).value ?? String(c)).join("\n")).join("\n");
        assert.ok(text.includes("java.util.Map"), `unexpected hover: ${text}`);
        assert.ok(text.includes("Correlation"));
    });

    test("signature help lists constructor overloads", async () => {
        const help = await vscode.commands.executeCommand<vscode.SignatureHelp>(
            "vscode.executeSignatureHelpProvider",
            document.uri, positionAfter("new Dog("), "(");
        assert.ok(help && help.signatures.length === 2,
            `two Dog constructors expected, got ${help?.signatures.map(s => s.label)}`);
        const labels = help.signatures.map(s => s.label);
        assert.ok(labels.some(l => l.includes("String name") && l.includes("double weight")),
            `got ${labels}`);
    });
});
