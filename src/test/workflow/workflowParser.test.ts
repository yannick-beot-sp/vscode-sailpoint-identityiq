import * as assert from "assert";
import { analyzeWorkflow } from "../../workflow/workflowAnalyzer";
import { WorkflowIssue } from "../../workflow/workflowModel";
import { looksLikeWorkflow, parseWorkflow, parseXmlElements } from "../../workflow/workflowParser";

const SAMPLE_WORKFLOW = `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Workflow PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Workflow explicitTransitions="true" libraries="Identity" name="Sample" type="IdentityLifecycle">
  <Variable input="true" name="identityName" required="true"/>
  <Variable initializer="false" name="scheduled"/>
  <Description>A sample workflow</Description>
  <Step icon="Start" name="Start">
    <Script>
      <Source>log.debug("start");</Source>
    </Script>
    <Transition to="Show Form" when="!scheduled"/>
    <Transition to="Do Call"/>
  </Step>
  <Step icon="Approval" name="Show Form">
    <Approval name="Show Form" owner="ref:requester" return="a, b">
      <Arg name="workItemType" value="string:Form"/>
      <Arg name="workItemForm" value="string:My Form"/>
    </Approval>
    <Transition to="Do Call"/>
  </Step>
  <Step action="call:buildApprovalSetFromNativeChanges" icon="Task" name="Do Call" resultVariable="out">
    <Arg name="plan" value="ref:plan"/>
    <Arg name="computed">
      <Script><Source>return 1;</Source></Script>
    </Arg>
    <Transition to="Sub"/>
  </Step>
  <Step name="Sub">
    <Arg name="identityName" value="ref:identityName"/>
    <WorkflowRef>
      <Reference class="sailpoint.object.Workflow" name="LCM Provisioning"/>
    </WorkflowRef>
    <Transition to="Notify"/>
  </Step>
  <Step action="sendEmail" condition="ref:doNotify" icon="Email" name="Notify">
    <Transition to="Run Rule"/>
  </Step>
  <Step action="rule:My Rule" name="Run Rule">
    <Transition to="Stop"/>
  </Step>
  <Step icon="Stop" name="Stop"/>
</Workflow>`;

suite("Workflow parser Test Suite", () => {

    test("parseXmlElements builds a tree with attributes, text and CDATA", () => {
        const roots = parseXmlElements(`<A x="1 &amp; 2"><B>hello <![CDATA[<world>]]></B><C/></A>`);
        assert.strictEqual(roots.length, 1);
        const a = roots[0];
        assert.strictEqual(a.name, "A");
        assert.strictEqual(a.attributes["x"], "1 & 2");
        assert.strictEqual(a.children.length, 2);
        assert.strictEqual(a.children[0].text, "hello <world>");
        assert.strictEqual(a.children[1].name, "C");
    });

    test("parseXmlElements recovers from a missing end tag", () => {
        const roots = parseXmlElements(`<A><B><C>text</C></A>`);
        assert.strictEqual(roots.length, 1);
        assert.strictEqual(roots[0].children[0].name, "B");
        assert.strictEqual(roots[0].children[0].children[0].name, "C");
    });

    test("looksLikeWorkflow", () => {
        assert.ok(looksLikeWorkflow(SAMPLE_WORKFLOW));
        assert.ok(!looksLikeWorkflow(`<Rule name="x"><Source>a</Source></Rule>`));
    });

    test("parseWorkflow extracts workflow attributes and variables", () => {
        const model = parseWorkflow(SAMPLE_WORKFLOW)!;
        assert.ok(model);
        assert.strictEqual(model.name, "Sample");
        assert.strictEqual(model.type, "IdentityLifecycle");
        assert.strictEqual(model.libraries, "Identity");
        assert.strictEqual(model.explicitTransitions, true);
        assert.strictEqual(model.description, "A sample workflow");
        assert.strictEqual(model.variables.length, 2);
        assert.deepStrictEqual(model.variables[0], {
            name: "identityName", input: true, output: undefined, required: true, initializer: undefined, description: undefined
        });
    });

    test("parseWorkflow detects step kinds", () => {
        const model = parseWorkflow(SAMPLE_WORKFLOW)!;
        const kinds = new Map(model.steps.map(s => [s.name, s.kind]));
        assert.strictEqual(kinds.get("Start"), "start");
        assert.strictEqual(kinds.get("Show Form"), "approval");
        assert.strictEqual(kinds.get("Do Call"), "call");
        assert.strictEqual(kinds.get("Sub"), "subprocess");
        assert.strictEqual(kinds.get("Notify"), "action");
        assert.strictEqual(kinds.get("Run Rule"), "rule");
        assert.strictEqual(kinds.get("Stop"), "stop");
    });

    test("parseWorkflow extracts step details", () => {
        const model = parseWorkflow(SAMPLE_WORKFLOW)!;
        const call = model.steps.find(s => s.name === "Do Call")!;
        assert.strictEqual(call.actionLabel, "buildApprovalSetFromNativeChanges");
        assert.strictEqual(call.resultVariable, "out");
        assert.deepStrictEqual(call.args.map(a => a.name), ["plan", "computed"]);
        assert.strictEqual(call.args[0].value, "ref:plan");
        assert.strictEqual(call.args[1].script, true);

        const sub = model.steps.find(s => s.name === "Sub")!;
        assert.strictEqual(sub.subprocess, "LCM Provisioning");

        const approval = model.steps.find(s => s.name === "Show Form")!;
        assert.strictEqual(approval.approvalOwner, "ref:requester");
        assert.strictEqual(approval.approvalForm, "string:My Form");

        const notify = model.steps.find(s => s.name === "Notify")!;
        assert.strictEqual(notify.condition, "ref:doNotify");

        const start = model.steps.find(s => s.name === "Start")!;
        assert.ok(start.scriptPreview?.includes("log.debug"));
        assert.deepStrictEqual(start.transitions.map(t => [t.to, t.when]), [
            ["Show Form", "!scheduled"],
            ["Do Call", undefined]
        ]);
    });

    test("parseWorkflow records offsets usable for reveal", () => {
        const model = parseWorkflow(SAMPLE_WORKFLOW)!;
        const sub = model.steps.find(s => s.name === "Sub")!;
        assert.strictEqual(SAMPLE_WORKFLOW.substring(sub.start, sub.start + 16), `<Step name="Sub"`);
        assert.ok(SAMPLE_WORKFLOW.substring(sub.start, sub.end).endsWith("</Step>"));
    });

    test("parseWorkflow synthesizes implicit transitions when explicitTransitions is off", () => {
        const model = parseWorkflow(`<Workflow name="W">
            <Step icon="Start" name="Start"/>
            <Step name="Middle"/>
            <Step icon="Stop" name="Stop"/>
        </Workflow>`)!;
        assert.strictEqual(model.explicitTransitions, false);
        assert.deepStrictEqual(model.steps[0].transitions.map(t => [t.to, t.implicit]), [["Middle", true]]);
        assert.deepStrictEqual(model.steps[1].transitions.map(t => [t.to, t.implicit]), [["Stop", true]]);
        assert.strictEqual(model.steps[2].transitions.length, 0);
    });

    test("parseWorkflow finds a Workflow nested in an import file", () => {
        const model = parseWorkflow(`<?xml version="1.0"?><sailpoint><ImportAction name="merge"/><Workflow name="Nested"><Step icon="Start" name="Start"/></Workflow></sailpoint>`);
        assert.strictEqual(model?.name, "Nested");
    });

    test("parseWorkflow returns undefined without a Workflow element", () => {
        assert.strictEqual(parseWorkflow(`<Rule name="x"/>`), undefined);
    });

    test("parseWorkflow decodes entities in attributes", () => {
        const model = parseWorkflow(`<Workflow explicitTransitions="true" name="W">
            <Step icon="Start" name="Start">
                <Transition to="Stop" when="when.equals(&#34;Now&#34;)"/>
            </Step>
            <Step icon="Stop" name="Stop"/>
        </Workflow>`)!;
        assert.strictEqual(model.steps[0].transitions[0].when, `when.equals("Now")`);
    });
});

suite("Workflow analyzer Test Suite", () => {

    function messagesOf(issues: WorkflowIssue[], severity?: string): string[] {
        return issues.filter(i => !severity || i.severity === severity).map(i => i.message);
    }

    test("clean workflow has no issue", () => {
        const model = parseWorkflow(SAMPLE_WORKFLOW)!;
        const issues = analyzeWorkflow(model);
        assert.deepStrictEqual(messagesOf(issues), []);
    });

    test("detects transition to unknown step", () => {
        const model = parseWorkflow(`<Workflow explicitTransitions="true" name="W">
            <Step icon="Start" name="Start"><Transition to="Nowhere"/></Step>
            <Step icon="Stop" name="Stop"/>
        </Workflow>`)!;
        const issues = analyzeWorkflow(model);
        assert.ok(messagesOf(issues, "error").some(m => m.includes(`unknown step "Nowhere"`)));
        // Stop is no longer reachable
        assert.ok(messagesOf(issues, "warning").some(m => m.includes(`"Stop" is unreachable`)));
    });

    test("detects duplicate step names", () => {
        const model = parseWorkflow(`<Workflow explicitTransitions="true" name="W">
            <Step icon="Start" name="Start"><Transition to="A"/></Step>
            <Step name="A"><Transition to="Stop"/></Step>
            <Step name="A"><Transition to="Stop"/></Step>
            <Step icon="Stop" name="Stop"/>
        </Workflow>`)!;
        const issues = analyzeWorkflow(model);
        assert.ok(messagesOf(issues, "error").some(m => m.includes(`Duplicate step name "A"`)));
    });

    test("detects missing Start and Stop", () => {
        const model = parseWorkflow(`<Workflow explicitTransitions="true" name="W">
            <Step name="A"><Transition to="A"/></Step>
        </Workflow>`)!;
        const messages = messagesOf(analyzeWorkflow(model), "warning");
        assert.ok(messages.some(m => m.includes("No Start step")));
        assert.ok(messages.some(m => m.includes("No Stop/End step")));
    });

    test("detects transitions shadowed by an unconditional one", () => {
        const model = parseWorkflow(`<Workflow explicitTransitions="true" name="W">
            <Step icon="Start" name="Start">
                <Transition to="Stop"/>
                <Transition to="Dead" when="x"/>
            </Step>
            <Step name="Dead"><Transition to="Stop"/></Step>
            <Step icon="Stop" name="Stop"/>
        </Workflow>`)!;
        const messages = messagesOf(analyzeWorkflow(model), "warning");
        assert.ok(messages.some(m => m.includes(`transition to "Dead" is unreachable`)));
        assert.ok(messages.some(m => m.includes(`"Dead" is unreachable`)));
    });

    test("detects dead end and conditional-only transitions", () => {
        const model = parseWorkflow(`<Workflow explicitTransitions="true" name="W">
            <Step icon="Start" name="Start"><Transition to="A" when="x"/></Step>
            <Step name="A"/>
            <Step icon="Stop" name="Stop"/>
        </Workflow>`)!;
        const issues = analyzeWorkflow(model);
        assert.ok(messagesOf(issues, "info").some(m => m.includes("all transitions are conditional")));
        assert.ok(messagesOf(issues, "warning").some(m => m.includes(`"A" has no outgoing transition`)));
    });

    test("detects unconditional self-loop", () => {
        const model = parseWorkflow(`<Workflow explicitTransitions="true" name="W">
            <Step icon="Start" name="Start"><Transition to="Start"/></Step>
        </Workflow>`)!;
        assert.ok(messagesOf(analyzeWorkflow(model), "warning").some(m => m.includes("infinite loop")));
    });

    test("steps with catches are considered reachable", () => {
        const model = parseWorkflow(`<Workflow explicitTransitions="true" name="W">
            <Step icon="Start" name="Start"><Transition to="Stop"/></Step>
            <Step catches="complete" name="Finalize"><Transition to="Stop"/></Step>
            <Step icon="Stop" name="Stop"/>
        </Workflow>`)!;
        const issues = analyzeWorkflow(model);
        assert.ok(!messagesOf(issues).some(m => m.includes("Finalize")));
    });
});
