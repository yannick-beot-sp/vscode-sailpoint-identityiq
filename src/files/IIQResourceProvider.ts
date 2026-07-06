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
import { IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { parseResourceUri } from "../utils/UriUtils";

/**
 * Virtual file system provider for the `iiq://` scheme.
 *
 * URIs have the form `iiq://<tenantId>/<tenant name>/<ObjectType>/<name>.xml`
 * (cf. UriUtils). Reading fetches the XML representation of the object from
 * the environment; saving imports it back, providing transparent live edit
 * of IdentityIQ objects.
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
        // Ancestors of a resource (tenant, object type) are virtual directories.
        // VS Code stats them before writing a file (parent existence check).
        const segments = uri.path.split("/").filter(s => s.length > 0);
        if (segments.length < 3) {
            return { type: FileType.Directory, ctime: 0, mtime: 0, size: 0 };
        }
        // stat is called frequently by VS Code (editor focus, before saves...):
        // use a lightweight HEAD request instead of transferring the whole XML.
        // The real mtime lets VS Code detect that the object changed remotely.
        const parts = parseResourceUri(uri);
        const metadata = await this.getClient(uri).getObjectMetadata(parts.objectType, parts.objectName);
        if (metadata === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return {
            type: FileType.File,
            ctime: 0,
            mtime: metadata.modified?.getTime() ?? 0,
            size: metadata.size
        };
    }

    async readFile(uri: Uri): Promise<Uint8Array> {
        const data = await this.lookupResource(uri);
        return Buffer.from(data, "utf8");
    }

    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
        const client = this.getClient(uri);
        const result = await client.importXml(Buffer.from(content).toString("utf8"));
        if (result.errors && result.errors.length > 0) {
            throw new Error(`Import failed: ${result.errors.join(", ")}`);
        }
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    async delete(uri: Uri): Promise<void> {
        const parts = parseResourceUri(uri);
        const client = this.getClient(uri);
        await client.deleteObject(parts.objectType, parts.objectName);
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
        const parts = parseResourceUri(uri);
        const client = this.getClient(uri);
        const data = await client.getObjectIfExists(parts.objectType, parts.objectName);
        if (data === undefined) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return data;
    }

    private getClient(uri: Uri): IIQClient {
        const parts = parseResourceUri(uri);
        const tenant = this.tenantService.getTenant(parts.tenantId);
        if (!tenant) {
            throw vscode.FileSystemError.FileNotFound(`Unknown environment for ${uri.toString()}`);
        }
        return new IIQClient(tenant, this.tenantService);
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
        return await client.getObject(parts.objectType, parts.objectName);
    }
}
