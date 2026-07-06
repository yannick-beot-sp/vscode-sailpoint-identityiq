import * as vscode from "vscode";
import { CONFIGURATION } from "../constants";
import { XmlCleaningOptions } from "./xmlUtils";

export type SortField = "name" | "lastModified";

export function getPageSize(): number {
    return vscode.workspace.getConfiguration().get<number>(CONFIGURATION.pageSize, 200);
}

export function getDefaultSort(): SortField {
    return vscode.workspace.getConfiguration().get<SortField>(CONFIGURATION.sort, "name");
}

export function getRejectUnauthorized(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(CONFIGURATION.rejectUnauthorized, true);
}

/**
 * Interval between two polls of the server log stream. Read on every
 * iteration so setting changes apply to running streams.
 */
export function getLogsPollInterval(): number {
    return vscode.workspace.getConfiguration().get<number>(CONFIGURATION.logsPollInterval, 2000);
}

/** BeanShell language assistance kill switch */
export function isBeanshellEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(CONFIGURATION.beanshellEnabled, true);
}

/** Jar files or folders (typically WEB-INF/lib) providing Java metadata */
export function getBeanshellClasspath(): string[] {
    return vscode.workspace.getConfiguration().get<string[]>(CONFIGURATION.beanshellClasspath, []);
}

/** Cap on the number of class-name completion items */
export function getBeanshellMaxCompletionItems(): number {
    return vscode.workspace.getConfiguration().get<number>(CONFIGURATION.beanshellMaxCompletionItems, 500);
}

/** XML completion (element/attribute/value suggestions) kill switch */
export function isXmlCompletionEnabled(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>(CONFIGURATION.xmlCompletionEnabled, true);
}

/** Custom DTD path overriding the bundled sailpoint.dtd, or "" for the bundled default */
export function getXmlDtdPath(): string {
    return vscode.workspace.getConfiguration().get<string>(CONFIGURATION.xmlDtdPath, "");
}

/** Reads the XML cleaning options for export from the user settings */
export function getXmlCleaningOptions(): XmlCleaningOptions {
    const config = vscode.workspace.getConfiguration();
    return {
        removeIds: config.get<boolean>(CONFIGURATION.removeIds, true),
        removeCreatedTimestamp: config.get<boolean>(CONFIGURATION.removeCreatedTimestamp, true),
        removeModifiedTimestamp: config.get<boolean>(CONFIGURATION.removeModifiedTimestamp, true),
        removeReferenceIds: config.get<boolean>(CONFIGURATION.removeReferenceIds, true),
        removeSignificantModified: config.get<boolean>(CONFIGURATION.removeSignificantModified, true),
        cleanForSourceControl: config.get<boolean>(CONFIGURATION.cleanForSourceControl, true)
    };
}
