package com.sailpoint.se.plugin.vscode.dto;

import lombok.Builder;
import lombok.Value;

/**
 * A tailable log file, element of the {@code GET /logs} response (see
 * docs/plugin-api.md). Log files are the targets of the file-backed
 * appenders of the live Log4j2 configuration — nothing else is readable.
 */
@Value
@Builder
public class LogFileDto {
    /** Log4j2 appender name — the only identifier accepted by the tail endpoint */
    String key;
    /** Base name of the file, for display (e.g. "sailpoint.log") */
    String fileName;
    /** Absolute path, for display only — never accepted as input */
    String path;
    /** Current size in bytes (0 when the file does not exist yet) */
    long size;
    /** ISO-8601 last modification date, null when the file does not exist */
    String lastModified;
    boolean exists;
}
