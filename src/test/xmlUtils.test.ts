import * as assert from "assert";
import { buildSailpointBundle, cleanXml, getObjectInfoFromXml, wrapSourceCdata, XmlCleaningOptions } from "../utils/xmlUtils";

const ALL_OPTIONS: XmlCleaningOptions = {
    removeIds: true,
    removeCreatedTimestamp: true,
    removeModifiedTimestamp: true,
    removeReferenceIds: true,
    removeSignificantModified: true,
    cleanForSourceControl: true
};

const SAMPLE_RULE = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Rule id="0a0000018c1d1f2a818c1d2f3b4c0d5e" name="My Rule" language="beanshell" type="IdentityAttribute" created="1700000000000" modified="1700000001000" significantModified="1700000001000">
  <Source><![CDATA[
    // BeanShell code with special chars: <, >, id="deadbeefdeadbeefdeadbeefdeadbeef"
    String created = "created=\\"123\\"";
    return identity.getName();
  ]]></Source>
  <ReferencedRules>
    <Reference class="sailpoint.object.Rule" id="0a0000018c1d1f2a818c1d2f3b4c0000" name="Library Rule"/>
  </ReferencedRules>
</Rule>
`;

suite("XML utils Test Suite", () => {

    test("cleanXml removes ids and timestamps", () => {
        const result = cleanXml(SAMPLE_RULE, ALL_OPTIONS);
        assert.ok(!result.includes('id="0a0000018c1d1f2a818c1d2f3b4c0d5e"'));
        assert.ok(!result.includes("created=\"1700000000000\""));
        assert.ok(!result.includes("modified="));
        assert.ok(!result.includes("significantModified="));
        // Reference id removed but name kept
        assert.ok(!result.includes('id="0a0000018c1d1f2a818c1d2f3b4c0000"'));
        assert.ok(result.includes('name="Library Rule"'));
    });

    test("cleanXml preserves CDATA sections verbatim", () => {
        const result = cleanXml(SAMPLE_RULE, ALL_OPTIONS);
        assert.ok(result.includes('id="deadbeefdeadbeefdeadbeefdeadbeef"'),
            "content inside CDATA must not be modified");
        assert.ok(result.includes('String created = "created=\\"123\\"";'));
    });

    test("cleanXml keeps everything when options are disabled", () => {
        const noCleaning: XmlCleaningOptions = {
            removeIds: false,
            removeCreatedTimestamp: false,
            removeModifiedTimestamp: false,
            removeReferenceIds: false,
            removeSignificantModified: false,
            cleanForSourceControl: false
        };
        assert.strictEqual(cleanXml(SAMPLE_RULE, noCleaning), SAMPLE_RULE);
    });

    test("getObjectInfoFromXml finds type and name of a root object", () => {
        const info = getObjectInfoFromXml(SAMPLE_RULE);
        assert.deepStrictEqual(info, { objectType: "Rule", name: "My Rule" });
    });

    test("getObjectInfoFromXml finds the first object in a sailpoint bundle", () => {
        const bundle = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE sailpoint PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<sailpoint>
  <Workflow name="My Workflow"/>
  <Rule name="Another Rule"/>
</sailpoint>`;
        const info = getObjectInfoFromXml(bundle);
        assert.deepStrictEqual(info, { objectType: "Workflow", name: "My Workflow" });
    });

    test("buildSailpointBundle wraps objects in a single document", () => {
        const bundle = buildSailpointBundle([SAMPLE_RULE, "<Workflow name=\"WF\"/>"]);
        assert.ok(bundle.includes("<sailpoint>"));
        assert.ok(bundle.includes("</sailpoint>"));
        assert.ok(bundle.includes('name="My Rule"'));
        assert.ok(bundle.includes('name="WF"'));
        // Only one prolog and one doctype
        assert.strictEqual(bundle.match(/<\?xml/g)?.length, 1);
        assert.strictEqual(bundle.match(/<!DOCTYPE/g)?.length, 1);
    });

    test("wrapSourceCdata wraps escaped Source text in a CDATA section", () => {
        const escaped = `<Rule name="My Rule" language="beanshell">
  <Source>if (a &lt; b) { return "x &amp; y"; }</Source>
</Rule>`;
        const result = wrapSourceCdata(escaped);
        assert.ok(result.includes('<Source><![CDATA[if (a < b) { return "x & y"; }]]></Source>'));
    });

    test("wrapSourceCdata leaves an already-CDATA Source untouched", () => {
        const result = wrapSourceCdata(SAMPLE_RULE);
        assert.strictEqual(result, SAMPLE_RULE);
    });

    test("wrapSourceCdata preserves attributes on the Source element", () => {
        const withAttr = `<Rule name="My Rule"><Source lang="beanshell">x &lt; y</Source></Rule>`;
        const result = wrapSourceCdata(withAttr);
        assert.ok(result.includes('<Source lang="beanshell"><![CDATA[x < y]]></Source>'));
    });

    test("wrapSourceCdata dedents escaped Source inherited from deep ancestor nesting", () => {
        const nested = `<Workflow name="Test Workflow">
  <Step name="step1">
    <Approval>
      <Script>
        <Source>
          System.out.println(&quot;hi&quot;);
          if (a &lt; b) {
            return wfcontext.getStepName();
          }
        </Source>
      </Script>
    </Approval>
  </Step>
</Workflow>`;
        const result = wrapSourceCdata(nested);
        assert.ok(result.includes(
            '<Source><![CDATA[\nSystem.out.println("hi");\nif (a < b) {\n  return wfcontext.getStepName();\n}\n]]></Source>'),
            `unexpected result:\n${result}`);
    });
});
