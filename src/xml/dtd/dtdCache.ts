/**
 * Loads and caches the parsed DTD: the bundled resources/sailpoint.dtd by
 * default, or the user-configured override path (iiq.xml.dtdPath) when set
 * and readable. Falls back to the bundled DTD with a warning if the
 * override cannot be read or parsed, so a bad setting never fully breaks
 * completion.
 */

import * as fs from "fs";
import * as vscode from "vscode";
import { getXmlDtdPath } from "../../utils/configurationUtils";
import { DtdParseResult, parseDtd } from "./dtdParser";

export class DtdCache implements vscode.Disposable {

    private cached: Promise<DtdParseResult> | undefined;
    private readonly output: vscode.OutputChannel;

    constructor(private readonly bundledPath: string) {
        this.output = vscode.window.createOutputChannel("IdentityIQ XML Completion");
    }

    public get(): Promise<DtdParseResult> {
        this.cached ??= this.load();
        return this.cached;
    }

    public invalidate(): void {
        this.cached = undefined;
    }

    private async load(): Promise<DtdParseResult> {
        const overridePath = getXmlDtdPath();
        if (overridePath) {
            try {
                const text = await fs.promises.readFile(overridePath, "utf8");
                this.log(`Using custom DTD: ${overridePath}`);
                return parseDtd(text);
            } catch (error) {
                this.log(`Cannot read custom DTD at ${overridePath}, falling back to the bundled DTD: ${error}`);
                vscode.window.showWarningMessage(
                    `IdentityIQ XML completion: cannot read the custom DTD at "${overridePath}", using the bundled DTD instead.`);
            }
        }
        const text = await fs.promises.readFile(this.bundledPath, "utf8");
        this.log(`Using the bundled DTD: ${this.bundledPath}`);
        return parseDtd(text);
    }

    private log(message: string): void {
        this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
    }

    public dispose(): void {
        this.output.dispose();
    }
}
