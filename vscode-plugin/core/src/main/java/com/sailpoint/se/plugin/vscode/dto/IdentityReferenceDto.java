package com.sailpoint.se.plugin.vscode.dto;

import lombok.Builder;
import lombok.Value;

/**
 * Reference to another Identity (manager, owner, identity-typed attribute)
 * in the Identity View payloads (see docs/identity-webview.md). Carries just
 * enough to render a clickable label without loading the target object.
 */
@Value
@Builder
public class IdentityReferenceDto {
    String id;
    String name;
    /** Displayable name, falling back to the name server-side */
    String displayName;
}
