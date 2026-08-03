import { ALL_OBJECT_TYPES } from "../models/ObjectTypes";
import { decodeXmlEntities } from "./xmlUtils";
import { parseXmlElements, XmlElement } from "../workflow/workflowParser";

/** A dependency on another IdentityIQ object, identified by type and name */
export interface ObjectReference {
    objectType: string;
    name: string;
}

const SAILPOINT_OBJECT_PREFIX = "sailpoint.object.";

/** Object types never pulled in as dependencies (identities, workgroups, ...) */
const EXCLUDED_OBJECT_TYPES = new Set([
    "Identity",
    "IdentityArchive",
    "IdentitySnapshot",
    "Workgroup",
    "accesshistory.HistoricalIdentity",
    "accesshistory.HistoricalWorkgroup"
]);

const EXPORTABLE_TYPES = new Set(ALL_OBJECT_TYPES.filter(t => !EXCLUDED_OBJECT_TYPES.has(t)));

/**
 * Parent wrapper elements whose single {@link Reference} child implies a type
 * when the Reference omits the {@code class} attribute.
 */
const REF_WRAPPER_TYPES: Record<string, string> = {
    AccountCorrelationConfig: "CorrelationConfig",
    WorkflowRef: "Workflow",
    RuleRef: "Rule",
    ListenerWorkflow: "Workflow",
    ApplicationRef: "Application",
    EmailTemplateRef: "EmailTemplate",
    PendingWorkflow: "Workflow",
    PopulationRef: "GroupDefinition",
    QuestionRef: "AuthenticationQuestion"
};

/** Map entry keys whose string value names a Rule (soft reference, no {@link Reference}) */
const MAP_ENTRY_RULE_KEYS = new Set([
    "beforeProvisioningRule",
    "afterProvisioningRule",
    "beforeRule",
    "afterRule",
    "rule",
    "ruleName",
    "correlationRule",
    "creationRule",
    "customizationRule",
    "managedAttributeCustomizationRule",
    "managerCorrelationRule",
    "joinRule",
    "listenerRule",
    "validationRule",
    "transformationRule",
    "violationOwnerRule"
]);

/** Map entry keys whose string value names a Workflow */
const MAP_ENTRY_WORKFLOW_KEYS = new Set([
    "workflowName",
    "workflow",
    "pendingWorkflow",
    "listenerWorkflow"
]);

/** Map entry keys whose string value names a Form */
const MAP_ENTRY_FORM_KEYS = new Set([
    "workItemForm",
    "formName"
]);

function classToObjectType(classAttr: string | undefined): string | undefined {
    if (!classAttr) {
        return undefined;
    }
    if (classAttr.startsWith(SAILPOINT_OBJECT_PREFIX)) {
        return classAttr.substring(SAILPOINT_OBJECT_PREFIX.length);
    }
    return EXPORTABLE_TYPES.has(classAttr) ? classAttr : undefined;
}

function isExportableType(objectType: string): boolean {
    return EXPORTABLE_TYPES.has(objectType);
}

function walkElements(elements: XmlElement[],
    visitor: (element: XmlElement, parent?: XmlElement) => void,
    parent?: XmlElement): void {
    for (const element of elements) {
        visitor(element, parent);
        walkElements(element.children, visitor, element);
    }
}

/** Reads a plain string value from a Map {@link entry} element */
function entryStringValue(entry: XmlElement): string | undefined {
    if (entry.attributes["value"]) {
        return decodeXmlEntities(entry.attributes["value"]).trim() || undefined;
    }
    const valueElement = entry.children.find(child => child.name === "value");
    if (valueElement) {
        if (valueElement.children.some(child => child.name === "Reference" || child.name === "Map")) {
            return undefined;
        }
        const text = valueElement.text.trim();
        if (text) {
            return text;
        }
    }
    const text = entry.text.trim();
    return text || undefined;
}

/**
 * Extracts exportable object dependencies from an IdentityIQ XML document.
 * Handles hard {@link Reference} elements, wrapper elements ({@code RuleRef},
 * {@code WorkflowRef}, …) and soft string references in Map {@link entry}
 * keys ({@code beforeRule}, {@code workflowName}, …).
 */
export function extractObjectReferences(xml: string): ObjectReference[] {
    const roots = parseXmlElements(xml);
    const refs: ObjectReference[] = [];
    const seen = new Set<string>();

    const add = (objectType: string, name: string) => {
        const trimmed = name.trim();
        if (!trimmed || !isExportableType(objectType)) {
            return;
        }
        const key = `${objectType}/${trimmed}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        refs.push({ objectType, name: trimmed });
    };

    walkElements(roots, (element, parent) => {
        if (element.name === "Reference") {
            const name = element.attributes["name"];
            if (!name) {
                return;
            }
            let objectType = classToObjectType(element.attributes["class"]);
            if (!objectType && parent) {
                objectType = REF_WRAPPER_TYPES[parent.name];
            }
            if (objectType) {
                add(objectType, name);
            }
            return;
        }

        if (element.name !== "entry") {
            return;
        }
        const key = element.attributes["key"];
        if (!key) {
            return;
        }
        if (element.children.some(child => child.name === "Reference")) {
            return;
        }

        let objectType: string | undefined;
        if (MAP_ENTRY_RULE_KEYS.has(key)) {
            objectType = "Rule";
        } else if (MAP_ENTRY_WORKFLOW_KEYS.has(key)) {
            objectType = "Workflow";
        } else if (MAP_ENTRY_FORM_KEYS.has(key)) {
            objectType = "Form";
        }
        if (!objectType) {
            return;
        }

        const value = entryStringValue(element);
        if (value) {
            add(objectType, value);
        }
    });

    return refs;
}

/** Stable key for deduplicating object references */
export function referenceKey(ref: ObjectReference): string {
    return `${ref.objectType}/${ref.name}`;
}
