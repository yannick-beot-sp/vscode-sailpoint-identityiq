import * as crypto from "crypto";
import * as http from "http";
import { AddressInfo } from "net";
import { EXPECTED_API_VERSION, PLUGIN_REST_BASE_PATH } from "../constants";
import { stripXmlEnvelope } from "../utils/xmlUtils";

/**
 * In-memory HTTP server implementing the iiq-devtools plugin REST contract
 * (docs/plugin-api.md). Used by the integration tests to exercise the
 * extension end-to-end without a live IdentityIQ instance.
 */

interface StoredObject {
    id: string;
    name: string;
    created: string;
    modified: string;
    xml: string;
}

interface MockLogFile {
    fileName: string;
    path: string;
    /** File content as bytes, so offsets stay honest with multi-byte text */
    content: Buffer;
}

export class MockPluginServer {

    private readonly server: http.Server;
    /** objects[type][name] = stored object */
    private readonly objects = new Map<string, Map<string, StoredObject>>();
    private idCounter = 0;
    /** Log of the received requests, for assertions on the traffic */
    public readonly requests: Array<{ method: string; path: string }> = [];
    /** Number of status polls a launched task stays "running" before completing */
    public taskPollsBeforeCompletion = 1;
    /** Completion status reported once a launched task completes */
    public taskCompletionStatus = "Success";
    /** taskResultId -> remaining "running" status polls */
    private readonly runningTasks = new Map<string, number>();

    // testConnector state (native IdentityIQ REST endpoint, outside the plugin contract)
    /** `${applicationName}:${schemaObjectType}` -> preview objects */
    private readonly connectorObjects = new Map<string, Record<string, unknown>[]>();
    /** When set, the testConnector endpoint answers with this failure instead */
    public connectorFailure: string | undefined;

    // Server log files state (contract of docs/plugin-api.md §6)
    /** Tailable log files, by appender name */
    private readonly logFiles = new Map<string, MockLogFile>();
    /** First-call tail window; small values make window tests cheap */
    public logInitialWindowBytes = 16 * 1024;
    /** Per-call byte cap; small values make catch-up tests cheap */
    public logMaxChunkBytes = 64 * 1024;

    // Logger levels state (contract of docs/plugin-api.md §8)
    private static readonly VALID_LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL", "OFF"];
    /** Explicit level overrides currently set, by logger name */
    private readonly loggerLevels = new Map<string, string>();

    constructor(
        private readonly username = "spadmin",
        private readonly password = "admin") {
        this.server = http.createServer((req, res) => this.handle(req, res));
    }

    public async start(): Promise<number> {
        await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
        return (this.server.address() as AddressInfo).port;
    }

    public async stop(): Promise<void> {
        await new Promise<void>((resolve, reject) =>
            this.server.close(err => err ? reject(err) : resolve()));
    }

    public get baseUrl(): string {
        return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/identityiq`;
    }

    /** Seeds an object without going through the import endpoint */
    public seed(objectType: string, name: string, xml?: string): void {
        this.store(objectType, name, xml ?? `<${objectType} name="${name}"/>`);
    }

    /** Declares a tailable log file (a file-backed appender server-side) */
    public seedLogFile(key: string, fileName = "sailpoint.log", initialContent = ""): void {
        this.logFiles.set(key, {
            fileName,
            path: `/opt/tomcat/logs/${fileName}`,
            content: Buffer.from(initialContent, "utf8")
        });
    }

    /** Appends text to a mock log file (the server writing new lines) */
    public appendLog(key: string, text: string): void {
        const file = this.logFiles.get(key)!;
        file.content = Buffer.concat([file.content, Buffer.from(text, "utf8")]);
    }

    /** Simulates a rotation/truncation: the file restarts with new content */
    public truncateLog(key: string, newContent = ""): void {
        this.logFiles.get(key)!.content = Buffer.from(newContent, "utf8");
    }

    public has(objectType: string, name: string): boolean {
        return this.objects.get(objectType)?.has(name) ?? false;
    }

    /** Current level override of a logger, for test assertions (undefined when not overridden) */
    public getLoggerLevel(logger: string): string | undefined {
        return this.loggerLevels.get(logger);
    }

    /** Seeds the objects returned by a testConnector preview call */
    public seedConnectorObjects(applicationName: string, schemaObjectType: string, objects: Record<string, unknown>[]): void {
        this.connectorObjects.set(`${applicationName}:${schemaObjectType}`, objects);
    }

    private store(objectType: string, name: string, xml: string): void {
        let byName = this.objects.get(objectType);
        if (!byName) {
            byName = new Map();
            this.objects.set(objectType, byName);
        }
        const existing = byName.get(name);
        const now = new Date(Date.UTC(2026, 0, 1 + this.idCounter)).toISOString();
        byName.set(name, {
            id: existing?.id ?? (++this.idCounter).toString(16).padStart(32, "0"),
            name,
            created: existing?.created ?? now,
            modified: now,
            xml
        });
    }

    private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
        const chunks: Buffer[] = [];
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => {
            try {
                this.route(req, Buffer.concat(chunks).toString("utf8"), res);
            } catch (error) {
                this.json(res, 500, { error: String(error) });
            }
        });
    }

    private route(req: http.IncomingMessage, body: string, res: http.ServerResponse): void {
        // Basic authentication
        const auth = req.headers.authorization ?? "";
        const expected = "Basic " + Buffer.from(`${this.username}:${this.password}`).toString("base64");
        if (auth !== expected) {
            this.json(res, 401, { error: "Authentication required" });
            return;
        }

        const url = new URL(req.url ?? "/", "http://localhost");
        this.requests.push({ method: req.method ?? "?", path: url.pathname });

        // GET /identityiq/rest/applications/{name}/testConnector/{schemaObjectType}
        // Native IdentityIQ REST endpoint (outside the plugin contract).
        const nativeBase = "/identityiq/rest/applications/";
        if (req.method === "GET" && url.pathname.startsWith(nativeBase)) {
            const segments = url.pathname.substring(nativeBase.length).split("/").map(decodeURIComponent);
            if (segments.length === 3 && segments[1] === "testConnector") {
                this.testConnector(segments[0], segments[2], res);
                return;
            }
        }

        const base = "/identityiq" + PLUGIN_REST_BASE_PATH;
        if (!url.pathname.startsWith(base)) {
            this.json(res, 404, { error: "Unknown path " + url.pathname });
            return;
        }
        const segments = url.pathname.substring(base.length).split("/")
            .filter(s => s.length > 0)
            .map(decodeURIComponent);

        // GET /system/ping
        if (req.method === "GET" && segments[0] === "system" && segments[1] === "ping") {
            this.json(res, 200, {
                result: {
                    version: "8.4p2",
                    pluginVersion: "1.0.0",
                    apiVersion: EXPECTED_API_VERSION,
                    identity: this.username
                }
            });
            return;
        }

        // GET /objects/{type}
        if (req.method === "GET" && segments[0] === "objects" && segments.length === 2) {
            this.list(segments[1], url.searchParams, res);
            return;
        }

        // HEAD|GET|PUT|DELETE /objects/{type}/{nameOrId}
        if (segments[0] === "objects" && segments.length === 3) {
            const [, objectType, nameOrId] = segments;
            const stored = this.find(objectType, nameOrId);
            if (req.method === "HEAD") {
                if (!stored) {
                    res.writeHead(404);
                } else {
                    res.writeHead(200, {
                        "Content-Length": Buffer.byteLength(stored.xml, "utf8"),
                        "Last-Modified": new Date(stored.modified).toUTCString(),
                        "ETag": `"${crypto.createHash("sha256").update(stored.xml).digest("hex")}"`
                    });
                }
                res.end();
                return;
            }
            if (req.method === "GET") {
                if (!stored) {
                    this.json(res, 404, { error: `${objectType} ${nameOrId} not found` });
                } else {
                    // The plugin cannot return raw XML: the XML travels as a
                    // string inside the JSON envelope (toXml() server-side)
                    this.json(res, 200, { result: stored.xml });
                }
                return;
            }
            if (req.method === "PUT") {
                const xml = this.xmlFromBody(body, res);
                if (xml === undefined) {
                    return;
                }
                this.store(objectType, nameOrId, xml);
                this.json(res, 200, { result: xml });
                return;
            }
            if (req.method === "DELETE") {
                if (!stored) {
                    this.json(res, 404, { error: `${objectType} ${nameOrId} not found` });
                } else {
                    this.objects.get(objectType)!.delete(stored.name);
                    res.writeHead(204);
                    res.end();
                }
                return;
            }
        }

        // POST /import
        if (req.method === "POST" && segments[0] === "import") {
            const xml = this.xmlFromBody(body, res);
            if (xml === undefined) {
                return;
            }
            this.import(xml, res);
            return;
        }

        // POST /objects/Rule/{nameOrId}/run
        if (req.method === "POST" && segments[0] === "objects" && segments[1] === "Rule"
            && segments.length === 4 && segments[3] === "run") {
            const nameOrId = segments[2];
            const rule = this.find("Rule", nameOrId);
            if (!rule) {
                this.json(res, 404, { error: `Rule ${nameOrId} not found` });
                return;
            }
            const args = body ? JSON.parse(body) : {};
            this.json(res, 200, {
                result: `ran:${rule.name}:${JSON.stringify(args)}`,
                executionTimeMs: 1
            });
            return;
        }

        // POST /objects/TaskDefinition/{nameOrId}/run
        if (req.method === "POST" && segments[0] === "objects" && segments[1] === "TaskDefinition"
            && segments.length === 4 && segments[3] === "run") {
            const nameOrId = segments[2];
            const task = this.find("TaskDefinition", nameOrId);
            if (!task) {
                this.json(res, 404, { error: `TaskDefinition ${nameOrId} not found` });
                return;
            }
            const resultName = `${task.name} - Result ${++this.idCounter}`;
            this.store("TaskResult", resultName, `<TaskResult name="${resultName}"/>`);
            const taskResult = this.objects.get("TaskResult")!.get(resultName)!;
            this.runningTasks.set(taskResult.id, this.taskPollsBeforeCompletion);
            this.json(res, 200, { result: taskResult.id });
            return;
        }

        // GET /objects/TaskResult/{nameOrId}/status
        if (req.method === "GET" && segments[0] === "objects" && segments[1] === "TaskResult"
            && segments.length === 4 && segments[3] === "status") {
            const stored = this.find("TaskResult", segments[2]);
            if (!stored) {
                this.json(res, 404, { error: `TaskResult ${segments[2]} not found` });
                return;
            }
            const remaining = this.runningTasks.get(stored.id) ?? 0;
            if (remaining > 0) {
                this.runningTasks.set(stored.id, remaining - 1);
                this.json(res, 200, {
                    result: { id: stored.id, name: stored.name, completed: null, completionStatus: null, messages: [] }
                });
            } else {
                this.runningTasks.delete(stored.id);
                this.json(res, 200, {
                    result: {
                        id: stored.id,
                        name: stored.name,
                        completed: stored.modified,
                        completionStatus: this.taskCompletionStatus,
                        messages: []
                    }
                });
            }
            return;
        }

        // GET /logs
        if (req.method === "GET" && segments.length === 1 && segments[0] === "logs") {
            this.json(res, 200, {
                result: [...this.logFiles.entries()].map(([key, file]) => ({
                    key,
                    fileName: file.fileName,
                    path: file.path,
                    size: file.content.length,
                    lastModified: new Date().toISOString(),
                    exists: true
                }))
            });
            return;
        }

        // GET /logs/{key}/tail
        if (req.method === "GET" && segments.length === 3
            && segments[0] === "logs" && segments[2] === "tail") {
            this.tailLog(segments[1], url.searchParams, res);
            return;
        }

        // PUT /logs/levels/{logger}
        if (req.method === "PUT" && segments.length === 3
            && segments[0] === "logs" && segments[1] === "levels") {
            this.setLoggerLevel(segments[2], body, res);
            return;
        }

        // DELETE /logs/levels/{logger}
        if (req.method === "DELETE" && segments.length === 3
            && segments[0] === "logs" && segments[1] === "levels") {
            this.loggerLevels.delete(segments[2]);
            res.writeHead(204);
            res.end();
            return;
        }

        this.json(res, 404, { error: `Unknown endpoint ${req.method} ${url.pathname}` });
    }

    /** Answers a testConnector preview call with the ExtJS grid JSON shape used by IdentityIQ */
    private testConnector(applicationName: string, schemaObjectType: string, res: http.ServerResponse): void {
        if (this.connectorFailure) {
            this.json(res, 200, { status: "failure", errors: [this.connectorFailure] });
            return;
        }
        const objects = this.connectorObjects.get(`${applicationName}:${schemaObjectType}`);
        if (!objects) {
            this.json(res, 200, { status: "failure", errors: [`No schema "${schemaObjectType}" on application "${applicationName}"`] });
            return;
        }
        this.json(res, 200, { status: "success", objects });
    }

    /** Implements the tail contract (docs/plugin-api.md §6) on the byte buffer */
    private tailLog(key: string, params: URLSearchParams, res: http.ServerResponse): void {
        const file = this.logFiles.get(key);
        if (!file) {
            this.json(res, 404, { error: `Unknown log appender: ${key}` });
            return;
        }
        const length = file.content.length;
        const offset = parseInt(params.get("offset") ?? "-1", 10);
        const rotated = offset >= 0 && offset > length;
        const freshWindow = offset < 0 || rotated;
        const start = freshWindow ? Math.max(0, length - this.logInitialWindowBytes) : offset;
        const buffer = file.content.subarray(start, start + Math.min(this.logMaxChunkBytes, length - start));

        // Fresh windows start at an arbitrary byte: skip the partial first line
        let from = 0;
        if (freshWindow && start > 0) {
            const newline = buffer.indexOf(0x0a);
            from = newline >= 0 ? newline + 1 : buffer.length;
        }
        // Cut at the last newline; the partial trailing line waits server-side
        let to = buffer.lastIndexOf(0x0a);
        if (to >= from) {
            to++;
        } else if (buffer.length === this.logMaxChunkBytes) {
            to = buffer.length; // pathological single line: emit anyway
        } else {
            to = from; // no complete line yet
        }

        this.json(res, 200, {
            result: {
                content: buffer.subarray(from, to).toString("utf8"),
                nextOffset: start + to,
                fileSize: length,
                rotated
            }
        });
    }

    /** Implements the PUT /logs/levels/{logger} contract (docs/plugin-api.md §8) */
    private setLoggerLevel(logger: string, body: string, res: http.ServerResponse): void {
        let level: unknown;
        try {
            level = JSON.parse(body).level;
        } catch {
            level = undefined;
        }
        if (typeof level !== "string" || level.length === 0) {
            this.json(res, 400, {
                error: "The request body must be a JSON object with a non-empty \"level\" string property"
            });
            return;
        }
        const upper = level.toUpperCase();
        if (!MockPluginServer.VALID_LEVELS.includes(upper)) {
            this.json(res, 400, {
                error: `Unknown level "${level}": expected one of ${MockPluginServer.VALID_LEVELS.join(", ")}`
            });
            return;
        }
        this.loggerLevels.set(logger, upper);
        this.json(res, 200, { result: upper });
    }

    /**
     * Extracts the XML from the JSON body ({ "xml": "..." }) of a mutation
     * request, answering 400 (and returning undefined) when it is missing —
     * same contract as the real plugin, which never receives raw XML bodies.
     */
    private xmlFromBody(body: string, res: http.ServerResponse): string | undefined {
        let xml: unknown;
        try {
            xml = JSON.parse(body).xml;
        } catch {
            xml = undefined;
        }
        if (typeof xml !== "string" || xml.length === 0) {
            this.json(res, 400, {
                error: "The request body must be a JSON object with a non-empty \"xml\" string property"
            });
            return undefined;
        }
        return xml;
    }

    /** Resolves an object by id first, then by name (same rules as the spec) */
    private find(objectType: string, nameOrId: string): StoredObject | undefined {
        const byName = this.objects.get(objectType);
        if (!byName) {
            return undefined;
        }
        for (const stored of byName.values()) {
            if (stored.id === nameOrId) {
                return stored;
            }
        }
        return byName.get(nameOrId);
    }

    private list(objectType: string, params: URLSearchParams, res: http.ServerResponse): void {
        const start = parseInt(params.get("start") ?? "0", 10);
        const limit = parseInt(params.get("limit") ?? "200", 10);
        const sortBy = params.get("sortBy") ?? "name";
        const sortDir = params.get("sortDir") ?? "asc";
        const excludeTypes = (params.get("excludeTypes") ?? "").split(",").filter(s => s.length > 0);

        let all = [...(this.objects.get(objectType)?.values() ?? [])];
        if (excludeTypes.length > 0) {
            // Same contract as the plugin: exclude on the type attribute,
            // objects without a type are kept
            all = all.filter(stored => {
                const match = /\stype="([^"]*)"/.exec(stored.xml);
                return !match || !excludeTypes.includes(match[1]);
            });
        }
        if (objectType === "TaskDefinition") {
            // Same contract as the plugin: templates are never listed as tasks
            all = all.filter(stored => !/\stemplate="true"/.test(stored.xml));
        }
        all.sort((a, b) => sortBy === "modified"
            ? a.modified.localeCompare(b.modified)
            : a.name.localeCompare(b.name));
        if (sortDir === "desc") {
            all.reverse();
        }
        this.json(res, 200, {
            count: all.length,
            result: all.slice(start, start + limit)
                .map(({ id, name, created, modified }) => ({ id, name, created, modified }))
        });
    }

    private import(xml: string, res: http.ServerResponse): void {
        const imported: string[] = [];
        const errors: string[] = [];
        // Naive sequential scan of the top-level elements of the (unwrapped)
        // document. Good enough for the contract tests.
        const content = stripXmlEnvelope(xml).trim();
        let pos = 0;
        while (pos < content.length) {
            const match = /<([A-Z]\w*)\b[^>]*>/.exec(content.substring(pos));
            if (!match) {
                break;
            }
            const objectType = match[1];
            const elementStart = pos + match.index;
            const elementXml = this.extractElement(content, elementStart, objectType);
            const nameMatch = match[0].match(/\sname="([^"]*)"/);
            if (nameMatch) {
                this.store(objectType, nameMatch[1], elementXml);
                imported.push(`${objectType}:${nameMatch[1]}`);
            } else {
                errors.push(`Object of type ${objectType} has no name`);
            }
            pos = elementStart + elementXml.length;
        }
        if (imported.length === 0 && errors.length === 0) {
            errors.push("No importable object found");
        }
        this.json(res, 200, { result: imported, errors });
    }

    private extractElement(content: string, startIndex: number, objectType: string): string {
        const selfClosing = new RegExp(`^<${objectType}\\b[^>]*/>`);
        const fromStart = content.substring(startIndex);
        if (selfClosing.test(fromStart)) {
            return fromStart.match(selfClosing)![0];
        }
        const endTag = `</${objectType}>`;
        const endIndex = fromStart.indexOf(endTag);
        return endIndex === -1 ? fromStart : fromStart.substring(0, endIndex + endTag.length);
    }

    private json(res: http.ServerResponse, status: number, payload: unknown): void {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
    }
}
