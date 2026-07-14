package com.sailpoint.se.plugin.vscode.rest;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.SimpleDateFormat;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import javax.ws.rs.Consumes;
import javax.ws.rs.DELETE;
import javax.ws.rs.DefaultValue;
import javax.ws.rs.GET;
import javax.ws.rs.HEAD;
import javax.ws.rs.POST;
import javax.ws.rs.PUT;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import javax.ws.rs.QueryParam;
import javax.ws.rs.WebApplicationException;
import javax.ws.rs.core.EntityTag;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;

import org.apache.logging.log4j.Level;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.Appender;
import org.apache.logging.log4j.core.LoggerContext;
import org.apache.logging.log4j.core.StringLayout;
import org.apache.logging.log4j.core.config.Configurator;

import com.sailpoint.se.plugin.vscode.dto.LogChunkDto;
import com.sailpoint.se.plugin.vscode.dto.LogFileDto;
import com.sailpoint.se.plugin.vscode.dto.ObjectSummaryDto;
import com.sailpoint.se.plugin.vscode.dto.SystemInfoDto;
import com.sailpoint.se.plugin.vscode.dto.TaskStatusDto;

import lombok.extern.log4j.Log4j2;
import sailpoint.Version;
import sailpoint.api.ObjectUtil;
import sailpoint.api.TaskManager;
import sailpoint.api.Terminator;
import sailpoint.connector.Connector;
import sailpoint.connector.ConnectorException;
import sailpoint.connector.ConnectorFactory;
import sailpoint.object.Application;
import sailpoint.object.Attributes;
import sailpoint.object.AuditEvent;
import sailpoint.object.ClassLists;
import sailpoint.object.Filter;
import sailpoint.object.Plugin;
import sailpoint.object.QueryOptions;
import sailpoint.object.Rule;
import sailpoint.object.SailPointObject;
import sailpoint.object.TaskDefinition;
import sailpoint.object.TaskResult;
import sailpoint.object.TaskSchedule;
import sailpoint.rest.BaseResource;
import sailpoint.rest.plugin.BasePluginResource;
import sailpoint.rest.plugin.RequiredRight;
import sailpoint.server.ImportExecutor;
import sailpoint.server.Importer;
import sailpoint.tools.GeneralException;
import sailpoint.tools.Util;
import sailpoint.tools.xml.AbstractXmlObject;
import sailpoint.tools.xml.XMLObjectFactory;

/**
 * REST resource implementing the iiq-devtools contract used by the
 * vscode-sailpoint-identityiq extension (docs/plugin-api.md).
 *
 * Every JSON response uses the same envelope: {@code { "result": ... }} on
 * success (plus endpoint-specific metadata such as {@code count} or
 * {@code executionTimeMs}), {@code { "error": "..." }} with an HTTP error
 * status on failure. A REST method cannot return raw XML: object XML always
 * travels as a string inside the envelope, serialized with {@code toXml()}.
 *
 * Requests carry XML the same way: the IIQ plugin REST filter chain does not
 * deliver non-JSON request bodies to the resource (a raw
 * {@code application/xml} String entity arrives null), so mutation endpoints
 * consume {@code application/json} with the XML in the {@code xml} property.
 */
@Path("iiq-devtools")
@Produces(MediaType.APPLICATION_JSON)
@Log4j2
public class VSCodePluginResource extends BasePluginResource {

    /** Version of the REST contract implemented by this resource */
    public static final int API_VERSION = 1;

    /**
     * SPRight protecting every endpoint. System Administrators always pass
     * the check, even when the SPRight object has not been imported.
     */
    private static final String ACCESS_RIGHT = "iiqDevToolsAccess";

    /**
     * Supported object types, keyed by their name relative to the
     * sailpoint.object package (e.g. "Rule", "accesshistory.HistoricalIdentity").
     * Built from ClassLists.MajorClasses — the same list that backs the
     * generic "Get object..." command of the extension.
     */
    private static final Map<String, Class<? extends SailPointObject>> MAJOR_CLASSES = buildMajorClasses();

    /** Attempts (x100 ms) to wait for the TaskResult of a launched task */
    private static final int TASK_RESULT_WAIT_ATTEMPTS = 50;

    /** First tail call: window of trailing bytes returned from the log file */
    private static final long LOG_INITIAL_WINDOW_BYTES = 16 * 1024;

    /** Maximum bytes read from a log file by one tail call */
    private static final int LOG_MAX_CHUNK_BYTES = 64 * 1024;

    @Override
    public String getPluginName() {
        return "vscodePlugin";
    }

    /**
     * Default constructor.
     */
    public VSCodePluginResource() {
        super();
    }

    /**
     * Inherited constructor.
     *
     * @param parent
     */
    public VSCodePluginResource(BaseResource parent) {
        super(parent);
    }

    ////////////////////////////////////////////////////////////////////////
    // 1. System
    ////////////////////////////////////////////////////////////////////////

    /**
     * Connection test and version negotiation.
     */
    @GET
    @Path("system/ping")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> ping() throws GeneralException {
        LOG.debug("ping()");
        Plugin plugin = getContext().getObjectByName(Plugin.class, getPluginName());
        return ok(SystemInfoDto.builder()
                .version(Version.getFullVersion())
                .pluginVersion(plugin != null ? plugin.getVersion() : "unknown")
                .apiVersion(API_VERSION)
                .identity(getLoggedInUserName())
                .build());
    }

    /**
     * Object types supported by the generic interface.
     */
    @GET
    @Path("system/classes")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> classes() {
        LOG.debug("classes()");
        return ok(new ArrayList<>(MAJOR_CLASSES.keySet()));
    }

    ////////////////////////////////////////////////////////////////////////
    // 2. Generic object CRUD
    ////////////////////////////////////////////////////////////////////////

    /**
     * Paginated, sorted list of objects. Uses a projection search: objects
     * are never fully loaded for listing.
     */
    @GET
    @Path("objects/{type}")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> list(@PathParam("type") String type,
                                    @QueryParam("start") @DefaultValue("0") int start,
                                    @QueryParam("limit") @DefaultValue("200") int limit,
                                    @QueryParam("sortBy") @DefaultValue("name") String sortBy,
                                    @QueryParam("sortDir") @DefaultValue("asc") String sortDir,
                                    @QueryParam("query") String query,
                                    @QueryParam("excludeTypes") String excludeTypes) throws GeneralException {
        LOG.debug("list(type={}, start={}, limit={}, sortBy={}, sortDir={}, query={}, excludeTypes={})",
                type, start, limit, sortBy, sortDir, query, excludeTypes);
        Class<? extends SailPointObject> clazz = resolveClass(type);
        if (!"name".equals(sortBy) && !"modified".equals(sortBy)) {
            throw error(Response.Status.BAD_REQUEST, "sortBy must be \"name\" or \"modified\"");
        }

        QueryOptions countOptions = new QueryOptions();
        QueryOptions queryOptions = new QueryOptions();
        if (Util.isNotNullOrEmpty(query)) {
            Filter filter = Filter.ignoreCase(Filter.like("name", query, Filter.MatchMode.ANYWHERE));
            countOptions.addFilter(filter);
            queryOptions.addFilter(filter);
        }
        if (Util.isNotNullOrEmpty(excludeTypes)) {
            Filter filter = buildExcludeTypesFilter(clazz, excludeTypes);
            countOptions.addFilter(filter);
            queryOptions.addFilter(filter);
        }
        if (TaskDefinition.class.equals(clazz)) {
            // Templates are blueprints used to create tasks, not runnable
            // tasks themselves: never show them in the Tasks list.
            Filter filter = Filter.eq("template", false);
            countOptions.addFilter(filter);
            queryOptions.addFilter(filter);
        }
        queryOptions.setFirstRow(Math.max(0, start));
        queryOptions.setResultLimit(Math.max(1, limit));
        queryOptions.addOrdering(sortBy, !"desc".equalsIgnoreCase(sortDir));
        if (!"name".equals(sortBy)) {
            // Stable secondary ordering
            queryOptions.addOrdering("name", true);
        }

        int count = getContext().countObjects(clazz, countOptions);
        List<ObjectSummaryDto> summaries = new ArrayList<>();
        Iterator<Object[]> rows = getContext().search(clazz, queryOptions,
                Arrays.asList("id", "name", "created", "modified"));
        while (rows.hasNext()) {
            Object[] row = rows.next();
            summaries.add(ObjectSummaryDto.builder()
                    .id((String) row[0])
                    .name((String) row[1])
                    .created(iso((Date) row[2]))
                    .modified(iso((Date) row[3]))
                    .build());
        }
        Map<String, Object> response = ok(summaries);
        response.put("count", count);
        return response;
    }

    /**
     * XML representation of a single object, as a string in the envelope
     * (standard IIQ export format, header and CDATA sections included).
     */
    @GET
    @Path("objects/{type}/{nameOrId}")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> get(@PathParam("type") String type,
                                   @PathParam("nameOrId") String nameOrId) throws GeneralException {
        LOG.debug("get(type={}, nameOrId={})", type, nameOrId);
        SailPointObject object = find(resolveClass(type), nameOrId);
        if (object == null) {
            throw error(Response.Status.NOT_FOUND, type + " \"" + nameOrId + "\" not found");
        }
        return ok(toXml(object));
    }

    /**
     * Lightweight existence and change-detection check: metadata in HTTP
     * headers, no body. Serves the stat() calls of the extension's virtual
     * file system.
     */
    @HEAD
    @Path("objects/{type}/{nameOrId}")
    @RequiredRight(ACCESS_RIGHT)
    public Response head(@PathParam("type") String type,
                         @PathParam("nameOrId") String nameOrId) throws GeneralException {
        LOG.debug("head(type={}, nameOrId={})", type, nameOrId);
        SailPointObject object = find(resolveClass(type), nameOrId);
        if (object == null) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        byte[] xml = toXml(object).getBytes(StandardCharsets.UTF_8);
        Date lastModified = object.getModified() != null ? object.getModified() : object.getCreated();
        Response.ResponseBuilder builder = Response.ok()
                .header("Content-Length", xml.length)
                .tag(new EntityTag(sha256(xml)));
        if (lastModified != null) {
            builder.lastModified(lastModified);
        }
        return builder.build();
    }

    /**
     * Creates an object from its XML representation. 409 if an object with
     * the same name already exists.
     */
    @POST
    @Path("objects/{type}")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(ACCESS_RIGHT)
    public Response create(@PathParam("type") String type, Map<String, Object> body) throws GeneralException {
        String xml = xmlFromBody(body);
        LOG.info("create(type={}, {} bytes)", type, xml.length());
        Class<? extends SailPointObject> clazz = resolveClass(type);
        SailPointObject parsed = parse(clazz, xml);
        if (parsed.getName() != null && getContext().getObjectByName(clazz, parsed.getName()) != null) {
            throw error(Response.Status.CONFLICT,
                    type + " \"" + parsed.getName() + "\" already exists");
        }
        SailPointObject saved = importSingleObject(clazz, xml, parsed.getName());
        return Response.status(Response.Status.CREATED).entity(ok(toXml(saved))).build();
    }

    /**
     * Creates or updates an object from its XML representation. Semantically
     * an import of a single object: internal ids present in the XML are
     * ignored, references are resolved by name.
     */
    @PUT
    @Path("objects/{type}/{nameOrId}")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> update(@PathParam("type") String type,
                                      @PathParam("nameOrId") String nameOrId,
                                      Map<String, Object> body) throws GeneralException {
        String xml = xmlFromBody(body);
        LOG.info("update(type={}, nameOrId={}, {} bytes)", type, nameOrId, xml.length());
        Class<? extends SailPointObject> clazz = resolveClass(type);
        SailPointObject parsed = parse(clazz, xml);
        SailPointObject saved = importSingleObject(clazz, xml, parsed.getName());
        return ok(toXml(saved));
    }

    /**
     * Deletes an object, cleaning up its references with the Terminator.
     */
    @DELETE
    @Path("objects/{type}/{nameOrId}")
    @RequiredRight(ACCESS_RIGHT)
    public Response delete(@PathParam("type") String type,
                           @PathParam("nameOrId") String nameOrId) throws GeneralException {
        Class<? extends SailPointObject> clazz = resolveClass(type);
        SailPointObject object = find(clazz, nameOrId);
        if (object == null) {
            throw error(Response.Status.NOT_FOUND, type + " \"" + nameOrId + "\" not found");
        }
        LOG.info("delete(type={}, name={})", type, object.getName());
        new Terminator(getContext()).deleteObject(object);
        getContext().commitTransaction();
        return Response.noContent().build();
    }

    ////////////////////////////////////////////////////////////////////////
    // 3. Import
    ////////////////////////////////////////////////////////////////////////

    /**
     * Imports an arbitrary XML document (single object or sailpoint bundle),
     * like "System Setup > Import from File" / iiq console import.
     */
    @POST
    @Path("import")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> importXml(Map<String, Object> body) {
        String xml = xmlFromBody(body);
        LOG.info("import({} bytes)", xml.length());
        List<String> errors = new ArrayList<>();
        List<String> imported = doImport(xml, errors);
        Map<String, Object> response = ok(imported);
        response.put("errors", errors);
        return response;
    }

    ////////////////////////////////////////////////////////////////////////
    // 4. Rule execution
    ////////////////////////////////////////////////////////////////////////

    /**
     * Runs a rule and returns its result. Rule failures (BeanShell
     * exceptions) are returned as 400 with the exception message.
     */
    @POST
    @Path("objects/Rule/{nameOrId}/run")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> runRule(@PathParam("nameOrId") String nameOrId,
                                       Map<String, Object> args) throws GeneralException {
        Rule rule = find(Rule.class, nameOrId);
        if (rule == null) {
            throw error(Response.Status.NOT_FOUND, "Rule \"" + nameOrId + "\" not found");
        }
        LOG.info("runRule(name={}, args={})", rule.getName(), args == null ? "{}" : args.keySet());
        audit("runRule", rule.getName());

        long started = System.currentTimeMillis();
        Object value;
        try {
            value = getContext().runRule(rule, args != null ? args : new HashMap<>());
        } catch (GeneralException e) {
            LOG.error("Rule \"{}\" failed", rule.getName(), e);
            throw error(Response.Status.BAD_REQUEST, e.getLocalizedMessage());
        }
        Map<String, Object> response = ok(jsonSafe(value));
        response.put("executionTimeMs", System.currentTimeMillis() - started);
        return response;
    }

    ////////////////////////////////////////////////////////////////////////
    // 5. Task execution
    ////////////////////////////////////////////////////////////////////////

    /**
     * Launches a task asynchronously and returns the id of the TaskResult
     * tracking the execution. A unique result name is forced so the
     * TaskResult can be resolved immediately, without waiting for completion.
     */
    @POST
    @Path("objects/TaskDefinition/{nameOrId}/run")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> runTask(@PathParam("nameOrId") String nameOrId,
                                       Map<String, Object> args) throws GeneralException {
        TaskDefinition definition = find(TaskDefinition.class, nameOrId);
        if (definition == null) {
            throw error(Response.Status.NOT_FOUND, "TaskDefinition \"" + nameOrId + "\" not found");
        }
        LOG.info("runTask(name={}, args={})", definition.getName(), args == null ? "{}" : args.keySet());
        audit("runTask", definition.getName());

        String resultName = definition.getName() + " - "
                + new SimpleDateFormat("yyyyMMdd-HHmmss.SSS").format(new Date());
        Attributes<String, Object> attributes = new Attributes<>();
        if (args != null) {
            attributes.putAll(args);
        }
        attributes.put(TaskSchedule.ARG_RESULT_NAME, resultName);

        TaskManager taskManager = new TaskManager(getContext());
        taskManager.setLauncher(getLoggedInUserName());
        try {
            taskManager.run(definition, attributes);
        } catch (GeneralException e) {
            LOG.error("Task \"{}\" could not be launched", definition.getName(), e);
            throw error(Response.Status.BAD_REQUEST, e.getLocalizedMessage());
        }
        return ok(waitForTaskResult(resultName).getId());
    }

    /**
     * Lightweight execution status of a task, polled by the extension while
     * the task runs. Answered from a projection query; the full TaskResult
     * is only loaded (for the messages) once the task has completed.
     */
    @GET
    @Path("objects/TaskResult/{nameOrId}/status")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> taskStatus(@PathParam("nameOrId") String nameOrId) throws GeneralException {
        LOG.debug("taskStatus(nameOrId={})", nameOrId);
        QueryOptions queryOptions = new QueryOptions();
        queryOptions.addFilter(Filter.or(Filter.eq("id", nameOrId), Filter.eq("name", nameOrId)));
        Iterator<Object[]> rows = getContext().search(TaskResult.class, queryOptions,
                Arrays.asList("id", "name", "completed", "completionStatus"));
        if (!rows.hasNext()) {
            throw error(Response.Status.NOT_FOUND, "TaskResult \"" + nameOrId + "\" not found");
        }
        Object[] row = rows.next();
        Util.flushIterator(rows);

        String id = (String) row[0];
        Date completed = (Date) row[2];
        TaskResult.CompletionStatus completionStatus = (TaskResult.CompletionStatus) row[3];

        List<String> messages = new ArrayList<>();
        if (completed != null) {
            TaskResult result = getContext().getObjectById(TaskResult.class, id);
            if (result != null && result.getMessages() != null) {
                // Iterated as Object: resolving sailpoint.tools.Message members
                // would require openconnector classes, absent from identityiq.jar.
                // Message.toString() returns the localized message.
                for (Object message : result.getMessages()) {
                    messages.add(String.valueOf(message));
                }
            }
        }
        return ok(TaskStatusDto.builder()
                .id(id)
                .name((String) row[1])
                .completed(iso(completed))
                .completionStatus(completionStatus != null ? completionStatus.name() : null)
                .messages(messages)
                .build());
    }

    ////////////////////////////////////////////////////////////////////////
    // 6. Application connection test
    ////////////////////////////////////////////////////////////////////////

    /**
     * Tests the connection of an Application: instantiates its Connector and
     * calls testConfiguration(), the same call the "Test Connection" button
     * of the Application configuration page makes. Connector failures
     * (invalid host, bad credentials...) are returned as 400 with the
     * exception message; anything else (unknown application) is 404.
     */
    @POST
    @Path("objects/Application/{nameOrId}/test-connection")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> testApplicationConnection(@PathParam("nameOrId") String nameOrId)
            throws GeneralException {
        LOG.debug("testApplicationConnection(nameOrId={})", nameOrId);
        Application application = find(Application.class, nameOrId);
        if (application == null) {
            throw error(Response.Status.NOT_FOUND, "Application \"" + nameOrId + "\" not found");
        }
        LOG.info("testApplicationConnection(name={})", application.getName());
        audit("testApplicationConnection", application.getName());

        try {
            Connector connector = ConnectorFactory.getConnector(application, null);
            ObjectUtil.getLocalApplication(connector);
            connector.testConfiguration();
        } catch (GeneralException | ConnectorException e) {
            LOG.error("Connection test failed for Application \"{}\"", application.getName(), e);
            throw error(Response.Status.BAD_REQUEST, e.getLocalizedMessage());
        }
        return ok("Connection to \"" + application.getName() + "\" succeeded.");
    }

    ////////////////////////////////////////////////////////////////////////
    // 7. Server log files
    ////////////////////////////////////////////////////////////////////////

    /**
     * Lists the tailable log files: the targets of the file-backed appenders
     * of the live Log4j2 configuration. Security invariant: only those files
     * are readable, and they are referenced by appender name — a path is
     * never accepted as input.
     */
    @GET
    @Path("logs")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> listLogFiles() {
        LOG.debug("listLogFiles()");
        List<LogFileDto> files = new ArrayList<>();
        for (Appender appender : getLoggerContext().getConfiguration().getAppenders().values()) {
            File file = resolveAppenderFile(appender);
            if (file != null) {
                files.add(LogFileDto.builder()
                        .key(appender.getName())
                        .fileName(file.getName())
                        .path(file.getAbsolutePath())
                        .size(file.exists() ? file.length() : 0)
                        .lastModified(file.exists() ? iso(new Date(file.lastModified())) : null)
                        .exists(file.exists())
                        .build());
            }
        }
        return ok(files);
    }

    /**
     * Reads a chunk of a log file, "tail -f" style. The appender is
     * re-resolved from the live configuration on every call, so log rolling
     * and reconfigurations are always honored. First call (no offset):
     * returns the trailing window of the file. Shrunken file (rotation,
     * truncation): the cursor resets to the tail and {@code rotated} is set.
     * Only whole lines are returned; the trailing partial line is kept
     * server-side for the next call (cut on bytes, so multi-byte characters
     * are never split).
     */
    @GET
    @Path("logs/{key}/tail")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> tailLogFile(@PathParam("key") String key,
                                           @QueryParam("offset") @DefaultValue("-1") long offset) {
        LOG.debug("tailLogFile(key={}, offset={})", key, offset);
        Appender appender = getLoggerContext().getConfiguration().getAppender(key);
        File file = appender == null ? null : resolveAppenderFile(appender);
        if (file == null) {
            throw error(Response.Status.NOT_FOUND, "Unknown log appender: " + key);
        }
        if (!file.exists()) {
            // The file may appear later (lazy appenders): keep polling
            return ok(LogChunkDto.builder().content("").nextOffset(0).fileSize(0).rotated(false).build());
        }

        long length = file.length();
        boolean rotated = offset >= 0 && offset > length;
        boolean freshWindow = offset < 0 || rotated;
        long start = freshWindow ? Math.max(0, length - LOG_INITIAL_WINDOW_BYTES) : offset;
        byte[] buffer = new byte[(int) Math.max(0, Math.min(LOG_MAX_CHUNK_BYTES, length - start))];
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            raf.seek(start);
            raf.readFully(buffer);
        } catch (IOException e) {
            // E.g. the file was swapped by a rename-rotation mid-read: the
            // client treats it as transient and the next poll self-heals
            LOG.error("Could not read log file {}", file, e);
            throw error(Response.Status.INTERNAL_SERVER_ERROR,
                    "Could not read the log file: " + e.getMessage());
        }

        // Line hygiene on the bytes, before decoding.
        // A fresh window starts at an arbitrary byte: skip the partial first
        // line (and any split multi-byte sequence with it).
        int from = 0;
        if (freshWindow && start > 0) {
            int newline = indexOf(buffer, (byte) '\n', 0);
            from = newline >= 0 ? newline + 1 : buffer.length;
        }
        // Cut at the last newline; the partial trailing line waits server-side
        int to = lastIndexOf(buffer, (byte) '\n', from);
        if (to >= from) {
            to++; // include the newline
        } else if (buffer.length == LOG_MAX_CHUNK_BYTES) {
            to = buffer.length; // pathological single line: emit anyway to guarantee progress
        } else {
            to = from; // no complete line yet: wait for the next poll
        }

        return ok(LogChunkDto.builder()
                .content(decode(buffer, from, to - from, charsetOf(appender)))
                .nextOffset(start + to)
                .fileSize(length)
                .rotated(rotated)
                .build());
    }

    ////////////////////////////////////////////////////////////////////////
    // 8. Logger levels
    ////////////////////////////////////////////////////////////////////////

    /**
     * Sets a logger's level at runtime, in memory: an in-place change to the
     * live Log4j2 configuration, not persisted to log4j2.properties and lost
     * on restart. Creates the {@code LoggerConfig} for the given name if it
     * did not already have one of its own.
     */
    @PUT
    @Path("logs/levels/{logger}")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> setLoggerLevel(@PathParam("logger") String logger, Map<String, Object> body) {
        Level level = parseLevel(body);
        LOG.info("setLoggerLevel(logger={}, level={})", logger, level);
        audit("setLoggerLevel", logger + "=" + level);
        Configurator.setLevel(logger, level);
        return ok(level.name());
    }

    /**
     * Removes a logger's explicit level override, so it reverts to
     * inheriting from its parent in the live Log4j2 configuration.
     */
    @DELETE
    @Path("logs/levels/{logger}")
    @RequiredRight(ACCESS_RIGHT)
    public Response resetLoggerLevel(@PathParam("logger") String logger) {
        LOG.info("resetLoggerLevel(logger={})", logger);
        audit("resetLoggerLevel", logger);
        Configurator.setLevel(logger, (Level) null);
        return Response.noContent().build();
    }

    /** Extracts and validates the {@code level} property of a PUT body */
    private static Level parseLevel(Map<String, Object> body) {
        Object levelName = body == null ? null : body.get("level");
        if (!(levelName instanceof String) || Util.isNullOrEmpty((String) levelName)) {
            throw error(Response.Status.BAD_REQUEST,
                    "The request body must be a JSON object with a non-empty \"level\" string property");
        }
        String upper = ((String) levelName).toUpperCase();
        Level level = Level.toLevel(upper, null);
        if (level == null || !level.name().equals(upper)) {
            throw error(Response.Status.BAD_REQUEST,
                    "Unknown level \"" + levelName + "\": expected one of TRACE, DEBUG, INFO, WARN, ERROR, FATAL, OFF");
        }
        return level;
    }

    ////////////////////////////////////////////////////////////////////////
    // Helpers
    ////////////////////////////////////////////////////////////////////////

    private static LoggerContext getLoggerContext() {
        return (LoggerContext) LogManager.getContext(false);
    }

    /**
     * Resolves the file behind an appender. Log4j2 has no common interface
     * for file-backed appenders: FileAppender, RollingFileAppender,
     * RandomAccessFileAppender, RollingRandomAccessFileAppender and
     * MemoryMappedFileAppender each declare their own public
     * {@code getFileName()} (returning the currently active file for the
     * rolling ones). Relying on that convention by reflection covers them
     * all — including custom appenders that follow it — without enumerating
     * classes. Returns null for non-file appenders (console, JDBC...).
     */
    private static File resolveAppenderFile(Appender appender) {
        try {
            Method getFileName = appender.getClass().getMethod("getFileName");
            Object fileName = getFileName.invoke(appender);
            if (fileName instanceof String && Util.isNotNullOrEmpty((String) fileName)) {
                return new File((String) fileName);
            }
        } catch (NoSuchMethodException e) {
            // Not a file-backed appender
        } catch (ReflectiveOperationException e) {
            LOG.warn("Could not resolve the file of appender {}", appender.getName(), e);
        }
        return null;
    }

    /** Charset of the appender's layout, UTF-8 when it does not declare one */
    private static Charset charsetOf(Appender appender) {
        if (appender.getLayout() instanceof StringLayout) {
            Charset charset = ((StringLayout) appender.getLayout()).getCharset();
            if (charset != null) {
                return charset;
            }
        }
        return StandardCharsets.UTF_8;
    }

    /** Lenient decoding: stray bytes are replaced, never a failure */
    private static String decode(byte[] buffer, int from, int length, Charset charset) {
        try {
            return charset.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPLACE)
                    .onUnmappableCharacter(CodingErrorAction.REPLACE)
                    .decode(ByteBuffer.wrap(buffer, from, length))
                    .toString();
        } catch (CharacterCodingException e) {
            // Unreachable with REPLACE, but the API requires handling it
            return new String(buffer, from, length, charset);
        }
    }

    private static int indexOf(byte[] buffer, byte value, int from) {
        for (int i = from; i < buffer.length; i++) {
            if (buffer[i] == value) {
                return i;
            }
        }
        return -1;
    }

    private static int lastIndexOf(byte[] buffer, byte value, int from) {
        for (int i = buffer.length - 1; i >= from; i--) {
            if (buffer[i] == value) {
                return i;
            }
        }
        return -1;
    }

    /** Success envelope: { "result": ... } */
    private static Map<String, Object> ok(Object result) {
        Map<String, Object> envelope = new HashMap<>();
        envelope.put("result", result);
        return envelope;
    }

    /** Failure envelope: HTTP status + { "error": ... } */
    private static WebApplicationException error(Response.Status status, String message) {
        return new WebApplicationException(Response.status(status)
                .type(MediaType.APPLICATION_JSON)
                .entity(Collections.singletonMap("error", message))
                .build());
    }

    /**
     * Extracts the XML document from the {@code xml} property of a JSON
     * request body. The XML cannot be posted as a raw entity: the plugin
     * REST filter chain never hands non-JSON bodies to the resource.
     */
    private static String xmlFromBody(Map<String, Object> body) {
        Object xml = body == null ? null : body.get("xml");
        if (!(xml instanceof String) || Util.isNullOrEmpty((String) xml)) {
            throw error(Response.Status.BAD_REQUEST,
                    "The request body must be a JSON object with a non-empty \"xml\" string property");
        }
        return (String) xml;
    }

    /** Indexes ClassLists.MajorClasses by name relative to sailpoint.object */
    private static Map<String, Class<? extends SailPointObject>> buildMajorClasses() {
        Map<String, Class<? extends SailPointObject>> byName = new TreeMap<>();
        for (Class<?> clazz : ClassLists.MajorClasses) {
            if (SailPointObject.class.isAssignableFrom(clazz)) {
                byName.put(clazz.getName().replace("sailpoint.object.", ""),
                        clazz.asSubclass(SailPointObject.class));
            }
        }
        return Collections.unmodifiableMap(byName);
    }

    /**
     * Builds a filter excluding the given values of the {@code type} property
     * (CSV, e.g. "Report,LiveReport" to keep reports out of a TaskDefinition
     * list). When the property is an enum (TaskDefinition, Rule...), the names
     * are converted with {@code Enum.valueOf} so Hibernate compares enums to
     * enums. Objects with a null type are kept: a bare {@code NOT (type IN
     * ...)} would silently drop them.
     */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private static Filter buildExcludeTypesFilter(Class<? extends SailPointObject> clazz, String excludeTypes) {
        Class<?> propertyType;
        try {
            propertyType = clazz.getMethod("getType").getReturnType();
        } catch (NoSuchMethodException e) {
            throw error(Response.Status.BAD_REQUEST,
                    "excludeTypes is not supported for " + clazz.getSimpleName());
        }
        List<Object> values = new ArrayList<>();
        for (String name : Util.csvToList(excludeTypes)) {
            if (propertyType.isEnum()) {
                try {
                    values.add(Enum.valueOf((Class<Enum>) propertyType, name));
                } catch (IllegalArgumentException e) {
                    throw error(Response.Status.BAD_REQUEST,
                            "Unknown " + clazz.getSimpleName() + " type: " + name);
                }
            } else {
                values.add(name);
            }
        }
        return Filter.or(Filter.isnull("type"), Filter.not(Filter.in("type", values)));
    }

    /**
     * Resolves an object type against the supported classes
     * (ClassLists.MajorClasses); anything else is rejected.
     */
    private Class<? extends SailPointObject> resolveClass(String type) {
        Class<? extends SailPointObject> clazz = type == null ? null : MAJOR_CLASSES.get(type);
        if (clazz == null) {
            throw error(Response.Status.NOT_FOUND, "Unknown or unsupported object type: " + type);
        }
        return clazz;
    }

    /** Resolves an object by id first, then by name */
    private <T extends SailPointObject> T find(Class<T> clazz, String nameOrId) throws GeneralException {
        T object = getContext().getObjectById(clazz, nameOrId);
        return object != null ? object : getContext().getObjectByName(clazz, nameOrId);
    }

    /** Serializes an object to the standard IIQ export XML, header included */
    private String toXml(SailPointObject object) {
        return XMLObjectFactory.getInstance().toXml(object, true);
    }

    /** Parses an XML document and checks it contains an object of the expected type */
    private <T extends SailPointObject> T parse(Class<T> clazz, String xml) {
        Object parsed;
        try {
            parsed = XMLObjectFactory.getInstance().parseXml(getContext(), xml, false);
        } catch (RuntimeException e) {
            throw error(Response.Status.BAD_REQUEST, "Invalid XML: " + e.getMessage());
        }
        if (!clazz.isInstance(parsed)) {
            throw error(Response.Status.BAD_REQUEST,
                    "The XML does not contain a " + clazz.getSimpleName());
        }
        return clazz.cast(parsed);
    }

    /**
     * Imports the XML of a single object through the Importer (so ids are
     * ignored and references resolved by name) and returns the saved object.
     */
    private <T extends SailPointObject> T importSingleObject(Class<T> clazz, String xml, String name)
            throws GeneralException {
        List<String> errors = new ArrayList<>();
        doImport(xml, errors);
        if (!errors.isEmpty()) {
            throw error(Response.Status.BAD_REQUEST, String.join("; ", errors));
        }
        T saved = getContext().getObjectByName(clazz, name);
        if (saved == null) {
            throw error(Response.Status.INTERNAL_SERVER_ERROR,
                    "The import did not produce " + clazz.getSimpleName() + " \"" + name + "\"");
        }
        return saved;
    }

    /**
     * Runs the standard Importer on an XML document, collecting the imported
     * object identifiers ("Type:Name") and the errors.
     */
    private List<String> doImport(String xml, List<String> errors) {
        List<String> imported = new ArrayList<>();
        Importer importer = new Importer(getContext(), new Importer.Monitor() {
            @Override
            public void report(SailPointObject object) {
                imported.add(object.getClass().getSimpleName() + ":" + object.getName());
            }

            @Override
            public void mergingObject(SailPointObject object) {
                imported.add(object.getClass().getSimpleName() + ":" + object.getName());
            }

            @Override
            public void executing(ImportExecutor executor) {
                LOG.debug("import: executing {}", executor.getClass().getSimpleName());
            }

            @Override
            public void includingFile(String fileName) {
                LOG.debug("import: including {}", fileName);
            }

            @Override
            public void info(String message) {
                LOG.info("import: {}", message);
            }

            @Override
            public void warn(String message) {
                LOG.warn("import: {}", message);
                errors.add(message);
            }
        });
        try {
            importer.importXml(xml);
            getContext().commitTransaction();
        } catch (GeneralException e) {
            LOG.error("Import failed", e);
            errors.add(e.getLocalizedMessage());
        }
        return imported;
    }

    /**
     * Waits for the TaskResult of a freshly launched task to be created
     * (the launch is asynchronous, the executor creates it a moment later).
     */
    private TaskResult waitForTaskResult(String resultName) throws GeneralException {
        for (int attempt = 0; attempt < TASK_RESULT_WAIT_ATTEMPTS; attempt++) {
            TaskResult result = getContext().getObjectByName(TaskResult.class, resultName);
            if (result != null) {
                return result;
            }
            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
            getContext().decache();
        }
        throw error(Response.Status.INTERNAL_SERVER_ERROR,
                "The task was launched but its TaskResult \"" + resultName + "\" was not found");
    }

    /**
     * Converts a value to something JSON-serializable: SailPoint objects
     * become their toXml() string, unknown types fall back to toString().
     */
    private Object jsonSafe(Object value) throws GeneralException {
        if (value == null || value instanceof String || value instanceof Number || value instanceof Boolean) {
            return value;
        }
        if (value instanceof AbstractXmlObject) {
            return ((AbstractXmlObject) value).toXml();
        }
        if (value instanceof Date) {
            return iso((Date) value);
        }
        if (value instanceof Collection) {
            List<Object> converted = new ArrayList<>();
            for (Object element : (Collection<?>) value) {
                converted.add(jsonSafe(element));
            }
            return converted;
        }
        if (value instanceof Map) {
            Map<String, Object> converted = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                converted.put(String.valueOf(entry.getKey()), jsonSafe(entry.getValue()));
            }
            return converted;
        }
        return value.toString();
    }

    /** Audits an execution (rule run, task launch); never fails the request */
    private void audit(String action, String target) {
        try {
            AuditEvent event = new AuditEvent(getLoggedInUserName(), "iiq-devtools:" + action, target);
            getContext().saveObject(event);
            getContext().commitTransaction();
        } catch (GeneralException e) {
            LOG.warn("Could not audit {} on {}", action, target, e);
        }
    }

    private static String iso(Date date) {
        return date == null ? null : DateTimeFormatter.ISO_INSTANT.format(date.toInstant());
    }

    private static String sha256(byte[] bytes) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            StringBuilder hex = new StringBuilder();
            for (byte b : digest.digest(bytes)) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
