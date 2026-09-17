import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { CONFIGURATION } from "../constants";
import { getWorkspaceFolder } from "../utils/configurationUtils";
import { normalizeAsFilename } from "../utils/stringUtils";

/**
 * Tokens that can appear in export path patterns (same set as the
 * Identity Security Cloud extension).
 */
export interface PathContext {
    /** User home directory */
    u?: string;
    /** First workspace folder */
    w?: string;
    /** Workspace folder if defined, otherwise home directory */
    x?: string;
    /** Day (UTC, 2 digits) */
    d?: string;
    /** Month (UTC, 2 digits) */
    M?: string;
    /** Year (UTC) */
    y?: string | number;
    /** Hour (UTC, 2 digits) */
    h?: string;
    /** Minute (UTC, 2 digits) */
    m?: string;
    /** Second (UTC, 2 digits) */
    s?: string;
    /** Environment name */
    t?: string;
    /** Environment display name (same as `t` in IdentityIQ) */
    T?: string;
    /** Object type (e.g. Rule, Application) */
    o?: string;
    /** Object name */
    S?: string;
}

const DEFAULT_PATTERNS: Record<string, string> = {
    [CONFIGURATION.exportSingleResourceFilename]: "%x/%S.xml",
    [CONFIGURATION.exportSingleFileFilename]: "%x/export.xml",
    [CONFIGURATION.exportMultipleFilesFolder]: "%x",
    [CONFIGURATION.exportMultipleFilesFilename]: "%o/%S.xml",
    [CONFIGURATION.exportWithDependenciesFilename]: "%x/%S-with-deps.xml"
};

    public static replaceVariables(pathPattern: string, context: PathContext = {}, now = new Date()): string {
        const workspace = getWorkspaceFolder();
        const defaults: PathContext = {
            u: os.homedir(),
            w: workspace,
            x: workspace ?? os.homedir(),
            y: now.getUTCFullYear(),
            M: String(now.getUTCMonth() + 1).padStart(2, "0"),
            d: String(now.getUTCDate()).padStart(2, "0"),
            h: String(now.getUTCHours()).padStart(2, "0"),
            m: String(now.getUTCMinutes()).padStart(2, "0"),
            s: String(now.getUTCSeconds()).padStart(2, "0")
        };
        const values = { ...defaults, ...context };
        let result = pathPattern;
        for (const [key, value] of Object.entries(values)) {
            result = result.replaceAll(`%${key}`, value !== undefined ? String(value) : "");
        }
        return result;
    }

    public static getSingleResourceFilename(
        tenantName: string, objectType: string, objectName: string): string {
        return this.resolveObjectBased(CONFIGURATION.exportSingleResourceFilename, tenantName, objectType, objectName);
    }

    public static getSingleFileFilename(tenantName: string): string {
        return this.resolveTenantBased(CONFIGURATION.exportSingleFileFilename, tenantName);
    }

    public static getMultipleFilesFolder(tenantName: string): string {
        return this.resolveTenantBased(CONFIGURATION.exportMultipleFilesFolder, tenantName);
    }

    public static getMultipleFilesFilename(
        tenantName: string, objectType: string, objectName: string): string {
        return this.resolveObjectBased(CONFIGURATION.exportMultipleFilesFilename, tenantName, objectType, objectName);
    }

    public static getWithDependenciesFilename(
        tenantName: string, objectType: string, objectName: string): string {
        return this.resolveObjectBased(CONFIGURATION.exportWithDependenciesFilename, tenantName, objectType, objectName);
    }

    private static resolveTenantBased(key: string, tenantName: string): string {
        return this.replaceVariables(this.readPattern(key), this.tenantContext(tenantName));
    }

    private static resolveObjectBased(
        key: string, tenantName: string, objectType: string, objectName: string): string {
        return this.replaceVariables(this.readPattern(key), {
            ...this.tenantContext(tenantName),
            o: normalizeAsFilename(objectType),
            S: normalizeAsFilename(objectName)
        });
    }

    private static tenantContext(tenantName: string): PathContext {
        const name = normalizeAsFilename(tenantName);
        return { t: name, T: name };
    }

    private static readPattern(key: string): string {
        return vscode.workspace.getConfiguration().get<string>(key, DEFAULT_PATTERNS[key] ?? "");
    }
}

/** Absolute path as a file URI for save/open dialogs */
export function pathToUri(fsPath: string): vscode.Uri {
    return vscode.Uri.file(path.normalize(fsPath));
}
