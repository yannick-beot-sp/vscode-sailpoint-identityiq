/**
 * Constants shared across the extension.
 */

/** URI scheme used by the virtual file system provider (iiq://) */
export const URI_SCHEME = "iiq";

/** URI scheme used to display the remote, read-only version of an object in diff views */
export const DIFF_SCHEME = "iiq-remote";

/** Base path of the companion IdentityIQ plugin REST resources */
export const PLUGIN_REST_BASE_PATH = "/plugin/rest/iiq-devtools";

/**
 * Version of the plugin REST API expected by this version of the extension.
 * The `ping` endpoint returns the API version implemented by the plugin.
 * A mismatch is reported to the user during the connection test.
 */
export const EXPECTED_API_VERSION = 1;

/**
 * Default name of the Log4j2 configuration file of an environment. The
 * plugin reports the name of the file actually backing the live
 * configuration, which Log4j2 also allows to be XML, YAML or JSON.
 */
export const LOG4J_CONFIG_FILE = "log4j2.properties";

/**
 * Header of the `HEAD /system/log4j` response carrying that real file
 * name (lowercase: axios normalizes response header names).
 */
export const LOG4J_FILE_NAME_HEADER = "x-iiq-file-name";

/** View id of the environment tree view */
export const VIEW_ID = "iiq.view.environments";

/** Context values used in the tree view for menu contributions */
export const CONTEXT_VALUES = {
    folder: "iiqFolder",
    tenant: "iiqTenant",
    tenantReadOnly: "iiqTenantReadOnly",
    tenantWritable: "iiqTenantWritable",
    objectType: "iiqObjectType",
    object: "iiqObject",
    loadMore: "iiqLoadMore",
    log4jConfig: "iiqLog4jConfig",
    log4jConfigReadOnly: "iiqLog4jConfigReadOnly"
} as const;

/** Commands ids. Must match the `contributes.commands` section of package.json */
export const COMMANDS = {
    addTenant: "iiq.tenant.add",
    removeTenant: "iiq.tenant.remove",
    renameTenant: "iiq.tenant.rename",
    testConnection: "iiq.tenant.test-connection",
    setActiveTenant: "iiq.tenant.set-active",
    setTenantReadOnly: "iiq.tenant.set-readonly",
    setTenantWritable: "iiq.tenant.set-writable",
    selectEnvironment: "iiq.select-environment",
    addFolder: "iiq.folder.add",
    renameFolder: "iiq.folder.rename",
    removeFolder: "iiq.folder.remove",
    openObject: "iiq.open-object",
    exportObjects: "iiq.export-objects",
    importFile: "iiq.import-file",
    importFileView: "iiq.import-file-view",
    importFileExplorer: "iiq.import-file-explorer",
    refreshFile: "iiq.refresh-file",
    compareFile: "iiq.compare-file",
    addRule: "iiq.rule.add",
    runRule: "iiq.run-rule",
    runTask: "iiq.run-task",
    testApplicationConnection: "iiq.application.test-connection",
    peekApplicationObjects: "iiq.application.peek-objects",
    previewWorkflow: "iiq.preview-workflow",
    viewIdentity: "iiq.identity.view",
    viewIdentityXml: "iiq.identity.view-xml",
    refreshIdentity: "iiq.identity.refresh",
    tailLogs: "iiq.tail-logs",
    stopTailLogs: "iiq.stop-tail-logs",
    configureLogging: "iiq.configure-logging",
    openLog4jConfig: "iiq.log4j.open",
    downloadLog4jConfig: "iiq.log4j.download",
    uploadLog4jConfig: "iiq.log4j.upload",
    saveObject: "iiq.object.save",
    saveObjectWithDependencies: "iiq.object.save-with-dependencies",
    cloneObject: "iiq.object.clone",
    copyObjectToTenant: "iiq.object.copy-to-tenant",
    copyObjectToTenantView: "iiq.object.copy-to-tenant-view",
    copyObjectName: "iiq.object.copy-name",
    openObjectInUi: "iiq.object.open-in-ui",
    deleteObject: "iiq.object.delete",
    refresh: "iiq.refresh",
    refreshNode: "iiq.refresh-node",
    loadMore: "iiq.load-more",
    sortByName: "iiq.sort-by-name",
    sortByLastModified: "iiq.sort-by-last-modified",
    filterObjects: "iiq.filter-objects",
    clearFilter: "iiq.clear-filter"
} as const;

/** Configuration keys. Must match the `contributes.configuration` section of package.json */
export const CONFIGURATION = {
    pageSize: "iiq.pagination.pageSize",
    sort: "iiq.objectList.sort",
    logsPollInterval: "iiq.logs.pollIntervalMs",
    rejectUnauthorized: "iiq.connection.rejectUnauthorized",
    exportSingleResourceFilename: "iiq.export.singleResource.filename",
    exportSingleFileFilename: "iiq.export.singleFile.filename",
    exportMultipleFilesFolder: "iiq.export.multipleFiles.folder",
    exportMultipleFilesFilename: "iiq.export.multipleFiles.filename",
    exportWithDependenciesFilename: "iiq.export.withDependencies.filename",
    removeIds: "iiq.export.removeIds",
    removeCreatedTimestamp: "iiq.export.removeCreatedTimestamp",
    removeModifiedTimestamp: "iiq.export.removeModifiedTimestamp",
    removeReferenceIds: "iiq.export.removeReferenceIds",
    removeSignificantModified: "iiq.export.removeSignificantModified",
    cleanForSourceControl: "iiq.export.cleanForSourceControl",
    beanshellEnabled: "iiq.beanshell.enabled",
    beanshellClasspath: "iiq.beanshell.classpath",
    beanshellMaxCompletionItems: "iiq.beanshell.maxCompletionItems",
    xmlCompletionEnabled: "iiq.xml.completion.enabled",
    xmlDtdPath: "iiq.xml.dtdPath"
} as const;

/** Provider id declared in package.json `contributes.mcpServerDefinitionProviders` */
export const MCP_PROVIDER_ID = "iiq.mcp";

/** Label shown in the MCP server list (VS Code / Cursor) */
export const MCP_SERVER_LABEL = "SailPoint IdentityIQ";

/** Env vars passed to the MCP stdio process so it can reach the loopback bridge */
export const MCP_ENV_URL = "IIQ_MCP_URL";
export const MCP_ENV_TOKEN = "IIQ_MCP_TOKEN";

/** Interval between TaskResult status polls while waiting on `iiq_run_task` */
export const TASK_POLL_INTERVAL_MS = 2000;

/** Max time `iiq_run_task` waits for completion when `wait` is true */
export const TASK_WAIT_CAP_MS = 120_000;
