package com.sailpoint.se.plugin.vscode.dto;

import java.util.List;

import lombok.Builder;
import lombok.Value;

/**
 * A QuickLink whose attached population(s) match the identity of the
 * Identity View cube (see docs/identity-webview.md).
 */
@Value
@Builder
public class IdentityQuickLinkDto {
    String id;
    String name;
    String category;
    String action;
    boolean disabled;
    /** DynamicScopes of this QuickLink that the identity is a member of */
    List<IdentityPopulationDto> populations;
}
