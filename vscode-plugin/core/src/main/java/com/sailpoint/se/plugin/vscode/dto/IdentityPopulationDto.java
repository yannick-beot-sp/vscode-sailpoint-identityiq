package com.sailpoint.se.plugin.vscode.dto;

import lombok.Builder;
import lombok.Value;

/**
 * A {@code DynamicScope} (QuickLink population) that matched the identity
 * of the Identity View cube (see docs/identity-webview.md).
 */
@Value
@Builder
public class IdentityPopulationDto {
    String id;
    String name;
    String description;
}
