import * as assert from "assert";
import { findBeanshellRegions, getRegionAtOffset } from "../../beanshell/beanshellRegions";

const SIMPLE_RULE = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Rule name="My Rule" language="beanshell" type="IdentityAttribute">
  <Source><![CDATA[
    return identity.getName();
  ]]></Source>
</Rule>
`;

const RULE_WITH_SIGNATURE = `<?xml version='1.0' encoding='UTF-8'?>
<Rule name='Correlate' language='beanshell' type='Correlation'>
  <Signature returnType='Map'>
    <Inputs>
      <Argument name='log' type='org.apache.commons.logging.Log'>
        <Description>The log object</Description>
      </Argument>
      <Argument name='application' type='Application'/>
      <Argument name='account' type='ResourceObject'/>
    </Inputs>
    <Returns>
      <Argument name='identity' type='Identity'/>
    </Returns>
  </Signature>
  <Source><![CDATA[
    Map map = new HashMap();
    return map;
  ]]></Source>
</Rule>
`;

const WORKFLOW = `<?xml version='1.0' encoding='UTF-8'?>
<Workflow name="My Workflow">
  <Step name="step1">
    <Script>
      <Source><![CDATA[ workflow.getName(); ]]></Source>
    </Script>
  </Step>
  <Step name="step2">
    <Script>
      <Source><![CDATA[ return "two"; ]]></Source>
    </Script>
  </Step>
</Workflow>
`;

suite("BeanShell regions Test Suite", () => {

    test("finds the region of a simple rule with correct offsets", () => {
        const regions = findBeanshellRegions(SIMPLE_RULE);
        assert.strictEqual(regions.length, 1);
        const region = regions[0];
        assert.strictEqual(region.container, "Rule");
        assert.strictEqual(region.ruleType, "IdentityAttribute");
        assert.strictEqual(SIMPLE_RULE.substring(region.start, region.end),
            "\n    return identity.getName();\n  ");
    });

    test("extracts the Signature inputs and return type of a rule", () => {
        const regions = findBeanshellRegions(RULE_WITH_SIGNATURE);
        assert.strictEqual(regions.length, 1);
        const region = regions[0];
        assert.strictEqual(region.ruleType, "Correlation");
        assert.strictEqual(region.signatureReturnType, "Map");
        assert.deepStrictEqual(region.signatureInputs, [
            { name: "log", type: "org.apache.commons.logging.Log" },
            { name: "application", type: "Application" },
            { name: "account", type: "ResourceObject" }
        ]);
    });

    test("finds every script of a workflow as a separate region", () => {
        const regions = findBeanshellRegions(WORKFLOW);
        assert.strictEqual(regions.length, 2);
        assert.ok(regions.every(r => r.container === "Script"));
        assert.strictEqual(WORKFLOW.substring(regions[0].start, regions[0].end),
            " workflow.getName(); ");
        assert.strictEqual(WORKFLOW.substring(regions[1].start, regions[1].end),
            " return \"two\"; ");
    });

    test("ignores commented-out rules", () => {
        const xml = `<sailpoint>
<!--
<Rule name="Old" type="Correlation">
  <Source><![CDATA[ return null; ]]></Source>
</Rule>
-->
<Rule name="New" type="IdentityAttribute">
  <Source><![CDATA[ return "x"; ]]></Source>
</Rule>
</sailpoint>`;
        const regions = findBeanshellRegions(xml);
        assert.strictEqual(regions.length, 1);
        assert.strictEqual(regions[0].ruleType, "IdentityAttribute");
        assert.strictEqual(xml.substring(regions[0].start, regions[0].end), " return \"x\"; ");
    });

    test("returns no region for XML without Source CDATA", () => {
        assert.deepStrictEqual(findBeanshellRegions("<Identity name='spadmin'/>"), []);
        // A CDATA outside a <Source> element is not BeanShell
        assert.deepStrictEqual(
            findBeanshellRegions("<Description><![CDATA[ some <text> ]]></Description>"), []);
    });

    test("a rule without type has an undefined ruleType", () => {
        const xml = `<Rule name="NoType"><Source><![CDATA[x]]></Source></Rule>`;
        const regions = findBeanshellRegions(xml);
        assert.strictEqual(regions.length, 1);
        assert.strictEqual(regions[0].container, "Rule");
        assert.strictEqual(regions[0].ruleType, undefined);
        assert.strictEqual(regions[0].signatureInputs, undefined);
    });

    test("a Source outside Rule and Script is container 'other'", () => {
        const xml = `<Application name="App">
  <AttributeDefinition/>
  <Source><![CDATA[ return 1; ]]></Source>
</Application>`;
        const regions = findBeanshellRegions(xml);
        assert.strictEqual(regions.length, 1);
        assert.strictEqual(regions[0].container, "other");
    });

    test("a region after a closed rule does not belong to it", () => {
        const xml = `<sailpoint>
<Rule name="First" type="Correlation">
  <Source><![CDATA[ return 1; ]]></Source>
</Rule>
<TaskDefinition name="task">
  <Script>
    <Source><![CDATA[ return 2; ]]></Source>
  </Script>
</TaskDefinition>
</sailpoint>`;
        const regions = findBeanshellRegions(xml);
        assert.strictEqual(regions.length, 2);
        assert.strictEqual(regions[0].container, "Rule");
        assert.strictEqual(regions[1].container, "Script");
    });

    test("a Source without CDATA (rule being written) is a plain-text region", () => {
        const xml = `<Rule name="Draft" type="Correlation"><Source>return 1;</Source></Rule>`;
        const regions = findBeanshellRegions(xml);
        assert.strictEqual(regions.length, 1);
        assert.strictEqual(xml.substring(regions[0].start, regions[0].end), "return 1;");
        assert.strictEqual(regions[0].container, "Rule");
        assert.strictEqual(regions[0].ruleType, "Correlation");
    });

    test("an empty Source is a zero-width region", () => {
        const xml = `<Rule name="Draft"><Source></Source></Rule>`;
        const regions = findBeanshellRegions(xml);
        assert.strictEqual(regions.length, 1);
        assert.strictEqual(regions[0].start, regions[0].end);
        assert.strictEqual(getRegionAtOffset(regions, regions[0].start), regions[0]);
    });

    test("a CDATA still being typed (no ]]> yet) ends at </Source> or at EOF", () => {
        const closedBySource = `<Rule name="R"><Source><![CDATA[ int x = 1; </Source></Rule>`;
        let regions = findBeanshellRegions(closedBySource);
        assert.strictEqual(regions.length, 1);
        assert.strictEqual(
            closedBySource.substring(regions[0].start, regions[0].end), " int x = 1; ");

        const openAtEof = `<Rule name="R"><Source><![CDATA[ int y = 2;`;
        regions = findBeanshellRegions(openAtEof);
        assert.strictEqual(regions.length, 1);
        assert.strictEqual(openAtEof.substring(regions[0].start, regions[0].end), " int y = 2;");
    });

    test("getRegionAtOffset finds the region containing an offset", () => {
        const regions = findBeanshellRegions(WORKFLOW);
        const first = regions[0];
        const second = regions[1];

        assert.strictEqual(getRegionAtOffset(regions, first.start), first);
        assert.strictEqual(getRegionAtOffset(regions, first.end), first);
        assert.strictEqual(getRegionAtOffset(regions, second.start + 3), second);
        assert.strictEqual(getRegionAtOffset(regions, 0), undefined);
        assert.strictEqual(getRegionAtOffset(regions, first.end + 5), undefined);
        assert.strictEqual(getRegionAtOffset([], 10), undefined);
    });
});
