import * as vscode from "vscode";
import { FilterMode, OBJECT_TYPES, ObjectSummary } from "../models/ObjectTypes";
import { TenantInfo } from "../models/TenantInfo";
import { isFolderTreeNode, isTenantInfo } from "../models/TreeNode";
import { IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { getDefaultSort, getPageSize, SortField } from "../utils/configurationUtils";
import {
    BaseTreeItem,
    FolderTreeItem,
    Log4jConfigTreeItem,
    LoadMoreTreeItem,
    ObjectTreeItem,
    ObjectTypeTreeItem,
    TenantTreeItem
} from "./IIQTreeItem";

/** Pagination, sorting & filtering state of an object type node */
interface ObjectTypeNodeState {
    /** Number of objects currently displayed */
    limit: number;
    /** Sort override for this node. Defaults to the `iiq.objectList.sort` setting */
    sortBy?: SortField;
    /**
     * Filter string: plain text (case-insensitive name search) or an IIQ
     * filter such as `department == "Finance"`; the plugin decides which
     */
    query?: string;
    /** How the plugin interpreted `query`, when it reported it */
    filterMode?: FilterMode;
}

/**
 * Tree data provider of the "Environments" view: folders, environments,
 * object types and paginated lists of objects.
 */
export class IIQTreeDataProvider implements vscode.TreeDataProvider<BaseTreeItem> {

    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<BaseTreeItem | undefined>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    /** Keyed by object type node id (`<tenantId>/<ObjectType>`) */
    private readonly nodeStates = new Map<string, ObjectTypeNodeState>();

    /**
     * Last environment item handed out for each tenant id. VS Code resolves the
     * argument of onDidChangeTreeData by instance, not by id, so refreshing a
     * single environment requires the very item it is currently displaying.
     */
    private readonly tenantItems = new Map<string, TenantTreeItem>();

    constructor(private readonly tenantService: TenantService) {
        tenantService.onDidUpdateTree(() => this.refresh());
        tenantService.onDidChangeActiveTenant(() => this.refresh());
    }

    public refresh(node?: BaseTreeItem): void {
        if (!node) {
            // Full refresh: drop the pagination states and the stale environment items
            this.nodeStates.clear();
            this.tenantItems.clear();
        }
        this.onDidChangeTreeDataEmitter.fire(node);
    }

    /** Shows one more page of objects under the given object type node */
    public loadMore(node: ObjectTypeTreeItem): void {
        const state = this.getNodeState(node);
        state.limit += getPageSize();
        this.onDidChangeTreeDataEmitter.fire(node);
    }

    /** Changes the sort order of the given object type node */
    public sortBy(node: ObjectTypeTreeItem, sortBy: SortField): void {
        const state = this.getNodeState(node);
        state.sortBy = sortBy;
        state.limit = getPageSize();
        this.refreshTenant(node.tenant);
    }

    /**
     * Filters the objects displayed under the given object type node by name
     * or with an IIQ filter. The query is validated by the server with a
     * first page request, so that an invalid filter is never stored:
     * throws InvalidFilterError and leaves the current filter untouched.
     */
    public async trySetFilter(node: ObjectTypeTreeItem, query: string | undefined): Promise<void> {
        if (!query) {
            this.setFilter(node, undefined);
            return;
        }
        const client = new IIQClient(node.tenant, this.tenantService);
        const result = await client.listObjects(node.definition.objectType, {
            start: 0,
            limit: 1,
            query,
            excludeTypes: node.definition.excludeTypes
        });
        this.setFilter(node, query, result.filterMode);
    }

    /** Applies (or clears) the filter without validation: use trySetFilter for user input */
    public setFilter(node: ObjectTypeTreeItem, query: string | undefined, filterMode?: FilterMode): void {
        const state = this.getNodeState(node);
        state.query = query;
        state.filterMode = query ? filterMode : undefined;
        state.limit = getPageSize();
        this.refreshTenant(node.tenant);
    }

    /**
     * Rebuilds the object type nodes of a single environment. They carry the sort
     * order and the filter in their context value and description, so re-rendering
     * them means recreating them: getTreeItem returns the items as they are, and
     * refreshing an object type node would only reload its children. Refreshing
     * the environment leaves the other ones untouched.
     */
    private refreshTenant(tenant: TenantInfo): void {
        // Without the displayed item, fall back to a refresh of the whole tree
        this.onDidChangeTreeDataEmitter.fire(this.tenantItems.get(tenant.id));
    }

    /** Current filter (name or advanced) applied to the given object type node, if any */
    public getFilter(node: ObjectTypeTreeItem): string | undefined {
        return this.nodeStates.get(node.id!)?.query;
    }

    getTreeItem(element: BaseTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: BaseTreeItem): Promise<BaseTreeItem[]> {
        if (!element) {
            return this.getRootItems();
        }
        if (element instanceof FolderTreeItem) {
            return this.toTreeItems(this.tenantService.getChildren(element.folder.id));
        }
        if (element instanceof TenantTreeItem) {
            // Log4j2 configuration first, then object types in alphabetical order (cf. OBJECT_TYPES)
            return [
                new Log4jConfigTreeItem(element.tenant),
                ...OBJECT_TYPES.map(definition => {
                    const nodeId = `${element.tenant.id}/${definition.objectType}`;
                    return new ObjectTypeTreeItem(
                        element.tenant,
                        definition,
                        this.getNodeSort(nodeId),
                        this.nodeStates.get(nodeId)?.query,
                        this.nodeStates.get(nodeId)?.filterMode);
                })
            ];
        }
        if (element instanceof ObjectTypeTreeItem) {
            return this.getObjectItems(element);
        }
        return [];
    }

    private getRootItems(): BaseTreeItem[] {
        return this.toTreeItems(this.tenantService.getRoots());
    }

    private toTreeItems(nodes: ReturnType<TenantService["getRoots"]>): BaseTreeItem[] {
        const activeTenantId = this.tenantService.getActiveTenant()?.id;
        const items: BaseTreeItem[] = [];
        for (const node of nodes) {
            if (isFolderTreeNode(node)) {
                items.push(new FolderTreeItem(node));
            } else if (isTenantInfo(node)) {
                const item = new TenantTreeItem(node, node.id === activeTenantId);
                this.tenantItems.set(node.id, item);
                items.push(item);
            }
        }
        return items;
    }

    private async getObjectItems(element: ObjectTypeTreeItem): Promise<BaseTreeItem[]> {
        const state = this.getNodeState(element);
        const client = new IIQClient(element.tenant, this.tenantService);
        try {
            const result = await client.listObjects(element.definition.objectType, {
                start: 0,
                limit: state.limit,
                sortBy: state.sortBy ?? getDefaultSort(),
                query: state.query,
                excludeTypes: element.definition.excludeTypes
            });
            const items: BaseTreeItem[] = result.objects.map(object =>
                new ObjectTreeItem(element.tenant, element.definition, object));
            if (result.count > result.objects.length) {
                items.push(new LoadMoreTreeItem(element, result.objects.length, result.count));
            }
            return items;
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
            return [];
        }
    }

    private getNodeState(node: ObjectTypeTreeItem): ObjectTypeNodeState {
        let state = this.nodeStates.get(node.id!);
        if (!state) {
            state = { limit: getPageSize() };
            this.nodeStates.set(node.id!, state);
        }
        return state;
    }

    private getNodeSort(nodeId: string): SortField {
        return this.nodeStates.get(nodeId)?.sortBy ?? getDefaultSort();
    }
}

/**
 * Drag & drop support to organize environments in folders and copy objects
 * between environments.
 */
export type ObjectCopyHandler = (source: ObjectTreeItem, target: TenantTreeItem) => Promise<void>;

export class IIQTreeDragAndDropController implements vscode.TreeDragAndDropController<BaseTreeItem> {

    private static readonly MIME_TYPE = "application/vnd.code.tree.iiq.view.environments";
    private static readonly OBJECT_MIME_TYPE = "application/vnd.code.tree.iiq.view.environments.object";
    readonly dropMimeTypes = [
        IIQTreeDragAndDropController.MIME_TYPE,
        IIQTreeDragAndDropController.OBJECT_MIME_TYPE
    ];
    readonly dragMimeTypes = [
        IIQTreeDragAndDropController.MIME_TYPE,
        IIQTreeDragAndDropController.OBJECT_MIME_TYPE
    ];

    constructor(
        private readonly tenantService: TenantService,
        private readonly copyObjectToTenant: ObjectCopyHandler) { }

    handleDrag(source: readonly BaseTreeItem[], dataTransfer: vscode.DataTransfer): void {
        const objectItems = source.filter(item => item instanceof ObjectTreeItem) as ObjectTreeItem[];
        if (objectItems.length > 0) {
            dataTransfer.set(IIQTreeDragAndDropController.OBJECT_MIME_TYPE,
                new vscode.DataTransferItem(JSON.stringify(objectItems.map(item => ({
                    tenantId: item.tenant.id,
                    objectType: item.definition.objectType,
                    objectId: item.object.id,
                    objectName: item.object.name
                })))));
        }
        // A mixed selection carries both payloads: the environments and folders must
        // still be movable even when an object happens to be selected as well
        const ids = source
            .filter(item => item instanceof FolderTreeItem || item instanceof TenantTreeItem)
            .map(item => item.id!);
        if (ids.length > 0) {
            dataTransfer.set(IIQTreeDragAndDropController.MIME_TYPE,
                new vscode.DataTransferItem(JSON.stringify(ids)));
        }
    }

    async handleDrop(target: BaseTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        const nodeTransfer = dataTransfer.get(IIQTreeDragAndDropController.MIME_TYPE);
        const objectTransfer = dataTransfer.get(IIQTreeDragAndDropController.OBJECT_MIME_TYPE);

        if (nodeTransfer) {
            const ids = JSON.parse(await nodeTransfer.asString()) as string[];
            const targetFolderId = this.resolveTargetFolderId(target);
            for (const id of ids) {
                await this.tenantService.move(id, targetFolderId);
            }
        }

        if (objectTransfer) {
            const targetTenant = getTenantOf(target);
            if (!targetTenant) {
                // Nothing was moved either: the drop had no meaning at all
                if (!nodeTransfer) {
                    vscode.window.showWarningMessage("Drop an object onto an environment to copy it.");
                }
                return;
            }
            const payloads = JSON.parse(await objectTransfer.asString()) as Array<{
                tenantId: string;
                objectType: string;
                objectId: string;
                objectName: string;
            }>;
            const targetItem = new TenantTreeItem(targetTenant, false);
            for (const payload of payloads) {
                // Dropping an object back into its own environment is a no-op
                if (payload.tenantId === targetTenant.id) {
                    continue;
                }
                const sourceTenant = this.tenantService.getTenants().find(t => t.id === payload.tenantId);
                if (!sourceTenant) {
                    continue;
                }
                const definition = OBJECT_TYPES.find(t => t.objectType === payload.objectType);
                if (!definition) {
                    continue;
                }
                const object: ObjectSummary = { id: payload.objectId, name: payload.objectName };
                const sourceItem = new ObjectTreeItem(sourceTenant, definition, object);
                await this.copyObjectToTenant(sourceItem, targetItem);
            }
        }
    }

    /**
     * Folder the dragged nodes must end up in. Folders auto-expand while dragging,
     * so a drop aimed at a folder often lands on one of its children: any item
     * belonging to an environment designates the folder holding that environment.
     */
    private resolveTargetFolderId(target: BaseTreeItem | undefined): string | undefined {
        if (target instanceof FolderTreeItem) {
            return target.folder.id;
        }
        const tenant = getTenantOf(target);
        return tenant ? this.tenantService.getParentFolderId(tenant.id) : undefined;
    }
}

/** Environment an item belongs to: the environment itself, or one of its descendants */
function getTenantOf(item: BaseTreeItem | undefined): TenantInfo | undefined {
    if (item instanceof TenantTreeItem
        || item instanceof ObjectTypeTreeItem
        || item instanceof ObjectTreeItem
        || item instanceof Log4jConfigTreeItem) {
        return item.tenant;
    }
    if (item instanceof LoadMoreTreeItem) {
        return item.parent.tenant;
    }
    return undefined;
}
