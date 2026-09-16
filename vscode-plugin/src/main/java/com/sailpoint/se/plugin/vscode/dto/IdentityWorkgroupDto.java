package com.sailpoint.se.plugin.vscode.dto;

import java.util.List;

import lombok.Builder;
import lombok.Value;

/**
 * One workgroup the identity is a member of, in the Identity View cube
 * (see docs/identity-webview.md).
 */
@Value
@Builder
public class IdentityWorkgroupDto {
    String id;
    String name;
    String displayName;
    String description;
    /** Capabilities the workgroup grants to its members */
    List<String> capabilities;
}
