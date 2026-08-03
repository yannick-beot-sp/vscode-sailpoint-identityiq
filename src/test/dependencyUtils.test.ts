import * as assert from "assert";
import { extractObjectReferences, referenceKey } from "../utils/dependencyUtils";

const SAMPLE_APPLICATION = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Application PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Application name="Oracle EBS">
  <AccountCorrelationConfig>
    <Reference class="sailpoint.object.CorrelationConfig" name="Oracle EBS Correlation"/>
  </AccountCorrelationConfig>
  <CreationRule>
    <Reference class="sailpoint.object.Rule" name="SERI - Identity Creation Script"/>
  </CreationRule>
  <CustomizationRule>
    <Reference class="sailpoint.object.Rule" name="HR Aggregation Processor"/>
  </CustomizationRule>
  <Attributes>
    <Map>
      <entry key="beforeProvisioningRule" value="Before Prov Rule"/>
      <entry key="afterProvisioningRule" value="After Prov Rule"/>
      <entry key="connectorArgs">
        <value>
          <Map>
            <entry key="beforeRule">
              <value>WS Before Rule</value>
            </entry>
            <entry key="afterRule">
              <value>WS After Rule</value>
            </entry>
          </Map>
        </value>
      </entry>
    </Map>
  </Attributes>
  <ProvisioningForms>
    <Form name="Provisioning Form">
      <Section name="User Details">
        <Field name="sAMAccountName" type="string">
          <RuleRef>
            <Reference class="sailpoint.object.Rule" name="Provisioning Policy - sAMAccountName"/>
          </RuleRef>
        </Field>
      </Section>
    </Form>
  </ProvisioningForms>
</Application>`;

const SAMPLE_WORKFLOW = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Workflow PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Workflow name="Parent Workflow">
  <Step name="sub">
    <WorkflowRef>
      <Reference class="sailpoint.object.Workflow" name="Child Workflow"/>
    </WorkflowRef>
  </Step>
  <Step name="run rule">
    <Script>
      <Source><![CDATA[// not parsed]]></Source>
    </Script>
  </Step>
</Workflow>`;

const SAMPLE_BUNDLE = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Bundle PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Bundle name="Parent Role">
  <Requirements>
    <Reference class="sailpoint.object.Bundle" name="Required Role"/>
  </Requirements>
  <Permits>
    <Reference class="sailpoint.object.Bundle" name="Permitted Role"/>
  </Permits>
  <Classifications>
    <Reference class="sailpoint.object.Classification" name="SOX"/>
  </Classifications>
</Bundle>`;

const SAMPLE_FORM = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Form PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Form name="My Form">
  <Section name="Main">
    <Field name="field1" type="string">
      <RuleRef>
        <Reference class="sailpoint.object.Rule" name="Validation Rule"/>
      </RuleRef>
      <AllowedValuesDefinition>
        <RuleRef>
          <Reference class="sailpoint.object.Rule" name="Allowed Values Rule"/>
        </RuleRef>
      </AllowedValuesDefinition>
    </Field>
  </Section>
</Form>`;

const SAMPLE_QUICKLINK = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE QuickLink PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<QuickLink name="AD Group Create">
  <Attributes>
    <Map>
      <entry key="workflowName" value="AD Group Management - Create"/>
    </Map>
  </Attributes>
</QuickLink>`;

const SAMPLE_RULE = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Rule name="Library Rule">
  <ReferencedRules>
    <Reference class="sailpoint.object.Rule" name="Helper Rule"/>
  </ReferencedRules>
</Rule>`;

function names(refs: ReturnType<typeof extractObjectReferences>): string[] {
    return refs.map(ref => `${ref.objectType}:${ref.name}`).sort();
}

suite("dependencyUtils Test Suite", () => {

    test("extractObjectReferences finds Application dependencies", () => {
        const refs = extractObjectReferences(SAMPLE_APPLICATION);
        assert.deepStrictEqual(names(refs), [
            "CorrelationConfig:Oracle EBS Correlation",
            "Rule:After Prov Rule",
            "Rule:Before Prov Rule",
            "Rule:HR Aggregation Processor",
            "Rule:Provisioning Policy - sAMAccountName",
            "Rule:SERI - Identity Creation Script",
            "Rule:WS After Rule",
            "Rule:WS Before Rule"
        ]);
    });

    test("extractObjectReferences finds Workflow subprocess references", () => {
        const refs = extractObjectReferences(SAMPLE_WORKFLOW);
        assert.deepStrictEqual(names(refs), ["Workflow:Child Workflow"]);
    });

    test("extractObjectReferences finds Bundle role and classification dependencies", () => {
        const refs = extractObjectReferences(SAMPLE_BUNDLE);
        assert.deepStrictEqual(names(refs), [
            "Bundle:Permitted Role",
            "Bundle:Required Role",
            "Classification:SOX"
        ]);
    });

    test("extractObjectReferences finds Form rule dependencies", () => {
        const refs = extractObjectReferences(SAMPLE_FORM);
        assert.deepStrictEqual(names(refs), [
            "Rule:Allowed Values Rule",
            "Rule:Validation Rule"
        ]);
    });

    test("extractObjectReferences finds QuickLink workflowName dependency", () => {
        const refs = extractObjectReferences(SAMPLE_QUICKLINK);
        assert.deepStrictEqual(names(refs), ["Workflow:AD Group Management - Create"]);
    });

    test("extractObjectReferences finds Rule referenced rules", () => {
        const refs = extractObjectReferences(SAMPLE_RULE);
        assert.deepStrictEqual(names(refs), ["Rule:Helper Rule"]);
    });

    test("extractObjectReferences ignores Identity references", () => {
        const xml = `<Workflow name="W">
  <Step name="s"><Approval owner="spadmin">
    <Reference class="sailpoint.object.Identity" name="jsmith"/>
  </Approval></Step>
</Workflow>`;
        assert.deepStrictEqual(extractObjectReferences(xml), []);
    });

    test("extractObjectReferences deduplicates repeated references", () => {
        const xml = `<Rule name="R">
  <ReferencedRules>
    <Reference class="sailpoint.object.Rule" name="Helper Rule"/>
    <Reference class="sailpoint.object.Rule" name="Helper Rule"/>
  </ReferencedRules>
</Rule>`;
        assert.strictEqual(extractObjectReferences(xml).length, 1);
    });

    test("referenceKey builds a stable deduplication key", () => {
        assert.strictEqual(referenceKey({ objectType: "Rule", name: "X" }), "Rule/X");
    });
});
