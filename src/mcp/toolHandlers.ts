import axios from "axios";
import { TASK_POLL_INTERVAL_MS, TASK_WAIT_CAP_MS } from "../constants";
import { getObjectTypeDefinition } from "../models/ObjectTypes";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient, SortField, TaskStatus, TenantCredentialsProvider } from "../services/IIQClient";
import { resolveTenant } from "./tenantResolver";

export interface McpHandlerOptions {
    taskPollIntervalMs?: number;
    taskWaitCapMs?: number;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface McpToolCallExtras {
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
}

export interface McpTenantSource extends TenantCredentialsProvider {
    getTenants(): TenantInfo[];
    getActiveTenant(): TenantInfo | undefined;
}

type Handler = (
    args: Record<string, unknown>,
    extras: McpToolCallExtras
) => Promise<unknown>;

/**
 * Executes MCP tools against IdentityIQ via {@link IIQClient}.
 * Runs in the extension host (has TenantService / SecretStorage).
 */
export class McpToolExecutor {

    private readonly handlers: Record<string, Handler>;

    constructor(
        private readonly tenantService: McpTenantSource,
        private readonly options: McpHandlerOptions = {}) {
        this.handlers = {
            iiq_list_tenants: () => this.listTenants(),
            iiq_ping: args => this.client(args).then(c => c.ping()),
            iiq_list_objects: args => this.listObjects(args),
            iiq_get_object: args => this.getObject(args),
            iiq_import_xml: args => this.importXml(args),
            iiq_delete_object: args => this.deleteObject(args),
            iiq_run_rule: args => this.runRule(args),
            iiq_run_task: (args, extras) => this.runTask(args, extras),
            iiq_get_task_status: args => this.getTaskStatus(args),
            iiq_test_application_connection: args => this.testApplication(args),
            iiq_peek_application_objects: args => this.peekObjects(args),
            iiq_list_log_files: args => this.client(args).then(c => c.getLogFiles()),
            iiq_get_log_chunk: args => this.getLogChunk(args),
            iiq_set_logger_level: args => this.setLoggerLevel(args),
            iiq_reset_logger_level: args => this.resetLoggerLevel(args)
        };
    }

    public async execute(
        name: string,
        args: Record<string, unknown>,
        extras: McpToolCallExtras = {}): Promise<unknown> {
        const handler = this.handlers[name];
        if (!handler) {
            throw new Error(`Unknown tool "${name}".`);
        }
        try {
            return await handler(args, extras);
        } catch (error) {
            throw new Error(formatToolError(error));
        }
    }

    private async listTenants(): Promise<unknown> {
        const activeId = this.tenantService.getActiveTenant()?.id;
        return this.tenantService.getTenants().map(tenant => ({
            id: tenant.id,
            name: tenant.name,
            url: tenant.url,
            active: tenant.id === activeId
        }));
    }

    private async listObjects(args: Record<string, unknown>): Promise<unknown> {
        const objectType = requiredString(args, "objectType");
        const client = await this.client(args);
        const definition = getObjectTypeDefinition(objectType);
        return client.listObjects(objectType, {
            start: optionalNumber(args, "start"),
            limit: optionalNumber(args, "limit"),
            query: optionalString(args, "query"),
            sortBy: optionalString(args, "sortBy") as SortField | undefined,
            excludeTypes: definition?.excludeTypes
        });
    }

    private async getObject(args: Record<string, unknown>): Promise<string> {
        const client = await this.client(args);
        return client.getObject(requiredString(args, "objectType"), requiredString(args, "nameOrId"));
    }

    private async importXml(args: Record<string, unknown>): Promise<unknown> {
        const client = await this.client(args);
        return client.importXml(requiredString(args, "xml"));
    }

    private async deleteObject(args: Record<string, unknown>): Promise<unknown> {
        const objectType = requiredString(args, "objectType");
        const nameOrId = requiredString(args, "nameOrId");
        await (await this.client(args)).deleteObject(objectType, nameOrId);
        return { deleted: true, objectType, nameOrId };
    }

    private async runRule(args: Record<string, unknown>): Promise<unknown> {
        const client = await this.client(args);
        return client.runRule(requiredString(args, "name"), optionalObject(args, "args"));
    }

    private async runTask(args: Record<string, unknown>, extras: McpToolCallExtras): Promise<unknown> {
        const name = requiredString(args, "name");
        const wait = args.wait !== false;
        const client = await this.client(args);
        const taskResultId = await client.runTask(name, optionalObject(args, "args"));
        if (!wait) {
            return {
                status: "running",
                taskResultId,
                hint: "The task was launched. Call iiq_get_task_status with this taskResultId to follow progress."
            };
        }

        const pollMs = this.options.taskPollIntervalMs ?? TASK_POLL_INTERVAL_MS;
        const capMs = this.options.taskWaitCapMs ?? TASK_WAIT_CAP_MS;
        const sleep = this.options.sleep ?? abortableSleep;
        const deadline = Date.now() + capMs;
        extras.onProgress?.(`Task "${name}" launched (TaskResult ${taskResultId}). Waiting for completion...`);

        while (Date.now() < deadline) {
            if (extras.signal?.aborted) {
                return stillRunning(taskResultId,
                    "Waiting was cancelled. The task keeps running on the server. Call iiq_get_task_status with this taskResultId.");
            }
            const status = await client.getTaskStatus(taskResultId);
            if (status.completed) {
                return { status: "completed", taskResultId, ...status };
            }
            extras.onProgress?.(formatProgress(name, status));
            await sleep(pollMs, extras.signal);
        }

        const last = await client.getTaskStatus(taskResultId);
        if (last.completed) {
            return { status: "completed", taskResultId, ...last };
        }
        return stillRunning(taskResultId,
            `The task is still running after ${Math.round(capMs / 1000)}s. Call iiq_get_task_status with this taskResultId.`,
            last);
    }

    private async getTaskStatus(args: Record<string, unknown>): Promise<TaskStatus> {
        const client = await this.client(args);
        return client.getTaskStatus(requiredString(args, "nameOrId"));
    }

    private async testApplication(args: Record<string, unknown>): Promise<unknown> {
        const name = requiredString(args, "name");
        const message = await (await this.client(args)).testApplicationConnection(name);
        return { application: name, message };
    }

    private async peekObjects(args: Record<string, unknown>): Promise<unknown> {
        const client = await this.client(args);
        return client.testConnectorObjects(
            requiredString(args, "applicationName"),
            requiredString(args, "schemaObjectType"),
            {
                start: optionalNumber(args, "start"),
                limit: optionalNumber(args, "limit"),
                page: optionalNumber(args, "page")
            });
    }

    private async getLogChunk(args: Record<string, unknown>): Promise<unknown> {
        const client = await this.client(args);
        return client.getLogChunk(requiredString(args, "key"), optionalNumber(args, "offset"));
    }

    private async setLoggerLevel(args: Record<string, unknown>): Promise<unknown> {
        const logger = requiredString(args, "logger");
        const level = requiredString(args, "level");
        const applied = await (await this.client(args)).setLoggerLevel(logger, level);
        return { logger, level: applied };
    }

    private async resetLoggerLevel(args: Record<string, unknown>): Promise<unknown> {
        const logger = requiredString(args, "logger");
        await (await this.client(args)).resetLoggerLevel(logger);
        return { logger, reset: true };
    }

    private async client(args: Record<string, unknown>): Promise<IIQClient> {
        const tenant = resolveTenant(
            optionalString(args, "tenant"),
            this.tenantService.getTenants(),
            this.tenantService.getActiveTenant());
        return new IIQClient(tenant, this.tenantService);
    }
}

function stillRunning(taskResultId: string, hint: string, status?: TaskStatus): Record<string, unknown> {
    return {
        status: "running",
        taskResultId,
        hint,
        ...(status ?? {})
    };
}

function formatProgress(taskName: string, status: TaskStatus): string {
    const extra = (status.messages ?? []).length ? ` Messages: ${status.messages!.join("; ")}` : "";
    return `Task "${taskName}" still running (TaskResult ${status.name ?? status.id}).${extra}`;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}

function requiredString(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`Missing required parameter "${key}".`);
    }
    return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
    const value = args[key];
    return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
    const value = args[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalObject(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
    const value = args[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return undefined;
}

export function formatToolError(error: unknown): string {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
        const data = error.response.data;
        if (typeof data === "string" && data.trim()) {
            return data;
        }
        if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
            return (data as { error: string }).error;
        }
        return error.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
