import * as vscode from "vscode";
import { OBJECT_TYPES } from "../models/ObjectTypes";
import { isFolderTreeNode, isTenantInfo } from "../models/TreeNode";
import { IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { getDefaultSort, getPageSize, SortField } from "../utils/configurationUtils";
import {
    BaseTreeItem,
    FolderTreeItem,
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
    /** Case-insensitive filter on the object name */
    query?: string;
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

    constructor(private readonly tenantService: TenantService) {
        tenantService.onDidUpdateTree(() => this.refresh());
        tenantService.onDidChangeActiveTenant(() => this.refresh());
    }

    public refresh(node?: BaseTreeItem): void {
        if (!node) {
            // Full refresh: drop the pagination states
            this.nodeStates.clear();
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
        // The context value contains the sort order: the node itself must be re-rendered
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }

    /** Filters the objects displayed under the given object type node by name */
    public setFilter(node: ObjectTypeTreeItem, query: string | undefined): void {
        const state = this.getNodeState(node);
        state.query = query;
        state.limit = getPageSize();
        // The context value contains the filtered state: the node itself must be re-rendered
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }

    /** Current name filter applied to the given object type node, if any */
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
            // Object types, in alphabetical order (cf. OBJECT_TYPES)
            return OBJECT_TYPES.map(definition => {
                const nodeId = `${element.tenant.id}/${definition.objectType}`;
                return new ObjectTypeTreeItem(
                    element.tenant,
                    definition,
                    this.getNodeSort(nodeId),
                    this.nodeStates.get(nodeId)?.query);
            });
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
                items.push(new TenantTreeItem(node, node.id === activeTenantId));
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
 * Drag & drop support to organize environments in folders.
 */
export class IIQTreeDragAndDropController implements vscode.TreeDragAndDropController<BaseTreeItem> {

    private static readonly MIME_TYPE = "application/vnd.code.tree.iiq.view.environments";
    readonly dropMimeTypes = [IIQTreeDragAndDropController.MIME_TYPE];
    readonly dragMimeTypes = [IIQTreeDragAndDropController.MIME_TYPE];

    constructor(private readonly tenantService: TenantService) { }

    handleDrag(source: readonly BaseTreeItem[], dataTransfer: vscode.DataTransfer): void {
        const ids = source
            .filter(item => item instanceof FolderTreeItem || item instanceof TenantTreeItem)
            .map(item => item.id!);
        if (ids.length > 0) {
            dataTransfer.set(IIQTreeDragAndDropController.MIME_TYPE,
                new vscode.DataTransferItem(JSON.stringify(ids)));
        }
    }

    async handleDrop(target: BaseTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        const transferItem = dataTransfer.get(IIQTreeDragAndDropController.MIME_TYPE);
        if (!transferItem) {
            return;
        }
        // Dropping on a tenant or on the background moves to the root
        const targetFolderId = target instanceof FolderTreeItem ? target.folder.id : undefined;
        const ids = JSON.parse(await transferItem.asString()) as string[];
        for (const id of ids) {
            await this.tenantService.move(id, targetFolderId);
        }
    }
}
