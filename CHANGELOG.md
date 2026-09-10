# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Copy name** on an object of the tree view: copies the object name to the clipboard, one name per line when several objects are selected.

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
