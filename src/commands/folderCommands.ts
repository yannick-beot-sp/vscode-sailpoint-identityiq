import * as crypto from "crypto";
import * as vscode from "vscode";
import { FolderTreeNode } from "../models/TreeNode";
import { TenantService } from "../services/TenantService";
import { isEmpty } from "../utils/stringUtils";
import { confirm } from "../utils/vsCodeHelpers";
import { FolderTreeItem } from "../views/IIQTreeItem";

/**
 * Commands to manage the folders used to organize environments.
 */
export class FolderCommands {

    constructor(private readonly tenantService: TenantService) { }

    /** Creates a folder at the root, or under the given folder */
    public async addFolder(node?: FolderTreeItem): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: "Enter the folder name",
            ignoreFocusOut: true,
            validateInput: (value) => isEmpty(value) ? "The folder name cannot be empty" : ""
        });
        if (name === undefined) {
            return;
        }
        const folder: FolderTreeNode = {
            id: crypto.randomUUID(),
            name: name.trim(),
            type: "FOLDER",
            children: []
        };
        await this.tenantService.add(folder, node instanceof FolderTreeItem ? node.folder.id : undefined);
    }

    public async renameFolder(node: FolderTreeItem): Promise<void> {
        const newName = await vscode.window.showInputBox({
            prompt: "Enter the new folder name",
            value: node.folder.name,
            ignoreFocusOut: true,
            validateInput: (value) => isEmpty(value) ? "The folder name cannot be empty" : ""
        });
        if (newName === undefined) {
            return;
        }
        await this.tenantService.update({ ...node.folder, name: newName.trim() });
    }

    /** Removes a folder and everything it contains, after confirmation */
    public async removeFolder(node: FolderTreeItem): Promise<void> {
        if (!await confirm(
            `Are you sure you want to remove the folder "${node.folder.name}" and all the environments it contains?`,
            "Remove")) {
            return;
        }
        await this.tenantService.remove(node.folder.id);
    }
}
