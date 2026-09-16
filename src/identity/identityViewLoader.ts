/**
 * Data access behind the Identity View webview. Kept out of the editor
 * provider so the resolution rules (URI -> environment -> JSON endpoint) can
 * be exercised without booting a webview.
 */

import * as vscode from "vscode";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { buildResourceUri, parseResourceUri } from "../utils/UriUtils";
import {
    DetailObjectType,
    IdentityReference,
    IdentitySection,
    IdentityView,
    ObjectSummaryView,
    visibleIdentityAttributes,
    visibleIdentityEntitlements
} from "./identityViewModel";

/** Thrown when the URI no longer maps to a registered environment. */
export class UnknownEnvironmentError extends Error {
    constructor(tenantName: string) {
        super(`Environment "${tenantName}" no longer exists.`);
    }
}

function resolveTenant(tenantService: TenantService, uri: vscode.Uri): TenantInfo {
    const parts = parseResourceUri(uri);
    const tenant = tenantService.getTenant(parts.tenantId);
    if (!tenant) {
        throw new UnknownEnvironmentError(parts.tenantName);
    }
    return tenant;
}

/**
 * Loads the identity cube, or a single section for a tab refresh. The
 * environment display name is stamped on the model for the header; the
 * Identity XML is never requested.
 */
export async function loadIdentityView(
    tenantService: TenantService,
    uri: vscode.Uri,
    section?: IdentitySection
): Promise<IdentityView> {
    const parts = parseResourceUri(uri);
    // Resolved once, up front: the environment can be removed while the cube
    // is in flight, and the header must name the environment the data
    // actually came from.
    const tenant = resolveTenant(tenantService, uri);
    const view = await new IIQClient(tenant, tenantService).getIdentityView(parts.objectId, section);
    view.environment = tenant.name;
    view.attributes = visibleIdentityAttributes(view.attributes);
    view.entitlements = visibleIdentityEntitlements(view.entitlements);
    view.quicklinks = view.quicklinks ?? [];
    return view;
}

/**
 * URI of another Identity on the same environment, used when the header
 * manager (or an identity-typed attribute) is opened from the webview.
 */
export function identityReferenceUri(from: vscode.Uri, reference: IdentityReference): vscode.Uri {
    const current = parseResourceUri(from);
    return buildResourceUri({
        tenantId: current.tenantId,
        tenantName: current.tenantName,
        objectType: "Identity",
        objectId: reference.id || reference.name,
        objectName: reference.name
    });
}

/** Loads the summary a detail drawer shows for a role, an entitlement or an account. */
export async function loadObjectSummary(
    tenantService: TenantService,
    uri: vscode.Uri,
    objectType: DetailObjectType,
    nameOrId: string
): Promise<ObjectSummaryView> {
    const tenant = resolveTenant(tenantService, uri);
    return new IIQClient(tenant, tenantService).getObjectSummary(objectType, nameOrId);
}
