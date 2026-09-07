import { ALL_OBJECT_TYPES } from "../models/ObjectTypes";

export interface McpJsonSchema {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
}

export interface McpToolAnnotations {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
}

export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: McpJsonSchema;
    annotations?: McpToolAnnotations;
}

const TENANT_PROP = {
    type: "string",
    description: "Environment friendly name or a unique substring of its URL (e.g. a hostname fragment). Defaults to the active environment."
};

function objectSchema(
    properties: Record<string, unknown>,
    required: string[] = [],
    extra: { additionalProperties?: boolean } = {}): McpJsonSchema {
    const schema: McpJsonSchema = {
        type: "object",
        properties: { ...properties, tenant: TENANT_PROP }
    };
    if (required.length > 0) {
        schema.required = required;
    }
    if (extra.additionalProperties !== undefined) {
        schema.additionalProperties = extra.additionalProperties;
    }
    return schema;
}

const readOnly: McpToolAnnotations = { readOnlyHint: true, openWorldHint: true };
const mutating: McpToolAnnotations = { readOnlyHint: false, openWorldHint: true };
const destructive: McpToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

export const MCP_TOOLS: McpToolDefinition[] = [
    {
        name: "iiq_list_tenants",
        description: "List configured IdentityIQ environments (id, friendly name, URL, whether it is the active default). Does not include credentials.",
        inputSchema: { type: "object", properties: {} },
        annotations: { title: "List environments", readOnlyHint: true, openWorldHint: false }
    },
    {
        name: "iiq_ping",
        description: "Test the connection to an IdentityIQ environment: URL reachable, credentials valid, companion plugin installed and API version compatible.",
        inputSchema: objectSchema({}),
        annotations: { title: "Test connection", ...readOnly }
    },
    {
        name: "iiq_list_objects",
        description: "List IdentityIQ objects of a given type, paginated and optionally filtered by name.",
        inputSchema: objectSchema({
            objectType: {
                type: "string",
                description: "IdentityIQ class name, e.g. Rule, Workflow, TaskDefinition, Application.",
                enum: ALL_OBJECT_TYPES
            },
            start: { type: "integer", minimum: 0, description: "Pagination offset. Defaults to 0." },
            limit: { type: "integer", minimum: 1, description: "Page size. Defaults to 200." },
            query: { type: "string", description: "Optional case-insensitive filter on the object name." },
            sortBy: { type: "string", enum: ["name", "lastModified"], description: "Sort field. Defaults to name." }
        }, ["objectType"]),
        annotations: { title: "List objects", ...readOnly }
    },
    {
        name: "iiq_get_object",
        description: "Get the XML representation of an IdentityIQ object by type and name or id.",
        inputSchema: objectSchema({
            objectType: {
                type: "string",
                description: "IdentityIQ class name, e.g. Rule, Workflow, TaskDefinition.",
                enum: ALL_OBJECT_TYPES
            },
            nameOrId: { type: "string", description: "Object name or id." }
        }, ["objectType", "nameOrId"]),
        annotations: { title: "Get object", ...readOnly }
    },
    {
        name: "iiq_import_xml",
        description: "Import an XML document (single object or <sailpoint> bundle). Creates or updates objects by name, equivalent to IdentityIQ import-from-file.",
        inputSchema: objectSchema({
            xml: { type: "string", description: "IdentityIQ XML to import." }
        }, ["xml"]),
        annotations: { title: "Import XML", ...mutating }
    },
    {
        name: "iiq_delete_object",
        description: "Delete an IdentityIQ object by type and name or id.",
        inputSchema: objectSchema({
            objectType: { type: "string", enum: ALL_OBJECT_TYPES },
            nameOrId: { type: "string", description: "Object name or id." }
        }, ["objectType", "nameOrId"]),
        annotations: { title: "Delete object", ...destructive }
    },
    {
        name: "iiq_run_rule",
        description: "Run a Rule on the server and return its result.",
        inputSchema: objectSchema({
            name: { type: "string", description: "Rule name or id." },
            args: { type: "object", additionalProperties: true, description: "Optional arguments passed to the rule context." }
        }, ["name"], { additionalProperties: true }),
        annotations: { title: "Run rule", ...mutating }
    },
    {
        name: "iiq_run_task",
        description: "Launch a TaskDefinition. By default waits (with progress) until the task completes or a 2-minute cap is reached. Pass wait=false to return the TaskResult id immediately. If still running at the cap, call iiq_get_task_status with the returned id.",
        inputSchema: objectSchema({
            name: { type: "string", description: "TaskDefinition name or id." },
            args: { type: "object", additionalProperties: true, description: "Optional launch arguments merged into the task attributes." },
            wait: { type: "boolean", description: "If true (default), poll until completion or the wait cap. If false, return the TaskResult id immediately." }
        }, ["name"], { additionalProperties: true }),
        annotations: { title: "Run task", ...mutating }
    },
    {
        name: "iiq_get_task_status",
        description: "Get the execution status of a TaskResult (id or name), including completionStatus and messages.",
        inputSchema: objectSchema({
            nameOrId: { type: "string", description: "TaskResult id or name." }
        }, ["nameOrId"]),
        annotations: { title: "Get task status", ...readOnly }
    },
    {
        name: "iiq_test_application_connection",
        description: "Test an Application connector configuration (testConfiguration on the server).",
        inputSchema: objectSchema({
            name: { type: "string", description: "Application name or id." }
        }, ["name"]),
        annotations: { title: "Test application connection", ...readOnly }
    },
    {
        name: "iiq_peek_application_objects",
        description: "Preview objects returned by an Application connector for a schema (e.g. account, group).",
        inputSchema: objectSchema({
            applicationName: { type: "string", description: "Application name." },
            schemaObjectType: { type: "string", description: "Schema objectType to preview, e.g. account or group." },
            start: { type: "integer", minimum: 0 },
            limit: { type: "integer", minimum: 1 },
            page: { type: "integer", minimum: 1 }
        }, ["applicationName", "schemaObjectType"]),
        annotations: { title: "Peek application objects", ...readOnly }
    },
    {
        name: "iiq_list_log_files",
        description: "List tailable server log files (file-backed Log4j2 appenders).",
        inputSchema: objectSchema({}),
        annotations: { title: "List log files", ...readOnly }
    },
    {
        name: "iiq_get_log_chunk",
        description: "Read a chunk of a server log file. Omit offset on the first call to get the trailing window; then pass nextOffset from the previous chunk.",
        inputSchema: objectSchema({
            key: { type: "string", description: "Appender name from iiq_list_log_files." },
            offset: { type: "integer", minimum: 0, description: "Byte cursor (nextOffset of the previous chunk)." }
        }, ["key"]),
        annotations: { title: "Get log chunk", ...readOnly }
    },
    {
        name: "iiq_set_logger_level",
        description: "Set a logger level at runtime on the server (in-memory Log4j2 change, not persisted).",
        inputSchema: objectSchema({
            logger: { type: "string", description: "Logger name, e.g. sailpoint.api." },
            level: { type: "string", enum: ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "OFF"] }
        }, ["logger", "level"]),
        annotations: { title: "Set logger level", ...mutating }
    },
    {
        name: "iiq_reset_logger_level",
        description: "Remove a logger's explicit level override so it inherits from its parent.",
        inputSchema: objectSchema({
            logger: { type: "string", description: "Logger name." }
        }, ["logger"]),
        annotations: { title: "Reset logger level", ...mutating }
    }
];

export function getMcpTool(name: string): McpToolDefinition | undefined {
    return MCP_TOOLS.find(tool => tool.name === name);
}
