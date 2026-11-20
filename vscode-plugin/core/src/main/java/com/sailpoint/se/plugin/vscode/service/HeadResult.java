package com.sailpoint.se.plugin.vscode.service;

import java.util.Date;
import java.util.Map;

/**
 * Metadata of a resource answered to a HEAD request: no body, only headers.
 * (A plain class, not a record: the core targets Java 11.)
 */
public final class HeadResult {

    private final long contentLength;
    private final String etag;
    private final Date lastModified;
    private final Map<String, String> headers;

    /**
     * @param contentLength size of the body a GET would return
     * @param etag change-detection tag (SHA-256 of the body)
     * @param lastModified last modification date, may be null
     * @param headers additional headers (name to value)
     */
    public HeadResult(long contentLength, String etag, Date lastModified, Map<String, String> headers) {
        this.contentLength = contentLength;
        this.etag = etag;
        this.lastModified = lastModified;
        this.headers = headers;
    }

    public long contentLength() {
        return contentLength;
    }

    public String etag() {
        return etag;
    }

    public Date lastModified() {
        return lastModified;
    }

    public Map<String, String> headers() {
        return headers;
    }
}
