import * as assert from "assert";
import * as crypto from "crypto";
import { FolderTreeNode } from "../models/TreeNode";
import { TenantService } from "../services/TenantService";
import { getExtensionApi, makeTenant } from "./testHelpers";

/**
 * Integration tests of the environment storage layer (UC-01/02/03/05/06):
 * tree of folders/environments in globalState, credentials in the real
 * VS Code Secret Storage of the test host, active environment.
 */
suite("TenantService Test Suite", () => {

    let tenantService: TenantService;
    const createdIds: string[] = [];

    suiteSetup(async () => {
        tenantService = (await getExtensionApi()).tenantService;
    });

    suiteTeardown(async () => {
        for (const id of createdIds) {
            await tenantService.remove(id);
        }
    });

    function makeFolder(name: string): FolderTreeNode {
        return { id: crypto.randomUUID(), name, type: "FOLDER", children: [] };
    }

    test("UC-01: add an environment and store its credentials securely", async () => {
        const tenant = makeTenant("http://localhost:8080/identityiq");
        createdIds.push(tenant.id);
        await tenantService.add(tenant);
        await tenantService.setCredentials(tenant.id, { username: "spadmin", password: "admin" });

        assert.deepStrictEqual(tenantService.getTenant(tenant.id), tenant);
        assert.deepStrictEqual(tenantService.getTenantByName(tenant.name.toUpperCase()), tenant,
            "name lookup must be case-insensitive");
        const credentials = await tenantService.getCredentials(tenant.id);
        assert.deepStrictEqual(credentials, { username: "spadmin", password: "admin" });
    });

    test("UC-03: rename keeps id and credentials", async () => {
        const tenant = makeTenant("http://localhost:8080/identityiq");
        createdIds.push(tenant.id);
        await tenantService.add(tenant);
        await tenantService.setCredentials(tenant.id, { username: "u", password: "p" });

        await tenantService.update({ ...tenant, name: tenant.name + " renamed" });

        const renamed = tenantService.getTenant(tenant.id);
        assert.strictEqual(renamed?.name, tenant.name + " renamed");
        assert.deepStrictEqual(await tenantService.getCredentials(tenant.id), { username: "u", password: "p" });
    });

    test("UC-02: remove deletes the node, its credentials and the active flag", async () => {
        const tenant = makeTenant("http://localhost:8080/identityiq");
        await tenantService.add(tenant);
        await tenantService.setCredentials(tenant.id, { username: "u", password: "p" });
        await tenantService.setActiveTenant(tenant);
        assert.strictEqual(tenantService.getActiveTenant()?.id, tenant.id);

        await tenantService.remove(tenant.id);

        assert.strictEqual(tenantService.getTenant(tenant.id), undefined);
        assert.strictEqual(await tenantService.getCredentials(tenant.id), undefined);
        assert.strictEqual(tenantService.getActiveTenant(), undefined);
    });

    test("UC-05: active environment can be selected and deselected (None)", async () => {
        const tenant = makeTenant("http://localhost:8080/identityiq");
        createdIds.push(tenant.id);
        await tenantService.add(tenant);

        let events = 0;
        const subscription = tenantService.onDidChangeActiveTenant(() => events++);
        try {
            await tenantService.setActiveTenant(tenant);
            assert.strictEqual(tenantService.getActiveTenant()?.id, tenant.id);
            await tenantService.setActiveTenant(undefined); // "None"
            assert.strictEqual(tenantService.getActiveTenant(), undefined);
            assert.strictEqual(events, 2);
        } finally {
            subscription.dispose();
        }
    });

    test("UC-06: folders can nest environments and be moved", async () => {
        const folder = makeFolder("Test folder " + crypto.randomUUID().substring(0, 8));
        const subFolder = makeFolder("Sub folder");
        const tenant = makeTenant("http://localhost:8080/identityiq");
        createdIds.push(folder.id);

        await tenantService.add(folder);
        await tenantService.add(subFolder, folder.id);
        await tenantService.add(tenant, subFolder.id);

        // Found although nested
        assert.strictEqual(tenantService.getTenant(tenant.id)?.id, tenant.id);
        assert.strictEqual(tenantService.getChildren(subFolder.id).length, 1);

        // Move the tenant to the root
        await tenantService.move(tenant.id, undefined);
        assert.strictEqual(tenantService.getChildren(subFolder.id).length, 0);
        assert.ok(tenantService.getRoots().some(n => n.id === tenant.id));

        // Move it back into the top folder
        await tenantService.move(tenant.id, folder.id);
        assert.ok(tenantService.getChildren(folder.id).some(n => n.id === tenant.id));
    });

    test("UC-06: removing a folder removes nested credentials", async () => {
        const folder = makeFolder("Doomed folder");
        const tenant = makeTenant("http://localhost:8080/identityiq");
        await tenantService.add(folder);
        await tenantService.add(tenant, folder.id);
        await tenantService.setCredentials(tenant.id, { username: "u", password: "p" });

        await tenantService.remove(folder.id);

        assert.strictEqual(tenantService.getFolder(folder.id), undefined);
        assert.strictEqual(tenantService.getTenant(tenant.id), undefined);
        assert.strictEqual(await tenantService.getCredentials(tenant.id), undefined);
    });

    test("tree updates fire the onDidUpdateTree event", async () => {
        let events = 0;
        const subscription = tenantService.onDidUpdateTree(() => events++);
        try {
            const tenant = makeTenant("http://localhost:8080/identityiq");
            await tenantService.add(tenant);
            await tenantService.remove(tenant.id);
            assert.ok(events >= 2);
        } finally {
            subscription.dispose();
        }
    });
});
