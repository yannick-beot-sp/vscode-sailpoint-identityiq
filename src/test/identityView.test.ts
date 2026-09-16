import * as assert from "assert";
import * as vscode from "vscode";
import { COMMANDS } from "../constants";
import { IDENTITY_VIEW_TYPE } from "../identity/IdentityViewProvider";
import { loadIdentityView, loadObjectSummary, UnknownEnvironmentError } from "../identity/identityViewLoader";
import {
    filteredIdentityAccounts,
    filteredIdentityEntitlements,
    filteredIdentityQuickLinks,
    filteredIdentityRoles,
    groupedIdentityAccounts,
    groupedIdentityEntitlements,
    groupedIdentityRoles,
    pageOfGroups,
    visibleIdentityAttributes,
    visibleIdentityEntitlements
} from "../identity/identityViewModel";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { buildResourceUri } from "../utils/UriUtils";
import { MockPluginServer } from "./mockPluginServer";
import { getExtensionApi, makeTenant } from "./testHelpers";

const IDENTITY_NAME = "ada.lovelace";

/** Waits for a predicate to hold, polling until the timeout elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
}

function openTabs(): readonly vscode.Tab[] {
    return vscode.window.tabGroups.all.flatMap(group => group.tabs);
}

/**
 * Identity View tests (docs/identity-webview.md): the JSON view contract on
 * the client, and the read-only custom editor opening on an iiq:// Identity.
 */
suite("Identity View Test Suite", () => {

    let tenantService: TenantService;
    let server: MockPluginServer;
    let tenant: TenantInfo;
    let identityId: string;

    suiteSetup(async () => {
        tenantService = (await getExtensionApi()).tenantService;
        server = new MockPluginServer("spadmin", "admin");
        await server.start();

        tenant = makeTenant(server.baseUrl, "Identity View");
        await tenantService.add(tenant);
        await tenantService.setCredentials(tenant.id, { username: "spadmin", password: "admin" });

        identityId = server.seedIdentityView(IDENTITY_NAME).id;
        server.seedObjectSummary("Bundle", "Employee");
        server.seedObjectSummary("ManagedAttribute", "CN=Finance");
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        await tenantService.remove(tenant.id);
        await server.stop();
    });

    test("commands are registered at activation", async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes(COMMANDS.viewIdentity));
        assert.ok(commands.includes(COMMANDS.viewIdentityXml));
        assert.ok(commands.includes(COMMANDS.refreshIdentity));
    });

    suite("view endpoints", () => {

        let client: IIQClient;

        suiteSetup(() => {
            client = new IIQClient(tenant, tenantService);
        });

        test("attributes already shown in the header or other tabs are omitted", () => {
            const visible = visibleIdentityAttributes([
                { name: "firstname", type: "string", value: "Ada" },
                { name: "department", type: "string", value: "Engineering" },
                { name: "detectedRoles", type: "string", value: "Employee" },
                { name: "assignedRoles", type: "string", value: "Employee" },
                { name: "lastRefresh", type: "date", value: "2026-01-15T10:12:00Z" },
                { name: "lastLogin", type: "date", value: "2026-02-01T08:30:00Z" },
                { name: "manager", type: "identity", value: "manager.name" },
                { name: "email", type: "string", value: "ada@example.com" },
                { name: "inactive", type: "boolean", value: false }
            ]);

            assert.deepStrictEqual(visible.map(attribute => attribute.name), ["firstname", "department"]);
        });

        test("assigned and detected roles are omitted from entitlements", () => {
            const visible = visibleIdentityEntitlements([
                {
                    application: "Active Directory", type: "group", name: "memberOf",
                    value: "CN=Finance"
                },
                {
                    application: "IIQ", type: "Entitlement", name: "assignedRoles",
                    value: "Employee"
                },
                {
                    application: "IIQ", type: "Entitlement", name: "detectedRoles",
                    value: "Employee"
                },
                {
                    application: "IIQ", type: "Entitlement", name: "bundles",
                    value: "Employee"
                }
            ]);

            assert.deepStrictEqual(visible.map(entitlement => entitlement.name), ["memberOf"]);
        });

        test("accounts, roles, entitlements and quicklinks can be filtered across displayed fields", () => {
            assert.strictEqual(filteredIdentityAccounts([
                { application: "Active Directory", nativeIdentity: "CN=Ada", disabled: false }
            ], "ada").length, 1);
            assert.strictEqual(filteredIdentityRoles([
                {
                    name: "Finance IT", assigned: false, detected: true, negative: false,
                    parentRoleNames: ["Finance Business"]
                }
            ], "business").length, 1);
            assert.strictEqual(filteredIdentityRoles([
                { name: "Finance", type: "organizational", assigned: true, detected: false, negative: false }
            ], "organizational").length, 1);
            assert.strictEqual(filteredIdentityRoles([
                {
                    name: "Finance", assigned: true, detected: false, negative: false,
                    classifications: ["SOX"]
                }
            ], "sox").length, 1);
            assert.strictEqual(filteredIdentityEntitlements([
                {
                    application: "Active Directory", type: "group", name: "memberOf",
                    value: "CN=Finance", grantedByRole: "Finance IT"
                }
            ], "finance it").length, 1);
            assert.strictEqual(filteredIdentityEntitlements([
                {
                    application: "Active Directory", nativeIdentity: "CN=Ada,DC=example",
                    type: "group", name: "memberOf", value: "CN=Finance", classifications: ["PCI"]
                }
            ], "cn=ada").length, 1);
            assert.strictEqual(filteredIdentityEntitlements([
                {
                    application: "Active Directory", type: "group", name: "memberOf",
                    value: "CN=Finance", classifications: ["PCI"]
                }
            ], "pci").length, 1);
            assert.strictEqual(filteredIdentityQuickLinks([
                {
                    name: "Manage User Access", category: "Tasks", action: "manageAccess",
                    disabled: false, populations: [{ name: "Everyone" }]
                }
            ], "everyone").length, 1);
        });

        test("accounts are ordered by application, then by native identity", () => {
            const accounts = [
                { application: "Unix", nativeIdentity: "ada", disabled: false },
                { application: "Active Directory", nativeIdentity: "CN=Ada.adm", disabled: true },
                { application: "Active Directory", nativeIdentity: "CN=Ada", disabled: false }
            ];

            assert.deepStrictEqual(
                filteredIdentityAccounts(accounts, "").map(account =>
                    `${account.application}/${account.nativeIdentity}`),
                ["Active Directory/CN=Ada", "Active Directory/CN=Ada.adm", "Unix/ada"]);
        });

        test("entitlements, accounts and roles can be grouped and paged", () => {
            const entitlements = [
                {
                    application: "AD", type: "Entitlement", name: "memberOf",
                    value: "Finance", classifications: ["PCI", "SOX"]
                },
                {
                    application: "AD", type: "Entitlement", name: "memberOf",
                    value: "Parking"
                },
                {
                    application: "Unix", type: "Permission", name: "groups",
                    value: "wheel", classifications: ["PCI"]
                }
            ];
            assert.deepStrictEqual(
                groupedIdentityEntitlements(entitlements, "application").map(group => group.key),
                ["AD", "Unix"]);
            const byClassification = groupedIdentityEntitlements(entitlements, "classification");
            assert.deepStrictEqual(byClassification.map(group => group.key), ["PCI", "SOX", "Unclassified"]);
            assert.strictEqual(
                byClassification.find(group => group.key === "PCI")?.items.length, 2,
                "an entitlement with several classifications appears in each group");

            const accounts = [
                { application: "AD", nativeIdentity: "CN=Ada", disabled: false },
                { application: "Unix", nativeIdentity: "ada", disabled: true }
            ];
            assert.deepStrictEqual(
                groupedIdentityAccounts(accounts, "disabled").map(group => group.key),
                ["Disabled", "Enabled"]);

            const roles = [
                {
                    name: "Finance", type: "business", assigned: true, detected: true,
                    negative: false, classifications: ["SOX"]
                },
                {
                    name: "IT", type: "it", assigned: false, detected: true,
                    negative: false
                }
            ];
            assert.deepStrictEqual(
                groupedIdentityRoles(roles, "type").map(group => group.key), ["business", "it"]);
            assert.strictEqual(
                groupedIdentityRoles(roles, "status").find(group => group.key === "Detected")?.items.length, 2);

            const paged = pageOfGroups(
                groupedIdentityEntitlements(entitlements, "application"), 2, 2);
            assert.strictEqual(paged.pageCount, 2);
            assert.strictEqual(paged.total, 3);
            assert.deepStrictEqual(paged.groups.map(group => group.key), ["Unix"]);
        });

        test("additional entitlements excludes values granted by a role", () => {
            const entitlements = [
                {
                    application: "Active Directory", type: "group", name: "memberOf",
                    value: "CN=Finance", grantedByRole: "Finance IT"
                },
                {
                    application: "Active Directory", type: "group", name: "memberOf",
                    value: "CN=Parking"
                }
            ];

            assert.deepStrictEqual(
                filteredIdentityEntitlements(entitlements, "", true).map(item => item.value),
                ["CN=Parking"]);
        });

        test("the full cube is resolved by id and carries every section", async () => {
            const view = await client.getIdentityView(identityId);

            assert.strictEqual(view.name, IDENTITY_NAME);
            assert.strictEqual(view.id, identityId);
            assert.strictEqual(view.manager?.name, "manager.name");
            assert.deepStrictEqual(
                view.attributes.map(attribute => attribute.type),
                ["string", "boolean", "date", "identity"]);
            assert.strictEqual(view.accounts.length, 1);
            assert.strictEqual(view.entitlements.length, 1);
            assert.strictEqual(view.workgroups.length, 1);
            assert.strictEqual(view.quicklinks.length, 1);
            assert.strictEqual(view.quicklinks[0].populations[0].name, "Everyone");
        });

        test("roles carry their type, so the tab shows it without a drawer", async () => {
            const roles = (await client.getIdentityView(IDENTITY_NAME)).roles;

            assert.deepStrictEqual(roles.map(role => role.type), ["business", "organizational"]);
            assert.deepStrictEqual(roles[0].classifications, ["SOX"]);
        });

        test("entitlements carry the account native identity and classifications", async () => {
            const entitlements = (await client.getIdentityView(IDENTITY_NAME)).entitlements;

            assert.strictEqual(entitlements[0].nativeIdentity, `CN=${IDENTITY_NAME},DC=example`);
            assert.deepStrictEqual(entitlements[0].classifications, ["PCI"]);
        });

        test("accounts carry the id of their Link, which the detail drawer resolves", async () => {
            const accounts = (await client.getIdentityView(IDENTITY_NAME)).accounts;

            assert.ok(accounts[0].id, "expected the account to carry its Link id");
            const detail = await client.getObjectSummary("Link", accounts[0].id!);
            assert.strictEqual(detail.name, accounts[0].nativeIdentity);
            assert.strictEqual(detail.application, accounts[0].application);
            assert.deepStrictEqual(
                detail.attributes?.map(attribute => attribute.name),
                ["sAMAccountName", "memberOf"]);
        });

        test("negative-only roles stay in the cube alongside assigned ones", async () => {
            const roles = (await client.getIdentityView(IDENTITY_NAME)).roles;

            assert.strictEqual(roles.length, 2);
            const negative = roles.find(role => role.negative);
            assert.ok(negative, "expected a negative role");
            assert.strictEqual(negative.detected, false,
                "a negative role must survive even when it is no longer detected");
        });

        test("role lineage is preserved in the cube", async () => {
            const name = "role.hierarchy";
            server.seedIdentityView(name, {
                roles: [
                    { name: "Finance Business", assigned: true, detected: false, negative: false },
                    {
                        name: "Finance IT", assigned: false, detected: true, negative: false,
                        parentRoleNames: ["Finance Business"]
                    }
                ]
            });

            const roles = (await client.getIdentityView(name)).roles;

            assert.deepStrictEqual(roles[1].parentRoleNames, ["Finance Business"]);
        });

        test("capabilities separate direct from inherited with their source workgroups", async () => {
            const capabilities = (await client.getIdentityView(IDENTITY_NAME)).capabilities;

            const direct = capabilities.find(capability => !capability.inherited);
            const inherited = capabilities.find(capability => capability.inherited);
            assert.strictEqual(direct?.name, "SystemAdministrator");
            assert.deepStrictEqual(inherited?.workgroups, ["IT Admins"]);
        });

        test("a workgroup carries the capabilities it grants, for its drawer", async () => {
            const workgroups = (await client.getIdentityView(IDENTITY_NAME)).workgroups;

            assert.deepStrictEqual(workgroups[0].capabilities, ["Certifier"]);
        });

        test("a section request only populates that section", async () => {
            const view = await client.getIdentityView(IDENTITY_NAME, "roles");

            assert.strictEqual(view.roles.length, 2);
            assert.deepStrictEqual(view.attributes, []);
            assert.deepStrictEqual(view.accounts, []);
            assert.deepStrictEqual(view.quicklinks, []);
        });

        test("the quicklinks section lists matching populations", async () => {
            const view = await client.getIdentityView(IDENTITY_NAME, "quicklinks");

            assert.strictEqual(view.quicklinks.length, 1);
            assert.strictEqual(view.quicklinks[0].name, "Manage User Access");
            assert.deepStrictEqual(view.roles, []);
        });

        test("an unknown identity is a 404", async () => {
            await assert.rejects(() => client.getIdentityView("no.such.identity"));
        });

        test("drawer summaries are loaded per object type", async () => {
            const bundle = await client.getObjectSummary("Bundle", "Employee");
            const managedAttribute = await client.getObjectSummary("ManagedAttribute", "CN=Finance");

            assert.strictEqual(bundle.name, "Employee");
            assert.strictEqual(bundle.type, "business");
            assert.strictEqual(managedAttribute.name, "CN=Finance");
            assert.strictEqual(managedAttribute.owner?.name, "spadmin");
        });
    });

    suite("custom editor", () => {

        let identityUri: vscode.Uri;

        suiteSetup(() => {
            identityUri = buildResourceUri({
                tenantId: tenant.id,
                tenantName: tenant.name,
                objectType: "Identity",
                objectId: identityId,
                objectName: IDENTITY_NAME
            });
        });

        setup(async () => {
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            server.requests.length = 0;
            // The environment tree lives in the shared globalState of the test
            // host, and TenantService writes it with a read-modify-write, so a
            // concurrent add/remove elsewhere can drop this environment. These
            // tests assert on view loading, not on that storage race: restate
            // the precondition instead of inheriting it from suiteSetup.
            if (!tenantService.getTenant(tenant.id)) {
                await tenantService.add(tenant);
                await tenantService.setCredentials(tenant.id, { username: "spadmin", password: "admin" });
            }
        });

        test("View Identity opens the identity in the custom editor", async () => {
            await vscode.commands.executeCommand(COMMANDS.viewIdentity, identityUri);

            assert.ok(
                await waitFor(() => openTabs().some(tab =>
                    tab.input instanceof vscode.TabInputCustom
                    && tab.input.viewType === IDENTITY_VIEW_TYPE
                    && tab.input.uri.toString() === identityUri.toString())),
                "expected an Identity View custom editor tab, got: "
                + openTabs().map(tab => tab.label).join(", "));
        });

        test("duplicate header and tab fields are stripped from attributes on load", async () => {
            const name = "dupe.attrs";
            const stored = server.seedIdentityView(name, {
                attributes: [
                    { name: "department", type: "string", value: "Engineering" },
                    { name: "detectedRoles", type: "string", value: "Employee" },
                    { name: "lastRefresh", type: "date", value: "2026-01-15T10:12:00Z" },
                    { name: "assignedRoles", type: "string", value: "Contractor" }
                ]
            });
            const uri = buildResourceUri({
                tenantId: tenant.id,
                tenantName: tenant.name,
                objectType: "Identity",
                objectId: stored.id,
                objectName: name
            });

            const view = await loadIdentityView(tenantService, uri);

            assert.deepStrictEqual(view.attributes.map(attribute => attribute.name), ["department"]);
        });

        test("role IdentityEntitlements are stripped from entitlements on load", async () => {
            const name = "role.ents";
            const stored = server.seedIdentityView(name, {
                entitlements: [
                    {
                        application: "Active Directory", type: "group", name: "memberOf",
                        value: "CN=Finance"
                    },
                    {
                        application: "IIQ", type: "Entitlement", name: "assignedRoles",
                        value: "Employee"
                    },
                    {
                        application: "IIQ", type: "Entitlement", name: "detectedRoles",
                        value: "Contractor"
                    }
                ]
            });
            const uri = buildResourceUri({
                tenantId: tenant.id,
                tenantName: tenant.name,
                objectType: "Identity",
                objectId: stored.id,
                objectName: name
            });

            const view = await loadIdentityView(tenantService, uri);

            assert.deepStrictEqual(view.entitlements.map(entitlement => entitlement.name), ["memberOf"]);
        });

        test("loading the cube resolves the environment from the URI and never fetches XML", async () => {
            const view = await loadIdentityView(tenantService, identityUri);

            assert.strictEqual(view.name, IDENTITY_NAME);
            assert.strictEqual(view.environment, tenant.name,
                "the header shows which environment the cube came from");
            assert.ok(
                server.requests.some(request => request.path.endsWith(`/identities/${identityId}/view`)),
                "expected the cube endpoint to be called, got: "
                + server.requests.map(request => request.path).join(", "));
            assert.ok(
                !server.requests.some(request => request.path.includes(`/objects/Identity/${identityId}`)),
                "the Identity XML must never be fetched to render the view");
        });

        test("a tab refresh only requests that section", async () => {
            await loadIdentityView(tenantService, identityUri, "roles");

            assert.ok(server.requests.some(request => request.path.endsWith(`/identities/${identityId}/view`)));
            assert.ok(
                !server.requests.some(request => request.path.includes("/objects/Identity/")),
                "a section refresh must not fall back to the XML");
        });

        test("drawer details are loaded against the same environment", async () => {
            const detail = await loadObjectSummary(tenantService, identityUri, "Bundle", "Employee");

            assert.strictEqual(detail.name, "Employee");
            assert.ok(
                server.requests.some(request => request.path.endsWith("/objects/Bundle/Employee/summary")),
                "expected the Bundle summary endpoint, got: "
                + server.requests.map(request => request.path).join(", "));
        });

        test("an account detail is loaded from its Link, attributes included", async () => {
            const nativeIdentity = `CN=${IDENTITY_NAME},DC=example`;

            const detail = await loadObjectSummary(tenantService, identityUri, "Link", nativeIdentity);

            assert.strictEqual(detail.name, nativeIdentity);
            assert.strictEqual(detail.attributes?.length, 2);
            assert.ok(
                server.requests.some(request => request.path.includes("/objects/Link/")
                    && request.path.endsWith("/summary")),
                "expected the Link summary endpoint, got: "
                + server.requests.map(request => request.path).join(", "));
        });

        test("loading fails cleanly once the environment is gone", async () => {
            const goneUri = buildResourceUri({
                tenantId: "removed-tenant-id",
                tenantName: "Removed",
                objectType: "Identity",
                objectId: "some-id",
                objectName: "some.identity"
            });

            await assert.rejects(() => loadIdentityView(tenantService, goneUri), UnknownEnvironmentError);
        });

        test("View XML opens the same identity in the default text editor", async () => {
            await vscode.commands.executeCommand(COMMANDS.viewIdentityXml, identityUri);

            assert.ok(
                await waitFor(() => openTabs().some(tab =>
                    tab.input instanceof vscode.TabInputText
                    && tab.input.uri.toString() === identityUri.toString())),
                "expected a text editor on the identity XML, got: "
                + openTabs().map(tab => tab.label).join(", "));
        });

        test("the viewer refuses non-Identity resources", async () => {
            const workgroupUri = buildResourceUri({
                tenantId: tenant.id,
                tenantName: tenant.name,
                objectType: "Workgroup",
                objectId: "wg-id",
                objectName: "IT Admins"
            });

            await assert.rejects(() =>
                Promise.resolve(vscode.commands.executeCommand(COMMANDS.viewIdentity, workgroupUri)));
        });
    });
});
