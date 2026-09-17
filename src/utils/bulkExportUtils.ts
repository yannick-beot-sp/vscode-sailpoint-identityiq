import { cleanXml, XmlCleaningOptions } from "./xmlUtils";

export const DEFAULT_BULK_EXPORT_CLASSES = [
    "Application", "AuditConfig", "Bundle", "Capability", "Configuration",
    "CorrelationConfig", "Custom", "Dictionary", "DynamicScope", "EmailTemplate",
    "Form", "FullTextIndex", "GroupFactory", "IdentityTrigger", "IntegrationConfig",
    "LocalizedAttribute", "MessageTemplate", "ObjectConfig", "PasswordPolicy", "Plugin",
    "Policy", "QuickLink", "QuickLinkOptions", "RightConfig", "Rule", "RuleRegistry",
    "SPRight", "ScoreConfig", "TaskDefinition", "TaskSchedule", "UIConfig", "Workflow",
    "Workgroup"
] as const;

export interface BulkClassSpec {
    objectType: string;
    property?: string;
    value?: string;
}

export interface BulkTransformOptions {
    cleaning: XmlCleaningOptions;
    stripMetadata: boolean;
    stripTDEmailMetadata: boolean;
    stripProfiles: boolean;
    stripRoleMetadata: boolean;
    sortObjectConfigIdentity: boolean;
    customIgnore: string[];
    simpleTokens?: Map<string, string>;
    xpathTokens?: Map<string, string>;
}

/** Resolves `default` and the ObjectExporter `Class:property:value` syntax. */
export function parseBulkClassNames(value: string, allClasses: readonly string[]): BulkClassSpec[] {
    const requested = value.trim()
        ? value.split(",").map(item => item.trim()).filter(Boolean)
        : allClasses.filter(name => !name.includes("Historical") && name !== "ServiceLock");
    const expanded = requested.flatMap(item =>
        item.toLowerCase() === "default" ? [...DEFAULT_BULK_EXPORT_CLASSES] : [item]);
    const unique = new Map<string, BulkClassSpec>();
    for (const item of expanded) {
        if (item.toLowerCase() === "pull") {
            unique.set("pull", { objectType: "pull" });
            continue;
        }
        const [objectType, property, ...rest] = item.split(":");
        if (!objectType) {
            continue;
        }
        unique.set(item.toLowerCase(), {
            objectType,
            property: property || undefined,
            value: property ? rest.join(":") : undefined
        });
    }
    return [...unique.values()];
}

export function parseProperties(content: string): Map<string, string> {
    const values = new Map<string, string>();
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith("!")) {
            continue;
        }
        const separator = line.search(/(?<!\\)[=:]/);
        if (separator < 0) {
            continue;
        }
        const key = line.slice(0, separator).trim().replaceAll("\\=", "=").replaceAll("\\:", ":");
        const value = line.slice(separator + 1).trim();
        values.set(key, value);
    }
    return values;
}

export function getRootAttribute(xml: string, attribute: string): string | undefined {
    const root = xml.replace(/<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, "")
        .match(/<([A-Za-z][\w.]*)\b([^>]*)>/);
    return root?.[2].match(new RegExp(`\\s${escapeRegex(attribute)}="([^"]*)"`))?.[1];
}

export function matchesClassProperty(xml: string, spec: BulkClassSpec): boolean {
    if (!spec.property) {
        return true;
    }
    const expected = spec.value ?? "";
    if (spec.objectType === "ManagedAttribute" && spec.property.toLowerCase() === "application") {
        const applicationRef = xml.match(
            /<ApplicationRef\b[^>]*>([\s\S]*?)<\/ApplicationRef>/)?.[1] ?? "";
        const application = applicationRef.match(/<Reference\b[^>]*\bname="([^"]*)"/)?.[1];
        return application?.toLowerCase() === expected.toLowerCase();
    }
    const rootValue = getRootAttribute(xml, spec.property);
    if (rootValue !== undefined) {
        return rootValue.toLowerCase() === expected.toLowerCase();
    }
    const entry = findEntryValue(xml, spec.property);
    return entry?.toLowerCase() === expected.toLowerCase();
}

export function matchesBundle(xml: string, bundleType: string, parentBundle: string): boolean {
    if (bundleType) {
        const actual = getRootAttribute(xml, "type") ?? findEntryValue(xml, "type");
        if (actual?.toLowerCase() !== bundleType.toLowerCase()) {
            return false;
        }
    }
    if (parentBundle) {
        const name = getRootAttribute(xml, "name");
        if (name?.toLowerCase() === parentBundle.toLowerCase()) {
            return true;
        }
        const inheritance = xml.match(/<Inheritance\b[^>]*>([\s\S]*?)<\/Inheritance>/)?.[1] ?? "";
        return new RegExp(`<Reference\\b[^>]*\\bname="${escapeRegex(parentBundle)}"`, "i").test(inheritance);
    }
    return true;
}

export function getBundleParentNames(xml: string): string[] {
    const inheritance = xml.match(/<Inheritance\b[^>]*>([\s\S]*?)<\/Inheritance>/)?.[1] ?? "";
    return [...inheritance.matchAll(/<Reference\b[^>]*\bname="([^"]*)"/g)].map(match => match[1]);
}

export function transformBulkXml(xml: string, objectType: string, options: BulkTransformOptions): string {
    let result = xml;
    if (options.sortObjectConfigIdentity && objectType === "ObjectConfig"
        && getRootAttribute(result, "name") === "Identity") {
        result = sortRepeatedElements(result, "ObjectAttribute", "name");
    }
    if (options.stripProfiles && objectType === "Bundle") {
        result = removeElement(result, "Profiles");
    }
    if (options.stripRoleMetadata && objectType === "Bundle") {
        result = removeElement(removeElement(result, "RoleIndex"), "RoleScorecard");
        result = removeElement(result, "Scorecard");
    }
    if (options.stripMetadata) {
        const keys = objectType === "Application"
            ? ["acctAggregationStart", "acctAggregationEnd", "deltaAggregation"]
            : objectType === "TaskSchedule"
                ? ["nextActualFireTime"]
                : [];
        result = removeEntries(result, keys);
        if (objectType === "TaskSchedule") {
            result = result.replace(/\s+(?:lastExecution|nextExecution)="[^"]*"/g, "");
        }
        if (objectType === "TaskDefinition" || objectType === "TaskSchedule") {
            result = removeEntriesMatching(result, /^(?:TaskDefinition|TaskSchedule)\./);
        }
    }
    if (options.stripTDEmailMetadata && objectType === "TaskDefinition") {
        result = removeEntriesMatching(result, /^taskCompletionEmail/);
    }
    if (["Application", "TaskDefinition", "TaskSchedule"].includes(objectType)) {
        result = removeEntries(result, options.customIgnore);
    }
    result = applySimpleTokens(result, options.simpleTokens);
    result = applyXpathTokens(result, options.xpathTokens);
    return cleanXml(result, options.cleaning);
}

/**
 * Supports the XPath forms used by ObjectExporter target.properties:
 * `//Element/@attribute`, `/A/B/@attribute`, and `//Element` text values.
 */
export function applyXpathTokens(xml: string, tokens?: Map<string, string>): string {
    let result = xml;
    for (const [xpath, token] of tokens ?? []) {
        if (!token.startsWith("%%")) {
            continue;
        }
        const attr = xpath.match(/\/([A-Za-z][\w.-]*)\/@([A-Za-z][\w.-]*)$/);
        if (attr) {
            const [, element, attribute] = attr;
            const tag = new RegExp(`<${escapeRegex(element)}\\b[^>]*>`, "g");
            result = result.replace(tag, value =>
                value.replace(new RegExp(`(\\s${escapeRegex(attribute)}=")[^"]*(")`), `$1${token}$2`));
            continue;
        }
        const node = xpath.match(/\/([A-Za-z][\w.-]*)$/);
        if (node) {
            const element = escapeRegex(node[1]);
            result = result.replace(
                new RegExp(`(<${element}\\b[^>]*>)[\\s\\S]*?(<\\/${element}>)`, "g"),
                `$1${token}$2`);
        }
    }
    return result;
}

function applySimpleTokens(xml: string, tokens?: Map<string, string>): string {
    let result = xml;
    for (let [left, right] of tokens ?? []) {
        if (right.startsWith("%%")) {
            [left, right] = [right, left];
        }
        const insensitive = left.endsWith("%%%");
        const token = insensitive ? left.slice(0, -1) : left;
        result = result.replace(new RegExp(escapeRegex(right), insensitive ? "gi" : "g"), token);
    }
    return result;
}

function removeEntries(xml: string, keys: string[]): string {
    const wanted = new Set(keys.filter(Boolean));
    return xml.replace(/<entry\b[^>]*\bkey="([^"]*)"[^>]*(?:\/>|>[\s\S]*?<\/entry>)/g,
        (entry, key: string) => wanted.has(key) ? "" : entry);
}

function removeEntriesMatching(xml: string, pattern: RegExp): string {
    return xml.replace(/<entry\b[^>]*\bkey="([^"]*)"[^>]*(?:\/>|>[\s\S]*?<\/entry>)/g,
        (entry, key: string) => pattern.test(key) ? "" : entry);
}

function removeElement(xml: string, element: string): string {
    return xml.replace(new RegExp(`<${element}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${element}>)`, "g"), "");
}

function findEntryValue(xml: string, key: string): string | undefined {
    const escaped = escapeRegex(key);
    return xml.match(new RegExp(`<entry\\b[^>]*\\bkey="${escaped}"[^>]*\\bvalue="([^"]*)"`))?.[1];
}

function sortRepeatedElements(xml: string, element: string, attribute: string): string {
    const pattern = new RegExp(`<${element}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${element}>)`, "g");
    const matches = [...xml.matchAll(pattern)];
    if (matches.length < 2) {
        return xml;
    }
    const sorted = matches.map(match => match[0]).sort((left, right) => {
        const getValue = (value: string) =>
            value.match(new RegExp(`\\s${escapeRegex(attribute)}="([^"]*)"`))?.[1] ?? "";
        return getValue(left).localeCompare(getValue(right), undefined, { sensitivity: "base" });
    });
    let index = 0;
    return xml.replace(pattern, () => sorted[index++]);
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
