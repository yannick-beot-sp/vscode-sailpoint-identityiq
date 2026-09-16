package com.sailpoint.se.plugin.vscode.dto;

import lombok.Builder;
import lombok.Value;

/**
 * One account (Link) of the Identity View cube
 * (see docs/identity-webview.md).
 */
@Value
@Builder
public class IdentityAccountDto {
    String id;
    String application;
    String nativeIdentity;
    boolean disabled;
}
