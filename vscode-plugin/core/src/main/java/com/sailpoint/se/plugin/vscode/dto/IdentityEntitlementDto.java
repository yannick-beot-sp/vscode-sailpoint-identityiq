package com.sailpoint.se.plugin.vscode.dto;

import java.util.List;

import lombok.Builder;
import lombok.Value;

/**
 * One entitlement of the Identity View cube (see docs/identity-webview.md).
 */
@Value
@Builder
public class IdentityEntitlementDto {
    /** Id of the IdentityEntitlement itself */
    String id;
    String application;
    /** Native identity of the account that holds this entitlement */
    String nativeIdentity;
    /** ManagedAttribute type: "Entitlement", "Permission"... */
    String type;
    /** Name of the account attribute carrying the entitlement (memberOf...) */
    String name;
    String value;
    /** Role the entitlement comes from, null when aggregated directly */
    String grantedByRole;
    /**
     * Id of the ManagedAttribute describing the value, when one exists. The
     * detail drawer resolves the object with it; without it, it would have
     * to fall back to the raw value, which is not unique across applications.
     */
    String managedAttributeId;
    /** Displayable names of the ManagedAttribute classifications */
    List<String> classifications;
}
