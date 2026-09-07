import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { MCP_ENV_TOKEN, MCP_ENV_URL, MCP_SERVER_LABEL } from "../constants";
import type { BridgeNdjsonLine } from "./bridgeServer";
import { MCP_TOOLS } from "./toolDefinitions";

const MISSING_BRIDGE =
    "The IdentityIQ MCP bridge is not running. Open VS Code or Cursor with the SailPoint IdentityIQ extension activated.";

async function main(): Promise<void> {
    const baseUrl = process.env[MCP_ENV_URL];
    const token = process.env[MCP_ENV_TOKEN];

    const server = new Server(
        { name: "identityiq", version: process.env.IIQ_MCP_VERSION ?? "1.1.0" },
        {
            capabilities: { tools: {} },
            instructions: "IdentityIQ tools. Omit tenant to use the active environment, or pass a friendly name or unique URL substring."
        }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        if (!baseUrl || !token) {
            return { tools: MCP_TOOLS };
        }
        const response = await fetch(`${baseUrl}/tools`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
            throw new Error(await readHttpError(response, "Failed to list IdentityIQ MCP tools"));
        }
        const body = await response.json() as { tools: typeof MCP_TOOLS };
        return { tools: body.tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        if (!baseUrl || !token) {
            return errorResult(MISSING_BRIDGE);
        }
        const response = await fetch(`${baseUrl}/tools/${encodeURIComponent(request.params.name)}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ arguments: request.params.arguments ?? {} }),
            signal: extra.signal
        });

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("ndjson")) {
            const message = await readHttpError(response, `Tool ${request.params.name} failed`);
            return errorResult(message);
        }

        if (!response.body) {
            return errorResult("Empty response from the IdentityIQ MCP bridge.");
        }

        let lastResult: unknown;
        let lastError: string | undefined;
        let progress = 0;
        for await (const line of readNdjson(response.body)) {
            if (line.type === "progress") {
                progress++;
                const token = extra._meta?.progressToken;
                if (token !== undefined) {
                    await extra.sendNotification({
                        method: "notifications/progress",
                        params: { progressToken: token, progress, message: line.message }
                    });
                }
            } else if (line.type === "result") {
                lastResult = line.result;
            } else if (line.type === "error") {
                lastError = line.error;
            }
        }

        if (lastError !== undefined) {
            return errorResult(lastError);
        }
        if (lastResult === undefined) {
            return errorResult("The IdentityIQ MCP bridge returned no result.");
        }
        const text = typeof lastResult === "string" ? lastResult : JSON.stringify(lastResult, null, 2);
        return { content: [{ type: "text" as const, text }] };
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<BridgeNdjsonLine> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
            const raw = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (raw) {
                yield JSON.parse(raw) as BridgeNdjsonLine;
            }
            newline = buffer.indexOf("\n");
        }
        if (done) {
            break;
        }
    }
    const rest = buffer.trim();
    if (rest) {
        yield JSON.parse(rest) as BridgeNdjsonLine;
    }
}

async function readHttpError(response: Response, fallback: string): Promise<string> {
    try {
        const body = await response.json() as { error?: string };
        if (body.error) {
            return body.error;
        }
    } catch {
        // ignore
    }
    if (!response.ok) {
        return `${fallback} (HTTP ${response.status}). ${MISSING_BRIDGE}`;
    }
    return fallback;
}

function errorResult(message: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
    return { content: [{ type: "text", text: message }], isError: true };
}

main().catch(error => {
    console.error(`[${MCP_SERVER_LABEL}]`, error instanceof Error ? error.message : error);
    process.exit(1);
});
