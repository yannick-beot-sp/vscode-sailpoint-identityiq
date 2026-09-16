export const IDENTITY_SECTIONS = [
    "attributes",
    "accounts",
    "roles",
    "entitlements",
    "capabilities",
    "workgroups",
    "quicklinks"
] as const;

/**
 * Attribute names the Attributes tab must not repeat: secrets, header
 * fields (manager, last refresh, last login, …) and values already shown
 * as their own tab (assigned/detected roles, capabilities, workgroups).
 */
export const HIDDEN_IDENTITY_ATTRIBUTES = [
    "password", "passwordHistory", "AuthenticationAnswers", "VerificationToken",
    "name", "displayName", "email", "type", "inactive", "correlated", "protected",
    "manager", "lastRefresh", "lastLogin",
    "assignedRoles", "detectedRoles", "bundles", "bundleSummary",
    "capabilities", "rights", "workgroups", "workgroup"
] as const;

/**
 * IdentityEntitlement attribute names that are IIQ roles, already shown
 * on the Roles tab. The same Hibernate table stores both.
 */
export const IDENTITY_ROLE_ENTITLEMENT_NAMES = [
    "assignedRoles", "detectedRoles", "bundles"
] as const;

export type IdentitySection = typeof IDENTITY_SECTIONS[number];
export type IdentityAttributeType = "boolean" | "string" | "date" | "identity";

export interface IdentityReference {
    id?: string;
    name: string;
    displayName?: string;
}

export interface IdentityAttributeView {
    name: string;
    label?: string;
    type: IdentityAttributeType;
    value: string | boolean | null;
    identity?: IdentityReference;
}

export interface IdentityAccountView {
    id?: string;
    application: string;
    nativeIdentity: string;
    disabled: boolean;
}

export interface IdentityRoleView {
    id?: string;
    name: string;
    /** Bundle type (business, it...), shown on the row */
    type?: string;
    assigned: boolean;
    detected: boolean;
    negative: boolean;
    source?: string;
    assignmentId?: string;
    assigner?: string;
    /** Roles whose assignment caused this role to be granted/detected. */
    parentRoleNames?: string[];
    /** Displayable names of the Bundle classifications, shown as badges. */
    classifications?: string[];
}

export interface IdentityEntitlementView {
    id?: string;
    application: string;
    /** Native identity of the account that holds this entitlement. */
    nativeIdentity?: string;
    type: string;
    name: string;
    value: string;
    grantedByRole?: string;
    managedAttributeId?: string;
    /** Displayable names of the ManagedAttribute classifications, shown as badges. */
    classifications?: string[];
}

export interface IdentityCapabilityView {
    name: string;
    inherited: boolean;
    workgroups: string[];
}

export interface IdentityWorkgroupView {
    id?: string;
    name: string;
    displayName?: string;
    description?: string;
    /** Capabilities the workgroup grants to its members. */
    capabilities?: string[];
}

export interface IdentityPopulationView {
    id?: string;
    name: string;
    description?: string;
}

export interface IdentityQuickLinkView {
    id?: string;
    name: string;
    category?: string;
    action?: string;
    disabled: boolean;
    populations: IdentityPopulationView[];
}

export interface IdentityView {
    id: string;
    name: string;
    displayName: string;
    email?: string;
    type?: string;
    inactive: boolean;
    correlated: boolean;
    protected: boolean;
    manager?: IdentityReference;
    lastRefresh?: string;
    lastLogin?: string;
    environment?: string;
    attributes: IdentityAttributeView[];
    accounts: IdentityAccountView[];
    roles: IdentityRoleView[];
    entitlements: IdentityEntitlementView[];
    capabilities: IdentityCapabilityView[];
    workgroups: IdentityWorkgroupView[];
    quicklinks: IdentityQuickLinkView[];
}

export interface ObjectSummaryView {
    id?: string;
    name: string;
    displayName?: string;
    type?: string;
    owner?: IdentityReference;
    description?: string;
    disabled?: boolean;
    application?: string;
    value?: string;
    classifications?: string[];
    action?: string;
    populations?: string[];
    capabilities?: string[];
    /** Account (Link) only, from here down. `name` is then the native identity. */
    instance?: string;
    locked?: boolean;
    manuallyCorrelated?: boolean;
    lastRefresh?: string;
    /** Aggregated account attributes, in the cube attribute shape */
    attributes?: IdentityAttributeView[];
}

/**
 * Object types a detail drawer loads lazily from the plugin
 * (`GET /objects/{type}/{nameOrId}/summary`).
 */
export const DETAIL_OBJECT_TYPES = ["Bundle", "ManagedAttribute", "Link"] as const;

export type DetailObjectType = typeof DETAIL_OBJECT_TYPES[number];

export function isDetailObjectType(value: unknown): value is DetailObjectType {
    return typeof value === "string" && (DETAIL_OBJECT_TYPES as readonly string[]).includes(value);
}

export function isIdentitySection(value: unknown): value is IdentitySection {
    return typeof value === "string" && (IDENTITY_SECTIONS as readonly string[]).includes(value);
}

const HIDDEN_IDENTITY_ATTRIBUTE_NAMES = new Set<string>(HIDDEN_IDENTITY_ATTRIBUTES);

/** Drops secrets and fields already rendered in the header or another tab. */
export function visibleIdentityAttributes(
    attributes: IdentityAttributeView[]
): IdentityAttributeView[] {
    return attributes.filter(attribute => !HIDDEN_IDENTITY_ATTRIBUTE_NAMES.has(attribute.name));
}

const ROLE_ENTITLEMENT_NAMES = new Set<string>(IDENTITY_ROLE_ENTITLEMENT_NAMES);

/** Drops assigned/detected role rows that belong on the Roles tab. */
export function visibleIdentityEntitlements(
    entitlements: IdentityEntitlementView[]
): IdentityEntitlementView[] {
    return entitlements.filter(entitlement => !ROLE_ENTITLEMENT_NAMES.has(entitlement.name));
}

function includesFilter(values: Array<string | undefined>, filter: string): boolean {
    const query = filter.trim().toLocaleLowerCase();
    return !query || values.some(value => value?.toLocaleLowerCase().includes(query));
}

/** Rows shown per page in Accounts, Roles and Entitlements. */
export const IDENTITY_TABLE_PAGE_SIZE = 100;

export const ENTITLEMENT_GROUP_BY = [
    { id: "none", label: "None" },
    { id: "application", label: "Application" },
    { id: "classification", label: "Classification" }
] as const;

export const ACCOUNT_GROUP_BY = [
    { id: "none", label: "None" },
    { id: "application", label: "Application" },
    { id: "nativeIdentity", label: "Native identity" },
    { id: "disabled", label: "Disabled" }
] as const;

export const ROLE_GROUP_BY = [
    { id: "none", label: "Lineage" },
    { id: "type", label: "Type" },
    { id: "name", label: "Name" },
    { id: "classification", label: "Classification" },
    { id: "status", label: "Status" }
] as const;

export type EntitlementGroupBy = typeof ENTITLEMENT_GROUP_BY[number]["id"];
export type AccountGroupBy = typeof ACCOUNT_GROUP_BY[number]["id"];
export type RoleGroupBy = typeof ROLE_GROUP_BY[number]["id"];

export interface NamedGroup<T> {
    key: string;
    label: string;
    items: T[];
    /** Size of the group before pagination, when `items` is a page slice. */
    total?: number;
}

export interface PagedGroups<T> {
    groups: NamedGroup<T>[];
    page: number;
    pageCount: number;
    total: number;
}

/**
 * Accounts as the tab shows them: ordered by application, then by native
 * identity so the several accounts an identity holds on one application
 * stay together and in a stable order.
 */
export function filteredIdentityAccounts(
    accounts: IdentityAccountView[],
    filter: string
): IdentityAccountView[] {
    return accounts
        .filter(account => includesFilter(
            [account.application, account.nativeIdentity, String(account.disabled)],
            filter))
        .sort((left, right) =>
            compareText(left.application, right.application)
            || compareText(left.nativeIdentity, right.nativeIdentity));
}

export function filteredIdentityRoles(
    roles: IdentityRoleView[],
    filter: string
): IdentityRoleView[] {
    return roles.filter(role => includesFilter([
        role.name,
        role.type,
        role.source,
        role.assignmentId,
        role.assigner,
        ...(role.parentRoleNames ?? []),
        ...(role.classifications ?? [])
    ], filter));
}

export function filteredIdentityEntitlements(
    entitlements: IdentityEntitlementView[],
    filter: string,
    onlyAdditional = false
): IdentityEntitlementView[] {
    return entitlements
        .filter(entitlement =>
            (!onlyAdditional || !entitlement.grantedByRole)
            && includesFilter([
                entitlement.application,
                entitlement.nativeIdentity,
                entitlement.type,
                entitlement.name,
                entitlement.value,
                entitlement.grantedByRole,
                ...(entitlement.classifications ?? [])
            ], filter))
        .sort((left, right) =>
            compareText(left.application, right.application)
            || compareText(left.name, right.name)
            || compareText(left.value, right.value));
}

export function groupedIdentityAccounts(
    accounts: IdentityAccountView[],
    groupBy: AccountGroupBy
): NamedGroup<IdentityAccountView>[] {
    return groupItems(accounts, account => {
        if (groupBy === "application") {
            return [labelOrDash(account.application)];
        }
        if (groupBy === "nativeIdentity") {
            return [labelOrDash(account.nativeIdentity)];
        }
        if (groupBy === "disabled") {
            return [account.disabled ? "Disabled" : "Enabled"];
        }
        return [];
    });
}

export function groupedIdentityRoles(
    roles: IdentityRoleView[],
    groupBy: RoleGroupBy
): NamedGroup<IdentityRoleView>[] {
    return groupItems(roles, role => {
        if (groupBy === "type") {
            return [labelOrDash(role.type)];
        }
        if (groupBy === "name") {
            return [labelOrDash(role.name)];
        }
        if (groupBy === "classification") {
            return classificationKeys(role.classifications);
        }
        if (groupBy === "status") {
            const statuses = [
                role.assigned ? "Assigned" : undefined,
                role.detected ? "Detected" : undefined,
                role.negative ? "Negative" : undefined
            ].filter((status): status is string => Boolean(status));
            return statuses.length ? statuses : ["—"];
        }
        return [];
    });
}

export function groupedIdentityEntitlements(
    entitlements: IdentityEntitlementView[],
    groupBy: EntitlementGroupBy
): NamedGroup<IdentityEntitlementView>[] {
    return groupItems(entitlements, entitlement => {
        if (groupBy === "application") {
            return [labelOrDash(entitlement.application)];
        }
        if (groupBy === "classification") {
            return classificationKeys(entitlement.classifications);
        }
        return [];
    });
}

/**
 * One page of grouped rows. Group headers are not counted: a page holds
 * `pageSize` items, and a group that straddles a page boundary is split.
 */
export function pageOfGroups<T>(
    groups: NamedGroup<T>[],
    page: number,
    pageSize = IDENTITY_TABLE_PAGE_SIZE
): PagedGroups<T> {
    const total = groups.reduce((count, group) => count + group.items.length, 0);
    const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
    const safePage = Math.min(Math.max(1, page), pageCount);
    if (!total) {
        return { groups: [], page: 1, pageCount: 1, total: 0 };
    }
    const start = (safePage - 1) * pageSize;
    const end = start + pageSize;
    let index = 0;
    const paged: NamedGroup<T>[] = [];
    for (const group of groups) {
        const groupEnd = index + group.items.length;
        if (groupEnd > start && index < end) {
            paged.push({
                key: group.key,
                label: group.label,
                items: group.items.slice(Math.max(0, start - index), Math.min(group.items.length, end - index)),
                total: group.items.length
            });
        }
        index = groupEnd;
        if (index >= end) {
            break;
        }
    }
    return { groups: paged, page: safePage, pageCount, total };
}

export function filteredIdentityQuickLinks(
    quickLinks: IdentityQuickLinkView[],
    filter: string
): IdentityQuickLinkView[] {
    return quickLinks.filter(quickLink => includesFilter([
        quickLink.name,
        quickLink.category,
        quickLink.action,
        ...quickLink.populations.map(population => population.name)
    ], filter));
}

function compareText(left?: string, right?: string): number {
    return (left ?? "").localeCompare(right ?? "", undefined, { sensitivity: "base" });
}

function labelOrDash(value?: string): string {
    return value?.trim() ? value : "—";
}

function classificationKeys(names?: string[]): string[] {
    const keys = [...new Set((names ?? []).filter(Boolean))];
    return keys.length ? keys : ["Unclassified"];
}

function groupItems<T>(items: T[], keysOf: (item: T) => string[]): NamedGroup<T>[] {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const keys = keysOf(item);
        if (!keys.length) {
            const bucket = groups.get("") ?? [];
            bucket.push(item);
            groups.set("", bucket);
            continue;
        }
        for (const key of keys) {
            const bucket = groups.get(key) ?? [];
            bucket.push(item);
            groups.set(key, bucket);
        }
    }
    return [...groups.entries()]
        .sort((left, right) => compareText(left[0], right[0]))
        .map(([key, grouped]) => ({ key, label: key, items: grouped }));
}
