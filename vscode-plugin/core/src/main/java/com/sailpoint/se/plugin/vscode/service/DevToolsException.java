package com.sailpoint.se.plugin.vscode.service;

/**
 * Failure of a service call, carrying the HTTP status the REST wrapper must
 * answer with. The service layer is independent of JAX-RS (javax on IIQ 8,
 * jakarta on IIQ 9): each wrapper converts it to a WebApplicationException
 * whose body is {@code { "error": message }}, or, when the exception has a
 * code, {@code { "error": code, "message": message }}.
 */
public class DevToolsException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final int status;
    private final String code;

    public DevToolsException(int status, String message) {
        this(status, null, message);
    }

    public DevToolsException(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    /** HTTP status code to answer with */
    public int getStatus() {
        return status;
    }

    /** Machine-readable error code (e.g. INVALID_FILTER), or null */
    public String getCode() {
        return code;
    }
}
