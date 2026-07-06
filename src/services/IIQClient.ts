import * as https from "https";
import axios, { AxiosInstance } from "axios";
import { EXPECTED_API_VERSION, PLUGIN_REST_BASE_PATH } from "../constants";
import { ObjectListResult, ObjectSummary } from "../models/ObjectTypes";
import { TenantInfo } from "../models/TenantInfo";
import { getRejectUnauthorized, SortField } from "../utils/configurationUtils";
import { wrapSourceCdata } from "../utils/xmlUtils";
import { TenantService } from "./TenantService";

/**
 * Standard JSON envelope of the plugin REST API (see docs/plugin-api.md):
 * successful responses carry the payload in `result`, failures carry the
 * message in `error`.
 */
interface Envelope<T> {
    result: T;
    error?: string;
}

/** Response of the ping endpoint of the companion plugin */
export interface SystemInfo {
    /** IdentityIQ version, e.g. "8.4p2" */
    version: string;
    /** Version of the companion plugin */
    pluginVersion: string;
    /** Version of the REST API implemented by the plugin */
    apiVersion: number;
    /** Identity used for the connection */
    identity: string;
}

/** Response of the rule execution endpoint of the companion plugin */
export interface RunRuleResult {
    /** Return value of the rule, serialized to JSON by the plugin */
    result: unknown;
    /** Execution time on the server, in milliseconds */
    executionTimeMs?: number;
}

/** Execution status of a task, as returned by the TaskResult status endpoint */
export interface TaskStatus {
    /** Id of the TaskResult */
    id: string;
    /** Name of the TaskResult */
    name: string;
    /** Completion date (ISO-8601), null while the task is still running */
    completed: string | null;
    /** "Success", "Warning", "Error" or "Terminated"; null while running */
    completionStatus: string | null;
    /** Messages accumulated by the task (errors, warnings) */
    messages?: string[];
}

/** A tailable server log file: the target of a file-backed Log4j2 appender */
export interface LogFile {
    /** Appender name — the only identifier accepted by the tail endpoint */
    key: string;
    /** Base name of the file, for display (e.g. "sailpoint.log") */
    fileName: string;
    /** Absolute path on the server, for display only */
    path: string;
    /** Current size in bytes (0 when the file does not exist yet) */
    size: number;
    /** ISO-8601 last modification date, null when the file does not exist */
    lastModified: string | null;
    exists: boolean;
}

/** One chunk of a tailed log file */
export interface LogChunk {
    /** Whole lines only (cut at the last newline); empty when nothing new */
    content: string;
    /** Byte offset to pass on the next call */
    nextOffset: number;
    /** File length observed for this read */
    fileSize: number;
    /** Truncation/rotation was detected and the cursor reset to the tail */
    rotated: boolean;
}

/** Metadata of an object, retrieved with a lightweight HEAD request */
export interface ObjectMetadata {
    /** Size in bytes of the XML representation */
    size: number;
    /** Last modification date, from the Last-Modified header */
    modified?: Date;
    /** Entity tag (hash of the XML), usable for change detection */
    etag?: string;
}

export interface ImportResult {
    /** Names of the objects successfully imported */
    imported: string[];
    /** Errors raised during the import */
    errors: string[];
}

export interface ListObjectsOptions {
    start?: number;
    limit?: number;
    sortBy?: SortField;
    /** Optional case-insensitive filter on the object name */
    query?: string;
    /** Values of the `type` attribute to exclude (e.g. Report, LiveReport) */
    excludeTypes?: string[];
}

/**
 * HTTP client for the companion IdentityIQ plugin REST API.
 * See docs/plugin-api.md for the API specification.
 *
 * Authentication is HTTP Basic, using the credentials stored in the
 * VS Code Secret Storage.
 */
export class IIQClient {

    constructor(
        private readonly tenant: TenantInfo,
        private readonly tenantService: TenantService) { }

    private async getAxios(): Promise<AxiosInstance> {
        const credentials = await this.tenantService.getCredentials(this.tenant.id);
        if (!credentials) {
            throw new Error(`No credentials found for environment "${this.tenant.name}". Please remove and add the environment again.`);
        }
        return axios.create({
            baseURL: this.tenant.url.replace(/\/+$/, "") + PLUGIN_REST_BASE_PATH,
            auth: {
                username: credentials.username,
                password: credentials.password
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized: getRejectUnauthorized()
            }),
            timeout: 60_000
        });
    }

    /**
     * Tests the connection: URL reachable, credentials valid, plugin
     * installed and API version compatible with this extension.
     */
    public async ping(): Promise<SystemInfo> {
        const client = await this.getAxios();
        try {
            const response = await client.get<Envelope<SystemInfo>>("/system/ping");
            const info = response.data.result;
            if (info.apiVersion !== EXPECTED_API_VERSION) {
                throw new Error(`The plugin API version (${info.apiVersion}) is not compatible with this version of the extension (expects ${EXPECTED_API_VERSION}). Please update the iiq-devtools plugin or the extension.`);
            }
            return info;
        } catch (error) {
            throw improveError(error, this.tenant);
        }
    }

    /** Lists objects of a type, paginated and sorted */
    public async listObjects(objectType: string, options: ListObjectsOptions = {}): Promise<ObjectListResult> {
        const client = await this.getAxios();
        try {
            const response = await client.get<Envelope<ObjectSummary[]> & { count: number }>(
                `/objects/${encodeURIComponent(objectType)}`, {
                params: {
                    start: options.start ?? 0,
                    limit: options.limit ?? 200,
                    sortBy: options.sortBy === "lastModified" ? "modified" : "name",
                    sortDir: options.sortBy === "lastModified" ? "desc" : "asc",
                    query: options.query,
                    excludeTypes: options.excludeTypes?.length ? options.excludeTypes.join(",") : undefined
                }
            });
            return { count: response.data.count, objects: response.data.result };
        } catch (error) {
            throw improveError(error, this.tenant);
        }
    }

    /**
     * Gets the XML representation of an object, by name or by id.
     * The plugin cannot return raw XML: the XML travels as a string in the
     * `result` field of the JSON envelope (serialized with toXml() server-side).
     */
    public async getObject(objectType: string, nameOrId: string): Promise<string> {
        const client = await this.getAxios();
        try {
            const response = await client.get<Envelope<string>>(
                `/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(nameOrId)}`);
            return wrapSourceCdata(response.data.result);
        } catch (error) {
            throw improveError(error, this.tenant);
        }
    }

    /**
     * Gets the metadata of an object with a HEAD request, without
     * transferring its XML representation. Much cheaper than getObject:
     * used by the virtual file system for stat, which VS Code calls
     * frequently (editor focus, before saves...).
     * Returns undefined when the object does not exist.
     */
    public async getObjectMetadata(objectType: string, nameOrId: string): Promise<ObjectMetadata | undefined> {
        const client = await this.getAxios();
        try {
            const response = await client.head(
                `/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(nameOrId)}`);
            const lastModified = response.headers["last-modified"];
            return {
                size: parseInt(String(response.headers["content-length"] ?? "0"), 10),
                modified: lastModified ? new Date(String(lastModified)) : undefined,
                etag: response.headers["etag"] ? String(response.headers["etag"]) : undefined
            };
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return undefined;
            }
            throw improveError(error, this.tenant);
        }
    }

    /** Returns undefined instead of throwing when the object does not exist */
    public async getObjectIfExists(objectType: string, nameOrId: string): Promise<string | undefined> {
        try {
            return await this.getObject(objectType, nameOrId);
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                return undefined;
            }
            throw error;
        }
    }

    /**
     * Imports an XML document (single object or <sailpoint> bundle).
     * Equivalent to the IdentityIQ "import from file" feature: objects are
     * created or updated, and references are resolved by name.
     * The XML travels in the `xml` property of a JSON body: the plugin REST
     * filter chain of IdentityIQ never delivers non-JSON request bodies.
     */
    public async importXml(xml: string): Promise<ImportResult> {
        const client = await this.getAxios();
        try {
            const response = await client.post<Envelope<string[]> & { errors: string[] }>(
                "/import", { xml }, {
                headers: { "Content-Type": "application/json" }
            });
            return { imported: response.data.result ?? [], errors: response.data.errors ?? [] };
        } catch (error) {
            throw improveError(error, this.tenant);
        }
    }

    /**
     * Runs a rule on the server and returns its result.
     * @param args optional rule arguments, passed to the rule context
     */
    public async runRule(ruleName: string, args?: Record<string, unknown>): Promise<RunRuleResult> {
        const client = await this.getAxios();
        try {
            const response = await client.post<RunRuleResult>(
                `/objects/Rule/${encodeURIComponent(ruleName)}/run`,
                args ?? {},
                { headers: { "Content-Type": "application/json" } });
            return response.data;
        } catch (error) {
            throw improveError(error, this.tenant);
        }
    }

    /**
     * Launches a task asynchronously on the server.
     * @param args optional task launch arguments, merged into the task attributes
     * @returns the id of the TaskResult tracking the execution
     */
    public async runTask(taskName: string, args?: Record<string, unknown>): Promise<string> {
        const client = await this.getAxios();
        try {
            const response = await client.post<Envelope<string>>(
                `/objects/TaskDefinition/${encodeURIComponent(taskName)}/run`,
                args ?? {},
                { headers: { "Content-Type": "application/json" } });
            return response.data.result;
        } catch (error) {
            throw improveError(error, this.tenant);
        }
    }

    /**
     * Gets the execution status of a task. Cheap by design (projection query
     * server-side): polled while a launched task is running.
     */
    public async getTaskStatus(taskResultNameOrId: string): Promise<TaskStatus> {
        const client = await this.getAxios();
        try {
            const response = await client.get<Envelope<TaskStatus>>(
                `/objects/TaskResult/${encodeURIComponent(taskResultNameOrId)}/status`);
            return response.data.result;
        } catch (error) {
            throw improveError(error, this.tenant);
        }
    }

    /**
     * Lists the tailable server log files: the targets of the file-backed
     * appenders of the live Log4j2 configuration.
     */
    public async getLogFiles(): Promise<LogFile[]> {
        const client = await this.getAxios();
        try {
            const response = await client.get<Envelope<LogFile[]>>("/logs");
            return response.data.result;
        } catch (error) {
            throw improveError(error, this.tenant);
        }
    }

    /**
     * Reads a chunk of a server log file, "tail -f" style. Without an
     * offset (first call), the server returns the trailing window of the
     * file and the cursor to poll from.
     * @param key appender name, from {@link getLogFiles}
     * @param offset byte cursor (`nextOffset` of the previous chunk)
     */
    public async getLogChunk(key: string, offset?: number): Promise<LogChunk> {
        const client = await this.getAxios();
        try {
            const response = await client.get<Envelope<LogChunk>>(
                `/logs/${encodeURIComponent(key)}/tail`, { params: { offset } });
            return response.data.result;
        } catch (error) {
            throw improveError(error, this.tenant);
        }
    }

    /** Deletes an object by name or id */
    public async deleteObject(objectType: string, nameOrId: string): Promise<void> {
        const client = await this.getAxios();
        try {
            await client.delete(`/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(nameOrId)}`);
        } catch (error) {
            throw improveError(error, this.tenant);
        }
    }
}

/**
 * HTTP status of an error raised by an IIQClient method, when there is one.
 * Lets callers classify failures (e.g. stop polling on 401/403) without
 * string-matching the improved message.
 */
export function getErrorStatus(error: unknown): number | undefined {
    if (axios.isAxiosError(error)) {
        return error.response?.status;
    }
    return error instanceof Error ? (error as Error & { status?: number }).status : undefined;
}

/** Converts low-level axios errors to actionable messages */
function improveError(error: unknown, tenant: TenantInfo): Error {
    if (axios.isAxiosError(error)) {
        if (error.response) {
            const withStatus = (improved: Error): Error => {
                (improved as Error & { status?: number }).status = error.response!.status;
                return improved;
            };
            switch (error.response.status) {
                case 401:
                    return withStatus(new Error(`Authentication failed on "${tenant.name}". Please verify the login and password.`));
                case 403:
                    return withStatus(new Error(`Access denied on "${tenant.name}". The user must have the System Administrator capability or the plugin authorization.`));
                case 404:
                    return error; // let callers handle not-found
                default: {
                    const detail = typeof error.response.data === "string"
                        ? error.response.data
                        : (error.response.data as any)?.error ?? (error.response.data as any)?.message ?? "";
                    return withStatus(new Error(`IdentityIQ returned HTTP ${error.response.status} on "${tenant.name}". ${detail}`.trim()));
                }
            }
        }
        if (error.code === "DEPTH_ZERO_SELF_SIGNED_CERT" || error.code === "SELF_SIGNED_CERT_IN_CHAIN"
            || error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || error.code === "CERT_HAS_EXPIRED") {
            return new Error(`SSL certificate verification failed for "${tenant.name}" (${error.code}). You can disable SSL verification with the setting "iiq.connection.rejectUnauthorized".`);
        }
        return new Error(`Could not reach "${tenant.name}" at ${tenant.url} (${error.code ?? error.message}). Please verify the URL.`);
    }
    return error instanceof Error ? error : new Error(String(error));
}
