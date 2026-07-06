/**
 * Wiring of the DTD-driven XML completion: owns the shared DTD cache and
 * registers the completion provider.
 */

import * as vscode from "vscode";
import { CONFIGURATION } from "../constants";
import { IIQ_XML_DOCUMENT_SELECTOR } from "../documentSelectors";
import { isXmlCompletionEnabled } from "../utils/configurationUtils";
import { DtdCache } from "./dtd/dtdCache";
import { DtdParseResult } from "./dtd/dtdParser";
import { XmlCompletionProvider } from "./providers/XmlCompletionProvider";

/** Shared state of the XML completion feature: the lazily-parsed, cached DTD. */
export class XmlLanguageService implements vscode.Disposable {

    private readonly cache: DtdCache;
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(bundledDtdPath: string) {
        this.cache = new DtdCache(bundledDtdPath);
        this.subscriptions.push(
            this.cache,
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration(CONFIGURATION.xmlDtdPath)) {
                    this.cache.invalidate();
                }
            })
        );
    }

    public isEnabled(): boolean {
        return isXmlCompletionEnabled();
    }

    /** The parsed DTD, loaded and cached on first use */
    public getDtd(): Promise<DtdParseResult> {
        return this.cache.get();
    }

    public dispose(): void {
        this.subscriptions.forEach(subscription => subscription.dispose());
    }
}

/** Registers the XML completion provider. Called once at activation. */
export function registerXmlCompletionSupport(context: vscode.ExtensionContext): vscode.Disposable {
    const service = new XmlLanguageService(context.asAbsolutePath("resources/sailpoint.dtd"));

    return vscode.Disposable.from(
        service,
        vscode.languages.registerCompletionItemProvider(
            IIQ_XML_DOCUMENT_SELECTOR, new XmlCompletionProvider(service), "<", " ", "\"", "'")
    );
}
