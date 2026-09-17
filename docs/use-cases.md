# Use Cases & Design Reference

This document is the functional and technical reference of the extension. It
captures every use case and the design decisions, and is meant to drive future
development (including code generation).

Vocabulary: an **environment** (also called *instance* or *tenant*) is a
connection to an IdentityIQ server. The command/configuration prefix is `iiq.`.

## 1. Architecture overview

```
src/
├── extension.ts                 # Activation: wires services, view, fs provider, commands
├── constants.ts                 # Commands ids, config keys, URI schemes, API version
├── errors.ts                    # UserCancelledError, GoBackError (wizard)
├── models/
│   ├── TenantInfo.ts            # Environment + credentials models
│   ├── TreeNode.ts              # Folder tree node + type guards
│   └── ObjectTypes.ts           # OBJECT_TYPES registry (data-driven object types)
├── services/
│   ├── TenantService.ts         # Tree of folders/environments (globalState) + Secret Storage + active environment
│   ├── IIQClient.ts             # REST client for the companion plugin (axios, basic auth, SSL config)
│   └── EnvironmentStatusBar.ts  # Status bar item showing the active environment
├── views/
│   ├── IIQTreeItem.ts           # Folder / Tenant / ObjectType / Object / LoadMore tree items
│   └── IIQTreeDataProvider.ts   # Tree data provider + drag & drop controller
├── files/
│   └── IIQResourceProvider.ts   # FileSystemProvider (iiq://) + diff content provider (iiq-remote://)
├── wizard/                      # Multi-step wizard framework (adapted from vscode-azuretools
│   │                            #   via vscode-sailpoint-identitynow) + reusable steps
│   ├── quickPickTenantStep.ts   # Reusable environment picker (active preselected, optional "None")
│   ├── quickPickObjectTypeStep.ts # Reusable object type picker (single/multi)
│   └── quickPickObjectStep.ts   # Reusable object picker (paginated retrieval, single/multi)
├── commands/
│   ├── tenantCommands.ts        # add/remove/rename/test/set-active/select environment
│   ├── folderCommands.ts        # add/rename/remove folder
│   ├── objectCommands.ts        # open/export/save/delete objects
│   ├── configCommands.ts        # open/download/upload the Log4j2 configuration
│   ├── ruleCommands.ts          # run a rule and display its result
│   ├── taskCommands.ts          # run a task, poll its status, preview the TaskResult
│   ├── applicationCommands.ts   # test connection, peek objects (testConnector)
│   └── fileCommands.ts          # import/refresh/compare XML files
└── utils/                       # xmlUtils (CDATA-safe cleaning, schema parsing), UriUtils, config, helpers
```

Key design decisions:

- **Communication**: almost all IIQ access goes through the companion plugin
  REST API (see [plugin-api.md](plugin-api.md)), with a generic CRUD interface
  `{baseUrl}/plugin/rest/iiq-devtools/objects/{ObjectType}/{nameOrId}` and
  object actions as sub-resources (`.../run`, `.../status`). Responses always
  use the JSON envelope `{ "result": ..., "error": ... }` — a plugin REST
  method cannot return raw XML, so object XML travels as a string in `result`
  (`toXml()` server-side). The one exception is UC-34 (peek objects), which
  has no plugin equivalent and calls IdentityIQ's own REST API
  (`{baseUrl}/rest/...`) directly — `IIQClient` exposes a second axios client
  rooted at that base path for it.
- **Data-driven object types**: `OBJECT_TYPES` in `src/models/ObjectTypes.ts`
  is the curated registry for the tree view (label, IIQ class name, icon) —
  adding a new object type = adding one line there. `ALL_OBJECT_TYPES` in the
  same file mirrors the full list supported by the plugin
  (`ClassLists.MajorClasses`, ~130 types, some with a subpackage prefix like
  `accesshistory.*`) and backs the generic "Get object..." command.
- **Virtual file system**: URIs are
  `iiq://<tenantId>/<Display Name>/<ObjectType>/<name>.xml`. The authority is
  the immutable tenant id; the display name is embedded in the path so the
  user always sees which environment a file belongs to (tab tooltip,
  breadcrumb). Saving a virtual document imports the XML back into the
  environment.
- **Security**: passwords are stored exclusively in the VS Code
  **Secret Storage** (key `IIQ_SECRET_<tenantId>`); everything else
  (tree of folders/environments, active environment) is in `globalState`.
- **Reusable pickers**: environment and object type selection are wizard steps
  shared by all commands (open, export, import, compare...), with back-button
  support and step count display.

## 2. Environment management

### UC-01 — Add an environment
1. Command `iiq.tenant.add` (view title `+`, folder context menu, welcome view, palette).
2. Wizard prompts: **display name** (unique, validated live), **base URL**
   (http/https validated), **login**, **password** (masked input).
3. Credentials are written to the Secret Storage.
4. **The full configuration is validated with an API call** (`GET /system/ping`):
   URL reachability, credentials, plugin presence, and **API version vs
   extension version** compatibility.
5. On failure, the user may "Save anyway" (e.g. server temporarily down),
   otherwise credentials are rolled back.
6. The first environment automatically becomes the active one.
7. If launched from a folder's context menu, the environment is created inside
   that folder.

### UC-02 — Remove an environment
1. Command `iiq.tenant.remove` (environment context menu).
2. **Modal confirmation** required.
3. The node is removed from the tree, credentials are deleted from the Secret
   Storage, and the active environment is cleared if it was the removed one.

### UC-03 — Rename an environment
`iiq.tenant.rename` — new name validated for uniqueness. The tenant id does
not change, so URIs and credentials remain valid.

### UC-04 — Test connection
`iiq.tenant.test-connection` (context menu or palette with environment picker).
Calls `GET /system/ping` and reports IIQ version, plugin version, API version
and authenticated identity. SSL verification can be disabled with the
`iiq.connection.rejectUnauthorized` setting (self-signed certificates);
SSL errors are reported with a hint pointing to that setting.

### UC-05 — Select the active environment
Three entry points, one implementation (`iiq.select-environment`):
- right click on an environment in the view (`iiq.tenant.set-active`),
- command palette: list of environments **plus a "None" entry** to deselect,
- **status bar item** (left side) showing the current active environment;
  clicking it opens the picker.
The active environment is preselected as default by every command that needs
an environment (open, export, import, refresh, compare).

### UC-06 — Organize environments in folders
- `iiq.folder.add` / `iiq.folder.rename` / `iiq.folder.remove` (with modal
  confirmation; removing a folder removes contained environments and their
  credentials).
- Folders nest arbitrarily; environments/folders are moved by **drag & drop**.
- Persisted in `globalState` under `IIQ_TREE` as a recursive
  `FolderTreeNode | TenantInfo` array (same model as vscode-sailpoint-identitynow).

## 3. Browsing & editing objects

### UC-10 — Browse objects in the tree view
- View container **IdentityIQ** (activity bar) > view **Environments**.
- Hierarchy: folders > environments > **object types (alphabetical)** > objects.
- Object types displayed: Applications, Bundles, Forms, Identities,
  ObjectConfigs, QuickLinks, Rules, Tasks, Workflows, Workgroups (extensible
  via `OBJECT_TYPES`). Workgroups are Identity objects with
  `workgroup="true"` (virtual type alias in the plugin); they are excluded
  from the Identities list.
- **Pagination**: only `iiq.pagination.pageSize` objects (default **200**) are
  listed; a "Load more... (n/total)" node fetches the next page.
- **Sorting**: default order from the `iiq.objectList.sort` setting (`name` or
  `lastModified`); each object type node has "Sort by name" / "Sort by last
  modification date" context menu entries overriding it per node.
- Clicking an object opens it through the virtual file system.
- Each environment also has a **Log4j2 configuration** leaf (see UC-35).

### UC-11 — Open an object (guided)
Command `iiq.open-object` (palette or environment context menu):
1. environment picker (active preselected, skipped if only one),
2. object type picker,
3. object picker (list retrieved with the configured sort order),
4. the object opens in the editor as `iiq://<id>/<Env>/<Type>/<name>.xml`.

### UC-12 — Edit and save an object (virtual FS)
- Reading a `iiq://` document performs `GET /objects/{type}/{name}`.
- Saving performs `POST /import` with the document body; errors are surfaced
  as file system errors so the editor keeps the dirty state.
- `iiq.refresh-file` on a virtual document reverts it (re-fetches from IIQ).

### UC-13 — Export an object from the view / delete an object
- `iiq.object.save` (**Export object...**, object context menu): tenant and
  object are taken from the leaf; save dialog, XML fetched and **cleaned**
  (see UC-21 — ids removed by default), file written and opened.
- `iiq.object.delete` (object context menu): modal confirmation then
  `DELETE /objects/{type}/{name}`; the view is refreshed.
- `iiq.object.copy-name` (**Copy name**, object context menu): writes the name
  of the selected object to the clipboard, one name per line when several
  objects are selected. No server call.
- `iiq.object.open-in-ui` (**Open in IdentityIQ...**, object context menu):
  opens the object in the IdentityIQ desktop UI (`vscode.env.openExternal`).
  Only types with a stable deep-link are offered (Application, Bundle,
  Identity, TaskDefinition, Workgroup, Workflow). Forms, Rules, ObjectConfigs
  and QuickLinks have no id-addressable page.

### UC-14 — Get any object (generic)
Command `iiq.get-object` (palette or environment context menu): same flow as
UC-11 (environment > type > object > editor), but the type picker offers
**every object type supported by the plugin** (`ALL_OBJECT_TYPES`, mirror of
`ClassLists.MajorClasses` — Configuration, Custom, WorkflowCase,
TaskResult...), not only the curated tree types. The virtual file system is
type-agnostic, so any of these objects can be opened, edited and saved.

## 4. Export / import

### UC-20 — Export objects
Command `iiq.export-objects` (palette, environment context menu, or an object
type node's context menu in the tree view):
1. environment picker (active preselected; skipped when invoked from the tree
   view, which preselects its environment),
2. object type picker (**multi-select**, offers **every object type supported
   by the plugin** — `ALL_OBJECT_TYPES`, same list as UC-14 — not only the
   curated tree types; skipped when invoked from an object type node, which
   preselects that single type),
3. for each selected type, an object picker (**multi-select**),
4. if several objects are selected: choice between **one file per object**
   (then folder picker, default `iiq.export.multipleFiles.folder`; files are
   written under that folder using `iiq.export.multipleFiles.filename`,
   default `<ObjectType>/<name>.xml`) and **a single file** (then save dialog
   using `iiq.export.singleFile.filename`; objects are wrapped in one
   `<sailpoint>` document). A single selected object skips this choice and
   uses `iiq.export.singleResource.filename`.
5. a single-file export is opened in the editor afterwards.

### UC-21 — XML cleaning on export
Applied to every exported XML, each rule individually configurable:

| Setting | Effect |
|---|---|
| `iiq.export.removeIds` | remove internal ids (`id="<32-hex>"`) |
| `iiq.export.removeCreatedTimestamp` | remove `created="..."` |
| `iiq.export.removeModifiedTimestamp` | remove `modified="..."` |
| `iiq.export.removeReferenceIds` | remove `id` on `<Reference>` elements |
| `iiq.export.removeSignificantModified` | remove `significantModified="..."` |
| `iiq.export.cleanForSourceControl` | remove volatile attributes (`lastRefresh`...), normalize EOL/trailing whitespace |

**CDATA sections are always preserved byte-for-byte** (they contain BeanShell
code): they are tokenized out before any transformation and restored verbatim
(`src/utils/xmlUtils.ts`). The sailpoint-iiq-dev-accelerator extension uses an
XSLT stylesheet for the same purpose; a text-based implementation was chosen
to guarantee formatting and CDATA stability.

### UC-22 — Import files
Three commands share the same import pipeline (`POST /import`):
- `iiq.import-file` — active editor (editor context menu / palette /
  **Ctrl+Alt+S**); always shows an environment picker.
- `iiq.import-file-explorer` — **file explorer** (single file, multi-selection
  of files and/or **folders — imported recursively**, XML files only); shows
  an environment picker.
- `iiq.import-file-view` — **environment context menu** in the tree view: opens
  a file picker for one or several XML files; the target environment is the
  selected node (no environment picker).
- each file is sent to `POST /import` (single object or `<sailpoint>` bundle).
- final report: **information message with the number of files imported
  successfully and in error**; details are available in a text document.

### UC-23 — Refresh a local XML file
Command `iiq.refresh-file` (editor context menu):
- the object type and name are parsed from the XML itself (root element or
  first child of `<sailpoint>`),
- the object is fetched from the active environment (or an environment picker
  is shown), cleaned per UC-21, and the **editor content is replaced**
  (unsaved, so the user can review/undo).

### UC-24 — Compare with an environment
Command `iiq.compare-file` (editor context menu):
- the object type/name are parsed from the XML,
- a **diff view** opens: remote version (read-only, via the
  `iiq-remote://` content provider) on the left, local file on the right.

### UC-25 — Export objects in bulk
Command `iiq.export-objects-bulk` (**IIQ: Export objects in bulk**, palette or
environment context menu) exports matching objects without an object picker.
The operation is cancellable, writes one local XML file per object, and reports
counts by class.

All command-specific settings use the `iiq.export.bulkExport.*` prefix:

| Setting | Effect |
|---|---|
| `filename` | Full output pattern; default `%x/%o/%S.xml`; also supports `%k` for the object `type` |
| `classNames` | CSV of classes; `default`, blank for non-runtime major classes, or `Class:property:value` |
| `regexFilter` | Full regular-expression match on object names |
| `fromDate` | Include objects created or modified on/after an ISO-8601 date |
| `bundleFilter`, `bundleTypeFilter` | Restrict Bundles by parent role and type |
| `addCData` | Wrap eligible source sections in CDATA |
| `stripMetadata`, `stripTDEmailMetadata` | Remove environment/task email metadata |
| `stripProfiles`, `stripRoleMetadata` | Remove Bundle profiles/index/scorecard data |
| `customIgnore` | CSV of Application/TaskDefinition/TaskSchedule entry keys to remove |
| `sortObjectConfigIdentity` | Sort `ObjectAttribute` elements in ObjectConfig Identity |
| `targetPropsFile`, `simplePropsFile` | XPath and literal reverse-tokenization property files |
| `mergeCompareDirPath` | Baseline directory for Configuration/UIConfig/ObjectConfig/AuditConfig/Dictionary SSB merges |
| `ignoreDirPath` | Directory containing objects to skip |
| `modelDirPath` | Directory whose object paths and filenames are mirrored; enables `pull` |
| `resolveIdsToNames` | Resolve remaining 32-character IIQ ids through the companion plugin |

Paths may be absolute or workspace-relative. Bulk exports also apply the common
UC-21 settings (`iiq.export.removeIds`, timestamps, reference ids and source
control cleanup). The Object Exporter `$Class$`, `$Name$`, and `$type$` concepts
map to `%o`, `%S`, and `%k`; `$Default$`/IIQDA camel-case naming is deliberately
not used.

## 5. Rule & task execution

### UC-30 — Run a rule
Command `iiq.run-rule`:
- entry points: **rule context menu** in the tree view (inline play button and
  context menu, only on Rule objects — the object type is part of the context
  value: `iiqObject-Rule`), **editor context menu** on a Rule XML file (the
  rule name is parsed from the XML; the rule must exist on the environment),
  and **command palette** (environment picker then rule picker; if the active
  editor is an XML file, it is used directly).
- optional **rule arguments** prompted as a JSON object (validated live).
- the rule is executed server-side (`POST /objects/Rule/{name}/run`) and the
  result (with the execution time) is appended to the **IdentityIQ output
  channel**.
- BeanShell errors are surfaced with the server message.

### UC-31 — Run a task
Command `iiq.run-task`:
- entry points: **task context menu** in the tree view (inline play button and
  context menu, only on TaskDefinition objects — context value
  `iiqObject-TaskDefinition`), and **command palette** (environment picker
  then task picker).
- the task is launched **asynchronously**
  (`POST /objects/TaskDefinition/{name}/run` returns the `TaskResult` id).
- a **progress notification** stays visible while the task runs; the status is
  polled every 2 s (`GET /objects/TaskResult/{id}/status`). Cancelling the
  notification stops the polling only — the task keeps running server-side.
- on completion, a message reports the outcome (information for `Success`,
  warning for `Warning`, error otherwise, with the task messages), and the
  final **TaskResult is opened as a read-only XML preview** (through the
  `iiq-remote://` content provider — a TaskResult is a regular object fetched
  with the generic `GET`).

### UC-32 — Tail server logs
Commands `iiq.tail-logs` / `iiq.stop-tail-logs`:
- entry points: **environment context menu** in the tree view, and **command
  palette** (environment picker).
- the tailable files are the **targets of the file-backed Log4j2 appenders**
  of the server (`GET /logs`); when there is exactly **one**, it is tailed
  directly, otherwise a picker shows name, path, size and last modification.
- the extension **polls a byte-offset cursor** (`GET /logs/{key}/tail`, every
  `iiq.logs.pollIntervalMs`, 2 s by default), appending whole lines to a
  per-environment-and-file **output channel** (`IIQ Logs — <environment> —
  <file>`, colorized by the `log` language). The first chunk is the
  **trailing 16 KB window** of the file, so recent history (the exception
  that just happened) is visible immediately.
- resilience: a capped chunk (64 KB max) is caught up immediately; a
  rotation/truncation is flagged (`--- log file rotated or truncated... ---`)
  and the tail resumes from the new tail; transient network errors are
  retried (single warning, stop after 5 consecutive failures); 401/403, or
  the appender disappearing from the Log4j2 configuration (404), stops the
  tail.
- one tail per environment+file (re-running the command reveals the
  channel); a **status bar item** (`$(pulse) IIQ logs: n`) shows the active
  tails and runs the stop command. Stopping keeps the channel content
  readable; nothing is left server-side (the tail is stateless).

## 6. Applications

### UC-33 — Test an application connection
Command `iiq.application.test-connection` (application context menu — inline
`$(plug)` icon — or palette with environment/application pickers):
- calls the connector's `testConfiguration()` server-side
  (`POST /objects/Application/{name}/test-connection`, companion plugin) and
  reports the outcome as an information/error message.

### UC-34 — Peek objects of an application
Command `iiq.application.peek-objects` (application context menu — inline
`$(eye)` icon — or palette with environment/application pickers):
1. the Application XML is fetched (`GET /objects/Application/{name}`,
   companion plugin) and its `<Schemas><Schema objectType="...">` are parsed
   (`extractApplicationSchemas` in `src/utils/xmlUtils.ts`) to list the object
   types it defines (e.g. `account`, `group`); a picker is shown when there is
   more than one, otherwise the single schema is used directly.
2. a live preview is fetched from **IdentityIQ's own REST API** (not the
   companion plugin — this reuses the endpoint backing the "Test Connector"
   grid of the Application configuration UI):
   `GET {baseUrl}/rest/applications/{name}/testConnector/{objectType}`
   (`IIQClient.testConnectorObjects`, via a dedicated axios client rooted at
   `{baseUrl}/rest` instead of the plugin's `{baseUrl}/plugin/rest/iiq-devtools`).
3. the `objects` array of the response is opened as a read-only preview JSON
   document (untitled, `showTextDocument(..., { preview: true })`).

### UC-35 — Edit the Log4j2 configuration
- Tree: a **Log4j2 configuration** leaf under each environment runs
  `iiq.log4j.open`, which resolves the real file name with
  `HEAD /system/log4j` and opens
  `iiq://<id>/<Env>/config/<file name>` through the virtual file system
  (read-only when the environment is). The name is resolved rather than
  assumed because Log4j2 also supports XML, YAML and JSON configurations.
- Reading performs `GET /system/log4j`; `stat` uses `HEAD /system/log4j`.
- **Saving** the virtual document performs `PUT /system/log4j`: the plugin
  writes the file and reconfigures the live logger context, so the new
  levels apply immediately. A configuration Log4j2 refuses is rolled back
  server-side and the save fails.
- **Download the Log4j2 configuration...** (`iiq.log4j.download`): save the
  current server file locally (changes nothing on the server).
- **Upload a Log4j2 configuration...** (`iiq.log4j.upload`): pick a local
  file, `PUT` it, reconfigure on the server. Also available from the
  explorer on a `log4j*.…` file. Blocked on read-only environments.
- Unlike **Configure logging...** (UC-33), which changes a level in memory
  only, edits here are persisted and survive a restart.

## 7. Configuration summary

| Setting | Default | Description |
|---|---|---|
| `iiq.pagination.pageSize` | `200` | Page size for object lists |
| `iiq.objectList.sort` | `name` | Default sort (`name` / `lastModified`) |
| `iiq.connection.rejectUnauthorized` | `true` | SSL certificate verification |
| `iiq.logs.pollIntervalMs` | `2000` | Poll interval while tailing server logs |
| `iiq.export.singleResource.filename` | `%x/%S.xml` | Proposed path for a single-object export |
| `iiq.export.singleFile.filename` | `%x/export.xml` | Proposed path for a multi-object single file |
| `iiq.export.multipleFiles.folder` | `%x` | Proposed folder for one-file-per-object export |
| `iiq.export.multipleFiles.filename` | `%o/%S.xml` | Relative filename under the chosen folder |
| `iiq.export.withDependencies.filename` | `%x/%S-with-deps.xml` | Proposed path for export with dependencies |
| `iiq.export.*` | `true` | XML cleaning rules (see UC-21) |

## 8. Command summary

| Command | Id | Entry points |
|---|---|---|
| Add environment | `iiq.tenant.add` | view title, folder menu, welcome, palette |
| Remove environment | `iiq.tenant.remove` | environment menu |
| Rename environment | `iiq.tenant.rename` | environment menu |
| Test connection | `iiq.tenant.test-connection` | environment menu, palette |
| Set active environment | `iiq.tenant.set-active` | environment menu |
| Select environment | `iiq.select-environment` | palette, status bar, environment menu |
| New/rename/remove folder | `iiq.folder.*` | view title, folder menu |
| Open object | `iiq.open-object` | palette, environment menu |
| Get object (any type) | `iiq.get-object` | palette, environment menu |
| Export objects | `iiq.export-objects` | palette, environment menu, object type menu (view) |
| Export objects in bulk | `iiq.export-objects-bulk` | palette, environment menu |
| Import file(s) | `iiq.import-file` / `iiq.import-file-explorer` / `iiq.import-file-view` | palette, editor menu, **Ctrl+Alt+S**, explorer menu, environment menu (view) |
| Refresh file from IIQ | `iiq.refresh-file` | editor menu, palette |
| Compare with IIQ | `iiq.compare-file` | editor menu, palette |
| Run rule | `iiq.run-rule` | rule menu (view), editor menu, palette |
| Run task | `iiq.run-task` | task menu (view), palette |
| Tail server logs | `iiq.tail-logs` | environment menu, palette |
| Stop tailing server logs | `iiq.stop-tail-logs` | palette, status bar |
| Open the Log4j2 configuration | `iiq.log4j.open` | Log4j2 leaf, environment menu, palette |
| Download the Log4j2 configuration | `iiq.log4j.download` | environment menu, Log4j2 leaf, palette |
| Upload a Log4j2 configuration | `iiq.log4j.upload` | environment menu (writable), Log4j2 leaf, explorer, palette |
| Export object | `iiq.object.save` | object menu |
| Copy name | `iiq.object.copy-name` | object menu |
| Open in IdentityIQ | `iiq.object.open-in-ui` | object menu (types with a desktop page) |
| Delete object | `iiq.object.delete` | object menu |
| Refresh / Load more / Sort by... | `iiq.refresh`, `iiq.load-more`, `iiq.sort-by-*` | view |
| Test an application connection | `iiq.application.test-connection` | application menu (view), palette |
| Peek objects of an application | `iiq.application.peek-objects` | application menu (view), palette |

## 9. Roadmap / future work

- **BeanShell language server**: completion/diagnostics for Rules, backed by
  the `POST /objects/Rule/{name}/run` sandbox endpoint.
- Workflow launching (`POST /objects/Workflow/{name}/launch`, reserved in the
  plugin API) and execution history.
- Dynamic object type discovery via `GET /system/classes`.
- Read-only environments (flag on `TenantInfo`, enforced in the fs provider).
- Snippets for common IIQ XML objects.
