import * as crypto from "crypto";
import * as http from "http";
import { AddressInfo } from "net";
import { McpToolExecutor } from "./toolHandlers";
import { MCP_TOOLS, getMcpTool } from "./toolDefinitions";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface BridgeNdjsonProgress {
    type: "progress";
    message: string;
}

export interface BridgeNdjsonResult {
    type: "result";
    result: unknown;
}

export interface BridgeNdjsonError {
    type: "error";
    error: string;
}

export type BridgeNdjsonLine = BridgeNdjsonProgress | BridgeNdjsonResult | BridgeNdjsonError;

/**
 * Loopback HTTP bridge used by the MCP stdio process.
 * Credentials never leave the extension host: the stdio proxy only holds a bearer token.
 */
export class McpBridgeServer {

    private readonly server: http.Server;
    private readonly token: string;
    private listening = false;

    constructor(private readonly executor: McpToolExecutor) {
        this.token = crypto.randomBytes(32).toString("hex");
        this.server = http.createServer((req, res) => {
            void this.handle(req, res);
        });
    }

    public get url(): string {
        const address = this.server.address() as AddressInfo | null;
        if (!address) {
            throw new Error("MCP bridge is not listening.");
        }
        return `http://127.0.0.1:${address.port}`;
    }

    public get bearerToken(): string {
        return this.token;
    }

    public async start(): Promise<void> {
        if (this.listening) {
            return;
        }
        await new Promise<void>((resolve, reject) => {
            this.server.once("error", reject);
            this.server.listen(0, "127.0.0.1", () => {
                this.server.off("error", reject);
                this.listening = true;
                resolve();
            });
        });
    }

    public async stop(): Promise<void> {
        if (!this.listening) {
            return;
        }
        await new Promise<void>((resolve, reject) => {
            this.server.close(err => err ? reject(err) : resolve());
        });
        this.listening = false;
    }

    private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        try {
            const url = new URL(req.url ?? "/", "http://127.0.0.1");
            if (!this.isAuthorized(req)) {
                json(res, 401, { error: "Unauthorized" });
                return;
            }
            if (req.method === "GET" && url.pathname === "/health") {
                json(res, 200, { ok: true });
                return;
            }
            if (req.method === "GET" && url.pathname === "/tools") {
                json(res, 200, { tools: MCP_TOOLS });
                return;
            }
            const toolMatch = url.pathname.match(/^\/tools\/([^/]+)$/);
            if (req.method === "POST" && toolMatch) {
                await this.callTool(decodeURIComponent(toolMatch[1]), req, res);
                return;
            }
            json(res, 404, { error: `Not found: ${req.method} ${url.pathname}` });
        } catch (error) {
            if (!res.headersSent) {
                json(res, 500, { error: error instanceof Error ? error.message : String(error) });
            }
        }
    }

    private isAuthorized(req: http.IncomingMessage): boolean {
        const header = req.headers.authorization ?? "";
        return header === `Bearer ${this.token}`;
    }

    private async callTool(name: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (!getMcpTool(name)) {
            json(res, 404, { error: `Unknown tool "${name}".` });
            return;
        }
        let body: { arguments?: Record<string, unknown> };
        try {
            body = await readJsonBody(req);
        } catch (error) {
            json(res, 400, { error: error instanceof Error ? error.message : String(error) });
            return;
        }
        const args = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
        const abort = new AbortController();
        req.on("close", () => {
            if (!res.writableEnded) {
                abort.abort();
            }
        });

        res.writeHead(200, {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache"
        });
        try {
            const result = await this.executor.execute(name, args, {
                signal: abort.signal,
                onProgress: message => writeLine(res, { type: "progress", message })
            });
            writeLine(res, { type: "result", result });
        } catch (error) {
            writeLine(res, { type: "error", error: error instanceof Error ? error.message : String(error) });
        }
        res.end();
    }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(payload);
}

function writeLine(res: http.ServerResponse, line: BridgeNdjsonLine): void {
    res.write(JSON.stringify(line) + "\n");
}

function readJsonBody(req: http.IncomingMessage): Promise<{ arguments?: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("error", reject);
        req.on("end", () => {
            if (size === 0) {
                resolve({});
                return;
            }
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                if (parsed && typeof parsed === "object") {
                    resolve(parsed as { arguments?: Record<string, unknown> });
                } else {
                    reject(new Error("Request body must be a JSON object."));
                }
            } catch {
                reject(new Error("Request body is not valid JSON."));
            }
        });
    });
}
