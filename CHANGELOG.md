# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Identity View**: section tabs show item counts (accounts, roles, …) as compact badges. The Entitlements tab shows the associated account (native identity) and classification badges; clicking the account switches to the Accounts tab filtered on it. The Roles tab shows classification badges on each row. Entitlements can be grouped by application or classification; Accounts and Roles have their own grouping. Those tables page 100 rows at a time in the webview; the plugin still returns at most 2000 entitlements. The redundant Entitlement **Type** column is omitted (`Entitlement` on almost every row); a badge appears only when the type differs. Table columns are resizable by dragging the right edge of a header (double-click to reset); a column can be narrower than its values, which are then truncated with an ellipsis and readable on hover. The widths are remembered per tab.

### Added

- Configurable export path patterns (`iiq.export.singleResource.filename`, `iiq.export.singleFile.filename`, `iiq.export.multipleFiles.folder`, `iiq.export.multipleFiles.filename`, `iiq.export.withDependencies.filename`), with the same tokens as the Identity Security Cloud extension (`%u`, `%w`, `%x`, date/time, `%t`/`%T`, `%o`, `%S`). Defaults keep the previous proposals (`<object name>.xml`, `export.xml`, workspace folder, `<ObjectType>/<name>.xml`).
- **Identity View**: identities open in a read-only custom editor instead of raw XML — header with status badges, manager and environment, plus Attributes, Accounts, Roles, Entitlements, Capabilities, Workgroups and QuickLinks tabs, each refreshable on its own. The Attributes tab omits fields already shown in the header or another tab (detected/assigned roles, last refresh, last login, manager, …). The Entitlements tab lists application entitlements only (assigned/detected roles stay on the Roles tab). Roles show their type on the row and expose the **Negative** assignment that the stock IdentityIQ UI hides; clicking a role or an entitlement opens a side drawer with the Bundle or ManagedAttribute summary. Clicking an account opens a drawer with the account detail: display name, last aggregation under it, Enabled/Disabled and Locked/Unlocked badges (Manually correlated only when true), application, instance, and every attribute the connector aggregated (credentials excluded). Clicking a workgroup opens a drawer listing the capabilities that workgroup grants. The QuickLinks tab lists QuickLinks whose population (`DynamicScope`) matches the identity. **View XML** switches to the XML editor (and **View Identity** switches back); the identity XML is never fetched to render the view. See [docs/identity-webview.md](docs/identity-webview.md). Requires the companion plugin to expose `GET /identities/{nameOrId}/view` and the object summary endpoints.
- **Open in IdentityIQ...** on an object of the tree view: opens the corresponding desktop page in the system browser for Applications, Roles (Bundles), Identities, Tasks, Workflows and Workgroups.
- **Log4j2 configuration**: open and edit the logging configuration of an environment through the virtual file system (`iiq://…/config/log4j2.properties`), download it locally, or upload a local copy. Saving or uploading writes the file on the server and reconfigures the live logger context, so the new levels apply immediately and survive a restart (unlike **Configure logging...**, which is in-memory only). The file is resolved from the live Log4j2 configuration, so an XML or relocated configuration is opened under its real name; a configuration Log4j2 rejects is rolled back server-side.
- **Read-only environments**: new environments start as read-only (lock icon). Toggle with **Set environment writable** / **Set environment read-only** on the tree. Objects and the Log4j2 configuration opened from a read-only environment cannot be saved or deleted; uploading a Log4j2 configuration is blocked. Existing environments stay writable until you lock them.

## 1.2.0 - 2026-09-07


### Added

- Local MCP server (stdio) for Cursor and VS Code Copilot, auto-registered when the extension activates. Agents can get/import/delete objects, list tenants, ping, run rules and tasks, test applications, and tail/configure logs. An optional `tenant` argument selects the environment by friendly name or a unique URL substring; otherwise the active environment is used. Credentials stay in VS Code Secret Storage: a loopback HTTP bridge in the extension host serves the stdio process. `iiq_run_task` waits with progress (2-minute cap, or `wait: false` for fire-and-forget).

### Changed

- **Import file...** (palette, editor context menu) now always asks for the target environment instead of silently using the active one. The active environment is preselected in the picker.
- Object leaf context menu: **Save to file...** renamed to **Export object...** (same behavior: tenant and object taken from the selection, cleaned XML without ids by default).
- During object export, the picker displays which object types is listed to be selected.

## [1.1.0] - 2026-08-07

### Added

- Environment (tenant) management: add (with API validation), remove (with confirmation), rename, test connection.
- Secure password storage in the VS Code Secret Storage.
- Folders to organize environments, with drag & drop.
- Active environment: status bar item, palette picker (with "None"), tree view context menu.
- Tree view of IIQ objects (Applications, Bundles, Forms, Identities, ObjectConfigs, QuickLinks, Rules, Tasks, Workflows) with configurable pagination (200 by default) and sorting by name or last modification date; refresh and sort-toggle buttons on each object type folder.
- Reports (TaskDefinitions of type `Report` or `LiveReport`) are excluded from the Tasks list; the generic "Get object..." command still lists them.
- Virtual file system (`iiq://`) to open and save objects directly in IdentityIQ.
- Guided commands: open object, export objects (single or multiple files), import files/folders, refresh a local XML file, compare a local XML file with an environment (diff view), save/delete an object from the view.
- Run rule command (tree view, editor, palette) with optional JSON arguments; result shown in the IdentityIQ output channel.
- Run task command (tree view, palette): asynchronous launch with progress notification while the task runs, success/warning/error report, and read-only preview of the final TaskResult.
- Get object command: generic access to every object type supported by the plugin (mirror of `ClassLists.MajorClasses`, ~130 types), beyond the curated tree types.
- Tail server logs command (tree view, palette): the server log files (targets of the file-backed Log4j2 appenders, resolved live) stream into a dedicated output channel, `tail -f` style — trailing window first, whole lines only, rotation detection, configurable poll interval (`iiq.logs.pollIntervalMs`), status bar indicator and stop command. A single log file is tailed without prompting.
- Consistent plugin REST contract: JSON envelope `{ "result": ..., "error": ... }` on every response, object XML carried as strings (`toXml()`), execution endpoints under `/objects/{ObjectType}/{nameOrId}/run`, systematic Log4j2 logging (see docs/plugin-api.md).
- XML cleaning on export (internal ids, timestamps, reference ids, significantModified, source-control cleanup) with CDATA preservation.
- Documentation: use cases reference and companion plugin REST API specification.
- BeanShell language assistance inside `<Source>` CDATA sections (Rules and workflow Scripts, `iiq://` and local XML files): member completion with type inference (declarations, `new`, casts, call chains, inherited members), import and class-name completion with automatic `import` insertion, predefined rule variables (`context`, `log`, per-rule-type arguments, document `<Signature>` taking precedence), hover with signatures and declaring class, signature help with overloads. Java metadata is read locally from the jars configured in `iiq.beanshell.classpath` (typically `WEB-INF/lib`); core JDK classes are bundled (`resources/jdk-core-index.json`, regenerated with `npm run generate-jdk-index`).
