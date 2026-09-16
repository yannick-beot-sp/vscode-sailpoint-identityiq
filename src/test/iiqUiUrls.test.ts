import * as assert from "assert";
import { buildObjectUiUrl, objectTypeHasUiPage } from "../utils/iiqUiUrls";

suite("iiqUiUrls Test Suite", () => {

    const base = "http://localhost:8080/identityiq";
    const id = "0a0000018123456789abcdef01234567";

    test("builds the application editor URL with appId", () => {
        assert.strictEqual(
            buildObjectUiUrl(base, "Application", id),
            `${base}/define/applications/application.jsf?appId=${id}&forceLoad=true`);
    });

    test("builds classic JSF editor URLs for roles, tasks, workflows and workgroups", () => {
        assert.strictEqual(
            buildObjectUiUrl(base, "Bundle", id),
            `${base}/define/roles/role.jsf?id=${id}&forceLoad=true`);
        assert.strictEqual(
            buildObjectUiUrl(base, "TaskDefinition", id),
            `${base}/define/tasks/taskDefinition.jsf?id=${id}&forceLoad=true`);
        assert.strictEqual(
            buildObjectUiUrl(base, "Workflow", id),
            `${base}/define/workflow/workflow.jsf?id=${id}&forceLoad=true`);
        assert.strictEqual(
            buildObjectUiUrl(base, "Workgroup", id),
            `${base}/define/groups/workgroup.jsf?id=${id}&forceLoad=true`);
    });

    test("builds the Angular identity view through the documented redirect", () => {
        assert.strictEqual(
            buildObjectUiUrl(base, "Identity", id),
            `${base}/ui/rest/redirect?rp1=/identities/identities.jsf&rp2=identities/${id}/attributes`);
    });

    test("strips a trailing slash on the environment URL", () => {
        assert.strictEqual(
            buildObjectUiUrl(`${base}/`, "Application", id),
            buildObjectUiUrl(base, "Application", id));
    });

    test("returns undefined for types without a desktop page", () => {
        for (const objectType of ["Form", "Rule", "ObjectConfig", "QuickLink"]) {
            assert.strictEqual(buildObjectUiUrl(base, objectType, id), undefined);
            assert.strictEqual(objectTypeHasUiPage(objectType), false);
        }
    });

    test("returns undefined when the object id is missing", () => {
        assert.strictEqual(buildObjectUiUrl(base, "Application", ""), undefined);
    });
});
