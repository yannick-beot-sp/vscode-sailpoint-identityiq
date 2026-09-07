import * as path from "path";
import * as vscode from "vscode";
import {
    MCP_ENV_TOKEN,
    MCP_ENV_URL,
    MCP_PROVIDER_ID,
    MCP_SERVER_LABEL
} from "../constants";
import { TenantService } from "../services/TenantService";
import { McpBridgeServer } from "./bridgeServer";
import { McpToolExecutor } from "./toolHandlers";

/**
 * Starts the loopback MCP bridge and registers the stdio MCP server with
 * VS Code Copilot and, when available, Cursor.
 */
export async function registerIdentityIqMcp(
    context: vscode.ExtensionContext,
    tenantService: TenantService): Promise<vscode.Disposable> {

    const bridge = new McpBridgeServer(new McpToolExecutor(tenantService));
    await bridge.start();

    const stdioArgs = [path.join(context.extensionPath, "dist", "mcp-stdio.js")];
    const env: Record<string, string> = {
        [MCP_ENV_URL]: bridge.url,
        [MCP_ENV_TOKEN]: bridge.bearerToken,
        IIQ_MCP_VERSION: context.extension.packageJSON.version ?? ""
    };

    const subscriptions: vscode.Disposable[] = [];

    if (typeof vscode.lm?.registerMcpServerDefinitionProvider === "function") {
        subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
            provideMcpServerDefinitions: () => [
                new vscode.McpStdioServerDefinition(
                    MCP_SERVER_LABEL,
                    process.execPath,
                    stdioArgs,
                    env,
                    context.extension.packageJSON.version)
            ]
        }));
    }

    const cursorMcp = getCursorMcp();
    if (cursorMcp) {
        cursorMcp.registerServer({
            name: MCP_PROVIDER_ID,
            server: {
                command: process.execPath,
                args: stdioArgs,
                env
            }
        });
        subscriptions.push({
            dispose: () => cursorMcp.unregisterServer(MCP_PROVIDER_ID)
        });
    }

    subscriptions.push({
        dispose: () => {
            void bridge.stop();
        }
    });

    return vscode.Disposable.from(...subscriptions);
}

interface CursorMcpApi {
    registerServer(config: {
        name: string;
        server: { command: string; args: string[]; env: Record<string, string> };
    }): void;
    unregisterServer(serverName: string): void;
}

function getCursorMcp(): CursorMcpApi | undefined {
    const cursor = (vscode as unknown as { cursor?: { mcp?: CursorMcpApi } }).cursor;
    return cursor?.mcp;
}
