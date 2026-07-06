import * as crypto from "crypto";
import * as vscode from "vscode";
import { IIQExtensionApi } from "../extension";
import { TenantInfo } from "../models/TenantInfo";

export const EXTENSION_ID = "yannick-beot-sp.vscode-sailpoint-identityiq";

/** Activates the extension and returns its API */
export async function getExtensionApi(): Promise<IIQExtensionApi> {
    const extension = vscode.extensions.getExtension<IIQExtensionApi>(EXTENSION_ID);
    if (!extension) {
        throw new Error(`Extension ${EXTENSION_ID} not found in the test host`);
    }
    return await extension.activate();
}

/** Creates a TenantInfo with a unique name, without registering it */
export function makeTenant(url: string, namePrefix = "Test"): TenantInfo {
    const id = crypto.randomUUID();
    return {
        id,
        name: `${namePrefix} ${id.substring(0, 8)}`,
        url,
        type: "TENANT"
    };
}
