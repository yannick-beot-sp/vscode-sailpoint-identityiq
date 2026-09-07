import { TenantInfo } from "../models/TenantInfo";

/** Thrown when the optional MCP `tenant` parameter cannot be resolved uniquely */
export class TenantResolveError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TenantResolveError";
    }
}

/**
 * Resolves the MCP `tenant` argument to one environment.
 *
 * - omitted / blank → the active environment
 * - case-insensitive exact match on the friendly name
 * - otherwise a unique case-insensitive substring of the URL
 * - otherwise a unique case-insensitive substring of the name
 */
export function resolveTenant(
    query: string | undefined,
    tenants: TenantInfo[],
    activeTenant: TenantInfo | undefined): TenantInfo {

    const trimmed = query?.trim() ?? "";
    if (!trimmed) {
        if (activeTenant) {
            return activeTenant;
        }
        if (tenants.length === 0) {
            throw new TenantResolveError(
                "No IdentityIQ environment defined. Add one in the IdentityIQ view.");
        }
        throw new TenantResolveError(
            "No active IdentityIQ environment. Pass the \"tenant\" parameter (friendly name or URL substring) or set an active environment.");
    }

    const needle = trimmed.toLowerCase();
    const exactName = tenants.filter(t => t.name.toLowerCase() === needle);
    if (exactName.length === 1) {
        return exactName[0];
    }

    const urlMatches = tenants.filter(t => t.url.toLowerCase().includes(needle));
    if (urlMatches.length === 1) {
        return urlMatches[0];
    }
    if (urlMatches.length > 1) {
        throw ambiguous(trimmed, urlMatches);
    }

    const nameMatches = tenants.filter(t => t.name.toLowerCase().includes(needle));
    if (nameMatches.length === 1) {
        return nameMatches[0];
    }
    if (nameMatches.length > 1) {
        throw ambiguous(trimmed, nameMatches);
    }

    const known = tenants.length === 0
        ? "none"
        : tenants.map(formatTenant).join("; ");
    throw new TenantResolveError(`No environment matches "${trimmed}". Known: ${known}.`);
}

function ambiguous(query: string, matches: TenantInfo[]): TenantResolveError {
    return new TenantResolveError(
        `Ambiguous environment "${query}". Matches: ${matches.map(formatTenant).join("; ")}. Pass a more specific name or URL fragment.`);
}

function formatTenant(tenant: TenantInfo): string {
    return `${tenant.name} (${tenant.url})`;
}
