package com.sailpoint.se.plugin.vscode.dto;

import lombok.Builder;
import lombok.Value;

/**
 * Payload of {@code GET /logs/{key}/tail} (see docs/plugin-api.md). Polled
 * by the extension while it tails a server log file.
 */
@Value
@Builder
public class LogChunkDto {
    /** Whole lines only (cut at the last newline); empty when nothing new */
    String content;
    /** Byte offset to pass on the next call */
    long nextOffset;
    /** File length observed for this read */
    long fileSize;
    /** Truncation/rotation was detected and the cursor was reset to the tail */
    boolean rotated;
}
