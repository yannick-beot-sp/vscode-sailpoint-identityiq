package com.sailpoint.se.plugin.vscode.dto;

import java.util.List;

import lombok.Builder;
import lombok.Value;

/**
 * Payload of {@code GET /objects/TaskResult/{nameOrId}/status}
 * (see docs/plugin-api.md). Polled by the extension while a task runs.
 */
@Value
@Builder
public class TaskStatusDto {
    String id;
    String name;
    /** ISO-8601 completion date, null while the task is still running */
    String completed;
    /** "Success", "Warning", "Error" or "Terminated"; null while running */
    String completionStatus;
    /** Messages accumulated by the task (errors, warnings) */
    List<String> messages;
}
