import * as assert from "assert";
import { TenantInfo } from "../../models/TenantInfo";
import { resolveTenant, TenantResolveError } from "../../mcp/tenantResolver";

function tenant(name: string, url: string): TenantInfo {
    return { id: name, name, url, type: "TENANT" };
}

const POC_URL = "http://redhatenterpriselinux92.company23552-poc.demohub.sailpointtechnologies.com:8080/identityiq";

suite("MCP tenantResolver", () => {

    const prod = tenant("Prod", "http://prod.example.com:8080/identityiq");
    const poc = tenant("IIQ POC", POC_URL);
    const tenants = [prod, poc];

    test("omitted query uses the active environment", () => {
        assert.strictEqual(resolveTenant(undefined, tenants, prod), prod);
        assert.strictEqual(resolveTenant("  ", tenants, poc), poc);
    });

    test("omitted query without an active environment throws", () => {
        assert.throws(() => resolveTenant(undefined, tenants, undefined), TenantResolveError);
        assert.throws(() => resolveTenant(undefined, [], undefined), /No IdentityIQ environment defined/);
    });

    test("exact friendly name is case-insensitive", () => {
        assert.strictEqual(resolveTenant("iiq poc", tenants, prod), poc);
        assert.strictEqual(resolveTenant("PROD", tenants, poc), prod);
    });

    test("unique URL substring matches (hostname fragment)", () => {
        assert.strictEqual(resolveTenant("redhatenterpriselinux92", tenants, prod), poc);
        assert.strictEqual(resolveTenant("redhat", tenants, prod), poc);
    });

    test("ambiguous URL substring throws and lists matches", () => {
        const other = tenant("Other", "http://redhat-lab.example.com/identityiq");
        assert.throws(
            () => resolveTenant("redhat", [poc, other], undefined),
            /Ambiguous environment "redhat"/);
    });

    test("unique name substring is used when the URL does not match", () => {
        assert.strictEqual(resolveTenant("POC", tenants, prod), poc);
    });

    test("unknown query lists known environments", () => {
        assert.throws(() => resolveTenant("no-such-env", tenants, prod), /No environment matches/);
    });
});
