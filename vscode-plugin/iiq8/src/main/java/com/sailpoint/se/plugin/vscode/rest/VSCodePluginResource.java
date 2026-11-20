package com.sailpoint.se.plugin.vscode.rest;

import java.util.Locale;
import java.util.Map;

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

import com.sailpoint.se.plugin.vscode.service.DevToolsException;
import com.sailpoint.se.plugin.vscode.service.DevToolsService;
import com.sailpoint.se.plugin.vscode.service.HeadResult;
import com.sailpoint.se.plugin.vscode.service.RequestEnvironment;

import sailpoint.api.SailPointContext;
import sailpoint.rest.BaseResource;
import sailpoint.rest.plugin.BasePluginResource;
import sailpoint.rest.plugin.RequiredRight;
import sailpoint.tools.GeneralException;

/**
 * REST resource of the iiq-devtools plugin for IdentityIQ 8.x (Tomcat 9,
 * {@code javax.ws.rs}). Thin wrapper: routing and HTTP concerns only, the
 * logic lives in {@link DevToolsService} (vscode-plugin-core), shared with the
 * IdentityIQ 9 wrapper. Keep both wrappers strictly identical apart from the
 * {@code javax} / {@code jakarta} imports.
 *
 * See docs/plugin-api.md for the contract.
 */
@Path("iiq-devtools")
@Produces(MediaType.APPLICATION_JSON)
public class VSCodePluginResource extends BasePluginResource {

    private DevToolsService service;

    @Override
    public String getPluginName() {
        return DevToolsService.PLUGIN_NAME;
    }

    /** Default constructor. */
    public VSCodePluginResource() {
        super();
    }

    /** Inherited constructor. */
    public VSCodePluginResource(BaseResource parent) {
        super(parent);
    }

    private DevToolsService service() {
        if (service == null) {
            service = new DevToolsService(new RequestEnvironment() {
                @Override
                public SailPointContext getContext() {
                    return VSCodePluginResource.this.getContext();
                }

                @Override
                public String getLoggedInUserName() throws GeneralException {
                    return VSCodePluginResource.this.getLoggedInUserName();
                }

                @Override
                public Locale getLocale() {
                    return VSCodePluginResource.this.getLocale();
                }
            });
        }
        return service;
    }

    ////////////////////////////////////////////////////////////////////////
    // System
    ////////////////////////////////////////////////////////////////////////

    @GET
    @Path("system/ping")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> ping() throws GeneralException {
        return call(() -> service().ping());
    }

    @GET
    @Path("system/classes")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> classes() {
        return call(() -> service().classes());
    }

    @GET
    @Path("system/log4j")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> getLog4jConfig() {
        return call(() -> service().getLog4jConfig());
    }

    @HEAD
    @Path("system/log4j")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Response headLog4jConfig() {
        return call(() -> head(service().headLog4jConfig()));
    }

    @PUT
    @Path("system/log4j")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> putLog4jConfig(Map<String, Object> body) {
        return call(() -> service().putLog4jConfig(body));
    }

    @GET
    @Path("system/object-name/{id}")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> resolveObjectName(@PathParam("id") String id) throws GeneralException {
        return call(() -> service().resolveObjectName(id));
    }

    ////////////////////////////////////////////////////////////////////////
    // Generic object CRUD
    ////////////////////////////////////////////////////////////////////////

    @GET
    @Path("objects/{type}")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> list(@PathParam("type") String type,
                                    @QueryParam("start") @DefaultValue("0") int start,
                                    @QueryParam("limit") @DefaultValue("200") int limit,
                                    @QueryParam("sortBy") @DefaultValue("name") String sortBy,
                                    @QueryParam("sortDir") @DefaultValue("asc") String sortDir,
                                    @QueryParam("query") String query,
                                    @QueryParam("excludeTypes") String excludeTypes,
                                    @QueryParam("includeTemplates") @DefaultValue("false") boolean includeTemplates)
            throws GeneralException {
        return call(() -> service().list(type, start, limit, sortBy, sortDir, query, excludeTypes,
                includeTemplates));
    }

    @GET
    @Path("objects/{type}/{nameOrId}")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> get(@PathParam("type") String type,
                                   @PathParam("nameOrId") String nameOrId) throws GeneralException {
        return call(() -> service().get(type, nameOrId));
    }

    @POST
    @Path("objects/{type}/{nameOrId}/merge-xml")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> mergeXml(@PathParam("type") String type,
                                        @PathParam("nameOrId") String nameOrId,
                                        Map<String, Object> body) throws GeneralException {
        return call(() -> service().mergeXml(type, nameOrId, body));
    }

    @HEAD
    @Path("objects/{type}/{nameOrId}")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Response head(@PathParam("type") String type,
                         @PathParam("nameOrId") String nameOrId) throws GeneralException {
        return call(() -> {
            HeadResult result = service().head(type, nameOrId);
            return result == null ? Response.status(Response.Status.NOT_FOUND).build() : head(result);
        });
    }

    @POST
    @Path("objects/{type}")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Response create(@PathParam("type") String type, Map<String, Object> body) throws GeneralException {
        return call(() -> Response.status(Response.Status.CREATED).entity(service().create(type, body)).build());
    }

    @PUT
    @Path("objects/{type}/{nameOrId}")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> update(@PathParam("type") String type,
                                      @PathParam("nameOrId") String nameOrId,
                                      Map<String, Object> body) throws GeneralException {
        return call(() -> service().update(type, nameOrId, body));
    }

    @DELETE
    @Path("objects/{type}/{nameOrId}")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Response delete(@PathParam("type") String type,
                           @PathParam("nameOrId") String nameOrId) throws GeneralException {
        return call(() -> {
            service().delete(type, nameOrId);
            return Response.noContent().build();
        });
    }

    @GET
    @Path("objects/{type}/{nameOrId}/summary")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> summary(@PathParam("type") String type,
                                       @PathParam("nameOrId") String nameOrId) throws GeneralException {
        return call(() -> service().summary(type, nameOrId));
    }

    ////////////////////////////////////////////////////////////////////////
    // Import, rules, tasks, connections
    ////////////////////////////////////////////////////////////////////////

    @POST
    @Path("import")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> importXml(Map<String, Object> body) {
        return call(() -> service().importXml(body));
    }

    @POST
    @Path("objects/Rule/{nameOrId}/run")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> runRule(@PathParam("nameOrId") String nameOrId,
                                       Map<String, Object> args) throws GeneralException {
        return call(() -> service().runRule(nameOrId, args));
    }

    @POST
    @Path("objects/TaskDefinition/{nameOrId}/run")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> runTask(@PathParam("nameOrId") String nameOrId,
                                       Map<String, Object> args) throws GeneralException {
        return call(() -> service().runTask(nameOrId, args));
    }

    @GET
    @Path("objects/TaskResult/{nameOrId}/status")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> taskStatus(@PathParam("nameOrId") String nameOrId) throws GeneralException {
        return call(() -> service().taskStatus(nameOrId));
    }

    @POST
    @Path("objects/Application/{nameOrId}/test-connection")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> testApplicationConnection(@PathParam("nameOrId") String nameOrId)
            throws GeneralException {
        return call(() -> service().testApplicationConnection(nameOrId));
    }

    ////////////////////////////////////////////////////////////////////////
    // Logs
    ////////////////////////////////////////////////////////////////////////

    @GET
    @Path("logs")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> listLogFiles() {
        return call(() -> service().listLogFiles());
    }

    @GET
    @Path("logs/{key}/tail")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> tailLogFile(@PathParam("key") String key,
                                           @QueryParam("offset") @DefaultValue("-1") long offset) {
        return call(() -> service().tailLogFile(key, offset));
    }

    @PUT
    @Path("logs/levels/{logger}")
    @Consumes(MediaType.APPLICATION_JSON)
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> setLoggerLevel(@PathParam("logger") String logger, Map<String, Object> body) {
        return call(() -> service().setLoggerLevel(logger, body));
    }

    @DELETE
    @Path("logs/levels/{logger}")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Response resetLoggerLevel(@PathParam("logger") String logger) {
        return call(() -> {
            service().resetLoggerLevel(logger);
            return Response.noContent().build();
        });
    }

    ////////////////////////////////////////////////////////////////////////
    // Identity view
    ////////////////////////////////////////////////////////////////////////

    @GET
    @Path("identities/{nameOrId}/view")
    @RequiredRight(DevToolsService.ACCESS_RIGHT)
    public Map<String, Object> identityView(@PathParam("nameOrId") String nameOrId,
                                            @QueryParam("section") String section) throws GeneralException {
        return call(() -> service().identityView(nameOrId, section));
    }

    ////////////////////////////////////////////////////////////////////////
    // HTTP plumbing
    ////////////////////////////////////////////////////////////////////////

    /** A service call, which may throw GeneralException or DevToolsException */
    @FunctionalInterface
    private interface ServiceCall<T> {
        T execute() throws GeneralException;
    }

    private static Map<String, Object> errorBody(DevToolsException e) {
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        if (e.getCode() != null) {
            body.put("error", e.getCode());
            body.put("message", e.getMessage());
        } else {
            body.put("error", e.getMessage());
        }
        return body;
    }

    /**
     * Runs a service call, converting its {@link DevToolsException} to the
     * HTTP error envelope {@code { "error": "..." }}. Other exceptions are
     * left to the framework, as before the restructuring.
     */
    private <T> T call(ServiceCall<T> call) {
        try {
            return call.execute();
        } catch (DevToolsException e) {
            throw new WebApplicationException(Response.status(e.getStatus())
                    .type(MediaType.APPLICATION_JSON)
                    .entity(errorBody(e))
                    .build());
        } catch (GeneralException e) {
            throw new WebApplicationException(e);
        }
    }

    /** Builds the bodyless response of a HEAD request */
    private static Response head(HeadResult result) {
        Response.ResponseBuilder builder = Response.ok()
                .header("Content-Length", result.contentLength())
                .tag(new EntityTag(result.etag()));
        result.headers().forEach(builder::header);
        if (result.lastModified() != null) {
            builder.lastModified(result.lastModified());
        }
        return builder.build();
    }
}
