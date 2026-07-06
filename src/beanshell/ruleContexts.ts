/**
 * Predefined variables available to a BeanShell region.
 *
 * Every rule gets `context` and `log`. The <Signature> declared in the
 * document is authoritative when present (it covers custom rules); otherwise
 * a curated map of the common rule types (from the IdentityIQ Rule Registry)
 * provides the usual arguments. Workflow scripts get the workflow variables.
 */

import { BeanshellRegion } from "./beanshellRegions";
import { LocalVariable } from "./scopeAnalyzer";

const COMMON_VARIABLES: LocalVariable[] = [
    { name: "context", type: "sailpoint.api.SailPointContext" },
    { name: "log", type: "org.apache.commons.logging.Log" }
];

const WORKFLOW_VARIABLES: LocalVariable[] = [
    { name: "workflow", type: "sailpoint.object.Workflow" },
    { name: "wfcontext", type: "sailpoint.workflow.WorkflowContext" },
    { name: "handler", type: "sailpoint.api.WorkflowHandler" },
    // Workflow.Step is an inner class: named for documentation, not resolvable
    { name: "step", type: "sailpoint.object.Workflow.Step" }
];

/**
 * Usual arguments of the common rule types (fallback when the rule has no
 * <Signature>). Curated from the IdentityIQ Rule Registry.
 */
const RULE_TYPE_VARIABLES: Record<string, LocalVariable[]> = {
    "IdentityAttribute": [
        { name: "environment", type: "java.util.Map" },
        { name: "identity", type: "sailpoint.object.Identity" },
        { name: "attributeDefinition", type: "sailpoint.object.ObjectAttribute" },
        { name: "attributeSource", type: "sailpoint.object.AttributeSource" },
        { name: "link", type: "sailpoint.object.Link" },
        { name: "oldValue", type: "java.lang.Object" }
    ],
    "Correlation": [
        { name: "environment", type: "java.util.Map" },
        { name: "application", type: "sailpoint.object.Application" },
        { name: "account", type: "sailpoint.object.ResourceObject" }
    ],
    "ManagerCorrelation": [
        { name: "environment", type: "java.util.Map" },
        { name: "application", type: "sailpoint.object.Application" },
        { name: "link", type: "sailpoint.object.Link" },
        { name: "managerAttributeValue", type: "java.lang.Object" }
    ],
    "Customization": [
        { name: "object", type: "sailpoint.object.ResourceObject" },
        { name: "application", type: "sailpoint.object.Application" },
        { name: "connector", type: "sailpoint.connector.Connector" },
        { name: "state", type: "java.util.Map" }
    ],
    "BuildMap": [
        { name: "cols", type: "java.util.List" },
        { name: "record", type: "java.util.List" },
        { name: "application", type: "sailpoint.object.Application" },
        { name: "schema", type: "sailpoint.object.Schema" },
        { name: "state", type: "java.util.Map" }
    ],
    "JDBCBuildMap": [
        { name: "result", type: "java.sql.ResultSet" },
        { name: "connection", type: "java.sql.Connection" },
        { name: "application", type: "sailpoint.object.Application" },
        { name: "schema", type: "sailpoint.object.Schema" },
        { name: "state", type: "java.util.Map" }
    ],
    "PreIterate": [
        { name: "application", type: "sailpoint.object.Application" },
        { name: "schema", type: "sailpoint.object.Schema" },
        { name: "stats", type: "java.util.Map" }
    ],
    "PostIterate": [
        { name: "application", type: "sailpoint.object.Application" },
        { name: "schema", type: "sailpoint.object.Schema" },
        { name: "stats", type: "java.util.Map" }
    ],
    "FieldValue": [
        { name: "field", type: "sailpoint.object.Field" },
        { name: "identity", type: "sailpoint.object.Identity" },
        { name: "application", type: "sailpoint.object.Application" },
        { name: "current", type: "java.lang.Object" }
    ],
    "Refresh": [
        { name: "environment", type: "java.util.Map" },
        { name: "identity", type: "sailpoint.object.Identity" }
    ],
    "IdentityCreation": [
        { name: "environment", type: "java.util.Map" },
        { name: "identity", type: "sailpoint.object.Identity" },
        { name: "accounts", type: "java.util.List" }
    ],
    "IdentityTrigger": [
        { name: "newIdentity", type: "sailpoint.object.Identity" },
        { name: "previousIdentity", type: "sailpoint.object.Identity" }
    ],
    "BeforeProvisioning": [
        { name: "plan", type: "sailpoint.object.ProvisioningPlan" },
        { name: "application", type: "sailpoint.object.Application" }
    ],
    "AfterProvisioning": [
        { name: "plan", type: "sailpoint.object.ProvisioningPlan" },
        { name: "application", type: "sailpoint.object.Application" },
        { name: "result", type: "sailpoint.object.ProvisioningResult" }
    ]
};

/**
 * Well-known simple names used in rule <Signature> types: resolved eagerly
 * so that a Signature written with simple names still gets member completion.
 */
const WELL_KNOWN_SIGNATURE_TYPES: Record<string, string> = {
    "Map": "java.util.Map",
    "List": "java.util.List",
    "String": "java.lang.String",
    "Object": "java.lang.Object",
    "Identity": "sailpoint.object.Identity",
    "Application": "sailpoint.object.Application",
    "Link": "sailpoint.object.Link",
    "ResourceObject": "sailpoint.object.ResourceObject",
    "Schema": "sailpoint.object.Schema",
    "Field": "sailpoint.object.Field",
    "ObjectAttribute": "sailpoint.object.ObjectAttribute",
    "ProvisioningPlan": "sailpoint.object.ProvisioningPlan",
    "ProvisioningResult": "sailpoint.object.ProvisioningResult",
    "TaskResult": "sailpoint.object.TaskResult",
    "Workflow": "sailpoint.object.Workflow",
    "Rule": "sailpoint.object.Rule",
    "Bundle": "sailpoint.object.Bundle",
    "Custom": "sailpoint.object.Custom",
    "Connector": "sailpoint.connector.Connector",
    "SailPointContext": "sailpoint.api.SailPointContext",
    "Log": "org.apache.commons.logging.Log"
};

/** The predefined variables visible in a BeanShell region */
export function getContextVariables(region: BeanshellRegion): LocalVariable[] {
    const variables = [...COMMON_VARIABLES];

    if (region.signatureInputs && region.signatureInputs.length > 0) {
        // The Signature of the document is authoritative
        for (const input of region.signatureInputs) {
            variables.push({ name: input.name, type: qualifySignatureType(input.type) });
        }
    } else if (region.ruleType && RULE_TYPE_VARIABLES[region.ruleType]) {
        variables.push(...RULE_TYPE_VARIABLES[region.ruleType]);
    } else if (region.container === "Script") {
        variables.push(...WORKFLOW_VARIABLES);
    }
    // Deduplicate by name, first declaration wins (context/log stay stable)
    const seen = new Set<string>();
    return variables.filter(v => !seen.has(v.name) && seen.add(v.name));
}

function qualifySignatureType(type: string | undefined): string | undefined {
    if (!type || type.includes(".")) {
        return type;
    }
    return WELL_KNOWN_SIGNATURE_TYPES[type] ?? type;
}
