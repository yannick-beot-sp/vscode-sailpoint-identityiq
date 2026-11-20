package com.sailpoint.se.plugin.vscode.dto;

import java.util.List;

import lombok.Builder;
import lombok.Value;

/**
 * Payload of {@code GET /identities/{nameOrId}/view}: the read-only identity
 * cube rendered by the Identity webview (see docs/identity-webview.md). The
 * Identity XML is never part of it.
 *
 * A {@code ?section=} request answers with this same shape, the header
 * fields filled and every section but the requested one empty.
 */
@Value
@Builder
public class IdentityViewDto {
    String id;
    String name;
    /** Displayable name, falling back to the name server-side */
    String displayName;
    String email;
    /** Identity type (employee, contractor...), null when not typed */
    String type;
    boolean inactive;
    boolean correlated;
    /**
     * Named {@code isProtected} because {@code protected} is a Java keyword:
     * Lombok generates {@code isProtected()} for it, which serializes to the
     * {@code protected} JSON property the webview expects.
     */
    boolean isProtected;
    IdentityReferenceDto manager;
    /** ISO-8601 date of the last identity refresh, or null */
    String lastRefresh;
    /** ISO-8601 date of the last login, or null */
    String lastLogin;
    List<IdentityAttributeDto> attributes;
    List<IdentityAccountDto> accounts;
    List<IdentityRoleDto> roles;
    List<IdentityEntitlementDto> entitlements;
    List<IdentityCapabilityDto> capabilities;
    List<IdentityWorkgroupDto> workgroups;
    /** QuickLinks whose populations match this identity */
    List<IdentityQuickLinkDto> quicklinks;
}
