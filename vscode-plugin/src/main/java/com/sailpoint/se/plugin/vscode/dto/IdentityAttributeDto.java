package com.sailpoint.se.plugin.vscode.dto;

import lombok.Builder;
import lombok.Value;

/**
 * One entry of the flat attribute list of the Identity View cube
 * (see docs/identity-webview.md). Standard and extended attributes are not
 * distinguished: the webview renders a single filterable grid.
 */
@Value
@Builder
public class IdentityAttributeDto {
    String name;
    /** Displayable name of the attribute definition, null when it has none */
    String label;
    /** "boolean", "string", "date" or "identity": drives the rendering */
    String type;
    /** Boolean for "boolean", ISO-8601 string for "date", String otherwise */
    Object value;
    /** Resolved target of an "identity" attribute, null for the other types */
    IdentityReferenceDto identity;
}
