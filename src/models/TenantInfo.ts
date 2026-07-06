/**
 * An IdentityIQ environment (also called instance or tenant).
 * Stored in the extension global state, except credentials which
 * are stored in the VS Code Secret Storage.
 */
export interface TenantInfo {
    /** Unique, immutable id. Used as key for the secret storage and in resource URIs */
    id: string;
    /** Unique display name */
    name: string;
    /** Base URL of IdentityIQ, e.g. http://localhost:8080/identityiq */
    url: string;
    type: "TENANT";
}

/**
 * Credentials of an environment, stored in the VS Code Secret Storage.
 */
export interface TenantCredentials {
    username: string;
    password: string;
}
