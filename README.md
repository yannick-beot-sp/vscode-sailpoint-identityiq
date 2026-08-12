# SailPoint IdentityIQ for Visual Studio Code

> Manage SailPoint IdentityIQ objects (Rules, Workflows, Tasks, Applications...) directly from VS Code.

This extension connects VS Code to one or several **IdentityIQ** environments
through a companion REST plugin, and lets you browse, edit, export, import,
refresh and compare IIQ objects without leaving your editor.

> ⚠️ This extension is **not** developed, funded or endorsed by SailPoint.

## Features

### Environments
- **Multiple environments** (dev, test, prod...) organized in **folders**
  (drag & drop), listed in a dedicated *IdentityIQ* view.
- Add an environment with a guided wizard: display name, base URL, login,
  password. The configuration is **validated with an API call** (including
  plugin API version vs extension version).
- Passwords are stored securely in the **VS Code Secret Storage** — never on disk.
- **Active environment** shown in the status bar; switch it from the status
  bar, the command palette (with a *None* option) or the tree view.
- Connection test with optional SSL verification
  (`iiq.connection.rejectUnauthorized`) for self-signed certificates.

### Browse & edit objects
- Tree view of objects per environment: Applications, Bundles, Forms,
  Identities, ObjectConfigs, QuickLinks, Rules, Tasks, Workflows.
- **Paginated** lists (`iiq.pagination.pageSize`, default 200) with
  *Load more...*, sorted **by name or by last modification date** (global
  setting + per-node override).
- Objects open in a **virtual file system** (`iiq://.../<Env>/<Type>/<name>.xml`
  — the environment display name is part of the path). **Saving the editor
  saves the object back to IdentityIQ.**
- **Get object...**: generic access to **every** object type supported by
  IdentityIQ (~130 types, mirror of `ClassLists.MajorClasses` — Configuration,
  Custom, WorkflowCase, TaskResult...), beyond the types shown in the tree.

### Export / import
- **Export objects...**: pick an environment, one or several object types, then
  the objects; export to one file per object or to a single `<sailpoint>` file.
- **Export object...** (object leaf context menu): tenant and object are taken
  from the selection; opens a save dialog with cleaned XML.
- Exported XML is **cleaned for source control** (configurable): internal ids,
  created/modified timestamps, reference ids, `significantModified`... removed,
  **CDATA preserved**.
- **Import file(s)...** from the editor, from an environment's context menu
  in the tree view (file picker), or from the file explorer (multi-selection,
  folders imported recursively), with a success/error report.
- **Refresh file from IdentityIQ...**: re-fetch the object of the current XML file.
- **Compare with IdentityIQ...**: diff the current XML file with its version
  in an environment.

### Run rules & tasks
- **Run rule...** from the tree view (play button on a Rule), from a Rule XML
  file or from the command palette, with optional JSON arguments; the result
  and execution time are shown in the *IdentityIQ* output channel.
- **Run task...** from the tree view (play button on a Task) or from the
  command palette: a progress notification stays visible while the task runs,
  the outcome (success or failure) is reported, and the final **TaskResult**
  opens as a read-only XML preview.

### BeanShell language assistance
- **Completion, hover and signature help** inside the `<Source>` sections of
  Rules and workflow `<Script>`s — in objects opened from an environment
  (`iiq://`) *and* in local XML files (SSB projects).
- **Member completion** after `variable.` with lightweight type inference:
  declared types, `new` constructions, casts, call chains
  (`context.getObjectByName(...).`), inherited members included.
- **Predefined rule variables**: `context` and `log` everywhere, plus the
  arguments of the rule type (`identity`, `application`, `account`...). The
  `<Signature>` of the rule wins when present; workflow scripts get
  `workflow`, `wfcontext`...
- **Import completion** (`import sailpoint.`) walking the package tree, and
  **class-name completion** with automatic insertion of the missing `import`.
- Java metadata is read **locally** from the jars configured in
  `iiq.beanshell.classpath` (point it at the `WEB-INF/lib` folder of an
  IdentityIQ installation — exact for your version, patches, connectors and
  custom jars). Core JDK classes (`java.lang`, `java.util`...) are bundled.
- No BeanShell code is sent anywhere; jars are indexed lazily and read
  entry-by-entry (no memory blow-up on a full `WEB-INF/lib`).

### Tail server logs
- **Tail server logs...** from an environment's context menu or the command
  palette: the server log files (the targets of its file-backed Log4j2
  appenders — `sailpoint.log`, etc.) stream into a colorized output channel,
  `tail -f` style, no SSH needed. A single log file is tailed directly;
  the first chunk shows the recent history. A status bar indicator shows
  the active tails; **Stop tailing server logs...** ends them.

## Requirements

- Visual Studio Code `>= 1.125`.
- An IdentityIQ instance with the **iiq-devtools companion plugin** installed
  (see [docs/plugin-api.md](docs/plugin-api.md) for the REST API the plugin
  must expose).
- An IIQ account allowed to use the plugin endpoints.

## Getting started

1. Open the **IdentityIQ** view in the activity bar.
2. Click **+** and enter the display name, base URL
   (e.g. `http://localhost:8080/identityiq`), login and password.
3. The connection is tested automatically; the first environment becomes active.
4. Expand the environment and start browsing — or use `IIQ: Open object...`
   from the command palette.

## Extension settings

| Setting | Default | Description |
|---|---|---|
| `iiq.pagination.pageSize` | `200` | Number of objects per page in lists |
| `iiq.objectList.sort` | `name` | Default sort order (`name` or `lastModified`) |
| `iiq.connection.rejectUnauthorized` | `true` | Verify SSL certificates |
| `iiq.export.removeIds` | `true` | Remove internal ids on export |
| `iiq.export.removeCreatedTimestamp` | `true` | Remove `created` timestamps on export |
| `iiq.export.removeModifiedTimestamp` | `true` | Remove `modified` timestamps on export |
| `iiq.export.removeReferenceIds` | `true` | Remove ids on `<Reference>` elements on export |
| `iiq.export.removeSignificantModified` | `true` | Remove `significantModified` on export |
| `iiq.export.cleanForSourceControl` | `true` | Remove volatile attributes, normalize whitespace |
| `iiq.beanshell.enabled` | `true` | BeanShell completion/hover/signature help in `<Source>` sections |
| `iiq.beanshell.classpath` | `[]` | Jars or folders (typically `WEB-INF/lib`) providing Java metadata |
| `iiq.beanshell.maxCompletionItems` | `500` | Cap on class-name completion items |

## Commands

All commands are available under the **IIQ:** prefix in the command palette;
most are also reachable from context menus in the view, the editor and the
file explorer. See [docs/use-cases.md](docs/use-cases.md) for the full list
and detailed flows.

## Documentation

- [Use cases & design reference](docs/use-cases.md)
- [Companion plugin REST API specification](docs/plugin-api.md)
- [Testing strategy](docs/testing.md)

## Related projects

- [vscode-sailpoint-identitynow](https://github.com/yannick-beot-sp/vscode-sailpoint-identitynow) — same experience for Identity Security Cloud.
- [sailpoint-iiq-dev-accelerator](https://github.com/lispercat/sailpoint-iiq-dev-accelerator) and
  [sailpoint-IIQ-studio](https://github.com/h2creations/sailpoint-IIQ-studio) — other IIQ extensions with a different architecture.

## Contributing

Issues and pull requests are welcome. To run the extension locally:

```bash
npm install
npm run watch   # then press F5 in VS Code
npm test        # unit + integration tests (mock plugin server);
                # live tests run automatically if an IdentityIQ instance with
                # the iiq-devtools plugin answers on http://localhost:8080/identityiq
```

## Install IdentityIQ libraries

In order to compile plugins, you will need IdentityIQ libraries.

To install them, execute the following command

_For command prompt (not PowerShell)_:
----

mvn install:install-file -Dfile=%IIQ_PATH%\identityiq.jar -DgroupId=sailpoint -DartifactId=iiq -Dversion=%VERSION% -Dpackaging=jar
mvn install:install-file -Dfile=%IIQ_PATH%\connector-bundle-identityiq.jar -DgroupId=sailpoint -DartifactId=iiq -Dversion=%VERSION% -Dpackaging=jar
----

_For PowerShell_:

----
$IIQ_PATH="C:\..."
$VERSION="8.1"
& mvn install:install-file -Dfile="$IIQ_PATH\identityiq.jar" -DgroupId=sailpoint -DartifactId=iiq -Dversion=$VERSION -Dpackaging=jar
----


## Release Notes

See [CHANGELOG.md](CHANGELOG.md).
