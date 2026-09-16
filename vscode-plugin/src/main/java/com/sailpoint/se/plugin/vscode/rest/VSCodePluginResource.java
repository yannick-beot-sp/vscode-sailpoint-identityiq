package com.sailpoint.se.plugin.vscode.rest;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.lang.reflect.Method;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
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
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

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
import org.apache.logging.log4j.core.config.ConfigurationSource;
import org.apache.logging.log4j.core.config.Configurator;
import org.apache.logging.log4j.core.config.DefaultConfiguration;

import com.sailpoint.se.plugin.vscode.dto.IdentityAccountDto;
import com.sailpoint.se.plugin.vscode.dto.IdentityAttributeDto;
import com.sailpoint.se.plugin.vscode.dto.IdentityCapabilityDto;
import com.sailpoint.se.plugin.vscode.dto.IdentityEntitlementDto;
import com.sailpoint.se.plugin.vscode.dto.IdentityPopulationDto;
import com.sailpoint.se.plugin.vscode.dto.IdentityQuickLinkDto;
import com.sailpoint.se.plugin.vscode.dto.IdentityReferenceDto;
import com.sailpoint.se.plugin.vscode.dto.IdentityRoleDto;
import com.sailpoint.se.plugin.vscode.dto.IdentityViewDto;
import com.sailpoint.se.plugin.vscode.dto.IdentityWorkgroupDto;
import com.sailpoint.se.plugin.vscode.dto.LogChunkDto;
import com.sailpoint.se.plugin.vscode.dto.LogFileDto;
import com.sailpoint.se.plugin.vscode.dto.ObjectDetailDto;
import com.sailpoint.se.plugin.vscode.dto.ObjectSummaryDto;
import com.sailpoint.se.plugin.vscode.dto.SystemInfoDto;
import com.sailpoint.se.plugin.vscode.dto.TaskStatusDto;

import lombok.extern.log4j.Log4j2;
import sailpoint.Version;
import sailpoint.api.Matchmaker;
import sailpoint.api.ObjectUtil;
import sailpoint.api.TaskManager;
import sailpoint.api.Terminator;
import sailpoint.connector.Connector;
import sailpoint.connector.ConnectorException;
import sailpoint.connector.ConnectorFactory;
import sailpoint.object.Application;
import sailpoint.object.Attributes;
import sailpoint.object.AuditEvent;
import sailpoint.object.BaseAttributeDefinition;
import sailpoint.object.Bundle;
import sailpoint.object.Capability;
import sailpoint.object.ClassLists;
import sailpoint.object.DynamicScope;
import sailpoint.object.Filter;
import sailpoint.object.Identity;
import sailpoint.object.IdentitySelector;
import sailpoint.object.IdentityEntitlement;
import sailpoint.object.Link;
import sailpoint.object.ManagedAttribute;
import sailpoint.object.ObjectAttribute;
import sailpoint.object.ObjectConfig;
import sailpoint.object.Plugin;
import sailpoint.object.QueryOptions;
import sailpoint.object.QuickLink;
import sailpoint.object.QuickLinkOptions;
import sailpoint.object.RoleAssignment;
import sailpoint.object.RoleDetection;
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

    /**
     * Header carrying the real name of the Log4j2 configuration file on the
     * HEAD response: the extension needs it before fetching the body to
     * name the editor tab (log4j2.properties, log4j2.xml...).
     */
    static final String FILE_NAME_HEADER = "X-IIQ-File-Name";

    /**
     * Conventional Log4j2 configuration file names, tried under
     * {@code WEB-INF/classes} when the live configuration does not expose
     * the file it was loaded from.
     */
    private static final List<String> LOG4J_CONFIG_FILE_NAMES = Collections.unmodifiableList(Arrays.asList(
            "log4j2.properties", "log4j2.xml", "log4j2.yaml", "log4j2.yml", "log4j2.json", "log4j.properties"));

    /** Refreshable sections of the Identity View cube, in tab order */
    private static final List<String> IDENTITY_SECTIONS = Collections.unmodifiableList(Arrays.asList(
            "attributes", "accounts", "roles", "entitlements", "capabilities", "workgroups",
            "quicklinks"));

    /**
     * Identity attributes never exposed by the Attributes tab.
     * Credentials and authentication material have no place in a read-only
     * debugging view. Standard fields already rendered in the header
     * (manager, last refresh, last login, …) or as their own tab (assigned
     * and detected roles, capabilities, workgroups) are dropped so they are
     * not shown twice as opaque strings. Attributes declared {@code secret}
     * in the ObjectConfig are dropped too.
     */
    private static final Set<String> HIDDEN_IDENTITY_ATTRIBUTES = Collections.unmodifiableSet(new HashSet<>(
            Arrays.asList(
                    "password", "passwordHistory", "AuthenticationAnswers", "VerificationToken",
                    "name", "displayName", "email", "type", "inactive", "correlated", "protected",
                    "manager", "lastRefresh", "lastLogin",
                    "assignedRoles", "detectedRoles", "bundles", "bundleSummary",
                    "capabilities", "rights", "workgroups", "workgroup")));

    /**
     * Account attributes never exposed by an account detail: an aggregated
     * credential is the one thing a read-only debugging view must not echo,
     * encrypted or not. Attributes declared {@code secret} in the Link
     * ObjectConfig are dropped too.
     */
    private static final Set<String> HIDDEN_ACCOUNT_ATTRIBUTES = Collections.unmodifiableSet(new HashSet<>(
            Arrays.asList("password", "passwordHistory")));

    /**
     * {@code IdentityEntitlement} rows that are IIQ roles, not application
     * entitlements. The same table stores both; they already have their own
     * Roles tab and must not reappear under Entitlements.
     */
    private static final List<String> IDENTITY_ROLE_ENTITLEMENT_NAMES = Collections.unmodifiableList(
            Arrays.asList("assignedRoles", "detectedRoles", "bundles"));

    /** Displayed types of a cube attribute, as the webview expects them */
    private static final String ATTRIBUTE_TYPE_STRING = "string";
    private static final String ATTRIBUTE_TYPE_BOOLEAN = "boolean";
    private static final String ATTRIBUTE_TYPE_DATE = "date";
    private static final String ATTRIBUTE_TYPE_IDENTITY = "identity";

    /**
     * Entitlements returned by one cube. An identity with more is pathological
     * (and unreadable in the webview anyway); the cap keeps a bad data set
     * from turning a single request into a multi-megabyte response.
     */
    private static final int IDENTITY_ENTITLEMENT_LIMIT = 2000;

    /** Values per IN clause of the bulk lookups behind a cube section */
    private static final int QUERY_CHUNK_SIZE = 500;

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
     * Object types supported by the generic interface, including the virtual
     * {@code Workgroup} alias (Identity with {@code workgroup=true}).
     */
    @GET
    @Path("system/classes")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> classes() {
        LOG.debug("classes()");
        List<String> names = new ArrayList<>(MAJOR_CLASSES.keySet());
        if (!names.contains("Workgroup")) {
            names.add("Workgroup");
            Collections.sort(names);
        }
        return ok(names);
    }

    ////////////////////////////////////////////////////////////////////////
    // 1b. Log4j2 configuration file
    ////////////////////////////////////////////////////////////////////////

    /**
     * Contents of the file backing the live Log4j2 configuration (usually
     * {@code WEB-INF/classes/log4j2.properties}). Used by the extension's
     * virtual file system to open it like an object XML. The envelope also
     * carries the real file name and path: the configuration may be an XML
     * or YAML file, and the extension labels the editor tab with it.
     */
    @GET
    @Path("system/log4j")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> getLog4jConfig() {
        LOG.debug("getLog4jConfig()");
        File file = resolveLog4jConfigFile();
        try {
            Map<String, Object> response = ok(readTextFile(file));
            response.put("fileName", file.getName());
            response.put("path", file.getAbsolutePath());
            return response;
        } catch (IOException e) {
            LOG.error("Could not read the Log4j2 configuration {}", file, e);
            throw error(Response.Status.INTERNAL_SERVER_ERROR,
                    "Could not read " + file.getAbsolutePath() + ": " + e.getMessage());
        }
    }

    /**
     * Metadata of the Log4j2 configuration file (name, size, last modified,
     * etag) for the virtual file system's {@code stat()} without
     * transferring the body.
     */
    @HEAD
    @Path("system/log4j")
    @RequiredRight(ACCESS_RIGHT)
    public Response headLog4jConfig() {
        LOG.debug("headLog4jConfig()");
        File file = resolveLog4jConfigFile();
        try {
            byte[] bytes = Files.readAllBytes(file.toPath());
            Response.ResponseBuilder builder = Response.ok()
                    .header("Content-Length", bytes.length)
                    .header(FILE_NAME_HEADER, file.getName())
                    .tag(new EntityTag(sha256(bytes)));
            long modified = file.lastModified();
            if (modified > 0) {
                builder.lastModified(new Date(modified));
            }
            return builder.build();
        } catch (IOException e) {
            LOG.error("Could not stat the Log4j2 configuration {}", file, e);
            throw error(Response.Status.INTERNAL_SERVER_ERROR,
                    "Could not read " + file.getAbsolutePath() + ": " + e.getMessage());
        }
    }

    /**
     * Writes the Log4j2 configuration file and reconfigures the live
     * logger context from it, so the new levels and appenders apply
     * immediately. A configuration Log4j2 refuses to load would leave the
     * server with its fallback console-only configuration: in that case the
     * previous content is restored, reapplied, and the request fails.
     */
    @PUT
    @Path("system/log4j")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> putLog4jConfig(Map<String, Object> body) {
        String content = contentFromBody(body);
        File file = resolveLog4jConfigFile();
        LOG.info("putLog4jConfig({} bytes) to {}", content.length(), file.getAbsolutePath());
        try {
            String previous = readTextFile(file);
            writeTextFile(file, content);
            if (!reconfigureLog4j(file)) {
                writeTextFile(file, previous);
                reconfigureLog4j(file);
                throw error(Response.Status.BAD_REQUEST,
                        "Log4j2 rejected the configuration; the previous " + file.getName() + " was restored");
            }
            audit("updateLog4jConfig", file.getAbsolutePath());
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("path", file.getAbsolutePath());
            result.put("fileName", file.getName());
            result.put("size", file.length());
            result.put("reloaded", true);
            return ok(result);
        } catch (WebApplicationException e) {
            throw e;
        } catch (IOException e) {
            LOG.error("Could not write the Log4j2 configuration {}", file, e);
            throw error(Response.Status.INTERNAL_SERVER_ERROR,
                    "Could not write " + file.getAbsolutePath() + ": " + e.getMessage());
        }
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
        if ("Workgroup".equals(type)) {
            // Workgroups are Identity objects with workgroup=true.
            Filter filter = Filter.eq("workgroup", true);
            countOptions.addFilter(filter);
            queryOptions.addFilter(filter);
        } else if (Identity.class.equals(clazz)) {
            // Keep regular identities and workgroups in separate lists.
            Filter filter = Filter.eq("workgroup", false);
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
    // 9. Identity View
    ////////////////////////////////////////////////////////////////////////

    /**
     * Read-only identity cube backing the Identity webview (payload and UI
     * behaviour specified in docs/identity-webview.md). Without
     * {@code section} every section is populated; with it only that one is,
     * which is all a tab refresh consumes. The Identity XML is never part of
     * the payload: the webview fetches it separately, on demand.
     */
    @GET
    @Path("identities/{nameOrId}/view")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> identityView(@PathParam("nameOrId") String nameOrId,
                                            @QueryParam("section") String section) throws GeneralException {
        LOG.debug("identityView(nameOrId={}, section={})", nameOrId, section);
        if (Util.isNotNullOrEmpty(section) && !IDENTITY_SECTIONS.contains(section)) {
            throw error(Response.Status.BAD_REQUEST, "Unknown section \"" + section
                    + "\": expected one of " + String.join(", ", IDENTITY_SECTIONS));
        }
        Identity identity = find(Identity.class, nameOrId);
        if (identity == null) {
            throw error(Response.Status.NOT_FOUND, "Identity \"" + nameOrId + "\" not found");
        }
        return ok(buildIdentityView(identity, Util.isNullOrEmpty(section) ? null : section));
    }

    /**
     * Summary of the object behind an Identity View detail drawer. Only the
     * three types the drawer can open are supported; everything else is 404,
     * so an unexpected type never turns into a full object load.
     */
    @GET
    @Path("objects/{type}/{nameOrId}/summary")
    @RequiredRight(ACCESS_RIGHT)
    public Map<String, Object> summary(@PathParam("type") String type,
                                       @PathParam("nameOrId") String nameOrId) throws GeneralException {
        LOG.debug("summary(type={}, nameOrId={})", type, nameOrId);
        if ("Bundle".equals(type)) {
            return ok(bundleSummary(nameOrId));
        }
        if ("ManagedAttribute".equals(type)) {
            return ok(managedAttributeSummary(nameOrId));
        }
        if ("Link".equals(type)) {
            return ok(linkSummary(nameOrId));
        }
        throw error(Response.Status.NOT_FOUND, "Summaries are not supported for " + type);
    }

    private ObjectDetailDto bundleSummary(String nameOrId) throws GeneralException {
        Bundle role = find(Bundle.class, nameOrId);
        if (role == null) {
            throw error(Response.Status.NOT_FOUND, "Bundle \"" + nameOrId + "\" not found");
        }
        return ObjectDetailDto.builder()
                .id(role.getId())
                .name(role.getName())
                .displayName(role.getDisplayableName())
                .type(role.getType())
                .owner(reference(role.getOwner()))
                .description(role.getDescription())
                .disabled(role.isDisabled())
                .classifications(role.getClassificationDisplayNames())
                .build();
    }

    private ObjectDetailDto managedAttributeSummary(String nameOrId) throws GeneralException {
        ManagedAttribute entitlement = findManagedAttribute(nameOrId);
        if (entitlement == null) {
            throw error(Response.Status.NOT_FOUND, "ManagedAttribute \"" + nameOrId + "\" not found");
        }
        Application application = entitlement.getApplication();
        return ObjectDetailDto.builder()
                .id(entitlement.getId())
                .name(entitlement.getDisplayableName())
                .displayName(entitlement.getDisplayName())
                .type(entitlement.getType())
                .owner(reference(entitlement.getOwner()))
                .description(entitlement.getDescription(getLocale()))
                .application(application != null ? application.getName() : null)
                .value(entitlement.getValue())
                .classifications(entitlement.getClassificationDisplayNames())
                .build();
    }

    /**
     * Detail of one account, attributes included. A Link carries no name: it
     * is resolved by id only, which is what the accounts section of the cube
     * hands the drawer.
     */
    private ObjectDetailDto linkSummary(String id) throws GeneralException {
        Link link = getContext().getObjectById(Link.class, id);
        if (link == null) {
            throw error(Response.Status.NOT_FOUND, "Link \"" + id + "\" not found");
        }
        return ObjectDetailDto.builder()
                .id(link.getId())
                .name(link.getNativeIdentity())
                .displayName(link.getDisplayName())
                .application(link.getApplicationName())
                .instance(link.getInstance())
                .disabled(link.isDisabled())
                .locked(link.isLocked())
                .manuallyCorrelated(link.isManuallyCorrelated())
                .lastRefresh(iso(link.getLastRefresh()))
                .attributes(linkAttributes(link))
                .build();
    }

    /**
     * Account attributes, in the same flat shape as the identity attributes:
     * the Link ObjectConfig definitions first, for their labels and declared
     * types, then everything else the connector aggregated — those undeclared
     * values are most of an account.
     */
    private List<IdentityAttributeDto> linkAttributes(Link link) throws GeneralException {
        List<IdentityAttributeDto> attributes = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        ObjectConfig config = Link.getObjectConfig();
        if (config != null) {
            for (ObjectAttribute definition : Util.safeIterable(config.getObjectAttributes())) {
                String name = definition.getName();
                if (isHiddenAccountAttribute(name) || !seen.add(name)
                        || BaseAttributeDefinition.TYPE_SECRET.equals(definition.getType())) {
                    continue;
                }
                Object value = link.getAttribute(name);
                // One Link ObjectConfig serves every application: a
                // definition this account has no value for belongs to
                // another schema, and is noise in its detail.
                if (value != null) {
                    attributes.add(attribute(name, definition.getDisplayableName(),
                            definition.getType(), value));
                }
            }
        }
        Attributes<String, Object> values = link.getAttributes();
        if (values != null) {
            for (String name : new TreeSet<>(values.keySet())) {
                if (isHiddenAccountAttribute(name) || !seen.add(name)) {
                    continue;
                }
                attributes.add(attribute(name, null, null, values.get(name)));
            }
        }
        return attributes;
    }

    private static boolean isHiddenAccountAttribute(String name) {
        return name == null || HIDDEN_ACCOUNT_ATTRIBUTES.contains(name);
    }

    /**
     * Resolves a ManagedAttribute by id, then by name, then by raw value.
     * The value is the last resort because it is only unique per application:
     * the webview sends it when the entitlement carried no ManagedAttribute
     * id, and the first match is the best answer available then.
     */
    private ManagedAttribute findManagedAttribute(String nameOrId) throws GeneralException {
        ManagedAttribute entitlement = find(ManagedAttribute.class, nameOrId);
        if (entitlement != null) {
            return entitlement;
        }
        QueryOptions options = new QueryOptions();
        options.addFilter(Filter.eq("value", nameOrId));
        options.setResultLimit(1);
        List<ManagedAttribute> found = getContext().getObjects(ManagedAttribute.class, options);
        return Util.isEmpty(found) ? null : found.get(0);
    }

    /** Assembles the cube; {@code section} null means "every section" */
    private IdentityViewDto buildIdentityView(Identity identity, String section) throws GeneralException {
        return IdentityViewDto.builder()
                .id(identity.getId())
                .name(identity.getName())
                .displayName(identity.getDisplayableName())
                .email(identity.getEmail())
                .type(identity.getType())
                .inactive(identity.isInactive())
                .correlated(identity.isCorrelated())
                .isProtected(identity.isProtected())
                .manager(reference(identity.getManager()))
                .lastRefresh(iso(identity.getLastRefresh()))
                .lastLogin(iso(identity.getLastLogin()))
                .attributes(wants(section, "attributes")
                        ? identityAttributes(identity) : Collections.emptyList())
                .accounts(wants(section, "accounts")
                        ? identityAccounts(identity) : Collections.emptyList())
                .roles(wants(section, "roles")
                        ? identityRoles(identity) : Collections.emptyList())
                .entitlements(wants(section, "entitlements")
                        ? identityEntitlements(identity) : Collections.emptyList())
                .capabilities(wants(section, "capabilities")
                        ? identityCapabilities(identity) : Collections.emptyList())
                .workgroups(wants(section, "workgroups")
                        ? identityWorkgroups(identity) : Collections.emptyList())
                .quicklinks(wants(section, "quicklinks")
                        ? identityQuickLinks(identity) : Collections.emptyList())
                .build();
    }

    private static boolean wants(String section, String name) {
        return section == null || section.equals(name);
    }

    /**
     * Flat attribute list: the ObjectConfig definitions first, in their
     * configured order, then the values the identity carries without a
     * definition (set by a rule, left over from an older ObjectConfig) —
     * dropping them would hide exactly the anomalies this view exists for.
     */
    private List<IdentityAttributeDto> identityAttributes(Identity identity) throws GeneralException {
        List<IdentityAttributeDto> attributes = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        ObjectConfig config = Identity.getObjectConfig();
        if (config != null) {
            for (ObjectAttribute definition : Util.safeIterable(config.getObjectAttributes())) {
                String name = definition.getName();
                // A secret is marked seen before it is dropped: the raw pass
                // below would otherwise hand out its encrypted value.
                if (isHiddenAttribute(name) || !seen.add(name)
                        || BaseAttributeDefinition.TYPE_SECRET.equals(definition.getType())) {
                    continue;
                }
                attributes.add(attribute(name, definition.getDisplayableName(),
                        definition.getType(), identity.getAttribute(name)));
            }
        }
        Attributes<String, Object> values = identity.getAttributes();
        if (values != null) {
            for (String name : new TreeSet<>(values.keySet())) {
                if (isHiddenAttribute(name) || !seen.add(name)) {
                    continue;
                }
                attributes.add(attribute(name, null, null, identity.getAttribute(name)));
            }
        }
        return attributes;
    }

    private static boolean isHiddenAttribute(String name) {
        return name == null || HIDDEN_IDENTITY_ATTRIBUTES.contains(name);
    }

    /**
     * One attribute of the cube, of an identity or of an account.
     * {@code declaredType} is the ObjectConfig type, null when the attribute
     * has no definition: the type is then inferred from the value.
     */
    private IdentityAttributeDto attribute(String name, String label,
                                           String declaredType, Object value) throws GeneralException {
        String type = attributeType(declaredType, value);
        IdentityAttributeDto.IdentityAttributeDtoBuilder attribute = IdentityAttributeDto.builder()
                .name(name)
                .label(label)
                .type(type);
        if (ATTRIBUTE_TYPE_IDENTITY.equals(type)) {
            IdentityReferenceDto target = identityReference(value);
            return attribute
                    .value(target != null ? target.getName() : stringValue(value))
                    .identity(target)
                    .build();
        }
        if (ATTRIBUTE_TYPE_BOOLEAN.equals(type)) {
            return attribute.value(value == null ? null : Util.otob(value)).build();
        }
        if (ATTRIBUTE_TYPE_DATE.equals(type)) {
            // Extended date attributes are stored as epoch millis, not as a Date
            return attribute.value(iso(Util.getDate(value))).build();
        }
        return attribute.value(stringValue(value)).build();
    }

    /** Maps an ObjectConfig type to one of the four types the webview renders */
    private static String attributeType(String declaredType, Object value) {
        if (declaredType != null) {
            if (BaseAttributeDefinition.TYPE_IDENTITY.equals(declaredType)) {
                return ATTRIBUTE_TYPE_IDENTITY;
            }
            if (BaseAttributeDefinition.TYPE_BOOLEAN.equals(declaredType)) {
                return ATTRIBUTE_TYPE_BOOLEAN;
            }
            if (BaseAttributeDefinition.TYPE_DATE.equals(declaredType)) {
                return ATTRIBUTE_TYPE_DATE;
            }
            return ATTRIBUTE_TYPE_STRING;
        }
        if (value instanceof Boolean) {
            return ATTRIBUTE_TYPE_BOOLEAN;
        }
        if (value instanceof Date) {
            return ATTRIBUTE_TYPE_DATE;
        }
        if (value instanceof Identity) {
            return ATTRIBUTE_TYPE_IDENTITY;
        }
        return ATTRIBUTE_TYPE_STRING;
    }

    /** Resolves an identity-typed attribute value, held either as an object or as a name */
    private IdentityReferenceDto identityReference(Object value) throws GeneralException {
        if (value instanceof Identity) {
            return reference((Identity) value);
        }
        if (value instanceof String && Util.isNotNullOrEmpty((String) value)) {
            return reference(find(Identity.class, (String) value));
        }
        return null;
    }

    private static IdentityReferenceDto reference(Identity identity) {
        return identity == null ? null : IdentityReferenceDto.builder()
                .id(identity.getId())
                .name(identity.getName())
                .displayName(identity.getDisplayableName())
                .build();
    }

    /** Renders an attribute value as the string the webview displays */
    private static String stringValue(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Date) {
            return iso((Date) value);
        }
        if (value instanceof SailPointObject) {
            return ((SailPointObject) value).getName();
        }
        if (value instanceof Collection) {
            List<String> parts = new ArrayList<>();
            for (Object element : (Collection<?>) value) {
                parts.add(String.valueOf(stringValue(element)));
            }
            return String.join(", ", parts);
        }
        return String.valueOf(value);
    }

    private List<IdentityAccountDto> identityAccounts(Identity identity) {
        List<IdentityAccountDto> accounts = new ArrayList<>();
        for (Link link : Util.safeIterable(identity.getLinks())) {
            accounts.add(IdentityAccountDto.builder()
                    .id(link.getId())
                    .application(link.getApplicationName())
                    .nativeIdentity(link.getNativeIdentity())
                    .disabled(link.isDisabled())
                    .build());
        }
        return accounts;
    }

    /**
     * One row per role, merging the four views IdentityIQ keeps of them:
     * the assigned and detected Bundle lists, the RoleAssignments (which
     * carry the provenance, and the negative assignments the stock UI hides)
     * and the RoleDetections.
     */
    private List<IdentityRoleDto> identityRoles(Identity identity) throws GeneralException {
        Map<String, RoleRow> rows = new TreeMap<>();
        for (Bundle role : Util.safeIterable(identity.getAssignedRoles())) {
            RoleRow row = roleRow(rows, role.getName());
            if (row != null) {
                row.id = role.getId();
                row.type = role.getType();
                row.assigned = true;
            }
        }
        for (Bundle role : Util.safeIterable(identity.getDetectedRoles())) {
            RoleRow row = roleRow(rows, role.getName());
            if (row != null) {
                row.id = role.getId();
                row.type = role.getType();
                row.detected = true;
            }
        }
        Map<String, String> rolesByAssignmentId = new HashMap<>();
        Set<RoleAssignment> visitedAssignments =
                Collections.newSetFromMap(new IdentityHashMap<RoleAssignment, Boolean>());
        for (RoleAssignment assignment : Util.safeIterable(identity.getRoleAssignments())) {
            collectRoleAssignment(assignment, null, true, rows, rolesByAssignmentId, visitedAssignments);
        }
        for (RoleDetection detection : Util.safeIterable(identity.getRoleDetections())) {
            RoleRow row = roleRow(rows, detection.getRoleName());
            if (row != null) {
                if (row.id == null) {
                    row.id = detection.getRoleId();
                }
                row.detected = true;
                for (String assignmentId : Util.safeIterable(detection.getAssignmentIdList())) {
                    String parentRoleName = rolesByAssignmentId.get(assignmentId);
                    if (parentRoleName != null && !parentRoleName.equals(row.name)) {
                        row.parentRoleNames.add(parentRoleName);
                    }
                }
            }
        }

        fillRoleDetails(rows);

        List<IdentityRoleDto> roles = new ArrayList<>();
        for (RoleRow row : rows.values()) {
            roles.add(IdentityRoleDto.builder()
                    .id(row.id)
                    .name(row.name)
                    .type(row.type)
                    .assigned(row.assigned)
                    .detected(row.detected)
                    .negative(row.negative)
                    .source(row.source)
                    .assignmentId(row.assignmentId)
                    .assigner(row.assigner)
                    .parentRoleNames(new ArrayList<>(row.parentRoleNames))
                    .classifications(row.classifications)
                    .build());
        }
        return roles;
    }

    /**
     * Type, id and classifications of every named role. Assigned and detected
     * Bundles already carry type and id; a negative assignment, or a
     * detection of a role the identity no longer holds, does not. Classifications
     * always come from the Bundle. Loaded in chunks, then decached.
     */
    private void fillRoleDetails(Map<String, RoleRow> rows) throws GeneralException {
        List<String> names = new ArrayList<>(rows.keySet());
        for (int from = 0; from < names.size(); from += QUERY_CHUNK_SIZE) {
            List<String> chunk = names.subList(from, Math.min(names.size(), from + QUERY_CHUNK_SIZE));
            QueryOptions options = new QueryOptions();
            options.addFilter(Filter.in("name", chunk));
            Iterator<Bundle> found = getContext().search(Bundle.class, options);
            while (found.hasNext()) {
                Bundle role = found.next();
                RoleRow target = rows.get(role.getName());
                if (target != null) {
                    if (target.id == null) {
                        target.id = role.getId();
                    }
                    if (target.type == null) {
                        target.type = role.getType();
                    }
                    target.classifications = listOrEmpty(role.getClassificationDisplayNames());
                }
                getContext().decache(role);
            }
        }
    }

    /**
     * Collects direct and permitted RoleAssignments. Permitted assignments
     * carry the concrete parent/child relation; RoleDetection assignment ids
     * are resolved against the same index below.
     */
    private static void collectRoleAssignment(RoleAssignment assignment,
                                              String parentRoleName,
                                              boolean direct,
                                              Map<String, RoleRow> rows,
                                              Map<String, String> rolesByAssignmentId,
                                              Set<RoleAssignment> visited) {
        if (assignment == null || !visited.add(assignment)) {
            return;
        }
        RoleRow row = roleRow(rows, assignment.getRoleName());
        if (row == null) {
            return;
        }
        if (row.id == null) {
            row.id = assignment.getRoleId();
        }
        if (assignment.isNegative()) {
            row.negative = true;
        } else if (direct) {
            row.assigned = true;
        }
        if (parentRoleName != null && !parentRoleName.equals(row.name)) {
            row.parentRoleNames.add(parentRoleName);
        }
        if (Util.isNotNullOrEmpty(assignment.getAssignmentId())) {
            rolesByAssignmentId.put(assignment.getAssignmentId(), row.name);
        }
        // A role can be assigned several times (allowMultipleAssignments):
        // the row keeps the provenance of the first one.
        if (row.source == null) {
            row.source = assignment.getSource();
            row.assignmentId = assignment.getAssignmentId();
            row.assigner = assignment.getAssigner();
        }
        for (RoleAssignment permitted : Util.safeIterable(assignment.getPermittedRoleAssignments())) {
            collectRoleAssignment(permitted, row.name, false, rows, rolesByAssignmentId, visited);
        }
    }

    /** The row of a role, created on first mention; null for an unnamed role */
    private static RoleRow roleRow(Map<String, RoleRow> rows, String name) {
        if (Util.isNullOrEmpty(name)) {
            return null;
        }
        RoleRow row = rows.get(name);
        if (row == null) {
            row = new RoleRow(name);
            rows.put(name, row);
        }
        return row;
    }

    /** Mutable accumulator merging the assignment and detection views of a role */
    private static final class RoleRow {
        private final String name;
        private String id;
        private String type;
        private boolean assigned;
        private boolean detected;
        private boolean negative;
        private String source;
        private String assignmentId;
        private String assigner;
        private final Set<String> parentRoleNames = new TreeSet<>();
        private List<String> classifications = Collections.emptyList();

        private RoleRow(String name) {
            this.name = name;
        }
    }

    /**
     * Entitlements of the identity, from a projection search: an identity can
     * carry thousands of them and none is ever needed as a full object.
     * Assigned and detected roles share this table in IIQ and are dropped:
     * they already appear on the Roles tab.
     */
    private List<IdentityEntitlementDto> identityEntitlements(Identity identity) throws GeneralException {
        QueryOptions options = new QueryOptions();
        options.addFilter(Filter.eq("identity.id", identity.getId()));
        options.addFilter(Filter.not(Filter.in("name", IDENTITY_ROLE_ENTITLEMENT_NAMES)));
        options.addOrdering("application.name", true);
        options.addOrdering("name", true);
        options.addOrdering("value", true);
        options.setResultLimit(IDENTITY_ENTITLEMENT_LIMIT);

        List<Object[]> rows = new ArrayList<>();
        Iterator<Object[]> found = getContext().search(IdentityEntitlement.class, options,
                Arrays.asList("id", "application.name", "type", "name", "value", "attributes",
                        "nativeIdentity"));
        while (found.hasNext()) {
            Object[] row = found.next();
            if (!isRoleEntitlement((String) row[3])) {
                rows.add(row);
            }
        }

        ManagedAttributeLookup managedAttributes = managedAttributes(rows);
        List<IdentityEntitlementDto> entitlements = new ArrayList<>();
        for (Object[] row : rows) {
            String application = (String) row[1];
            String name = (String) row[3];
            String value = (String) row[4];
            String managedAttributeId = managedAttributes.idsByKey.get(
                    managedAttributeKey(application, name, value));
            entitlements.add(IdentityEntitlementDto.builder()
                    .id((String) row[0])
                    .application(application)
                    .nativeIdentity((String) row[6])
                    .type(row[2] == null ? null : String.valueOf(row[2]))
                    .name(name)
                    .value(value)
                    .grantedByRole(grantingRoles(row[5]))
                    .managedAttributeId(managedAttributeId)
                    .classifications(managedAttributeId == null
                            ? Collections.emptyList()
                            : managedAttributes.classificationsById.getOrDefault(
                                    managedAttributeId, Collections.emptyList()))
                    .build());
        }
        return entitlements;
    }

    private static boolean isRoleEntitlement(String name) {
        return name != null && IDENTITY_ROLE_ENTITLEMENT_NAMES.contains(name);
    }

    /**
     * Roles granting an entitlement. They are not Hibernate properties: IIQ
     * stores them in the attributes map of the IdentityEntitlement, assignable
     * roles first since a detected role is often just their side effect.
     */
    @SuppressWarnings("unchecked")
    private static String grantingRoles(Object attributes) {
        if (!(attributes instanceof Attributes)) {
            return null;
        }
        Attributes<String, Object> values = (Attributes<String, Object>) attributes;
        String assignable = values.getString(IdentityEntitlement.SOURCE_ASSIGNABLE);
        return Util.isNotNullOrEmpty(assignable)
                ? assignable
                : values.getString(IdentityEntitlement.SOURCE_DETECTED);
    }

    /**
     * Ids and classifications of the ManagedAttributes describing the
     * entitlement values, keyed by application + attribute + value. Resolved
     * in bulk — one chunked query per application — rather than one lookup
     * per entitlement. Classifications need the object, so the hits are
     * decached after the display names are read.
     */
    private ManagedAttributeLookup managedAttributes(List<Object[]> rows) throws GeneralException {
        Map<String, Set<String>> valuesByApplication = new LinkedHashMap<>();
        for (Object[] row : rows) {
            String application = (String) row[1];
            String value = (String) row[4];
            if (application == null || value == null) {
                continue;
            }
            Set<String> values = valuesByApplication.get(application);
            if (values == null) {
                values = new TreeSet<>();
                valuesByApplication.put(application, values);
            }
            values.add(value);
        }

        ManagedAttributeLookup lookup = new ManagedAttributeLookup();
        for (Map.Entry<String, Set<String>> entry : valuesByApplication.entrySet()) {
            List<String> values = new ArrayList<>(entry.getValue());
            for (int from = 0; from < values.size(); from += QUERY_CHUNK_SIZE) {
                List<String> chunk = values.subList(from,
                        Math.min(values.size(), from + QUERY_CHUNK_SIZE));
                QueryOptions options = new QueryOptions();
                options.addFilter(Filter.eq("application.name", entry.getKey()));
                options.addFilter(Filter.in("value", chunk));
                Iterator<ManagedAttribute> found = getContext().search(ManagedAttribute.class, options);
                while (found.hasNext()) {
                    ManagedAttribute entitlement = found.next();
                    lookup.idsByKey.put(
                            managedAttributeKey(entry.getKey(), entitlement.getAttribute(),
                                    entitlement.getValue()),
                            entitlement.getId());
                    lookup.classificationsById.put(entitlement.getId(),
                            listOrEmpty(entitlement.getClassificationDisplayNames()));
                    getContext().decache(entitlement);
                }
            }
        }
        return lookup;
    }

    private static List<String> listOrEmpty(List<String> values) {
        return values == null || values.isEmpty()
                ? Collections.emptyList()
                : new ArrayList<>(values);
    }

    /** Bulk lookup of ManagedAttribute ids and classification display names */
    private static final class ManagedAttributeLookup {
        private final Map<String, String> idsByKey = new HashMap<>();
        private final Map<String, List<String>> classificationsById = new HashMap<>();
    }

    private static String managedAttributeKey(String application, String attribute, String value) {
        return application + "|" + attribute + "|" + value;
    }

    /**
     * Effective capabilities, each flagged direct or inherited. An inherited
     * capability names the workgroups granting it, which is the only way to
     * tell where an unexpected right comes from.
     */
    private List<IdentityCapabilityDto> identityCapabilities(Identity identity) {
        Set<String> direct = new HashSet<>();
        for (Capability capability : Util.safeIterable(identity.getCapabilities())) {
            direct.add(capability.getName());
        }
        Map<String, List<String>> grantingWorkgroups = new HashMap<>();
        for (Identity workgroup : Util.safeIterable(identity.getWorkgroups())) {
            for (Capability capability : Util.safeIterable(workgroup.getCapabilities())) {
                List<String> workgroups = grantingWorkgroups.get(capability.getName());
                if (workgroups == null) {
                    workgroups = new ArrayList<>();
                    grantingWorkgroups.put(capability.getName(), workgroups);
                }
                workgroups.add(workgroup.getName());
            }
        }

        List<IdentityCapabilityDto> capabilities = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Capability capability : Util.safeIterable(identity.getEffectiveCapabilities())) {
            String name = capability.getName();
            if (!seen.add(name)) {
                continue;
            }
            boolean inherited = !direct.contains(name);
            List<String> workgroups = inherited ? grantingWorkgroups.get(name) : null;
            capabilities.add(IdentityCapabilityDto.builder()
                    .name(name)
                    .inherited(inherited)
                    .workgroups(workgroups != null ? workgroups : Collections.emptyList())
                    .build());
        }
        return capabilities;
    }

    private List<IdentityWorkgroupDto> identityWorkgroups(Identity identity) {
        List<IdentityWorkgroupDto> workgroups = new ArrayList<>();
        for (Identity workgroup : Util.safeIterable(identity.getWorkgroups())) {
            List<String> capabilities = new ArrayList<>();
            for (Capability capability : Util.safeIterable(workgroup.getCapabilities())) {
                capabilities.add(capability.getName());
            }
            workgroups.add(IdentityWorkgroupDto.builder()
                    .id(workgroup.getId())
                    .name(workgroup.getName())
                    .displayName(workgroup.getDisplayableName())
                    .description(workgroup.getDescription())
                    .capabilities(capabilities)
                    .build());
        }
        return workgroups;
    }

    /**
     * QuickLinks whose attached DynamicScope (population) matches this
     * identity. A QuickLink with several options appears once, listing only
     * the populations that matched. A population without a selector is
     * treated as everyone (the stock "Everyone" scope).
     */
    private List<IdentityQuickLinkDto> identityQuickLinks(Identity identity) throws GeneralException {
        Matchmaker matcher = new Matchmaker(getContext());
        matcher.setArgument(Matchmaker.ARG_IDENTITY, identity);

        QueryOptions options = new QueryOptions();
        options.addOrdering("name", true);
        List<IdentityQuickLinkDto> quickLinks = new ArrayList<>();
        Iterator<QuickLink> found = getContext().search(QuickLink.class, options);
        try {
            while (found.hasNext()) {
                QuickLink quickLink = found.next();
                List<IdentityPopulationDto> populations = matchingPopulations(identity, quickLink, matcher);
                if (populations.isEmpty()) {
                    continue;
                }
                quickLinks.add(IdentityQuickLinkDto.builder()
                        .id(quickLink.getId())
                        .name(quickLink.getName())
                        .category(quickLink.getCategory())
                        .action(quickLink.getAction())
                        .disabled(quickLink.isDisabled())
                        .populations(populations)
                        .build());
            }
        } finally {
            Util.flushIterator(found);
        }
        return quickLinks;
    }

    private List<IdentityPopulationDto> matchingPopulations(Identity identity, QuickLink quickLink,
                                                            Matchmaker matcher) {
        Map<String, IdentityPopulationDto> matched = new LinkedHashMap<>();
        for (QuickLinkOptions option : Util.safeIterable(quickLink.getQuickLinkOptions())) {
            DynamicScope scope = option.getDynamicScope();
            if (scope == null || matched.containsKey(scope.getId() != null ? scope.getId() : scope.getName())) {
                continue;
            }
            if (!matchesPopulation(identity, scope, matcher)) {
                continue;
            }
            String key = scope.getId() != null ? scope.getId() : scope.getName();
            matched.put(key, IdentityPopulationDto.builder()
                    .id(scope.getId())
                    .name(scope.getName())
                    .description(scope.getDescription())
                    .build());
        }
        return new ArrayList<>(matched.values());
    }

    /**
     * Membership of a QuickLink population. A null selector is everyone;
     * otherwise {@link Matchmaker} evaluates the IdentitySelector (inclusions,
     * exclusions, filter, script, rule). A selector that throws is treated
     * as a miss so one bad population cannot fail the cube.
     */
    private boolean matchesPopulation(Identity identity, DynamicScope scope, Matchmaker matcher) {
        IdentitySelector selector = scope.getSelector();
        if (selector == null) {
            return true;
        }
        try {
            return matcher.isMatch(selector, identity);
        } catch (GeneralException e) {
            LOG.warn("DynamicScope \"{}\" could not be evaluated for identity \"{}\": {}",
                    scope.getName(), identity.getName(), e.getMessage());
            return false;
        }
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
     * Extracts the {@code content} property of a JSON request body (used
     * for the Log4j2 configuration; XML uses {@link #xmlFromBody}).
     */
    private static String contentFromBody(Map<String, Object> body) {
        Object content = body == null ? null : body.get("content");
        if (!(content instanceof String) || Util.isNullOrEmpty((String) content)) {
            throw error(Response.Status.BAD_REQUEST,
                    "The request body must be a JSON object with a non-empty \"content\" string property");
        }
        return (String) content;
    }

    /**
     * File backing the live Log4j2 configuration. Resolved from the
     * configuration source itself, so a relocated file or an XML/YAML
     * configuration is honored; falls back to the conventional names under
     * {@code WEB-INF/classes}. Security invariant: the path always comes
     * from the server's own configuration, never from the request.
     */
    private static File resolveLog4jConfigFile() {
        File file = configurationSourceFile();
        if (file == null) {
            file = conventionalLog4jConfigFile();
        }
        if (file == null) {
            throw error(Response.Status.NOT_FOUND,
                    "The live Log4j2 configuration is not backed by a file on this server");
        }
        if (!file.isFile()) {
            throw error(Response.Status.NOT_FOUND,
                    "The Log4j2 configuration file was not found at " + file.getAbsolutePath());
        }
        return file;
    }

    /** The file of the live {@link ConfigurationSource}, null if it is not file-backed */
    private static File configurationSourceFile() {
        ConfigurationSource source = getLoggerContext().getConfiguration().getConfigurationSource();
        if (source == null) {
            return null;
        }
        if (source.getFile() != null) {
            return source.getFile();
        }
        URL url = source.getURL();
        if (url != null && "file".equalsIgnoreCase(url.getProtocol())) {
            try {
                return new File(url.toURI());
            } catch (URISyntaxException e) {
                LOG.debug("Log4j2 configuration URL {} is not a usable file: {}", url, e.toString());
            }
        }
        return null;
    }

    /** First of the conventional Log4j2 file names present in {@code WEB-INF/classes} */
    private static File conventionalLog4jConfigFile() {
        String home;
        try {
            home = Util.getApplicationHome();
        } catch (GeneralException e) {
            LOG.warn("Could not resolve the IdentityIQ application home", e);
            return null;
        }
        if (Util.isNullOrEmpty(home)) {
            return null;
        }
        File classesDir = new File(new File(home, "WEB-INF"), "classes");
        for (String name : LOG4J_CONFIG_FILE_NAMES) {
            File candidate = new File(classesDir, name);
            if (candidate.isFile()) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * Reconfigures the live logger context from the given file. Returns
     * false when Log4j2 could not build a configuration out of it and fell
     * back to its default console-only configuration.
     */
    private static boolean reconfigureLog4j(File file) {
        LoggerContext context = getLoggerContext();
        context.setConfigLocation(file.toURI());
        return !(context.getConfiguration() instanceof DefaultConfiguration);
    }

    /** Reads the file as UTF-8, falling back to ISO-8859-1 if it is not valid UTF-8. */
    private static String readTextFile(File file) throws IOException {
        byte[] bytes = Files.readAllBytes(file.toPath());
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException e) {
            return new String(bytes, StandardCharsets.ISO_8859_1);
        }
    }

    /** Atomic write of a text file as UTF-8. */
    private static void writeTextFile(File file, String content) throws IOException {
        java.nio.file.Path target = file.toPath();
        java.nio.file.Path tmp = target.resolveSibling(file.getName() + ".tmp");
        Files.write(tmp, content.getBytes(StandardCharsets.UTF_8));
        try {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
        }
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
     * (ClassLists.MajorClasses). {@code Workgroup} is a virtual alias for
     * {@link Identity} (objects with {@code workgroup=true}); anything else
     * unknown is rejected.
     */
    private Class<? extends SailPointObject> resolveClass(String type) {
        if ("Workgroup".equals(type)) {
            return Identity.class;
        }
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
