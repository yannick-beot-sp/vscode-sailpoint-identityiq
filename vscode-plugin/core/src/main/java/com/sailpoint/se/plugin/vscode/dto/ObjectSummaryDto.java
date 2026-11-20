package com.sailpoint.se.plugin.vscode.dto;

import lombok.Builder;
import lombok.Value;

/**
 * One entry of the object list returned by {@code GET /objects/{ObjectType}}
 * (see docs/plugin-api.md). Built from a projection search, never from a
 * fully loaded object.
 */
@Value
@Builder
public class ObjectSummaryDto {
    String id;
    String name;
    /** ISO-8601 creation date, or null */
    String created;
    /** ISO-8601 last modification date, or null */
    String modified;
}
