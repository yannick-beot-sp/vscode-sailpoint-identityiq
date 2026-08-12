/**
 * Definition of an IdentityIQ object type manageable by the extension.
 *
 * To support a new object type, simply add an entry to {@link OBJECT_TYPES}:
 * the tree view, the wizards and the file system provider are data-driven.
 */
export interface ObjectTypeDefinition {
    /** IdentityIQ class name (as expected by the plugin REST API), e.g. "TaskDefinition" */
    objectType: string;
    /** Label displayed in the tree view and in pickers (plural), e.g. "Tasks" */
    label: string;
    /** Codicon id used in the tree view */
    icon: string;
    /**
     * Values of the `type` attribute excluded when listing objects,
     * e.g. Report/LiveReport to keep reports out of the Tasks list.
     */
    excludeTypes?: string[];
}

/**
 * Object types displayed in the tree view, in alphabetical order of label.
 */
export const OBJECT_TYPES: ObjectTypeDefinition[] = [
    { objectType: "Application", label: "Applications", icon: "plug" },
    { objectType: "Bundle", label: "Bundles", icon: "folder-library" },
    { objectType: "Form", label: "Forms", icon: "preview" },
    { objectType: "Identity", label: "Identities", icon: "person" },
    { objectType: "ObjectConfig", label: "ObjectConfigs", icon: "settings-gear" },
    { objectType: "QuickLink", label: "QuickLinks", icon: "link" },
    { objectType: "Rule", label: "Rules", icon: "code" },
    // Reports are TaskDefinitions too (type Report or LiveReport): keep them out of the Tasks list
    { objectType: "TaskDefinition", label: "Tasks", icon: "checklist", excludeTypes: ["Report", "LiveReport"] },
    { objectType: "Workflow", label: "Workflows", icon: "type-hierarchy-sub" },
    // Workgroups are Identity objects with workgroup="true" (virtual type alias in the plugin)
    { objectType: "Workgroup", label: "Workgroups", icon: "organization" }
];

export function getObjectTypeDefinition(objectType: string): ObjectTypeDefinition | undefined {
    return OBJECT_TYPES.find(t => t.objectType.toLowerCase() === objectType.toLowerCase());
}

/**
 * All object types accessible through the generic "Get object..." command.
 * Mirror of the list supported by the plugin (sailpoint.object.ClassLists
 * .MajorClasses); names are relative to the sailpoint.object package, so a
 * few carry a subpackage prefix (accesshistory.*). OBJECT_TYPES above is the
 * curated subset displayed in the tree view.
 */
export const ALL_OBJECT_TYPES: string[] = [
    "AccountGroup", "ActivityDataSource", "Alert", "AlertDefinition", "Application",
    "ApplicationActivity", "ApplicationScorecard", "AsyncRequest", "AuditConfig", "AuditEvent",
    "AuthenticationQuestion", "BatchRequest", "Bundle", "BundleArchive", "BundleProfileRelation",
    "BundleProfileRelationObject", "BundleProfileRelationStep", "Category", "Capability",
    "Certification", "CertificationItem", "CertificationArchive", "CertificationDefinition",
    "CertificationGroup", "Classification", "CloudAccess3Way", "CloudAccessGroup",
    "CloudAccessRole", "CloudAccessScope", "Configuration", "CorrelationConfig", "Custom",
    "DatabaseVersion", "Dictionary", "DynamicScope", "EmailTemplate", "Form", "FullTextIndex",
    "GroupFactory", "GroupDefinition", "GroupIndex",
    "accesshistory.HistoricalAccountCapture", "accesshistory.HistoricalCapability",
    "accesshistory.HistoricalCapabilityCapture", "accesshistory.HistoricalCertification",
    "accesshistory.HistoricalCertificationRemediationCapture", "accesshistory.HistoricalDatabaseVersion",
    "accesshistory.HistoricalEntitlementCapture", "accesshistory.HistoricalPolicyViolationCapture",
    "accesshistory.HistoricalPolicyViolationRemediationCapture", "accesshistory.HistoricalIdentity",
    "accesshistory.HistoricalIdentityCapture", "accesshistory.HistoricalIdentityEvent",
    "accesshistory.HistoricalIdentityRequestCapture", "accesshistory.HistoricalIdentityRequestItemCapture",
    "accesshistory.HistoricalWorkgroup", "accesshistory.HistoricalWorkgroupCapture",
    "accesshistory.HistoricalWorkgroupEvent", "accesshistory.HistoricalManagedAttribute",
    "accesshistory.HistoricalManagedAttributeCapture", "accesshistory.HistoricalManagedAttributeEvent",
    "accesshistory.HistoricalRole", "accesshistory.HistoricalRoleCapture",
    "accesshistory.HistoricalRoleEvent", "accesshistory.HistoricalObjectConfigCapture",
    "Identity", "IdentityArchive", "IdentityEntitlement", "IdentityHistoryItem", "IdentityRequest",
    "IdentityRequestItem", "IdentitySnapshot", "IdentityTrigger", "IntegrationConfig",
    "InterceptedDelete", "JasperResult", "JasperTemplate", "AdaptiveCardNotificationTemplate",
    "Link", "LocalizedAttribute", "ManagedAttribute", "MessageTemplate", "MiningConfig",
    "MitigationExpiration", "Module", "MonitoringStatistic", "NamedTimestamp",
    "NativeIdentityChangeEvent", "ObjectConfig", "PasswordPolicy", "PendingRequestAttachment",
    "Plugin", "Policy", "PolicyViolation", "PostCommitNotificationObject", "ProcessLog",
    "Profile", "ProvisioningRequest", "ProvisioningTransaction", "QuickLink",
    "RecommenderDefinition", "Request", "RequestState", "RequestDefinition", "ResourceEvent",
    "RightConfig", "RoleChangeEvent", "RoleIndex", "RoleMetadata", "RoleMiningResult",
    "RoleScorecard", "Rule", "RuleRegistry", "Scope", "Scorecard", "ScoreConfig", "SPRight",
    "ServerStatistic", "ServiceDefinition", "ServiceLock", "ServiceStatus", "Server",
    "SyslogEvent", "Tag", "Target", "TargetAssociation", "TargetSource", "TaskDefinition",
    "TaskResult", "TaskSchedule", "TimePeriod", "UIConfig", "UIPreferences", "Widget",
    "Workflow", "WorkflowCase", "WorkflowRegistry", "WorkflowTestSuite", "WorkItem",
    "WorkItemArchive",
    // Virtual alias: Identity with workgroup=true (not a ClassLists.MajorClasses entry)
    "Workgroup",
    "YAMLConfig"
];

/**
 * Returns the curated definition of a type when it exists, or a generic
 * definition, so that any supported type can be used by the pickers and the
 * virtual file system.
 */
export function getOrCreateObjectTypeDefinition(objectType: string): ObjectTypeDefinition {
    return getObjectTypeDefinition(objectType)
        ?? { objectType, label: objectType, icon: "symbol-class" };
}

/**
 * Definitions for every object type supported by the plugin (ALL_OBJECT_TYPES),
 * generic (no type-based exclusion, since it isn't the curated tree view list),
 * sorted alphabetically. Used by pickers offering any object type, such as
 * "Get object..." and "Export objects...".
 */
export function getAllObjectTypeDefinitions(): ObjectTypeDefinition[] {
    return ALL_OBJECT_TYPES
        .map(getOrCreateObjectTypeDefinition)
        .map(definition => ({ ...definition, excludeTypes: undefined }))
        .sort((a, b) => a.objectType.localeCompare(b.objectType));
}

/**
 * Summary of an IdentityIQ object, as returned by the list endpoint of the plugin.
 */
export interface ObjectSummary {
    id: string;
    name: string;
    /** ISO-8601 creation date */
    created?: string;
    /** ISO-8601 last modification date */
    modified?: string;
}

/** Result of a paginated list request */
export interface ObjectListResult {
    /** Total number of objects for the type (regardless of pagination) */
    count: number;
    objects: ObjectSummary[];
}
