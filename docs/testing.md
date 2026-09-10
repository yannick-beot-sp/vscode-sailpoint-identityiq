# Testing Strategy

Tests run in a real VS Code extension host (`@vscode/test-cli`, mocha TDD
style) with `npm test`. The host version is pinned in `.vscode-test.mjs` to
the oldest VS Code supported by the extension (`engines.vscode`). They are
organized in three levels, all mapped to the use cases of
[use-cases.md](use-cases.md).

## 1. Unit tests (no network, no VS Code API beyond types)

| File | Coverage |
|---|---|
| `src/test/xmlUtils.test.ts` | UC-21 XML cleaning (ids, timestamps, references, CDATA preservation), object type/name parsing, `<sailpoint>` bundling |
| `src/test/uriUtils.test.ts` | `iiq://` URI build/parse round-trips, special characters, diff scheme |

## 2. Integration tests against a mock plugin

`src/test/mockPluginServer.ts` is an **in-memory HTTP server implementing the
plugin REST contract** ([plugin-api.md](plugin-api.md)): basic auth, ping,
paginated/sorted lists, object CRUD, import (including `<sailpoint>` bundles)
and rule execution. It keeps the tests deterministic and validates that the
extension conforms to the documented contract before the real plugin exists.

| File | Coverage |
|---|---|
| `src/test/tenantService.test.ts` | UC-01/02/03/05/06 — storage layer: environments and folders (nesting, move, recursive removal), credentials in the **real Secret Storage** of the test host, active environment and events |
| `src/test/iiqClient.test.ts` | UC-04 (ping, bad credentials, unreachable server), UC-10 (pagination, sorting), UC-11/12 (read/write through the `iiq://` virtual FS, including `vscode.workspace.openTextDocument`; `stat` served by `HEAD` without transferring the body — asserted on the mock's request log), UC-13 (delete), UC-22 (import bundle), UC-30 (run rule with arguments) |
| `src/test/fileCommands.test.ts` | UC-22 — `iiq.import-file-view` command registration, import from the environment tree view (file dialog stubbed) |
| `src/test/objectCommands.test.ts` | UC-13 — copy an object to another environment (context menu and drag & drop), **Copy name** (clipboard, single and multiple selection) |

The tests access the extension services through the API returned by
`activate()` (`IIQExtensionApi` in `src/extension.ts`).

## 3. Live tests against a local IdentityIQ

`src/test/live.test.ts` exercises a real instance with the iiq-devtools
plugin installed. To (re)deploy the plugin to the local docker environment,
run `vscode-plugin/deploy.sh --build --restart` (see
[vscode-plugin/README.md](../vscode-plugin/README.md)). Default target
(overridable by environment variables):

| Variable | Default |
|---|---|
| `IIQ_TEST_URL` | `http://localhost:8080/identityiq` |
| `IIQ_TEST_USERNAME` | `spadmin` |
| `IIQ_TEST_PASSWORD` | `admin` |

The suite **skips itself automatically** when the instance or the plugin is
not reachable, so `npm test` stays green everywhere. When available, it runs
the full lifecycle: ping (UC-04), list rules (UC-10), import a temporary test
rule (UC-22), fetch it as XML and through the virtual FS (UC-11/12), execute
it (UC-30) and delete it (UC-13), with cleanup in `suiteTeardown` even on
failure.

## Not covered (by design, for now)

The interactive command layer (wizards, quick picks, dialogs) is thin glue
over the tested services and requires UI automation to test meaningfully; it
is validated manually. The command ids and menus are declared in
`package.json` and exercised at activation time by the integration tests.
