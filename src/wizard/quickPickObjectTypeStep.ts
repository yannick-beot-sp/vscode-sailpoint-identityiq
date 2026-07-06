import { QuickPickItem } from "vscode";
import { OBJECT_TYPES, ObjectTypeDefinition } from "../models/ObjectTypes";
import { QuickPickPromptStep } from "./quickPickPromptStep";
import { WizardContext } from "./wizardContext";

interface ObjectTypeQuickPickItem extends QuickPickItem {
    objectTypeDefinition: ObjectTypeDefinition;
}

export interface QuickPickObjectTypeStepOptions {
    /** Name of the context property. Defaults to "objectType" (single) or "objectTypes" (multi) */
    name?: string;
    canPickMany?: boolean;
    /** Type definitions offered by the picker. Defaults to the curated OBJECT_TYPES */
    objectTypes?: ObjectTypeDefinition[];
}

/**
 * Reusable step to pick one or several IdentityIQ object types.
 * Stores ObjectTypeDefinition(s) in the context.
 */
export class QuickPickObjectTypeStep extends QuickPickPromptStep<WizardContext, ObjectTypeQuickPickItem> {

    constructor(options: QuickPickObjectTypeStepOptions = {}) {
        super({
            name: options.name ?? (options.canPickMany ? "objectTypes" : "objectType"),
            displayName: options.canPickMany ? "object types" : "object type",
            options: { canPickMany: options.canPickMany ?? false },
            items: () => (options.objectTypes ?? OBJECT_TYPES).map(definition => ({
                label: definition.label,
                description: definition.objectType,
                objectTypeDefinition: definition
            })),
            project: (item: ObjectTypeQuickPickItem) => item.objectTypeDefinition
        });
    }
}
