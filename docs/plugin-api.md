# IdentityIQ DevTools Plugin — REST API Specification

The extension communicates with IdentityIQ through a **companion plugin**
(`iiq-devtools`) that exposes REST web services. This document is the contract
between the extension and the plugin: it lists **all the endpoints that must be
implemented** in the plugin, so that plugin development can start (or be
code-generated) independently from the extension.

References:
- [IIQ Plugin Developer Guide — Java classes & REST resources](https://developer.sailpoint.com/docs/iiq/plugin-developer-guide/java-classes-rest-resources)

## General principles

- **Base path**: `{baseUrl}/plugin/rest/iiq-devtools`
  where `{baseUrl}` is the IdentityIQ base URL (e.g. `http://localhost:8080/identityiq`).
  Plugin REST resources are declared with `@Path("iiq-devtools")` on a class
  extending `BasePluginResource`.
- **Authentication**: HTTP Basic. The extension sends the login/password stored
  in the VS Code Secret Storage. The plugin endpoints must be protected with
  `@RequiredRight` or capability checks (recommended right: `iiqDevToolsAccess`,
  granted by default to System Administrators).
- **Generic interface**: object access is exposed through a generic CRUD
  interface `{baseUrl}/plugin/rest/iiq-devtools/objects/{ObjectType}/{ObjectNameOrId}`
  where `{ObjectType}` is a class name **relative to the `sailpoint.object`
  package** (e.g. `Rule`, `TaskDefinition`, `accesshistory.HistoricalIdentity`).
  The supported set is **`sailpoint.object.ClassLists.MajorClasses`**, plus
  the virtual alias **`Workgroup`** (`Identity` with `workgroup=true`): the
  plugin indexes those classes by relative name and rejects (`404`) any other
  type. The extension embeds a mirror of this list (`ALL_OBJECT_TYPES` in
  `src/models/ObjectTypes.ts`) for the generic "Get object..." command.
  **Object actions** (execution, status...) are sub-resources of the same
  hierarchy: `/objects/{ObjectType}/{ObjectNameOrId}/{action}`, e.g.
  `/objects/Rule/{nameOrId}/run`, `/objects/TaskDefinition/{nameOrId}/run`,
  `/objects/TaskResult/{nameOrId}/status`.

### Response envelope

A plugin REST method **cannot simply return raw XML**: the plugin framework
serializes endpoint return values to JSON. XML representations therefore
always travel **as a string inside the JSON envelope** — server side, the
object is serialized with `toXml()` and the resulting string is placed in the
`result` field.

For maximum consistency, **every JSON response uses the same envelope**:

- **Success** (`2xx`):
  ```json
  { "result": ... }
  ```
  `result` holds the payload: a string (e.g. an object XML produced by
  `toXml()`), an array of values (e.g. an object list), or a JSON object.
  Endpoint-specific metadata (e.g. `count`, `executionTimeMs`, `errors`) sits
  next to `result` and is documented per endpoint.
- **Failure** (`4xx`/`5xx`): the `error` property gives the message:
  ```json
  { "error": "TaskDefinition 'Nightly Refresh' not found" }
  ```
  Standard status codes: `400` invalid request or execution failure,
  `401` bad credentials, `403` missing right, `404` unknown object/type,
  `409` conflict (e.g. duplicate name), `500` internal error.

Requests that carry XML (`PUT`/`POST` object, `POST /import`) send it inside a
**JSON envelope** (`Content-Type: application/json`):

```json
{ "xml": "<?xml version='1.0' encoding='UTF-8'?>..." }
```

Raw `application/xml` bodies cannot be used: the IdentityIQ plugin REST filter
chain never delivers non-JSON request bodies to the resource (a plain `String`
entity parameter arrives `null`, observed on 8.5p1 — the import then "succeeds"
while importing nothing). A missing or empty `xml` property is rejected with
`400`. `HEAD` metadata travels in standard HTTP headers (no body, so no
envelope).

### Logging

**Every endpoint method must be logged with Log4j2**
(`private static final Logger LOG = LogManager.getLogger(DevToolsResource.class);`):

- `DEBUG` on entry with the method name and parameters (never log credentials,
  and log payload sizes rather than full XML bodies),
- `INFO` for every mutation or execution (import, create/update/delete,
  rule run, task launch) with the object type and name,
- `ERROR` with the exception for every failure returned as `4xx`/`5xx`.

- **API versioning**: the plugin advertises an integer `apiVersion` in the ping
  response. The extension checks it against the version it expects
  (`EXPECTED_API_VERSION` in `src/constants.ts`, currently `1`) and warns the
  user on mismatch. Increment `apiVersion` on any breaking change of this contract.

- **Plugin versioning**: `pluginVersion` in the ping response is purely
  informational (never compared by the extension). It is the `<Plugin
  version="...">` attribute of `manifest.xml`, itself filled from
  `${project.version}` (`vscode-plugin/pom.xml`) when Maven builds the zip.
  Bump `pom.xml`'s `<version>` by hand before packaging a release of the
  plugin, following semver: patch for internal fixes with no visible change,
  minor for backward-compatible additions, major together with an
  `apiVersion` bump when the REST contract breaks.

## Endpoints

### 1. System

#### `GET /system/ping`

Connection test and version negotiation. Used by the "Test connection" command
and after adding an environment.

Response `200`:
```json
{
  "result": {
    "version": "8.4p2",
    "pluginVersion": "1.1.0",
    "apiVersion": 1,
    "identity": "spadmin"
  }
}
```

| Field | Description |
|---|---|
| `version` | IdentityIQ version (`Version.getVersion()` + patch) |
| `pluginVersion` | Version of the installed iiq-devtools plugin |
| `apiVersion` | Integer version of this REST contract |
| `identity` | Name of the authenticated identity |

#### `GET /system/classes`

Returns the list of object types supported by the generic interface — the
classes of `ClassLists.MajorClasses`, named relative to `sailpoint.object`,
plus the virtual `Workgroup` alias — so the extension can discover new types
dynamically (its embedded `ALL_OBJECT_TYPES` list is a static mirror).

Response `200`:
```json
{ "result": ["AccountGroup", "ActivityDataSource", "...", "Rule", "TaskDefinition", "TaskResult", "Workflow", "Workgroup", "accesshistory.HistoricalIdentity", "..."] }
```

#### `GET /system/log4j`

Contents of the file backing the **live Log4j2 configuration**, usually
`WEB-INF/classes/log4j2.properties`. Used by the virtual file system to open
the logging configuration like an object XML.

The file is resolved from the live `ConfigurationSource`, so a relocated file
or an XML/YAML/JSON configuration is honored; when the configuration source
is not file-backed, the conventional names are tried under
`WEB-INF/classes` (`log4j2.properties`, `log4j2.xml`, `log4j2.yaml`,
`log4j2.yml`, `log4j2.json`, `log4j.properties`). A path is never accepted
as input.

Response `200`:
```json
{
  "result": "rootLogger.level = warn\\n",
  "fileName": "log4j2.properties",
  "path": "/opt/tomcat/webapps/identityiq/WEB-INF/classes/log4j2.properties"
}
```

`result` is the file content as a string (UTF-8; ISO-8859-1 is accepted on
read when the file is not valid UTF-8). `fileName` lets the extension name
the editor tab after the real file. Response `404` if no file backs the
configuration.

#### `HEAD /system/log4j`

Lightweight metadata for the virtual file system's `stat()`: `Content-Length`,
`Last-Modified`, `ETag` (SHA-256 of the bytes) and `X-IIQ-File-Name` (the
real file name, needed before the body is fetched). `404` if the file is
missing.

#### `PUT /system/log4j`

Writes the file and **reconfigures the live logger context** from it
(`LoggerContext.setConfigLocation`), so new levels and appenders apply
immediately.

If Log4j2 refuses the configuration — detected by the context falling back
to its default console-only configuration — the previous content is
restored, reapplied, and the request fails with `400`: a bad edit can never
leave the server without logging.

Request body: JSON envelope `{ "content": "<file contents>" }`. An empty
`content` is rejected with `400`.

Response `200`:
```json
{
  "result": {
    "path": "/opt/tomcat/webapps/identityiq/WEB-INF/classes/log4j2.properties",
    "fileName": "log4j2.properties",
    "size": 1234,
    "reloaded": true
  }
}
```

Every write is audited (`iiq-devtools:updateLog4jConfig`).

### 2. Generic object CRUD

#### `GET /objects/{ObjectType}`

Paginated, sorted list of objects. Used by the tree view, the "Open object..."
and "Export objects..." wizards.

Query parameters:

| Parameter | Default | Description |
|---|---|---|
| `start` | `0` | Index of the first result (`QueryOptions.setFirstRow`) |
| `limit` | `200` | Page size (`QueryOptions.setResultLimit`) |
| `sortBy` | `name` | `name` or `modified` |
| `sortDir` | `asc` | `asc` or `desc` |
| `query` | — | Optional case-insensitive filter on the name (`Filter.ignoreCase(Filter.like("name", query))`) |
| `excludeTypes` | — | Optional CSV of `type` values to exclude, e.g. `Report,LiveReport` to keep reports out of a `TaskDefinition` list. `400` when the class has no `type` property or a value does not match its enum |
| `includeTemplates` | `false` | Include TaskDefinition templates; used by bulk export |

Implementation note: use a projection search
(`context.search(clazz, queryOptions, Arrays.asList("id", "name", "created", "modified"))`)
— never load full objects for listing. `count` is obtained with `context.countObjects`,
with the same filters as the search. `excludeTypes` values are converted to the
enum of the `type` property when there is one (`TaskDefinition`, `Rule`...), and
objects with a **null** type are kept (a bare `NOT (type IN ...)` would drop them).

For `TaskDefinition`, `template = false` is applied unless
`includeTemplates=true`. Interactive task lists keep templates hidden; bulk
export requests them so its result matches Object Exporter.

`Workgroup` is a **virtual type alias** for `Identity`: it resolves to the
`Identity` class, and listing applies an unconditional `workgroup = true`
filter. Conversely, listing `Identity` always applies `workgroup = false`, so
regular identities and workgroups never overlap. CRUD on `/objects/Workgroup/...`
operates on the underlying `Identity` (XML root remains `<Identity workgroup="true" …>`).

Response `200` — `result` is the array of object summaries, `count` is the
total regardless of pagination:
```json
{
  "count": 1234,
  "result": [
    { "id": "0a00000181...", "name": "Active Directory", "created": "2024-01-15T10:12:00Z", "modified": "2024-06-01T08:00:00Z" }
  ]
}
```

#### `GET /objects/{ObjectType}/{nameOrId}`

Returns the XML representation of a single object (resolve by id first, then by
name — `context.getObjectById` then `context.getObjectByName`). The XML is
produced with `toXml()` and returned **as a string in the envelope**; it is the
standard IIQ export format, **including the header**
(`<?xml version=...?><!DOCTYPE ... "sailpoint.dtd">`), with CDATA sections
preserved.

Response `200`:
```json
{ "result": "<?xml version='1.0' encoding='UTF-8'?>\n<!DOCTYPE Rule PUBLIC \"sailpoint.dtd\" \"sailpoint.dtd\">\n<Rule name=\"My Rule\" ...>...</Rule>" }
```

Response `404`: unknown object.

#### `POST /objects/{ObjectType}/{nameOrId}/merge-xml`

Builds the additive SSB XML used by bulk export. The request body is
`{ "baselineXml": "..." }`; the live IIQ object is compared to that baseline.
Supported classes are `Configuration`, `UIConfig`, `ObjectConfig`,
`AuditConfig`, and `Dictionary`. The response `result` is a `<sailpoint>`
document containing `<ImportAction name="merge">` and only added or changed
values. This endpoint does not mutate IIQ.

#### `GET /system/object-name/{id}`

Resolves a 32-character internal id across `ClassLists.MajorClasses`. Response
`200` is `{ "result": "Object name" }`; response `404` means the id is unknown.
Bulk export uses this only when `iiq.export.bulkExport.resolveIdsToNames` is
enabled.

#### `HEAD /objects/{ObjectType}/{nameOrId}`

Lightweight existence and change-detection check: same resolution rules as the
`GET`, but **no response body**. The metadata travels in standard HTTP headers:

| Header | Content |
|---|---|
| `Content-Length` | Size in bytes of the XML representation |
| `Last-Modified` | Last modification date of the object (HTTP date; from the `modified` column, falling back to `created`) |
| `ETag` | Hash of the XML representation (e.g. SHA-256), quoted |

- Response `200` with the headers above, empty body.
- Response `404`: unknown object.

Rationale: the extension's virtual file system must answer `stat()` calls,
which VS Code issues frequently (editor focus, before every save, dirty-state
checks). Serving them with `HEAD` avoids serializing and transferring the full
XML each time, and the `Last-Modified` value lets VS Code detect that an
object changed on the server.

Implementation note: computing `Content-Length`/`ETag` requires serializing
the object server-side, but the payload is not transferred; if even that is
too costly, `Content-Length` may be approximated (VS Code only uses it as a
hint) — `Last-Modified` is the load-bearing field and comes from a projection
query (`id`, `modified`, `created`), without loading the object.

*Future (reserved)*: support `If-None-Match` on the `GET` endpoint and answer
`304 Not Modified` when the ETag matches, so the extension can cache object
bodies as well.

#### `POST /objects/{ObjectType}`

Creates an object from its XML representation (JSON envelope,
`{ "xml": "..." }`). Returns `201` with `{ "result": "<created object XML>" }`,
or `409` if an object with the same name already exists.

#### `PUT /objects/{ObjectType}/{nameOrId}`

Creates or updates an object from its XML representation (JSON envelope,
`{ "xml": "..." }`). Semantically an "import" of a single object: internal ids
present in the XML are ignored, references are resolved by name.
Returns `200` with `{ "result": "<saved object XML>" }`.

#### `DELETE /objects/{ObjectType}/{nameOrId}`

Deletes an object (use `Terminator` to clean up references).
Returns `204` (no body), or `404` if the object does not exist.

### 3. Import

#### `POST /import`

Imports an arbitrary XML document, exactly like *System Setup > Import from
File* / `iiq console import`:
- accepts a single object or a `<sailpoint>` bundle with multiple objects,
- supports `<!DOCTYPE ...>` and resolves `$(token)` variables if any,
- executes `ImportCommand`/`Importer` so that side effects (e.g.
  `ImportAction`) are honored,
- objects are created or updated; references are resolved by name.

Request body: JSON envelope `{ "xml": "<the XML document>" }`.

Response `200` — `result` is the array of imported object identifiers:
```json
{
  "result": ["Rule:My Rule", "Workflow:My Workflow"],
  "errors": []
}
```

Partial failures return `200` with the `errors` array populated (one message
per failed object); the extension aggregates them per file.

### 4. Rule execution

#### `POST /objects/Rule/{nameOrId}/run`

Runs a rule and returns its result. Used by the "Run rule..." command; also a
key enabler for the future BeanShell language server (evaluation sandbox).

Request body (`application/json`): a JSON object mapping **rule argument names
to values**, passed to the rule execution context (empty object if the rule
takes no argument):
```json
{ "identityName": "spadmin" }
```

Implementation notes:
- resolve the rule by id then by name (same rules as the generic `GET`),
  `404` if unknown;
- run it with `context.runRule(rule, args)`;
- serialize the returned value to JSON. Values that are not JSON-serializable
  must be converted **to a string**: a `SailPointObject` with `toXml()`,
  anything else with `toString()` (a REST method cannot return raw XML — see
  the envelope principles above);
- measure and return the server-side execution time;
- rule execution is a powerful capability: this endpoint must be protected by
  the same right as the others (`iiqDevToolsAccess`) and every execution should
  be audited (`AuditEvent`) and logged at `INFO`.

Response `200` — `result` holds the rule return value (string, array, object
or `null`):
```json
{
  "result": "spadmin@example.com",
  "executionTimeMs": 42
}
```

Rule failures (BeanShell exceptions) return `400` with
`{ "error": "<exception message and BeanShell location>" }` so the developer
can fix the rule.

### 5. Task execution

#### `POST /objects/TaskDefinition/{nameOrId}/run`

Launches a task **asynchronously** and returns the id of the `TaskResult`
tracking the execution. Used by the "Run task..." command.

Request body (`application/json`): a JSON object mapping **task launch
argument names to values**, merged into the task attributes (empty object for
none):
```json
{ "filterString": "identity.inactive == false" }
```

Implementation notes:
- resolve the `TaskDefinition` by id then by name, `404` if unknown;
- launch with `TaskManager` (`new TaskManager(context)`), passing a **unique
  result name** (e.g. `<task name> - <timestamp>` via
  `TaskSchedule.ARG_RESULT_NAME`) so the created `TaskResult` can be resolved
  and its id returned immediately — do **not** wait for completion;
- launch failures (task already running with `resultAction=Cancel`, invalid
  arguments...) return `400` with `{ "error": "..." }`;
- like rule execution, audit (`AuditEvent`) and log at `INFO` every launch.

Response `200` — `result` is the id of the created `TaskResult`:
```json
{ "result": "0a00000181fa3c2b8181fa5e12345678" }
```

#### `GET /objects/TaskResult/{nameOrId}/status`

Lightweight execution status of a task, designed to be **polled** by the
extension (progress notification) while the task runs.

Response `200`:
```json
{
  "result": {
    "id": "0a00000181fa3c2b8181fa5e12345678",
    "name": "Nightly Refresh - 20260705-103000",
    "completed": "2026-07-05T10:32:11Z",
    "completionStatus": "Success",
    "messages": []
  }
}
```

| Field | Description |
|---|---|
| `id` / `name` | Identifiers of the `TaskResult` |
| `completed` | Completion date (ISO-8601), `null` while the task is still running |
| `completionStatus` | `Success`, `Warning`, `Error` or `Terminated`; `null` while running |
| `messages` | Messages accumulated by the task (localized with `Message.getLocalizedMessage()`) |

Implementation note: while the task runs, answer from a **projection query**
(`id`, `name`, `completed`, `completionStatus`) so polling stays cheap; only
load the full object (for `messages`) once `completed` is set.

The final `TaskResult` object itself is retrieved through the generic
interface (`GET /objects/TaskResult/{nameOrId}` — a `TaskResult` is a regular
`SailPointObject`, returned as its `toXml()` string), which the extension uses
to display the result preview.

### 6. Application connection test

#### `POST /objects/Application/{nameOrId}/test-connection`

Tests the connection of an `Application`: instantiates its `Connector` and
calls `testConfiguration()`, the same call made by the "Test Connection"
button of the Application configuration page. Used by the "Test connection"
command on Applications.

Implementation notes:
- resolve the `Application` by id then by name (same rules as the generic
  `GET`), `404` if unknown;
- `Connector connector = ConnectorFactory.getConnector(application, null);`
  then `connector.testConfiguration()`. `ConnectorFactory.getConnector` throws
  `GeneralException`, `testConfiguration()` throws `ConnectorException`
  (**not** a subclass of `GeneralException` — both must be caught);
- connector failures (invalid host, bad credentials, unreachable resource...)
  return `400` with `{ "error": "<exception message>" }`;
- like rule/task execution, audit (`AuditEvent`) and log at `INFO` every test.

Response `200` — `result` is a human-readable success message:
```json
{ "result": "Connection to \"Active Directory\" succeeded." }
```

Response `400` on connector failure:
```json
{ "error": "Could not connect to host ldap.example.com:389" }
```

### 7. Server log files

Tails the server's log files into VS Code ("Tail server logs..." command),
`tail -f` style: the extension polls a **byte-offset cursor** on a
configurable interval.

**Security invariant**: the only readable files are the **targets of the
file-backed appenders of the live Log4j2 configuration**, and they are
referenced by **appender name** — a path is never accepted as input. The
appender (and its path) is re-resolved from the live configuration on every
call, so log rolling and reconfigurations are always honored.

Implementation notes:

- Log4j2 has **no common interface** for file-backed appenders:
  `FileAppender`, `RollingFileAppender`, `RandomAccessFileAppender`,
  `RollingRandomAccessFileAppender` and `MemoryMappedFileAppender` each
  declare their own public `getFileName()` (returning the *currently active*
  file for the rolling ones). The plugin relies on that convention by
  reflection, which covers them all — including custom appenders that follow
  it — without enumerating classes.
- **Whole lines only**: chunks are cut at the last newline (on the bytes, so
  multi-byte characters are never split); the trailing partial line waits
  server-side for the next call. A fresh window also skips its partial first
  line. Decoding uses the appender layout's charset (UTF-8 fallback), with
  lenient replacement of stray bytes.
- **Rotation/truncation** is detected by a shrunken file (`offset >
  fileSize`): the cursor resets to the trailing window and `rotated` is set.
  Known limitation: a rotation where the new file is already *larger* than
  the old offset is undetectable by size comparison — the tail silently
  continues at that offset.
- Constants: first call returns at most the trailing **16 KB**
  (`LOG_INITIAL_WINDOW_BYTES`); one call reads at most **64 KB**
  (`LOG_MAX_CHUNK_BYTES`). When `nextOffset < fileSize` after a non-empty
  chunk, the client should poll again immediately to catch up.

#### `GET /logs`

Lists the tailable log files. The extension tails the file directly when
there is exactly one, and shows a picker otherwise.

Response `200`:
```json
{
  "result": [
    {
      "key": "file",
      "fileName": "sailpoint.log",
      "path": "/opt/tomcat/logs/sailpoint.log",
      "size": 123456,
      "lastModified": "2026-07-05T10:32:11Z",
      "exists": true
    }
  ]
}
```

| Field | Description |
|---|---|
| `key` | Log4j2 appender name — the only identifier accepted by the tail endpoint |
| `fileName` / `path` | For display only; the path is never sent back |
| `size` / `lastModified` / `exists` | Current file state (`size` 0 and `lastModified` null when the file does not exist yet) |

#### `GET /logs/{key}/tail?offset={offset}`

Reads a chunk of the file behind the `{key}` appender.

Query parameters:

| Parameter | Default | Description |
|---|---|---|
| `offset` | — | Byte cursor from the previous response (`nextOffset`). Omitted on the first call: the trailing window of the file is returned |

Response `200`:
```json
{
  "result": {
    "content": "2026-07-05 10:32:11,042 ERROR sailpoint.api.Aggregator - Connection failed\n",
    "nextOffset": 123532,
    "fileSize": 123532,
    "rotated": false
  }
}
```

| Field | Description |
|---|---|
| `content` | Whole lines only; empty when nothing new (or a partial line is pending) |
| `nextOffset` | Cursor to pass as `offset` on the next call |
| `fileSize` | File length observed for this read |
| `rotated` | Truncation/rotation detected; the cursor was reset to the tail |

- Response `404`: unknown appender name, or the appender is not file-backed.
- A file that does not exist yet answers `200` with an empty chunk
  (`nextOffset` 0) — it may appear later, the client keeps polling.
- A read failure (e.g. the file swapped by a rename-rotation mid-read)
  answers `500`; the client treats it as transient and the next poll
  self-heals.

### 8. Logger levels

Changes a logger's level at runtime ("Configure logging..." command), so a
specific package or class can be switched to `DEBUG` while reproducing an
issue, then back to `INFO` — without a server restart. The change is an
**in-memory update to the live Log4j2 configuration**: it is not persisted to
`log4j2.properties` and does not survive a restart.

Valid levels: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`, `OFF`
(case-insensitive).

#### `PUT /logs/levels/{logger}`

Sets the level of `{logger}` (a logger name, e.g.
`sailpoint.connector.LDAPConnector`), creating its `LoggerConfig` if it did
not already have one of its own.

Request body:
```json
{ "level": "DEBUG" }
```

Response `200`:
```json
{ "result": "DEBUG" }
```

Response `400`: the body has no `level` property, or it is not one of the
valid levels.

#### `DELETE /logs/levels/{logger}`

Removes `{logger}`'s explicit level override, so it reverts to inheriting
from its parent logger.

Response `204`, no body.

### 9. Identity View

Feeds the read-only Identity webview. The payload shapes and the UI behaviour
they serve are specified in [identity-webview.md](identity-webview.md); this
section is the REST contract.

#### `GET /identities/{nameOrId}/view`

The identity cube: header fields plus the seven sections
(`attributes`, `accounts`, `roles`, `entitlements`, `capabilities`,
`workgroups`, `quicklinks`). The Identity XML is never part of it — the webview fetches it
separately, through the generic interface, only when the user asks for it.

Query parameters:

| Parameter | Default | Description |
|---|---|---|
| `section` | *(none)* | Populates only that section, for a tab refresh. One of the seven section names. |

```json
{
  "result": {
    "id": "0a0000…", "name": "ada.lovelace", "displayName": "Ada Lovelace",
    "email": "ada@example.com", "type": "employee",
    "inactive": false, "correlated": true, "protected": false,
    "manager": { "id": "0a0001…", "name": "manager.name", "displayName": "Manager Name" },
    "lastRefresh": "2026-01-15T10:12:00Z", "lastLogin": "2026-02-01T08:30:00Z",
    "attributes": [
      { "name": "firstname", "label": "First name", "type": "string", "value": "Ada" }
    ],
    "accounts": [
      { "id": "…", "application": "Active Directory",
        "nativeIdentity": "CN=Ada,DC=example", "disabled": false }
    ],
    "roles": [
      { "id": "…", "name": "Employee", "type": "business", "assigned": true,
        "detected": true, "negative": false, "source": "LCM", "assignmentId": "…",
        "assigner": "spadmin", "parentRoleNames": [], "classifications": ["SOX"] }
    ],
    "entitlements": [
      { "id": "…", "application": "Active Directory",
        "nativeIdentity": "CN=Ada,DC=example", "type": "Entitlement",
        "name": "memberOf", "value": "CN=Finance", "grantedByRole": "Employee",
        "managedAttributeId": "…", "classifications": ["PCI"] }
    ],
    "capabilities": [
      { "name": "Certifier", "inherited": true, "workgroups": ["IT Admins"] }
    ],
    "workgroups": [
      { "id": "…", "name": "IT Admins", "displayName": "IT Admins",
        "description": "Infrastructure team", "capabilities": ["Certifier"] }
    ],
    "quicklinks": [
      { "id": "…", "name": "Manage User Access", "category": "Tasks",
        "action": "manageAccess", "disabled": false,
        "populations": [{ "id": "…", "name": "Everyone", "description": "All identities" }] }
    ]
  }
}
```

A `section` request answers with this same shape, the header fields filled and
every section but the requested one empty.

Notes on how the sections are built:

- `attributes` is **flat**: the ObjectConfig definitions in their configured
  order, then the values the identity carries without a definition, typed from
  the value. `type` is one of `boolean`, `string`, `date`, `identity`; an
  `identity` attribute also carries the resolved `identity` reference.
  `password`, `passwordHistory`, `AuthenticationAnswers`, `VerificationToken`
  and every attribute declared `secret` are excluded. Standard fields already
  rendered in the header (`manager`, `lastRefresh`, `lastLogin`, `email`,
  `displayName`, `type`, `inactive`, `correlated`, `protected`) or as their
  own tab (`assignedRoles`, `detectedRoles`, `bundles`, `capabilities`,
  `workgroups`) are excluded too, so they are not shown twice.
- `accounts` has one entry per `Link`. `id` is the id of the Link, which the
  account detail endpoint below resolves.
- `roles` has one entry per role, merging the assigned and detected Bundle
  lists, the `RoleAssignment`s (provenance, and the negative assignments the
  stock UI hides) and the `RoleDetection`s. `id` is the id of the **Bundle**,
  so the detail drawer can resolve it. `type` is the Bundle type, shown on the
  row; roles known only through an assignment or a detection (a negative
  assignment, a detection of a role the identity no longer holds) get theirs
  from one chunked Bundle load, which also fills `classifications` (display
  names). `parentRoleNames` identifies assignments that granted/detected this
  role, using permitted assignments and `RoleDetection.assignmentIds`.
- `entitlements` comes from a projection search on `IdentityEntitlement`,
  capped at 2000 entries. Rows that are IIQ roles (`assignedRoles`,
  `detectedRoles`, `bundles`) are excluded: they already have the Roles tab.
  `nativeIdentity` is the account that holds the entitlement.
  `managedAttributeId` and `classifications` are resolved in bulk so the
  drawer opens the right object and the table can show classification badges.
- `capabilities` lists the **effective** capabilities; `inherited` means
  "not held directly", and `workgroups` then names the workgroups granting it.
- `workgroups` carries, per workgroup, the `capabilities` it grants to its
  members, so the detail drawer shows them without a second request.
- `quicklinks` lists QuickLinks whose attached `DynamicScope` (population)
  matches the identity. Membership is `Matchmaker.isMatch` on the scope's
  `IdentitySelector`; a null selector is treated as everyone. One entry per
  QuickLink, with only the populations that matched.

Response `400`: unknown `section`. Response `404`: unknown identity.

#### `GET /objects/{Bundle|ManagedAttribute|Link}/{nameOrId}/summary`

Summary loaded lazily by the detail drawer when a role, an entitlement or an
account is clicked. Only those three types are supported; any other answers
`404`.

```json
{
  "result": {
    "id": "…", "name": "Employee", "displayName": "Employee",
    "type": "business",
    "owner": { "name": "spadmin", "displayName": "The Administrator" },
    "description": "Base role of every employee",
    "disabled": false,
    "classifications": []
  }
}
```

`application` and `value` are filled for a `ManagedAttribute`, `disabled` for
a `Bundle`. A `ManagedAttribute` is resolved by id, then by name, then by raw
value (the value is only unique per application: the first match wins, which
is what the webview falls back to when an entitlement carried no
`managedAttributeId`).

A `Link` (one account) answers with the account detail instead: it has no
name, so it is resolved **by id only** — the id the `accounts` section
carries — and `name` is its native identity.

```json
{
  "result": {
    "id": "…", "name": "CN=Ada,DC=example", "displayName": "Ada Lovelace",
    "application": "Active Directory", "instance": null,
    "disabled": false, "locked": false, "manuallyCorrelated": false,
    "lastRefresh": "2026-02-01T08:30:00Z",
    "attributes": [
      { "name": "sAMAccountName", "label": "Account name", "type": "string",
        "value": "alovelace" },
      { "name": "memberOf", "type": "string", "value": "CN=Finance,DC=example" }
    ]
  }
}
```

`attributes` is the flat account attribute list, same shape as the cube
attributes: the `Link` ObjectConfig definitions the account has a value for
(one ObjectConfig serves every application, so the others belong to another
schema), for their labels and declared types, then every other aggregated
value, typed from the value. `password`, `passwordHistory` and attributes
declared `secret` are excluded.

Response `404`: unknown object, or unsupported type.

### 10. Future endpoints (not used by the extension yet)

Reserved for future features; do not implement for the MVP:

- `POST /objects/Workflow/{nameOrId}/launch` — launch a workflow with a
  variable map (same shape as the task `run` action).

## Plugin skeleton (for reference)

```java
@Path("iiq-devtools")
@Produces(MediaType.APPLICATION_JSON)
public class DevToolsResource extends BasePluginResource {

    private static final Logger LOG = LogManager.getLogger(DevToolsResource.class);

    @Override
    public String getPluginName() {
        return "iiq-devtools";
    }

    /** Success envelope: { "result": ... } */
    private static Map<String, Object> ok(Object result) {
        Map<String, Object> envelope = new HashMap<>();
        envelope.put("result", result);
        return envelope;
    }

    /** Failure envelope: status + { "error": ... } */
    private static Response error(Response.Status status, String message) {
        return Response.status(status)
            .entity(Collections.singletonMap("error", message))
            .build();
    }

    @GET
    @Path("system/ping")
    @RequiredRight("iiqDevToolsAccess")
    public Map<String, Object> ping() throws GeneralException {
        LOG.debug("ping()");
        ...
        return ok(info);
    }

    @GET
    @Path("objects/{type}")
    @RequiredRight("iiqDevToolsAccess")
    public Map<String, Object> list(@PathParam("type") String type,
                                    @QueryParam("start") @DefaultValue("0") int start,
                                    @QueryParam("limit") @DefaultValue("200") int limit,
                                    @QueryParam("sortBy") @DefaultValue("name") String sortBy,
                                    @QueryParam("sortDir") @DefaultValue("asc") String sortDir,
                                    @QueryParam("query") String query,
                                    @QueryParam("excludeTypes") String excludeTypes) throws GeneralException {
        LOG.debug("list(type={}, start={}, limit={}, sortBy={}, sortDir={}, query={}, excludeTypes={})",
            type, start, limit, sortBy, sortDir, query, excludeTypes);
        ...
    }

    @POST
    @Path("objects/Rule/{nameOrId}/run")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight("iiqDevToolsAccess")
    public Map<String, Object> runRule(@PathParam("nameOrId") String nameOrId,
                                       Map<String, Object> args) throws GeneralException {
        LOG.info("runRule(nameOrId={})", nameOrId);
        // resolve rule, context.runRule(rule, args), audit, envelope
        ...
    }

    @POST
    @Path("objects/TaskDefinition/{nameOrId}/run")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight("iiqDevToolsAccess")
    public Map<String, Object> runTask(@PathParam("nameOrId") String nameOrId,
                                       Map<String, Object> args) throws GeneralException {
        LOG.info("runTask(nameOrId={})", nameOrId);
        // resolve TaskDefinition, TaskManager launch, return ok(taskResultId)
        ...
    }

    // GET/POST/PUT/DELETE objects/{type}/{nameOrId}, POST import,
    // GET objects/TaskResult/{nameOrId}/status ...
}
```

The plugin `manifest.xml` must declare `restResources` with this class, the
`iiqDevToolsAccess` SPRight, and `minSystemVersion` aligned with the supported
IIQ versions.
