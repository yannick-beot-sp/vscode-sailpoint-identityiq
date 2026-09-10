import * as vscode from "vscode";
import {
    Disposable,
    Event,
    FileChangeEvent,
    FileStat,
    FileSystemProvider,
    FileType,
    Uri
} from "vscode";
import { URI_SCHEME } from "../constants";
import { IIQClient, ObjectMetadata } from "../services/IIQClient";
import { TenantInfo } from "../models/TenantInfo";
import { TenantService } from "../services/TenantService";
import { parseIiqUri, parseResourceUri } from "../utils/UriUtils";

/**
 * Virtual file system provider for the `iiq://` scheme.
 *
 * Object URIs have the form `iiq://<tenantId>/<tenant name>/<ObjectType>/<id>/<name>.xml`
 * (cf. UriUtils). Reading fetches the XML representation of the object from
 * the environment; saving imports it back, providing transparent live edit
 * of IdentityIQ objects.
 *
 * The environment configuration file is `iiq://<tenantId>/<tenant name>/config/iiq.properties`.
 * Saving writes `WEB-INF/classes/iiq.properties` on the server and reloads it.
 */
export class IIQResourceProvider implements FileSystemProvider {

    private readonly _emitter = new vscode.EventEmitter<FileChangeEvent[]>();
    onDidChangeFile: Event<FileChangeEvent[]> = this._emitter.event;

    constructor(private readonly tenantService: TenantService) { }

    watch(): Disposable {
        // ignore, fires for all changes
        return new vscode.Disposable(() => { });
    }

    async stat(uri: Uri): Promise<FileStat> {
        // Ancestors of a resource (tenant, object type, config folder) are
        // virtual directories. VS Code stats them before writing a file.
        if (this.isVirtualDirectory(uri)) {
            return { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        }
        // stat is called frequently by VS Code (editor focus, before saves...):
        // use a lightweight HEAD request instead of transferring the whole body.
        const metadata = await this.lookupMetadata(uri);
        if (metadata === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const tenant = this.getTenant(uri);
        return {
            type: FileType.File,
            ctime: 0,
            mtime: metadata.modified?.getTime() ?? 0,
            size: metadata.size,
            permissions: tenant.readOnly ? vscode.FilePermission.Readonly : undefined
        };
    }

    async readFile(uri: Uri): Promise<Uint8Array> {
        const data = await this.lookupResource(uri);
        return Buffer.from(data, "utf8");
    }

    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
        this.ensureWritable(uri);
        const client = this.getClient(uri);
        const parsed = parseIiqUri(uri);
        const text = Buffer.from(content).toString("utf8");
        if (parsed.kind === "config") {
            await client.putIiqProperties(text);
        } else {
            const result = await client.importXml(text);
            if (result.errors && result.errors.length > 0) {
                throw new Error(`Import failed: ${result.errors.join(", ")}`);
            }
        }
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    async delete(uri: Uri): Promise<void> {
        this.ensureWritable(uri);
        const parsed = parseIiqUri(uri);
        if (parsed.kind === "config") {
            throw vscode.FileSystemError.NoPermissions("The IdentityIQ configuration file cannot be deleted.");
        }
        const client = this.getClient(uri);
        await client.deleteObject(parsed.objectType, parsed.objectId);
        this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    }

    readDirectory(): [string, FileType][] {
        throw vscode.FileSystemError.NoPermissions("Directories are not supported");
    }

    createDirectory(): void {
        throw vscode.FileSystemError.NoPermissions("Directories are not supported");
    }

    rename(): void {
        throw vscode.FileSystemError.NoPermissions("Rename is not supported");
    }

    /** Notifies VS Code that resources have changed on the environment */
    public triggerModified(uris: Uri | Uri[]): void {
        const list = Array.isArray(uris) ? uris : [uris];
        list.forEach(uri => this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]));
    }

    private async lookupResource(uri: Uri): Promise<string> {
        const parsed = parseIiqUri(uri);
        const client = this.getClient(uri);
        if (parsed.kind === "config") {
            return await client.getIiqProperties();
        }
        const data = await client.getObjectIfExists(parsed.objectType, parsed.objectId);
        if (data === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return data;
    }

    private async lookupMetadata(uri: Uri): Promise<ObjectMetadata | undefined> {
        const parsed = parseIiqUri(uri);
        const client = this.getClient(uri);
        if (parsed.kind === "config") {
            return await client.getIiqPropertiesMetadata();
        }
        return await client.getObjectMetadata(parsed.objectType, parsed.objectId);
    }

    private isVirtualDirectory(uri: Uri): boolean {
        try {
            parseIiqUri(uri);
            return false;
        } catch {
            return true;
        }
    }

    /** Re-evaluates permissions for open virtual documents of an environment. */
    public triggerTenantModified(tenantId: string): void {
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input;
                if (input instanceof vscode.TabInputText && input.uri.scheme === URI_SCHEME) {
                    try {
                        const parts = parseIiqUri(input.uri);
                        if (parts.tenantId === tenantId) {
                            this.triggerModified(input.uri);
                        }
                    } catch {
                        // Ignore tabs whose URI is not a known IIQ resource
                    }
                }
            }
        }
    }

    private getTenant(uri: Uri): TenantInfo {
        const parts = parseIiqUri(uri);
        const tenant = this.tenantService.getTenant(parts.tenantId);
        if (!tenant) {
            throw vscode.FileSystemError.FileNotFound(`Unknown environment for ${uri.toString()}`);
        }
        return tenant;
    }

    private getClient(uri: Uri): IIQClient {
        return new IIQClient(this.getTenant(uri), this.tenantService);
    }

    private ensureWritable(uri: Uri): void {
        const tenant = this.getTenant(uri);
        if (tenant.readOnly) {
            throw vscode.FileSystemError.NoPermissions(`Environment "${tenant.name}" is read-only.`);
        }
    }
}

/**
 * Read-only content provider used by the "Compare with IdentityIQ" command
 * to display the remote version of an object in a diff view.
 */
export class IIQRemoteContentProvider implements vscode.TextDocumentContentProvider {

    constructor(private readonly tenantService: TenantService) { }

    async provideTextDocumentContent(uri: Uri): Promise<string> {
        const parts = parseResourceUri(uri);
        const tenant = this.tenantService.getTenant(parts.tenantId);
        if (!tenant) {
            throw new Error(`Unknown environment for ${uri.toString()}`);
        }
        const client = new IIQClient(tenant, this.tenantService);
        return await client.getObject(parts.objectType, parts.objectId);
    }
}
