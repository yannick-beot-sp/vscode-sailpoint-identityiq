package com.sailpoint.se.plugin.vscode.dto;

import java.util.List;

import lombok.Builder;
import lombok.Value;

/**
 * One effective capability of the Identity View cube
 * (see docs/identity-webview.md).
 */
@Value
@Builder
public class IdentityCapabilityDto {
    String name;
    /** Effective but not held directly: granted through a workgroup */
    boolean inherited;
    /** Workgroups granting it, empty when the capability is direct */
    List<String> workgroups;
}
