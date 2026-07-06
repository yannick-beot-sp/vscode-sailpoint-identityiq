import * as vscode from "vscode";
import { COMMANDS } from "../constants";
import { TenantInfo } from "../models/TenantInfo";
import { getErrorStatus, IIQClient, LogChunk, LogFile } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { getLogsPollInterval } from "../utils/configurationUtils";
import { withProgress } from "../utils/vsCodeHelpers";
import { TenantTreeItem } from "../views/IIQTreeItem";
import { QuickPickTenantStep } from "../wizard/quickPickTenantStep";
import { runWizard } from "../wizard/wizard";

/** A tail stops itself after this many consecutive poll failures */
const MAX_CONSECUTIVE_ERRORS = 5;

/** An active tail: one per environment + log file */
interface TailSession {
    tenant: TenantInfo;
    client: IIQClient;
    file: LogFile;
    channel: vscode.OutputChannel;
    /** Byte cursor (`nextOffset` of the last chunk); undefined until the first chunk */
    offset?: number;
    timer?: NodeJS.Timeout;
    stopped: boolean;
    consecutiveErrors: number;
    /** A retry warning was already shown for the current error streak */
    warned: boolean;
}

/**
 * Commands to tail a server log file of an environment into an output
 * channel ("tail -f" style). The files are the targets of the file-backed
 * Log4j2 appenders of the server; the extension polls a byte-offset cursor
 * (see docs/plugin-api.md §6). The first chunk is the trailing window of
 * the file, so recent history is visible immediately.
 */
export class LogCommands implements vscode.Disposable {

    /** Active sessions, by `${tenant.id}:${file.key}` */
    private readonly sessions = new Map<string, TailSession>();
    /** Channels outlive their session so a stopped tail stays readable */
    private readonly channels = new Map<string, vscode.OutputChannel>();
    private readonly statusBarItem: vscode.StatusBarItem;

    constructor(private readonly tenantService: TenantService) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        this.statusBarItem.command = COMMANDS.stopTailLogs;
        this.statusBarItem.tooltip = "Stop tailing IdentityIQ server logs";
    }

    /**
     * Tails a server log file. Entry points:
     * - environment context menu in the tree view,
     * - command palette (environment picker).
     * When the environment exposes a single log file, it is tailed directly;
     * otherwise the user picks one. Re-running the command on a file already
     * being tailed just reveals its output channel.
     */
    public async tailLogs(arg?: TenantTreeItem): Promise<void> {
        let tenant: TenantInfo | undefined;
        if (arg instanceof TenantTreeItem) {
            tenant = arg.tenant;
        } else {
            const context = await runWizard({
                title: "Tail server logs",
                promptSteps: [new QuickPickTenantStep({ tenantService: this.tenantService })]
            });
            if (!context) {
                return;
            }
            tenant = context.tenant as TenantInfo;
        }
        if (!tenant) {
            return;
        }

        const client = new IIQClient(tenant, this.tenantService);
        let files: LogFile[];
        try {
            files = await withProgress(`Retrieving the log files of ${tenant.name}...`,
                () => client.getLogFiles());
        } catch (error) {
            vscode.window.showErrorMessage(getErrorStatus(error) === 404
                ? `The iiq-devtools plugin on ${tenant.name} does not support log tailing. Please update the plugin.`
                : error instanceof Error ? error.message : String(error));
            return;
        }
        if (files.length === 0) {
            vscode.window.showWarningMessage(
                `No file-backed appender found in the Log4j2 configuration of ${tenant.name}.`);
            return;
        }

        const file = await this.chooseLogFile(tenant, files);
        if (!file) {
            return; // cancelled
        }

        const sessionKey = `${tenant.id}:${file.key}`;
        const existing = this.sessions.get(sessionKey);
        if (existing) {
            existing.channel.show(true);
            return;
        }

        let channel = this.channels.get(sessionKey);
        if (!channel) {
            // The "log" language id colorizes levels and timestamps
            channel = vscode.window.createOutputChannel(`IIQ Logs — ${tenant.name} — ${file.fileName}`, "log");
            this.channels.set(sessionKey, channel);
        }
        channel.appendLine(`--- tailing ${file.path} ---`);
        channel.show(true);

        const session: TailSession = {
            tenant, client, file, channel,
            stopped: false, consecutiveErrors: 0, warned: false
        };
        this.sessions.set(sessionKey, session);
        this.updateStatusBar();
        // First poll right away: it returns the trailing window of the file
        void this.poll(session);
    }

    /** A single log file is tailed directly; several offer a picker */
    private async chooseLogFile(tenant: TenantInfo, files: LogFile[]): Promise<LogFile | undefined> {
        if (files.length === 1) {
            return files[0];
        }
        const pick = await vscode.window.showQuickPick(
            files.map(file => ({
                label: file.fileName,
                description: file.path,
                detail: file.exists
                    ? `${file.size} bytes${file.lastModified ? ` — last modified ${file.lastModified}` : ""}`
                    : "does not exist yet",
                file
            })), {
            title: `Tail server logs of ${tenant.name}`,
            placeHolder: "Log file to tail",
            ignoreFocusOut: true,
            matchOnDescription: true
        });
        return pick?.file;
    }

    /** Stops one, several or the only active tail */
    public async stopTailLogs(): Promise<void> {
        const sessions = [...this.sessions.values()];
        if (sessions.length === 0) {
            vscode.window.showInformationMessage("No log tail in progress.");
            return;
        }
        if (sessions.length === 1) {
            this.stopSession(sessions[0]);
            return;
        }
        const picks = await vscode.window.showQuickPick(
            sessions.map(session => ({
                label: `${session.tenant.name} — ${session.file.fileName}`,
                description: session.file.path,
                picked: true,
                session
            })), {
            title: "Stop tailing server logs",
            canPickMany: true,
            ignoreFocusOut: true
        });
        picks?.forEach(pick => this.stopSession(pick.session));
    }

    /** Chained setTimeout: polls never overlap, and interval changes apply live */
    private schedule(session: TailSession): void {
        if (session.stopped) {
            return;
        }
        session.timer = setTimeout(() => this.poll(session), getLogsPollInterval());
    }

    private async poll(session: TailSession): Promise<void> {
        if (session.stopped) {
            return;
        }
        try {
            let chunk: LogChunk;
            do {
                chunk = await session.client.getLogChunk(session.file.key, session.offset);
                if (session.stopped) {
                    return; // stopped while the request was in flight
                }
                if (chunk.rotated) {
                    session.channel.appendLine("--- log file rotated or truncated, resuming from its tail ---");
                }
                if (chunk.content) {
                    session.channel.append(chunk.content); // already ends with a newline
                }
                session.offset = chunk.nextOffset;
                // The server capped the chunk: catch up immediately. Only
                // when content came through — an empty chunk with a lagging
                // offset is a partial line waiting for its newline.
            } while (chunk.content && chunk.nextOffset < chunk.fileSize);
            session.consecutiveErrors = 0;
            session.warned = false;
        } catch (error) {
            if (!this.handlePollError(session, error)) {
                return; // the session was stopped
            }
        }
        this.schedule(session);
    }

    /**
     * Returns false when the failure stopped the session. A transient error
     * loses nothing: the file keeps the lines, the next poll catches up.
     */
    private handlePollError(session: TailSession, error: unknown): boolean {
        const status = getErrorStatus(error);
        const message = error instanceof Error ? error.message : String(error);
        if (status === 401 || status === 403 || status === 404) {
            // 404: the appender disappeared from the Log4j2 configuration
            this.stopSession(session, `--- tail stopped: ${message} ---`);
            vscode.window.showErrorMessage(status === 404
                ? `The log file "${session.file.fileName}" is no longer exposed by ${session.tenant.name} (appender removed from the Log4j2 configuration).`
                : message);
            return false;
        }
        session.consecutiveErrors++;
        if (session.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            this.stopSession(session, "--- tail stopped after repeated errors ---");
            vscode.window.showErrorMessage(
                `Stopped tailing "${session.file.fileName}" on ${session.tenant.name} after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. ${message}`);
            return false;
        }
        if (!session.warned) {
            session.warned = true;
            vscode.window.showWarningMessage(
                `Tailing "${session.file.fileName}" on ${session.tenant.name} hit an error, retrying: ${message}`);
        }
        return true;
    }

    private stopSession(session: TailSession, banner = "--- tail stopped ---"): void {
        if (session.stopped) {
            return;
        }
        session.stopped = true;
        if (session.timer) {
            clearTimeout(session.timer);
        }
        this.sessions.delete(`${session.tenant.id}:${session.file.key}`);
        session.channel.appendLine(banner);
        this.updateStatusBar();
    }

    private updateStatusBar(): void {
        if (this.sessions.size === 0) {
            this.statusBarItem.hide();
        } else {
            this.statusBarItem.text = `$(pulse) IIQ logs: ${this.sessions.size}`;
            this.statusBarItem.show();
        }
    }

    public dispose(): void {
        for (const session of [...this.sessions.values()]) {
            this.stopSession(session);
        }
        for (const channel of this.channels.values()) {
            channel.dispose();
        }
        this.channels.clear();
        this.statusBarItem.dispose();
    }
}
