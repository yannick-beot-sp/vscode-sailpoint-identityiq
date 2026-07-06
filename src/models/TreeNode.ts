import { TenantInfo } from "./TenantInfo";

export interface FolderTreeNode {
    id: string;
    name: string;
    type: "FOLDER";
    children?: Array<FolderTreeNode | TenantInfo>;
}

export function isTenantInfo(item: FolderTreeNode | TenantInfo | undefined): item is TenantInfo {
    return item !== null && item !== undefined && item.type === "TENANT";
}

export function isFolderTreeNode(item: FolderTreeNode | TenantInfo | undefined): item is FolderTreeNode {
    return item !== null && item !== undefined && item.type === "FOLDER";
}
