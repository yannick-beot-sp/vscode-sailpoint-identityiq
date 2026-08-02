import { QuickPickItem } from "vscode";
import { TenantInfo } from "../models/TenantInfo";
import { TenantService } from "../services/TenantService";
import { QuickPickPromptStep } from "./quickPickPromptStep";
import { WizardContext } from "./wizardContext";

interface TenantQuickPickItem extends QuickPickItem {
    tenant?: TenantInfo;
}

export interface QuickPickTenantStepOptions {
    tenantService: TenantService;
    /** Name of the context property. Defaults to "tenant" */
    name?: string;
    /** Adds a "None" entry allowing to deselect the environment */
    allowNone?: boolean;
    /** Skip the prompt if there is only one environment */
    skipIfOne?: boolean;
    /** Environment ids to exclude from the picker */
    excludeTenantIds?: string[] | ((context: WizardContext) => string[]);
}

/**
 * Reusable step to pick an environment.
 * The active environment, if any, is preselected.
 * Stores a TenantInfo (or undefined if "None" was chosen) in the context.
 */
export class QuickPickTenantStep extends QuickPickPromptStep<WizardContext, TenantQuickPickItem> {

    constructor(options: QuickPickTenantStepOptions) {
        super({
            name: options.name ?? "tenant",
            displayName: "environment",
            options: { matchOnDescription: true },
            skipIfOne: (options.skipIfOne ?? true) && !options.allowNone,
            items: (context: WizardContext) => {
                const active = options.tenantService.getActiveTenant();
                const excludeIds = new Set(
                    typeof options.excludeTenantIds === "function"
                        ? options.excludeTenantIds(context)
                        : options.excludeTenantIds ?? []);
                const items: TenantQuickPickItem[] = options.tenantService.getTenants()
                    .filter(tenant => !excludeIds.has(tenant.id))
                    .map(tenant => ({
                        label: tenant.name,
                        description: tenant.url,
                        detail: active?.id === tenant.id ? "Active environment" : undefined,
                        picked: active?.id === tenant.id,
                        tenant
                    }));
                if (options.allowNone) {
                    items.push({
                        label: "None",
                        description: "Deselect the active environment",
                        picked: active === undefined
                    });
                }
                return items;
            },
            project: (item: TenantQuickPickItem) => item.tenant
        });
    }
}
