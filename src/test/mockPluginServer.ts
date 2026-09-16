import * as crypto from "crypto";
import * as http from "http";
import { AddressInfo } from "net";
import { EXPECTED_API_VERSION, PLUGIN_REST_BASE_PATH } from "../constants";
import {
    DetailObjectType,
    IdentitySection,
    IdentityView,
    isDetailObjectType,
    ObjectSummaryView
} from "../identity/identityViewModel";
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

    // Log4j2 configuration file (contract of docs/plugin-api.md §1b)
    public log4jConfigFileName = "log4j2.properties";
    public log4jConfig: string | undefined = "rootLogger.level = warn\n";
    public log4jReconfigurations = 0;

    // Identity View (contract of docs/identity-webview.md)
    /** Identity View cubes, by identity name */
    private readonly identityViews = new Map<string, IdentityView>();
    /** Drawer summaries, by `${objectType}:${name}` */
    private readonly objectSummaries = new Map<string, ObjectSummaryView>();

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

    /**
     * Seeds an Identity and its Identity View cube. The default cube covers
     * every renderer of the webview: the four attribute types, an account,
     * assigned/detected/negative roles, an entitlement, direct and inherited
     * capabilities, a workgroup membership, and a matching QuickLink.
     */
    public seedIdentityView(name: string, overrides: Partial<IdentityView> = {}): IdentityView {
        this.seed("Identity", name, `<Identity name="${name}"/>`);
        const stored = this.find("Identity", name)!;
        const view: IdentityView = {
            id: stored.id,
            name,
            displayName: `${name} Display`,
            email: `${name}@example.com`,
            type: "employee",
            inactive: false,
            correlated: true,
            protected: false,
            manager: { id: "manager-id", name: "manager.name", displayName: "Manager Name" },
            lastRefresh: "2026-01-15T10:12:00Z",
            lastLogin: "2026-02-01T08:30:00Z",
            attributes: [
                { name: "firstname", label: "First name", type: "string", value: "Ada" },
                { name: "vip", label: "VIP", type: "boolean", value: false },
                { name: "startDate", label: "Start date", type: "date", value: "2020-03-01T00:00:00Z" },
                {
                    name: "administrator", label: "Administrator", type: "identity", value: "manager.name",
                    identity: { name: "manager.name", displayName: "Manager Name" }
                }
            ],
            accounts: [
                { application: "Active Directory", nativeIdentity: `CN=${name},DC=example`, disabled: false }
            ],
            roles: [
                {
                    name: "Employee", type: "business", assigned: true, detected: true,
                    negative: false, source: "LCM", classifications: ["SOX"]
                },
                {
                    name: "Contractor", type: "organizational", assigned: false, detected: false,
                    negative: true, assignmentId: "assign-1"
                }
            ],
            entitlements: [
                {
                    application: "Active Directory",
                    nativeIdentity: `CN=${name},DC=example`,
                    type: "group", name: "memberOf",
                    value: "CN=Finance", grantedByRole: "Employee",
                    classifications: ["PCI"]
                }
            ],
            capabilities: [
                { name: "SystemAdministrator", inherited: false, workgroups: [] },
                { name: "Certifier", inherited: true, workgroups: ["IT Admins"] }
            ],
            workgroups: [
                {
                    name: "IT Admins", displayName: "IT Admins",
                    description: "Infrastructure team", capabilities: ["Certifier"]
                }
            ],
            quicklinks: [
                {
                    name: "Manage User Access", category: "Tasks", action: "manageAccess",
                    disabled: false,
                    populations: [{ name: "Everyone", description: "All identities" }]
                }
            ],
            ...overrides
        };
        // Accounts carry the id of their Link, which is what an account
        // detail drawer resolves: seed the matching detail alongside them.
        for (const account of view.accounts) {
            account.id = this.seedObjectSummary("Link", account.nativeIdentity, {
                application: account.application,
                disabled: account.disabled
            }).id;
        }
        this.identityViews.set(name, view);
        return view;
    }

    /**
     * Seeds the lazy summary a detail drawer loads for a Bundle, a
     * ManagedAttribute or an account (Link). An account carries no owner or
     * description but the attributes the connector aggregated.
     */
    public seedObjectSummary(
        objectType: DetailObjectType,
        name: string,
        overrides: Partial<ObjectSummaryView> = {}
    ): ObjectSummaryView {
        this.seed(objectType, name, `<${objectType} name="${name}"/>`);
        const specific: Partial<ObjectSummaryView> = objectType === "Link"
            ? {
                application: "Active Directory",
                disabled: false,
                locked: false,
                manuallyCorrelated: false,
                lastRefresh: "2026-02-01T08:30:00Z",
                attributes: [
                    { name: "sAMAccountName", label: "Account name", type: "string", value: name },
                    { name: "memberOf", type: "string", value: "CN=Finance,DC=example" }
                ]
            }
            : {
                type: objectType === "Bundle" ? "business" : "group",
                owner: { name: "spadmin", displayName: "The Administrator" },
                description: `Summary of ${name}`
            };
        const summary: ObjectSummaryView = {
            id: this.find(objectType, name)!.id,
            name,
            displayName: name,
            ...specific,
            ...overrides
        };
        this.objectSummaries.set(`${objectType}:${name}`, summary);
        return summary;
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
        return this.objects.get(this.resolveStorageType(objectType))?.has(name) ?? false;
    }

    /** Current level override of a logger, for test assertions (undefined when not overridden) */
    public getLoggerLevel(logger: string): string | undefined {
        return this.loggerLevels.get(logger);
    }

    /** Seeds the objects returned by a testConnector preview call */
    public seedConnectorObjects(applicationName: string, schemaObjectType: string, objects: Record<string, unknown>[]): void {
        this.connectorObjects.set(`${applicationName}:${schemaObjectType}`, objects);
    }

    /**
     * Workgroup is a virtual alias for Identity (workgroup="true"), matching
     * the plugin contract.
     */
    private resolveStorageType(objectType: string): string {
        return objectType === "Workgroup" ? "Identity" : objectType;
    }

    private store(objectType: string, name: string, xml: string): void {
        const storageType = this.resolveStorageType(objectType);
        let byName = this.objects.get(storageType);
        if (!byName) {
            byName = new Map();
            this.objects.set(storageType, byName);
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
                    pluginVersion: "1.1.0",
                    apiVersion: EXPECTED_API_VERSION,
                    identity: this.username
                }
            });
            return;
        }

        // GET|HEAD|PUT /system/log4j (Log4j2 configuration file)
        if (segments[0] === "system" && segments[1] === "log4j" && segments.length === 2) {
            this.handleLog4jConfig(req.method ?? "GET", body, res);
            return;
        }

        // GET /objects/{type}
        if (req.method === "GET" && segments[0] === "objects" && segments.length === 2) {
            this.list(segments[1], url.searchParams, res);
            return;
        }

        // GET /identities/{nameOrId}/view[?section=]
        if (req.method === "GET" && segments[0] === "identities"
            && segments.length === 3 && segments[2] === "view") {
            this.identityView(segments[1], url.searchParams.get("section"), res);
            return;
        }

        // GET /objects/{Bundle|ManagedAttribute}/{nameOrId}/summary
        if (req.method === "GET" && segments[0] === "objects"
            && segments.length === 4 && segments[3] === "summary") {
            this.objectSummary(segments[1], segments[2], res);
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
                    this.objects.get(this.resolveStorageType(objectType))!.delete(stored.name);
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

    /**
     * Implements GET /identities/{nameOrId}/view (docs/identity-webview.md).
     * A `section` request keeps the header fields and populates only that
     * section, which is all a tab refresh consumes.
     */
    private identityView(nameOrId: string, section: string | null, res: http.ServerResponse): void {
        const stored = this.find("Identity", nameOrId);
        const view = stored ? this.identityViews.get(stored.name) : undefined;
        if (!view) {
            this.json(res, 404, { error: `Identity "${nameOrId}" not found` });
            return;
        }
        if (section === null) {
            this.json(res, 200, { result: view });
            return;
        }
        if (!(section in view) || !Array.isArray((view as unknown as Record<string, unknown>)[section])) {
            this.json(res, 400, { error: `Unknown section "${section}"` });
            return;
        }
        this.json(res, 200, {
            result: {
                ...view,
                attributes: [], accounts: [], roles: [],
                entitlements: [], capabilities: [], workgroups: [], quicklinks: [],
                [section as IdentitySection]: view[section as IdentitySection]
            }
        });
    }

    /** Implements the drawer summary endpoints (docs/identity-webview.md) */
    private objectSummary(objectType: string, nameOrId: string, res: http.ServerResponse): void {
        if (!isDetailObjectType(objectType)) {
            this.json(res, 404, { error: `Summaries are not supported for ${objectType}` });
            return;
        }
        const stored = this.find(objectType, nameOrId);
        const summary = stored ? this.objectSummaries.get(`${objectType}:${stored.name}`) : undefined;
        if (!summary) {
            this.json(res, 404, { error: `${objectType} "${nameOrId}" not found` });
            return;
        }
        this.json(res, 200, { result: summary });
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
        const byName = this.objects.get(this.resolveStorageType(objectType));
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

        let all = [...(this.objects.get(this.resolveStorageType(objectType))?.values() ?? [])];
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
        if (objectType === "Workgroup") {
            // Same contract as the plugin: workgroups are Identity with workgroup=true
            all = all.filter(stored => /\sworkgroup="true"/.test(stored.xml));
        } else if (objectType === "Identity") {
            // Keep regular identities and workgroups in separate lists
            all = all.filter(stored => !/\sworkgroup="true"/.test(stored.xml));
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

    /** Implements GET/HEAD/PUT /system/log4j (Log4j2 configuration file) */
    private handleLog4jConfig(method: string, body: string, res: http.ServerResponse): void {
        const path = `/opt/tomcat/webapps/identityiq/WEB-INF/classes/${this.log4jConfigFileName}`;
        if (method === "HEAD") {
            if (this.log4jConfig === undefined) {
                res.writeHead(404);
            } else {
                res.writeHead(200, {
                    "Content-Length": Buffer.byteLength(this.log4jConfig, "utf8"),
                    "Last-Modified": new Date().toUTCString(),
                    "X-IIQ-File-Name": this.log4jConfigFileName,
                    "ETag": `"${crypto.createHash("sha256").update(this.log4jConfig).digest("hex")}"`
                });
            }
            res.end();
            return;
        }
        if (method === "GET") {
            if (this.log4jConfig === undefined) {
                this.json(res, 404, { error: "The Log4j2 configuration file was not found" });
                return;
            }
            this.json(res, 200, { result: this.log4jConfig, fileName: this.log4jConfigFileName, path });
            return;
        }
        if (method === "PUT") {
            let content: unknown;
            try {
                content = JSON.parse(body).content;
            } catch {
                this.json(res, 400, { error: "Invalid JSON" });
                return;
            }
            if (typeof content !== "string" || content.length === 0) {
                this.json(res, 400, {
                    error: "The request body must be a JSON object with a non-empty \"content\" string property"
                });
                return;
            }
            this.log4jConfig = content;
            this.log4jReconfigurations++;
            this.json(res, 200, {
                result: { path, fileName: this.log4jConfigFileName, size: content.length, reloaded: true }
            });
            return;
        }
        this.json(res, 405, { error: `Unsupported method ${method}` });
    }

    private json(res: http.ServerResponse, status: number, payload: unknown): void {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
    }
}
