/**
 * Wiring of the BeanShell language assistance: owns the shared services
 * (region cache, lazy class index) and registers the language providers.
 */

import * as vscode from "vscode";
import { CONFIGURATION } from "../constants";
import { IIQ_XML_DOCUMENT_SELECTOR } from "../documentSelectors";
import { getBeanshellClasspath, isBeanshellEnabled } from "../utils/configurationUtils";
import { DocumentRegionCache } from "./documentRegionCache";
import { ClassIndexService } from "./java/ClassIndexService";
import { JdkClassSource } from "./java/jdkIndex";
import { BeanshellCompletionProvider } from "./providers/BeanshellCompletionProvider";
import { BeanshellHoverProvider } from "./providers/BeanshellHoverProvider";
import { BeanshellSignatureHelpProvider } from "./providers/BeanshellSignatureHelpProvider";

/**
 * Shared state of the BeanShell providers. The class index is built in the
 * background as soon as a document containing BeanShell is opened, and
 * rebuilt when the classpath setting changes. Providers that can answer
 * without the index do so immediately instead of waiting for the build.
 */
export class BeanshellLanguageService implements vscode.Disposable {

    public readonly regions = new DocumentRegionCache();

    private indexPromise: Promise<ClassIndexService> | undefined;
    private readyIndex: ClassIndexService | undefined;
    private readonly output: vscode.OutputChannel;
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(private readonly jdkIndexPath: string) {
        this.output = vscode.window.createOutputChannel("IdentityIQ BeanShell");
        this.subscriptions.push(
            this.output,
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration(CONFIGURATION.beanshellClasspath)) {
                    this.log("Classpath setting changed: rebuilding the class index");
                    this.resetIndex();
                }
            }),
            // Warm up the index as soon as BeanShell is on screen, so the
            // first completion does not have to wait for the build
            vscode.workspace.onDidOpenTextDocument(document => this.warmUpFor(document))
        );
        vscode.workspace.textDocuments.forEach(document => this.warmUpFor(document));
    }

    private warmUpFor(document: vscode.TextDocument): void {
        if (this.isEnabled() && document.languageId === "xml"
            && this.regions.getRegions(document).length > 0) {
            this.getIndex();
        }
    }

    public isEnabled(): boolean {
        return isBeanshellEnabled();
    }

    /** The class index, built on first use */
    public getIndex(): Promise<ClassIndexService> {
        this.indexPromise ??= this.buildIndex();
        return this.indexPromise;
    }

    /** The class index if it is already built, without waiting */
    public getIndexIfReady(): ClassIndexService | undefined {
        return this.readyIndex;
    }

    private async buildIndex(): Promise<ClassIndexService> {
        const classpath = getBeanshellClasspath();
        this.log(`Building the class index — classpath: ${classpath.length > 0 ? classpath.join(", ") : "(empty, JDK classes only)"}`);
        const startTime = Date.now();

        let jdkSource: JdkClassSource | undefined;
        try {
            jdkSource = await JdkClassSource.load(this.jdkIndexPath);
        } catch (error) {
            this.log(`Cannot load the bundled JDK core index: ${error}`);
        }
        const index = await ClassIndexService.build(classpath, jdkSource);
        if (index.invalidPaths.length > 0) {
            this.log(`Unreadable classpath entries: ${index.invalidPaths.join(", ")}`);
            vscode.window.showWarningMessage(
                `IdentityIQ BeanShell: cannot read classpath entries: ${index.invalidPaths.join(", ")}`);
        }
        this.log(`Class index ready: ${index.classCount} classes in ${Date.now() - startTime} ms`);
        this.readyIndex = index;
        return index;
    }

    private resetIndex(): void {
        const previous = this.indexPromise;
        this.indexPromise = undefined;
        this.readyIndex = undefined;
        previous?.then(index => index.dispose(), () => { /* build already failed */ });
    }

    private log(message: string): void {
        this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
    }

    public dispose(): void {
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.regions.dispose();
        this.resetIndex();
    }
}

/** Registers the BeanShell language providers. Called once at activation. */
export function registerBeanshellLanguageSupport(context: vscode.ExtensionContext): vscode.Disposable {
    const service = new BeanshellLanguageService(
        context.asAbsolutePath("resources/jdk-core-index.json"));

    return vscode.Disposable.from(
        service,
        vscode.languages.registerCompletionItemProvider(
            IIQ_XML_DOCUMENT_SELECTOR, new BeanshellCompletionProvider(service), "."),
        vscode.languages.registerHoverProvider(
            IIQ_XML_DOCUMENT_SELECTOR, new BeanshellHoverProvider(service)),
        vscode.languages.registerSignatureHelpProvider(
            IIQ_XML_DOCUMENT_SELECTOR, new BeanshellSignatureHelpProvider(service), "(", ",")
    );
}
