import * as vscode from "vscode";
import { CONTEXT_VALUES } from "../constants";
import { ObjectSummary, ObjectTypeDefinition } from "../models/ObjectTypes";
import { TenantInfo } from "../models/TenantInfo";
import { FolderTreeNode } from "../models/TreeNode";
import { buildResourceUri } from "../utils/UriUtils";

/**
 * Base class of all items displayed in the environment tree view.
 */
export abstract class BaseTreeItem extends vscode.TreeItem {
    constructor(label: string, collapsibleState: vscode.TreeItemCollapsibleState) {
        super(label, collapsibleState);
    }
}

export class FolderTreeItem extends BaseTreeItem {
    constructor(public readonly folder: FolderTreeNode) {
        super(folder.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = folder.id;
        this.contextValue = CONTEXT_VALUES.folder;
        this.iconPath = vscode.ThemeIcon.Folder;
    }
}

export class TenantTreeItem extends BaseTreeItem {
    constructor(public readonly tenant: TenantInfo, isActive: boolean) {
        super(tenant.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = tenant.id;
        this.contextValue = CONTEXT_VALUES.tenant;
        this.description = isActive ? `${tenant.url} (active)` : tenant.url;
        this.tooltip = `${tenant.name}\n${tenant.url}` + (isActive ? "\nActive environment" : "");
        this.iconPath = new vscode.ThemeIcon("server-environment",
            isActive ? new vscode.ThemeColor("charts.green") : undefined);
    }
}

export class ObjectTypeTreeItem extends BaseTreeItem {
    constructor(
        public readonly tenant: TenantInfo,
        public readonly definition: ObjectTypeDefinition,
        sortedBy: "name" | "lastModified",
        filter?: string) {
        super(definition.label, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `${tenant.id}/${definition.objectType}`;
        // The sort order, filtered state and object type are part of the context value to
        // drive the "Sort by..."/"Filter..." context menu entries and type-specific actions
        // (cf. package.json)
        this.contextValue = `${CONTEXT_VALUES.objectType}-${definition.objectType}-sorted-by-${sortedBy}${filter ? "-filtered" : ""}`;
        this.description = filter ? `filter: ${filter}` : undefined;
        this.iconPath = new vscode.ThemeIcon(definition.icon);
    }
}

export class ObjectTreeItem extends BaseTreeItem {
    constructor(
        public readonly tenant: TenantInfo,
        public readonly definition: ObjectTypeDefinition,
        public readonly object: ObjectSummary) {
        super(object.name, vscode.TreeItemCollapsibleState.None);
        this.id = `${tenant.id}/${definition.objectType}/${object.id}`;
        // The object type is part of the context value to enable
        // type-specific menu entries such as "Run rule" or "Run task"
        // (cf. package.json)
        this.contextValue = `${CONTEXT_VALUES.object}-${definition.objectType}`;
        this.tooltip = object.modified ? `Last modified: ${object.modified}` : undefined;
        this.resourceUri = this.getResourceUri();
        this.command = {
            command: "vscode.open",
            title: "Open",
            arguments: [this.resourceUri]
        };
        this.iconPath = vscode.ThemeIcon.File;
    }

    public getResourceUri(): vscode.Uri {
        return buildResourceUri({
            tenantId: this.tenant.id,
            tenantName: this.tenant.name,
            objectType: this.definition.objectType,
            objectId: this.object.id,
            objectName: this.object.name
        });
    }
}

/** "Load more..." item displayed at the end of a partially loaded object list */
export class LoadMoreTreeItem extends BaseTreeItem {
    constructor(public readonly parent: ObjectTypeTreeItem, loaded: number, total: number) {
        super(`Load more... (${loaded}/${total})`, vscode.TreeItemCollapsibleState.None);
        this.id = `${parent.id}/load-more`;
        this.contextValue = CONTEXT_VALUES.loadMore;
        this.iconPath = new vscode.ThemeIcon("ellipsis");
        this.command = {
            command: "iiq.load-more",
            title: "Load more",
            arguments: [parent]
        };
    }
}
