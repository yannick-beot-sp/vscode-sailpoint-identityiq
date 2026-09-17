import * as assert from "assert";
import {
    applyXpathTokens,
    matchesBundle,
    parseBulkClassNames,
    parseProperties,
    transformBulkXml
} from "../utils/bulkExportUtils";

suite("Bulk Export Utils Test Suite", () => {
    test("expands default classes and parses property filters", () => {
        const result = parseBulkClassNames("default,Rule:type:BeforeProvisioning", ["Rule"]);
        assert.ok(result.some(spec => spec.objectType === "Application"));
        assert.ok(result.some(spec =>
            spec.objectType === "Rule" && spec.property === "type" && spec.value === "BeforeProvisioning"));
    });

    test("blank class list excludes historical and lock classes", () => {
        const result = parseBulkClassNames("", ["Rule", "accesshistory.HistoricalIdentity", "ServiceLock"]);
        assert.deepStrictEqual(result, [{ objectType: "Rule", property: undefined, value: undefined }]);
    });

    test("parses token property files", () => {
        const result = parseProperties("# comment\n/url=%%URL%%\nvalue\\=part:%%VALUE%%");
        assert.strictEqual(result.get("/url"), "%%URL%%");
        assert.strictEqual(result.get("value=part"), "%%VALUE%%");
    });

    test("applies common XPath attribute and node token forms", () => {
        const xml = '<TaskDefinition host="dev"><Description>Local</Description></TaskDefinition>';
        const tokens = new Map([
            ["//TaskDefinition/@host", "%%HOST%%"],
            ["//Description", "%%DESCRIPTION%%"]
        ]);
        assert.strictEqual(applyXpathTokens(xml, tokens),
            '<TaskDefinition host="%%HOST%%"><Description>%%DESCRIPTION%%</Description></TaskDefinition>');
    });

    test("strips role and task metadata", () => {
        const cleaning = {
            removeIds: false,
            removeCreatedTimestamp: false,
            removeModifiedTimestamp: false,
            removeReferenceIds: false,
            removeSignificantModified: false,
            cleanForSourceControl: false
        };
        const task = '<TaskDefinition name="T"><Attributes><Map>'
            + '<entry key="TaskDefinition.runLength" value="1"/>'
            + '<entry key="taskCompletionEmailNotify" value="x"/>'
            + '<entry key="keep" value="yes"/>'
            + '</Map></Attributes></TaskDefinition>';
        const result = transformBulkXml(task, "TaskDefinition", {
            cleaning,
            stripMetadata: true,
            stripTDEmailMetadata: true,
            stripProfiles: false,
            stripRoleMetadata: false,
            sortObjectConfigIdentity: false,
            customIgnore: []
        });
        assert.ok(!result.includes("runLength"));
        assert.ok(!result.includes("taskCompletionEmail"));
        assert.ok(result.includes('key="keep"'));
    });

    test("matches bundle type and inherited parent", () => {
        const xml = '<Bundle name="Child" type="it"><Inheritance>'
            + '<Reference class="sailpoint.object.Bundle" name="Parent"/>'
            + '</Inheritance></Bundle>';
        assert.strictEqual(matchesBundle(xml, "it", "Parent"), true);
        assert.strictEqual(matchesBundle(xml, "business", "Parent"), false);
    });
});
