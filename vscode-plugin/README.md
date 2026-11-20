# vscode-plugin (iiq-devtools)

IdentityIQ companion plugin for the
[vscode-sailpoint-identityiq](https://github.com/yannick-beot-sp/vscode-sailpoint-identityiq)
extension. It exposes the REST API specified in
[docs/plugin-api.md](../docs/plugin-api.md) under
`{baseUrl}/plugin/rest/iiq-devtools`.

## Which artifact for which IdentityIQ?

IdentityIQ 8.x runs on Tomcat 9 (`javax.*` namespace) and IdentityIQ 9.x on
Tomcat 10 (`jakarta.*`): a plugin REST resource cannot work on both. The
build therefore produces **two zips**, one per generation:

| IdentityIQ | Artifact |
|---|---|
| 8.0 and later 8.x | `vscode-plugin-iiq8-<version>-bin.zip` |
| 9.0 and later | `vscode-plugin-iiq9-<version>-bin.zip` |

Installing the wrong one fails with a `javax` / `jakarta` `NoClassDefFoundError`.

## Project structure

Multi-module Maven project:

| Module | Role |
|---|---|
| `core` (`vscode-plugin-core`) | All the logic: `DevToolsService`, DTOs, `BulkExportMerge`. **No JAX-RS dependency**; compiled against the oldest supported IIQ (8.5). Gets what it needs from the request through the `RequestEnvironment` interface. |
| `iiq8` (`vscode-plugin-iiq8`) | Thin REST wrapper (`javax.ws.rs`), packaged with the core into the IIQ 8 zip. |
| `iiq9` (`vscode-plugin-iiq9`) | Thin REST wrapper (`jakarta.ws.rs`), packaged with the core into the IIQ 9 zip. |

Shared by both zips: `src/main/plugin-resources` (`manifest.xml`, SPRight
import) and `build-config/assembly/plugin-files.xml`. `manifest.xml` is
filtered; only `minSystemVersion` differs (`8.0` / `9.0`).

**Adding or changing an endpoint**: implement it in `DevToolsService` (returns
a `Map` envelope, throws `DevToolsException(status, message)` on failure),
then add the delegating method in **both** wrappers
(`VSCodePluginResource`). The two wrapper files must stay identical apart from
the `javax` / `jakarta` imports. Never import JAX-RS in `core`.

## Build

Requires the IdentityIQ jars in the local Maven repository (see the root
README, section *Install IdentityIQ libraries*): `identityiq` and
`connector-bundle-identityiq` in version `8.5` (core and `iiq8`) and `9.0`
(`iiq9`). Then:

```bash
mvn package                     # both zips
mvn package -pl iiq8 -am        # IIQ 8 only
mvn package -pl iiq9 -am        # IIQ 9 only
```

The zips are produced in `iiq8/target/vscode-plugin-iiq8-<version>-bin.zip` and
`iiq9/target/vscode-plugin-iiq9-<version>-bin.zip` (`<version>` is the
plugin's own version, set in the parent `pom.xml` and the modules' `<parent>`).

To compile everything against a single IIQ release (e.g. when only 8.5 is
installed locally): `mvn package -Diiq.version=8.5`.

## Install

Install the zip matching your IdentityIQ generation like any IIQ plugin:
*gear icon > Plugins > New*, or:

```
iiq console
> plugin install vscode-plugin-iiq8-<version>-bin.zip
```

## Deploy to the local docker environment

[deploy.sh](deploy.sh) automates the whole cycle against the local
IdentityIQ container (any running container whose image matches `iiq:*`,
e.g. `iiq-docker-iiq-1`):

```bash
./deploy.sh --build --restart            # IIQ 8 container (default)
./deploy.sh --iiq-version 9 --build --restart   # IIQ 9 container
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

Options: `--iiq-version 8|9` (artifact to build and deploy), `--container NAME` and `--zip PATH` override the defaults;
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

Rule executions, task launches and Log4j2 configuration updates are also
written to the audit log (actions `iiq-devtools:runRule` /
`iiq-devtools:runTask` / `iiq-devtools:updateLog4jConfig`).

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
its status and fetch the final TaskResult, tail the logs, and load the
Identity View cube and its drawer summaries.
