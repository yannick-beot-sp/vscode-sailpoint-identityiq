# Change Log

All notable changes to the "vscode-sailpoint-identityiq" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
