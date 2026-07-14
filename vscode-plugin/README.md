# vscode-plugin (iiq-devtools)

IdentityIQ companion plugin for the
[vscode-sailpoint-identityiq](https://github.com/yannick-beot-sp/vscode-sailpoint-identityiq)
extension. It exposes the REST API specified in
[docs/plugin-api.md](../docs/plugin-api.md) under
`{baseUrl}/plugin/rest/iiq-devtools`.

## Build

Requires the IdentityIQ jar in the local Maven repository (see the root
README, section *Install IdentityIQ libraries*), then:

```bash
mvn package
```

The installable plugin zip is produced in `target/vscode-plugin-<version>-bin.zip`
(`<version>` is the plugin's own version, set in `pom.xml`, e.g. `1.0.0`).

## Install

Install the zip like any IIQ plugin: *gear icon > Plugins > New*, or:

```
iiq console
> plugin install target/vscode-plugin-<version>-bin.zip
```

## Deploy to the local docker environment

[deploy.sh](deploy.sh) automates the whole cycle against the local
IdentityIQ container (any running container whose image matches `iiq:*`,
e.g. `iiq-docker-iiq-1`):

```bash
./deploy.sh --build --restart
```

It runs, in order:

1. `mvn package` (only with `--build`);
2. `docker cp` of the zip to `/tmp` inside the container;
3. `iiq console` in the container: `plugin uninstall vscodePlugin` if the
   plugin is already installed, then `plugin install`;
4. `plugin list` to verify the plugin is `Enabled`;
5. container restart (only with `--restart`), waiting for the webapp to come
   back;
6. an authenticated `GET /system/ping` against the REST API and prints the
   version payload.

Options: `--container NAME` and `--zip PATH` override the defaults;
`IIQ_URL` / `IIQ_USER` / `IIQ_PASSWORD` (default
`http://localhost:8080/identityiq`, `spadmin` / `admin`) configure the final
ping check. Run `./deploy.sh --help` for details.

**Console installs are not hot-loaded.** The console runs in its own JVM, so
the running Tomcat only picks the new version up when its plugin sync
service polls the database — observed to take several minutes. If the ping
answers 404 right after an install, either wait for the sync or use
`--restart` for a deterministic, immediate load (installing through the UI
also hot-loads immediately).

## Security

Every endpoint is protected with `@RequiredRight("iiqDevToolsAccess")`:

- **System Administrators** always pass the check — nothing to import for a
  typical developer setup (`spadmin`).
- To grant access to non-administrators, import an SPRight named
  `iiqDevToolsAccess` and assign it through a capability.

Rule executions and task launches are also written to the audit log
(actions `iiq-devtools:runRule` / `iiq-devtools:runTask`).

## Logging

Every endpoint logs through Log4j2. To see the plugin logs, add to
`WEB-INF/classes/log4j2.properties`:

```properties
logger.vscodeplugin.name = com.sailpoint.se.plugin.vscode
logger.vscodeplugin.level = debug
```

## Testing

[test.http](test.http) exercises every endpoint (httpyac / VS Code REST
Client): ping, list, get/HEAD, import, update, run rule, launch task, poll
its status and fetch the final TaskResult.
