package com.sailpoint.se.plugin.vscode.dto;

import lombok.Builder;
import lombok.Value;

/**
 * Payload of {@code GET /system/ping} (see docs/plugin-api.md).
 */
@Value
@Builder
public class SystemInfoDto {
    /** IdentityIQ version, including the patch level (e.g. "8.4p2") */
    String version;
    /** Version of the installed plugin */
    String pluginVersion;
    /** Integer version of the REST contract implemented by the plugin */
    int apiVersion;
    /** Name of the authenticated identity */
    String identity;
}
