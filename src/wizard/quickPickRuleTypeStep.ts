import { QuickPickItem } from "vscode";
import { QuickPickPromptStep } from "./quickPickPromptStep";
import { WizardContext } from "./wizardContext";

interface RuleTypeQuickPickItem extends QuickPickItem {
    type: string;
}

const RULE_TYPES: Array<{ type: string; label: string; description: string }> = [
    // Common identity & provisioning rules
    { type: "", label: "Generic Rule", description: "A simple generic rule" },
    { type: "IdentityAttribute", label: "Identity Attribute", description: "Custom identity attribute calculation" },
    { type: "IdentityCreation", label: "Identity Creation", description: "Create or modify identities during aggregation" },
    { type: "IdentityTrigger", label: "Identity Trigger", description: "Triggered by identity changes" },
    { type: "Refresh", label: "Refresh", description: "Modify identity after refresh" },
    { type: "FieldValue", label: "Field Value", description: "Calculate form/request field values" },

    // Correlation & account rules
    { type: "Correlation", label: "Correlation", description: "Find identities for new accounts" },
    { type: "ManagerCorrelation", label: "Manager Correlation", description: "Find manager identities" },
    { type: "PreIterate", label: "Pre Iterate", description: "Before resource aggregation" },
    { type: "PostIterate", label: "Post Iterate", description: "After resource aggregation" },

    // Provisioning rules
    { type: "BeforeProvisioning", label: "Before Provisioning", description: "Modify plan before provisioning" },
    { type: "AfterProvisioning", label: "After Provisioning", description: "Handle result after provisioning" },

    // Form & validation rules
    { type: "Validation", label: "Validation", description: "Validate form/request field values" },
    { type: "AllowedValues", label: "Allowed Values", description: "Determine allowed field values" },
    { type: "Owner", label: "Owner", description: "Determine role/app owner" },

    // Policy & compliance rules
    { type: "Policy", label: "Policy", description: "Evaluate policy violations" },
    { type: "PolicyNotification", label: "Policy Notification", description: "Determine policy violation recipients" },
    { type: "Escalation", label: "Escalation", description: "Escalate work/cert items" },
    { type: "IdentityFilterGenerator", label: "Identity Filter Generator", description: "Generate filters for quicklinks" },

    // Workflow rules
    { type: "Workflow", label: "Workflow", description: "Custom workflow logic" },
    { type: "CertificationPhaseChange", label: "Certification Phase Change", description: "Handle certification phase changes" },

    // Advanced/Specialized rules
    { type: "ActivityCorrelation", label: "Activity Correlation", description: "Correlate user activities" },
    { type: "CompositeAccount", label: "Composite Account", description: "Build composite accounts" },
    { type: "LinkAttribute", label: "Link Attribute", description: "Calculate account attribute values" },
    { type: "RequestObjectSelector", label: "Request Object Selector", description: "Filter requestable objects" },
    { type: "ScopeCorrelation", label: "Scope Correlation", description: "Correlate scopes to identities" },
    { type: "WorkItemForward", label: "Work Item Forward", description: "Forward work items to users" },
];

/**
 * Wizard step to pick a rule type with descriptions.
 * Stores the rule type string in the context.
 */
export class QuickPickRuleTypeStep extends QuickPickPromptStep<WizardContext, RuleTypeQuickPickItem> {

    constructor() {
        super({
            name: "ruleType",
            displayName: "rule type",
            options: { canPickMany: false },
            items: RULE_TYPES.map(rt => ({
                label: rt.label,
                description: rt.description,
                type: rt.type
            })),
            project: (item: RuleTypeQuickPickItem) => item.type
        });
    }
}
