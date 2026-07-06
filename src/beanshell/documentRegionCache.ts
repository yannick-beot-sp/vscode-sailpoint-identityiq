/**
 * Per-document cache of the BeanShell regions, keyed by document version.
 * This is the cheap bail-out used by every language provider: for an XML
 * document without <Source> CDATA, the cost is one cached regex scan per
 * document version.
 */

import * as vscode from "vscode";
import { BeanshellRegion, findBeanshellRegions, getRegionAtOffset } from "./beanshellRegions";

interface CacheEntry {
    version: number;
    regions: BeanshellRegion[];
}

export class DocumentRegionCache implements vscode.Disposable {

    private readonly cache = new Map<string, CacheEntry>();
    private readonly subscription: vscode.Disposable;

    constructor() {
        this.subscription = vscode.workspace.onDidCloseTextDocument(
            document => this.cache.delete(document.uri.toString()));
    }

    /** BeanShell regions of the document, recomputed when the version changes */
    public getRegions(document: vscode.TextDocument): BeanshellRegion[] {
        const key = document.uri.toString();
        const entry = this.cache.get(key);
        if (entry && entry.version === document.version) {
            return entry.regions;
        }
        const regions = findBeanshellRegions(document.getText());
        this.cache.set(key, { version: document.version, regions });
        return regions;
    }

    /** The region containing the position, or undefined (fast path) */
    public getRegionAt(document: vscode.TextDocument, position: vscode.Position): BeanshellRegion | undefined {
        return getRegionAtOffset(this.getRegions(document), document.offsetAt(position));
    }

    public dispose(): void {
        this.subscription.dispose();
        this.cache.clear();
    }
}
