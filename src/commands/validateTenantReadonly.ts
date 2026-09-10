import { TenantInfo } from "../models/TenantInfo";
import { TenantService } from "../services/TenantService";
import { confirm } from "../utils/vsCodeHelpers";

/** Returns true when a mutating action may continue. */
export async function validateTenantReadonly(
    tenantService: TenantService,
    tenant: TenantInfo,
    actionName: string): Promise<boolean> {
    const current = tenantService.getTenant(tenant.id) ?? tenant;
    if (current.readOnly === true) {
        return confirm(
            `The environment "${current.name}" is read-only. Do you still want to ${actionName}?`,
            "Continue");
    }
    return true;
}

/** Returns whether the environment is configured as read-only. */
export function isTenantReadonly(tenantService: TenantService, tenant: TenantInfo): boolean {
    return (tenantService.getTenant(tenant.id) ?? tenant).readOnly === true;
}
