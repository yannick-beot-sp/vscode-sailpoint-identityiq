import * as vscode from "vscode";
import { Memento, SecretStorage } from "vscode";
import { TenantCredentials, TenantInfo } from "../models/TenantInfo";
import { FolderTreeNode, isFolderTreeNode, isTenantInfo } from "../models/TreeNode";
import { compareByName } from "../utils/stringUtils";

const TREE_KEY = "IIQ_TREE";
const ACTIVE_TENANT_KEY = "IIQ_ACTIVE_TENANT";
const SECRET_PREFIX = "IIQ_SECRET_";

type TreeItemNode = FolderTreeNode | TenantInfo;

/**
 * Stores the environments (tenants) and the folders used to organize them.
 * - The tree structure is persisted in the extension global state.
 * - Credentials are persisted in the VS Code Secret Storage.
 * - The active environment (used as default by most commands) is persisted
 *   in the global state.
 */
export class TenantService {

    private readonly onDidUpdateTreeEmitter = new vscode.EventEmitter<void>();
    /** Fired whenever tenants or folders are added, removed, renamed or moved */
    public readonly onDidUpdateTree = this.onDidUpdateTreeEmitter.event;

    private readonly onDidChangeActiveTenantEmitter = new vscode.EventEmitter<TenantInfo | undefined>();
    /** Fired whenever the active environment changes */
    public readonly onDidChangeActiveTenant = this.onDidChangeActiveTenantEmitter.event;

    constructor(
        private readonly storage: Memento,
        private readonly secretStorage: SecretStorage) { }

    //////////////////////////
    // Tree & tenant access //
    //////////////////////////

    public getRoots(): TreeItemNode[] {
        const roots = this.storage.get<TreeItemNode[]>(TREE_KEY) ?? [];
        const validRoots = roots.filter(Boolean);
        return normalizeLegacyTenants(validRoots).sort(compareByName);
    }

    public getTenants(): TenantInfo[] {
        return this.findInTree<TenantInfo>(item => isTenantInfo(item), true)
            .sort(compareByName);
    }

    public getTenant(id: string): TenantInfo | undefined {
        return this.findInTree<TenantInfo>(item => isTenantInfo(item) && item.id === id)[0];
    }

    public getTenantByName(name: string): TenantInfo | undefined {
        return this.findInTree<TenantInfo>(
            item => isTenantInfo(item) && item.name.toLowerCase() === name.toLowerCase())[0];
    }

    public getFolder(id: string): FolderTreeNode | undefined {
        return this.findInTree<FolderTreeNode>(item => isFolderTreeNode(item) && item.id === id)[0];
    }

    public getChildren(folderId: string): TreeItemNode[] {
        const folder = this.getFolder(folderId);
        return (folder?.children ?? []).filter(Boolean).sort(compareByName);
    }

    ///////////////////
    // Tree mutation //
    ///////////////////

    /** Adds a node at the root or under the given folder */
    public async add(item: TreeItemNode, parentFolderId?: string): Promise<void> {
        const roots = this.getRoots();
        if (parentFolderId) {
            const folder = findFirst(roots, i => isFolderTreeNode(i) && i.id === parentFolderId) as FolderTreeNode | undefined;
            if (folder) {
                folder.children = [...(folder.children ?? []), item];
            } else {
                roots.push(item);
            }
        } else {
            roots.push(item);
        }
        await this.saveRoots(roots);
    }

    /** Updates a node in place (matched by id) */
    public async update(item: TreeItemNode): Promise<void> {
        const roots = this.getRoots();
        const existing = findFirst(roots, i => i.id === item.id);
        if (existing) {
            Object.assign(existing, item);
            await this.saveRoots(roots);
        }
    }

    /** Removes a node. Recursively removes credentials of deleted tenants. */
    public async remove(id: string): Promise<void> {
        const roots = this.getRoots();
        const removed = removeById(roots, id);
        await this.saveRoots(roots);
        if (removed) {
            await this.cleanupRemovedNode(removed);
        }
    }

    /** Moves a node under a folder, or to the root if no folder is given */
    public async move(id: string, targetFolderId?: string): Promise<void> {
        if (id === targetFolderId) {
            return;
        }
        const roots = this.getRoots();
        const node = removeById(roots, id);
        if (!node) {
            return;
        }
        // Prevent moving a folder into one of its own descendants
        if (isFolderTreeNode(node) && targetFolderId
            && findFirst([node], i => i.id === targetFolderId)) {
            roots.push(node);
            await this.saveRoots(roots);
            return;
        }
        const target = targetFolderId
            ? findFirst(roots, i => isFolderTreeNode(i) && i.id === targetFolderId) as FolderTreeNode | undefined
            : undefined;
        if (target) {
            target.children = [...(target.children ?? []), node];
        } else {
            roots.push(node);
        }
        await this.saveRoots(roots);
    }

    private async saveRoots(roots: TreeItemNode[]): Promise<void> {
        await this.storage.update(TREE_KEY, roots);
        this.onDidUpdateTreeEmitter.fire();
    }

    private async cleanupRemovedNode(node: TreeItemNode): Promise<void> {
        if (isTenantInfo(node)) {
            await this.removeCredentials(node.id);
            if (this.getActiveTenantId() === node.id) {
                await this.setActiveTenant(undefined);
            }
        } else if (isFolderTreeNode(node)) {
            for (const child of node.children ?? []) {
                await this.cleanupRemovedNode(child);
            }
        }
    }

    ////////////////////////
    // Active environment //
    ////////////////////////

    public getActiveTenant(): TenantInfo | undefined {
        const id = this.getActiveTenantId();
        return id ? this.getTenant(id) : undefined;
    }

    public async setActiveTenant(tenant: TenantInfo | undefined): Promise<void> {
        await this.storage.update(ACTIVE_TENANT_KEY, tenant?.id);
        this.onDidChangeActiveTenantEmitter.fire(tenant);
    }

    private getActiveTenantId(): string | undefined {
        return this.storage.get<string>(ACTIVE_TENANT_KEY);
    }

    /////////////////
    // Credentials //
    /////////////////

    public async getCredentials(tenantId: string): Promise<TenantCredentials | undefined> {
        const raw = await this.secretStorage.get(SECRET_PREFIX + tenantId);
        return raw ? JSON.parse(raw) as TenantCredentials : undefined;
    }

    public async setCredentials(tenantId: string, credentials: TenantCredentials): Promise<void> {
        await this.secretStorage.store(SECRET_PREFIX + tenantId, JSON.stringify(credentials));
    }

    public async removeCredentials(tenantId: string): Promise<void> {
        const key = SECRET_PREFIX + tenantId;
        if (await this.secretStorage.get(key) !== undefined) {
            await this.secretStorage.delete(key);
        }
    }

    private findInTree<T extends TreeItemNode>(
        predicate: (item: TreeItemNode) => boolean,
        findAll = false): T[] {
        const results: T[] = [];
        const traverse = (items: TreeItemNode[]): boolean => {
            for (const item of items) {
                if (predicate(item)) {
                    results.push(item as T);
                    if (!findAll) {
                        return true;
                    }
                }
                if (isFolderTreeNode(item) && item.children
                    && traverse(item.children) && !findAll) {
                    return true;
                }
            }
            return false;
        };
        traverse(this.getRoots());
        return results;
    }
}

/** Legacy environments predate the read-only flag and remain writable. */
function normalizeLegacyTenants(items: TreeItemNode[]): TreeItemNode[] {
    for (const item of items) {
        if (isTenantInfo(item) && item.readOnly === undefined) {
            item.readOnly = false;
        } else if (isFolderTreeNode(item) && item.children) {
            normalizeLegacyTenants(item.children);
        }
    }
    return items;
}

function findFirst(items: TreeItemNode[], predicate: (item: TreeItemNode) => boolean): TreeItemNode | undefined {
    for (const item of items) {
        if (predicate(item)) {
            return item;
        }
        if (isFolderTreeNode(item) && item.children) {
            const found = findFirst(item.children, predicate);
            if (found) {
                return found;
            }
        }
    }
    return undefined;
}

/** Removes the node with the given id from the tree and returns it */
function removeById(items: TreeItemNode[], id: string): TreeItemNode | undefined {
    const index = items.findIndex(item => item.id === id);
    if (index !== -1) {
        return items.splice(index, 1)[0];
    }
    for (const item of items) {
        if (isFolderTreeNode(item) && item.children) {
            const removed = removeById(item.children, id);
            if (removed) {
                return removed;
            }
        }
    }
    return undefined;
}
