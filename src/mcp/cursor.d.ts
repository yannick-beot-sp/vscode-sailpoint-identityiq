declare module "vscode" {
    export namespace cursor {
        export namespace mcp {
            export interface StdioServerConfig {
                name: string;
                server: {
                    command: string;
                    args: string[];
                    env: Record<string, string>;
                };
            }

            export interface RemoteServerConfig {
                name: string;
                server: {
                    url: string;
                    headers?: Record<string, string>;
                };
            }

            export type ExtMCPServerConfig = StdioServerConfig | RemoteServerConfig;

            export function registerServer(config: ExtMCPServerConfig): void;
            export function unregisterServer(serverName: string): void;
        }
    }
}
