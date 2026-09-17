import * as path from "path";
import * as vscode from "vscode";
import { CONFIGURATION } from "../constants";
import { ALL_OBJECT_TYPES, ObjectSummary } from "../models/ObjectTypes";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient } from "../services/IIQClient";
import { PathProposer } from "../services/PathProposer";
import { TenantService } from "../services/TenantService";
import {
    BulkClassSpec,
    getBundleParentNames,
    getRootAttribute,
    matchesBundle,
    matchesClassProperty,
    parseBulkClassNames,
    parseProperties,
    transformBulkXml
} from "../utils/bulkExportUtils";
import { getXmlCleaningOptions } from "../utils/configurationUtils";
import { getObjectInfoFromXml, wrapSourceCdata } from "../utils/xmlUtils";
import { chooseTenant } from "../utils/vsCodeHelpers";
import { TenantTreeItem } from "../views/IIQTreeItem";

interface IndexedXml {
    uri: vscode.Uri;
    relativePath: string;
    xml: string;
}

interface BulkSettings {
    classNames: string;
    regex: RegExp;
    fromDate?: Date;
    bundleFilter: string;
    bundleTypeFilter: string;
    addCData: boolean;
    stripMetadata: boolean;
    stripTDEmailMetadata: boolean;
    stripProfiles: boolean;
    stripRoleMetadata: boolean;
    sortObjectConfigIdentity: boolean;
    customIgnore: string[];
    targetPropsFile: string;
    simplePropsFile: string;
    mergeCompareDirPath: string;
    ignoreDirPath: string;
    modelDirPath: string;
    resolveIdsToNames: boolean;
}

export class BulkExportCommands {
    constructor(private readonly tenantService: TenantService) { }

    public async exportObjects(node?: TenantTreeItem): Promise<void> {
        const tenant = node?.tenant ?? await chooseTenant(this.tenantService, "Export IdentityIQ objects in bulk");
        if (!tenant) {
            return;
        }
        try {
            const settings = this.readSettings();
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Bulk exporting from ${tenant.name}`,
                cancellable: true
            }, (progress, token) => this.run(tenant, settings, progress, token));
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    private async run(tenant: TenantInfo, settings: BulkSettings,
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        cancellation: vscode.CancellationToken): Promise<void> {
        const client = new IIQClient(tenant, this.tenantService);
        const model = await this.indexXmlDirectory(settings.modelDirPath);
        const ignored = await this.indexXmlDirectory(settings.ignoreDirPath);
        const baselines = await this.indexXmlDirectory(settings.mergeCompareDirPath);
        const ignoreKeys = new Set(ignored.keys());
        const simpleTokens = await this.readProperties(settings.simplePropsFile);
        const xpathTokens = await this.readProperties(settings.targetPropsFile);
        const specs = parseBulkClassNames(settings.classNames, ALL_OBJECT_TYPES);
        const pull = specs.some(spec => spec.objectType.toLowerCase() === "pull");
        const work = pull
            ? [...model.entries()].map(([key]) => {
                const separator = key.indexOf("\0");
                return { spec: { objectType: key.slice(0, separator) }, name: key.slice(separator + 1) };
            })
            : await this.listWork(client, specs, settings, progress, cancellation);
        let exported = 0;
        const perType = new Map<string, number>();
        const idNames = new Map<string, string | undefined>();
        const bundleMatches = new Map<string, boolean>();

        for (const { spec, name } of work) {
            if (cancellation.isCancellationRequested) {
                break;
            }
            const key = objectKey(spec.objectType, name);
            if (ignoreKeys.has(key)) {
                continue;
            }
            progress.report({ message: `${spec.objectType}: ${name}` });
            let xml = await client.getObject(spec.objectType, name, settings.addCData);
            if (!matchesClassProperty(xml, spec)
                || (spec.objectType === "Bundle"
                    && (!matchesBundle(xml, settings.bundleTypeFilter, "")
                        || !await this.matchesBundleHierarchy(
                            client, xml, settings.bundleFilter, bundleMatches, new Set())))) {
                continue;
            }
            const subtype = getRootAttribute(xml, "type");
            const baseline = baselines.get(key);
            if (baseline && isMergeType(spec.objectType)) {
                xml = await client.mergeObjectXml(spec.objectType, name, baseline.xml);
                if (settings.addCData) {
                    xml = wrapSourceCdata(xml);
                }
            }
            xml = transformBulkXml(xml, spec.objectType, {
                cleaning: getXmlCleaningOptions(),
                stripMetadata: settings.stripMetadata,
                stripTDEmailMetadata: settings.stripTDEmailMetadata,
                stripProfiles: settings.stripProfiles,
                stripRoleMetadata: settings.stripRoleMetadata,
                sortObjectConfigIdentity: settings.sortObjectConfigIdentity,
                customIgnore: settings.customIgnore,
                simpleTokens,
                xpathTokens
            });
            if (settings.resolveIdsToNames) {
                xml = await resolveIds(xml, client, idNames);
            }
            // A model file has priority; otherwise use the configured PathProposer pattern.
            const modelFile = model.get(key);
            const filename = modelFile?.relativePath
                ?? PathProposer.getBulkExportFilename(tenant.name, spec.objectType, name, subtype);
            const target = this.resolveOutputUri(filename);
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(target.fsPath)));
            await vscode.workspace.fs.writeFile(target, Buffer.from(xml, "utf8"));
            exported++;
            perType.set(spec.objectType, (perType.get(spec.objectType) ?? 0) + 1);
        }

        const details = [...perType.entries()].map(([type, count]) => `${type}: ${count}`).join(", ");
        const suffix = cancellation.isCancellationRequested ? " (cancelled)" : "";
        vscode.window.showInformationMessage(`${exported} objects exported${suffix}${details ? ` — ${details}` : ""}.`);
    }

    private async listWork(client: IIQClient, specs: BulkClassSpec[], settings: BulkSettings,
        progress: vscode.Progress<{ message?: string }>, cancellation: vscode.CancellationToken)
        : Promise<Array<{ spec: BulkClassSpec; name: string }>> {
        const work: Array<{ spec: BulkClassSpec; name: string }> = [];
        for (const spec of specs.filter(item => item.objectType.toLowerCase() !== "pull")) {
            let start = 0;
            let total = 0;
            do {
                if (cancellation.isCancellationRequested) {
                    return work;
                }
                progress.report({ message: `Listing ${spec.objectType}...` });
                const page = await client.listObjects(spec.objectType, {
                    start,
                    limit: 500,
                    includeTemplates: spec.objectType === "TaskDefinition"
                });
                total = page.count;
                for (const object of page.objects) {
                    if (this.includeSummary(object, settings)) {
                        work.push({ spec, name: object.name });
                    }
                }
                start += page.objects.length;
                if (page.objects.length === 0) {
                    break;
                }
            } while (start < total);
        }
        return work;
    }

    private includeSummary(object: ObjectSummary, settings: BulkSettings): boolean {
        if (!settings.regex.test(object.name)) {
            return false;
        }
        settings.regex.lastIndex = 0;
        if (!settings.fromDate) {
            return true;
        }
        return [object.created, object.modified]
            .filter((value): value is string => Boolean(value))
            .some(value => new Date(value) >= settings.fromDate!);
    }

    private async matchesBundleHierarchy(client: IIQClient, xml: string, target: string,
        cache: Map<string, boolean>, visited: Set<string>): Promise<boolean> {
        if (!target) {
            return true;
        }
        const name = getRootAttribute(xml, "name") ?? "";
        if (name.toLowerCase() === target.toLowerCase()) {
            return true;
        }
        if (cache.has(name)) {
            return cache.get(name)!;
        }
        if (visited.has(name)) {
            return false;
        }
        visited.add(name);
        for (const parent of getBundleParentNames(xml)) {
            if (parent.toLowerCase() === target.toLowerCase()) {
                cache.set(name, true);
                return true;
            }
            const parentXml = await client.getObjectIfExists("Bundle", parent);
            if (parentXml && await this.matchesBundleHierarchy(client, parentXml, target, cache, visited)) {
                cache.set(name, true);
                return true;
            }
        }
        cache.set(name, false);
        return false;
    }

    private readSettings(): BulkSettings {
        const config = vscode.workspace.getConfiguration();
        const regexValue = config.get<string>(CONFIGURATION.bulkExportRegexFilter, "") || ".*";
        let regex: RegExp;
        try {
            regex = new RegExp(`^(?:${regexValue})$`);
        } catch (error) {
            throw new Error(`Invalid iiq.export.bulkExport.regexFilter: ${String(error)}`);
        }
        const fromDateValue = config.get<string>(CONFIGURATION.bulkExportFromDate, "").trim();
        const fromDate = fromDateValue ? new Date(fromDateValue) : undefined;
        if (fromDate && Number.isNaN(fromDate.getTime())) {
            throw new Error(`Invalid iiq.export.bulkExport.fromDate: "${fromDateValue}"`);
        }
        return {
            classNames: config.get<string>(CONFIGURATION.bulkExportClassNames, "default"),
            regex,
            fromDate,
            bundleFilter: config.get<string>(CONFIGURATION.bulkExportBundleFilter, "").trim(),
            bundleTypeFilter: config.get<string>(CONFIGURATION.bulkExportBundleTypeFilter, "").trim(),
            addCData: config.get<boolean>(CONFIGURATION.bulkExportAddCData, true),
            stripMetadata: config.get<boolean>(CONFIGURATION.bulkExportStripMetadata, true),
            stripTDEmailMetadata: config.get<boolean>(CONFIGURATION.bulkExportStripTDEmailMetadata, false),
            stripProfiles: config.get<boolean>(CONFIGURATION.bulkExportStripProfiles, false),
            stripRoleMetadata: config.get<boolean>(CONFIGURATION.bulkExportStripRoleMetadata, false),
            sortObjectConfigIdentity: config.get<boolean>(
                CONFIGURATION.bulkExportSortObjectConfigIdentity, true),
            customIgnore: config.get<string>(CONFIGURATION.bulkExportCustomIgnore, "")
                .split(",").map(value => value.trim()).filter(Boolean),
            targetPropsFile: config.get<string>(CONFIGURATION.bulkExportTargetPropsFile, "").trim(),
            simplePropsFile: config.get<string>(CONFIGURATION.bulkExportSimplePropsFile, "").trim(),
            mergeCompareDirPath: config.get<string>(CONFIGURATION.bulkExportMergeCompareDirPath, "").trim(),
            ignoreDirPath: config.get<string>(CONFIGURATION.bulkExportIgnoreDirPath, "").trim(),
            modelDirPath: config.get<string>(CONFIGURATION.bulkExportModelDirPath, "").trim(),
            resolveIdsToNames: config.get<boolean>(CONFIGURATION.bulkExportResolveIdsToNames, false)
        };
    }

    private async readProperties(configuredPath: string): Promise<Map<string, string> | undefined> {
        if (!configuredPath) {
            return undefined;
        }
        const uri = this.resolveInputUri(configuredPath);
        return parseProperties(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8"));
    }

    private async indexXmlDirectory(configuredPath: string): Promise<Map<string, IndexedXml>> {
        const result = new Map<string, IndexedXml>();
        if (!configuredPath) {
            return result;
        }
        const root = this.resolveInputUri(configuredPath);
        for (const file of await collectXmlFiles(root)) {
            const xml = Buffer.from(await vscode.workspace.fs.readFile(file)).toString("utf8");
            const info = getObjectInfoFromXml(xml);
            if (info) {
                result.set(objectKey(info.objectType, info.name), {
                    uri: file,
                    relativePath: path.relative(root.fsPath, file.fsPath),
                    xml
                });
            }
        }
        return result;
    }

    private resolveInputUri(configuredPath: string): vscode.Uri {
        if (path.isAbsolute(configuredPath)) {
            return vscode.Uri.file(configuredPath);
        }
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspace) {
            throw new Error(`A workspace is required to resolve "${configuredPath}".`);
        }
        return vscode.Uri.joinPath(workspace, configuredPath);
    }

    private resolveOutputUri(filename: string): vscode.Uri {
        if (path.isAbsolute(filename)) {
            return vscode.Uri.file(filename);
        }
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspace) {
            throw new Error("The bulk export filename must be absolute when no workspace is open.");
        }
        return vscode.Uri.joinPath(workspace, filename);
    }
}

async function collectXmlFiles(directory: vscode.Uri): Promise<vscode.Uri[]> {
    const files: vscode.Uri[] = [];
    for (const [name, type] of await vscode.workspace.fs.readDirectory(directory)) {
        const child = vscode.Uri.joinPath(directory, name);
        if (type === vscode.FileType.Directory) {
            files.push(...await collectXmlFiles(child));
        } else if (type === vscode.FileType.File && name.toLowerCase().endsWith(".xml")) {
            files.push(child);
        }
    }
    return files;
}

function objectKey(objectType: string, name: string): string {
    return `${objectType}\0${name}`;
}

function isMergeType(objectType: string): boolean {
    return ["Configuration", "UIConfig", "ObjectConfig", "AuditConfig", "Dictionary"].includes(objectType);
}

async function resolveIds(xml: string, client: IIQClient,
    cache: Map<string, string | undefined>): Promise<string> {
    const ids = new Set(xml.match(/[0-9a-fA-F]{32}/g) ?? []);
    let result = xml;
    for (const id of ids) {
        if (!cache.has(id)) {
            cache.set(id, await client.resolveObjectName(id));
        }
        const name = cache.get(id);
        if (name) {
            result = result.replaceAll(id, name);
        }
    }
    return result;
}
