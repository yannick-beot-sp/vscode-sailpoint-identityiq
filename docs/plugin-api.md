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
  The supported set is **`sailpoint.object.ClassLists.MajorClasses`**: the
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
    "pluginVersion": "1.0.0",
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
classes of `ClassLists.MajorClasses`, named relative to `sailpoint.object` —
so the extension can discover new types dynamically (its embedded
`ALL_OBJECT_TYPES` list is a static mirror).

Response `200`:
```json
{ "result": ["AccountGroup", "ActivityDataSource", "...", "Rule", "TaskDefinition", "TaskResult", "Workflow", "accesshistory.HistoricalIdentity", "..."] }
```

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

Implementation note: use a projection search
(`context.search(clazz, queryOptions, Arrays.asList("id", "name", "created", "modified"))`)
— never load full objects for listing. `count` is obtained with `context.countObjects`,
with the same filters as the search. `excludeTypes` values are converted to the
enum of the `type` property when there is one (`TaskDefinition`, `Rule`...), and
objects with a **null** type are kept (a bare `NOT (type IN ...)` would drop them).

For `TaskDefinition`, an unconditional `template = false` filter is always
applied (not exposed as a query parameter): templates (`template="true"` in the
XML) are blueprints used to create tasks, not runnable tasks themselves, so
they are never returned by this endpoint.

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

### 9. Future endpoints (not used by the extension yet)

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
