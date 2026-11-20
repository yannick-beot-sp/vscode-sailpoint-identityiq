package com.sailpoint.se.plugin.vscode.dto;

import java.util.List;

import lombok.Builder;
import lombok.Value;

/**
 * Payload of {@code GET /objects/{Bundle|ManagedAttribute|Link}/{nameOrId}/summary}:
 * what the Identity webview's detail drawer shows when a role, an
 * entitlement or an account is clicked (see docs/identity-webview.md).
 * Unlike {@link ObjectSummaryDto}, which is a row of the object list, this is
 * a per-object detail; the fields that do not apply to the type are null.
 */
@Value
@Builder
public class ObjectDetailDto {
    String id;
    /** Name of the object; the native identity for a Link, which has none */
    String name;
    String displayName;
    /** Bundle type (business, it...) or ManagedAttribute type (Entitlement...) */
    String type;
    IdentityReferenceDto owner;
    String description;
    /** Bundle and Link */
    Boolean disabled;
    /** ManagedAttribute and Link */
    String application;
    /** ManagedAttribute only: the raw entitlement value */
    String value;
    /** Displayable names of the classifications carried by the object */
    List<String> classifications;
    /** Link only: application instance, for template applications */
    String instance;
    /** Link only */
    Boolean locked;
    /** Link only: whether IIQ correlated the account by hand */
    Boolean manuallyCorrelated;
    /** Link only: ISO-8601 date of the last aggregation of the account */
    String lastRefresh;
    /** Link only: the aggregated account attributes */
    List<IdentityAttributeDto> attributes;
}
