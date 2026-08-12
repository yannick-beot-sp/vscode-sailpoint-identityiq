import { QuickPickItem } from "vscode";
import { ObjectSummary, ObjectTypeDefinition } from "../models/ObjectTypes";
import { IIQClient } from "../services/IIQClient";
import { TenantInfo } from "../models/TenantInfo";
import { TenantService } from "../services/TenantService";
import { getDefaultSort, getPageSize } from "../utils/configurationUtils";
import { QuickPickPromptStep } from "./quickPickPromptStep";
import { WizardContext } from "./wizardContext";

export interface ObjectQuickPickItem extends QuickPickItem {
    object: ObjectSummary;
}

export interface QuickPickObjectStepOptions {
    tenantService: TenantService;
    /** Name of the context property. Defaults to "object" (single) or "objects" (multi) */
    name?: string;
    canPickMany?: boolean;
    /** Resolves the object type: either static or from the context */
    getObjectType: (context: WizardContext) => ObjectTypeDefinition;
    /** Resolves the tenant. Defaults to the "tenant" property of the context */
    getTenant?: (context: WizardContext) => TenantInfo;
}

/**
 * Reusable step to pick one or several objects of a given type.
 * The list is retrieved from the environment, sorted according to the
 * `iiq.objectList.sort` setting, and paginated with the
 * `iiq.pagination.pageSize` setting (all pages are fetched sequentially so
 * that the quick pick filter works on the complete list).
 */
export class QuickPickObjectStep extends QuickPickPromptStep<WizardContext, ObjectQuickPickItem> {

    private readonly getObjectType: (context: WizardContext) => ObjectTypeDefinition;
    private readonly canPickMany: boolean;

    constructor(options: QuickPickObjectStepOptions) {
        super({
            name: options.name ?? (options.canPickMany ? "objects" : "object"),
            displayName: options.canPickMany ? "objects" : "object",
            options: {
                canPickMany: options.canPickMany ?? false,
                matchOnDescription: true
            },
            items: async (context: WizardContext) => {
                const tenant = options.getTenant?.(context) ?? context.tenant as TenantInfo;
                const objectType = options.getObjectType(context);
                const client = new IIQClient(tenant, options.tenantService);

                const pageSize = getPageSize();
                const sortBy = getDefaultSort();
                const objects: ObjectSummary[] = [];
                let start = 0;
                let count = Number.MAX_SAFE_INTEGER;
                while (start < count) {
                    const result = await client.listObjects(objectType.objectType, {
                        start,
                        limit: pageSize,
                        sortBy,
                        excludeTypes: objectType.excludeTypes
                    });
                    objects.push(...result.objects);
                    count = result.count;
                    if (result.objects.length === 0) {
                        break;
                    }
                    start += result.objects.length;
                }

                return objects.map(object => ({
                    label: object.name,
                    description: object.modified ? `Modified: ${object.modified}` : undefined,
                    object
                }));
            },
            project: (item: ObjectQuickPickItem) => item.object
        });
        this.getObjectType = options.getObjectType;
        this.canPickMany = options.canPickMany ?? false;
    }

    /** Shows the current object type in the quick pick placeholder (e.g. "Choose Rules"). */
    public override async configureBeforePrompt(wizardContext: WizardContext): Promise<void> {
        const { label } = this.getObjectType(wizardContext);
        // Labels are plural (e.g. "Rules"); avoid "Choose one Rules".
        this._options.placeHolder = this.canPickMany
            ? `Choose ${label}`
            : `Choose from ${label}`;
    }
}
