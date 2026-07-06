import * as vscode from "vscode";
import { getObjectTypeDefinition } from "../models/ObjectTypes";
import { TenantInfo } from "../models/TenantInfo";
import { IIQClient, RunRuleResult } from "../services/IIQClient";
import { TenantService } from "../services/TenantService";
import { isEmpty } from "../utils/stringUtils";
import { chooseTenant, withProgress } from "../utils/vsCodeHelpers";
import { buildResourceUri } from "../utils/UriUtils";
import { getObjectInfoFromXml } from "../utils/xmlUtils";
import { ObjectTreeItem, ObjectTypeTreeItem } from "../views/IIQTreeItem";
import { QuickPickObjectStep } from "../wizard/quickPickObjectStep";
import { QuickPickRuleTypeStep } from "../wizard/quickPickRuleTypeStep";
import { QuickPickTenantStep } from "../wizard/quickPickTenantStep";
import { runWizard } from "../wizard/wizard";
import { InputPromptStep } from "../wizard/inputPromptStep";
import { ObjectSummary } from "../models/ObjectTypes";

/**
 * Command to run a rule on an environment and display its result.
 */
export class RuleCommands {

    private outputChannel: vscode.OutputChannel | undefined;

    constructor(private readonly tenantService: TenantService) { }

    /**
     * Runs a rule. Entry points:
     * - rule context menu in the tree view (environment and rule known),
     * - editor context menu on a Rule XML file (rule name parsed from the XML),
     * - command palette (environment and rule pickers).
     * Optional rule arguments can be provided as JSON.
     */
    public async runRule(arg?: ObjectTreeItem | vscode.Uri): Promise<void> {
        let tenant: TenantInfo | undefined;
        let ruleName: string | undefined;

        if (arg instanceof ObjectTreeItem) {
            // From the tree view
            tenant = arg.tenant;
            ruleName = arg.object.name;
        } else if (arg instanceof vscode.Uri || this.isRuleXmlEditorActive()) {
            // From an XML file: the rule name is parsed from the XML itself
            const document = arg instanceof vscode.Uri
                ? await vscode.workspace.openTextDocument(arg)
                : vscode.window.activeTextEditor!.document;
            const objectInfo = getObjectInfoFromXml(document.getText());
            if (!objectInfo || objectInfo.objectType !== "Rule") {
                vscode.window.showErrorMessage("The current file is not an IdentityIQ Rule.");
                return;
            }
            ruleName = objectInfo.name;
            tenant = this.tenantService.getActiveTenant()
                ?? await chooseTenant(this.tenantService, `Run rule "${ruleName}"`);
        } else {
            // From the command palette: environment then rule pickers
            const context = await runWizard({
                title: "Run a rule",
                promptSteps: [
                    new QuickPickTenantStep({ tenantService: this.tenantService }),
                    new QuickPickObjectStep({
                        tenantService: this.tenantService,
                        name: "rule",
                        getObjectType: () => getObjectTypeDefinition("Rule")!
                    })
                ]
            });
            if (!context) {
                return;
            }
            tenant = context.tenant as TenantInfo;
            ruleName = (context.rule as ObjectSummary).name;
        }
        if (!tenant || !ruleName) {
            return;
        }

        const args = await this.promptRuleArguments();
        if (args === undefined) {
            return; // cancelled
        }

        try {
            const result = await withProgress(`Running rule "${ruleName}" on ${tenant.name}...`,
                () => new IIQClient(tenant!, this.tenantService).runRule(ruleName!, args));
            this.showResult(tenant, ruleName, args, result);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Creates a new rule. Entry point:
     * - rule type tree item context menu (addRule icon on the Rules node).
     * The tenant is inferred from the tree item, so only asks for
     * rule type and rule name.
     */
    public async addRule(arg?: ObjectTypeTreeItem): Promise<void> {
        let tenant: TenantInfo | undefined;

        if (arg instanceof ObjectTypeTreeItem) {
            tenant = arg.tenant;
        }

        if (!tenant) {
            return;
        }

        const context = await runWizard({
            title: "Create a new rule",
            promptSteps: [
                new QuickPickRuleTypeStep(),
                new InputPromptStep({
                    name: "ruleName",
                    displayName: "rule name",
                    options: {
                        prompt: "Enter the rule name",
                        placeHolder: "MyRule",
                        validateInput: (value) => {
                            if (isEmpty(value)) {
                                return "Rule name cannot be empty";
                            }
                            return "";
                        }
                    }
                })
            ]
        });

        if (!context) {
            return;
        }

        const ruleType = context.ruleType as string;
        const ruleName = context.ruleName as string;

        if (!tenant || !ruleName) {
            return;
        }

        const ruleXml = this.generateRuleXml(ruleName, ruleType);

        try {
            await withProgress(`Creating rule "${ruleName}" on ${tenant.name}...`,
                () => new IIQClient(tenant, this.tenantService).importXml(ruleXml));

            const uri = this.buildRuleUri(tenant, ruleName);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`Rule "${ruleName}" created successfully.`);
        } catch (error) {
            vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }

    private generateRuleXml(name: string, type: string): string {
        const typeAttr = type ? ` type="${type}"` : "";
        const signature = this.getSignatureForRuleType(type);
        const signatureXml = signature ? `\n  ${signature}\n` : "";
        return `<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE Rule PUBLIC "sailpoint.dtd" "sailpoint.dtd">
<Rule name="${name}" language="beanshell"${typeAttr}>
  <Description></Description>${signatureXml}  <Source><![CDATA[
    return null;
  ]]></Source>
</Rule>
`;
    }

    private getSignatureForRuleType(type: string): string | undefined {
        const signatures: Record<string, string> = {
            "IdentityAttribute": `<Signature returnType='String'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='environment' type='Map' />
      <Argument name='identity' type='Identity' />
      <Argument name='attributeDefinition' type='ObjectAttribute' />
    </Inputs>
  </Signature>`,
            "IdentityCreation": `<Signature returnType='Identity'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='environment' type='Map' />
      <Argument name='application' type='Application' />
      <Argument name='account' type='ResourceObject' />
      <Argument name='identity' type='Identity' />
    </Inputs>
  </Signature>`,
            "IdentityTrigger": `<Signature returnType='boolean'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='previousIdentity' type='Identity' />
      <Argument name='newIdentity' type='Identity' />
    </Inputs>
  </Signature>`,
            "Refresh": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='environment' type='Map' />
      <Argument name='identity' type='Identity' />
    </Inputs>
  </Signature>`,
            "FieldValue": `<Signature returnType='String'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='identity' type='Identity' />
      <Argument name='accountRequest' type='Object' />
      <Argument name='field' type='Object' />
    </Inputs>
  </Signature>`,
            "Correlation": `<Signature returnType='Map'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='environment' type='Map' />
      <Argument name='application' type='Application' />
      <Argument name='account' type='ResourceObject' />
      <Argument name='link' type='Link' />
    </Inputs>
  </Signature>`,
            "ManagerCorrelation": `<Signature returnType='String'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='environment' type='Map' />
      <Argument name='application' type='Application' />
      <Argument name='instance' type='Object' />
      <Argument name='managerAttributeValue' type='Object' />
    </Inputs>
  </Signature>`,
            "PreIterate": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='application' type='Application' />
      <Argument name='schema' type='Schema' />
      <Argument name='stats' type='Map' />
    </Inputs>
  </Signature>`,
            "PostIterate": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='application' type='Application' />
      <Argument name='schema' type='Schema' />
      <Argument name='stats' type='Map' />
    </Inputs>
  </Signature>`,
            "BeforeProvisioning": `<Signature returnType='ProvisioningPlan'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='plan' type='ProvisioningPlan' />
      <Argument name='application' type='Application' />
    </Inputs>
  </Signature>`,
            "AfterProvisioning": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='plan' type='ProvisioningPlan' />
      <Argument name='application' type='Application' />
      <Argument name='result' type='ProvisioningResult' />
    </Inputs>
  </Signature>`,
            "Validation": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='identity' type='Identity' />
      <Argument name='app' type='Application' />
      <Argument name='form' type='Object' />
      <Argument name='field' type='Object' />
      <Argument name='value' type='Object' />
    </Inputs>
  </Signature>`,
            "AllowedValues": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='identity' type='Identity' />
      <Argument name='form' type='Object' />
      <Argument name='field' type='Object' />
    </Inputs>
  </Signature>`,
            "Owner": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='identity' type='Identity' />
      <Argument name='role' type='Bundle' />
      <Argument name='application' type='Application' />
      <Argument name='template' type='Object' />
      <Argument name='field' type='Object' />
    </Inputs>
  </Signature>`,
            "Policy": `<Signature returnType='PolicyViolation'>
    <Inputs>
      <Argument name='identity' type='Identity' />
      <Argument name='policy' type='Policy' />
      <Argument name='constraint' type='Object' />
    </Inputs>
  </Signature>`,
            "PolicyNotification": `<Signature returnType='Map'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='violation' type='PolicyViolation' />
      <Argument name='policy' type='Policy' />
    </Inputs>
  </Signature>`,
            "Escalation": `<Signature returnType='String'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='item' type='Notifiable' />
    </Inputs>
  </Signature>`,
            "IdentityFilterGenerator": `<Signature returnType='Filter'>
    <Inputs>
      <Argument name='requester' type='Identity' />
    </Inputs>
  </Signature>`,
            "Workflow": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='wfcontext' type='WorkflowContext' />
      <Argument name='handler' type='WorkflowHandler' />
      <Argument name='workflow' type='Workflow' />
      <Argument name='step' type='Workflow.Step' />
      <Argument name='approval' type='Approval' />
    </Inputs>
  </Signature>`,
            "CertificationPhaseChange": `<Signature returnType='void'>
    <Inputs>
      <Argument name='certification' type='Certification' />
      <Argument name='certificationItem' type='CertificationItem' />
      <Argument name='previousPhase' type='String' />
      <Argument name='nextPhase' type='String' />
    </Inputs>
  </Signature>`,
            "ActivityCorrelation": `<Signature returnType='Map'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='application' type='Application' />
      <Argument name='datasource' type='Object' />
      <Argument name='activity' type='Object' />
    </Inputs>
  </Signature>`,
            "CompositeAccount": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='identity' type='Identity' />
      <Argument name='application' type='Application' />
    </Inputs>
  </Signature>`,
            "LinkAttribute": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='link' type='Link' />
    </Inputs>
  </Signature>`,
            "RequestObjectSelector": `<Signature returnType='Filter'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='requestor' type='Identity' />
      <Argument name='requestee' type='Identity' />
    </Inputs>
  </Signature>`,
            "ScopeCorrelation": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='identity' type='Identity' />
      <Argument name='scopeCorrelationAttribute' type='String' />
      <Argument name='scopeCorrelationAttributeValue' type='Object' />
      <Argument name='context' type='SailPointContext' />
    </Inputs>
  </Signature>`,
            "WorkItemForward": `<Signature returnType='Object'>
    <Inputs>
      <Argument name='context' type='SailPointContext' />
      <Argument name='item' type='WorkItem' />
      <Argument name='owner' type='Identity' />
    </Inputs>
  </Signature>`
        };
        return signatures[type];
    }

    private buildRuleUri(tenant: TenantInfo, ruleName: string): vscode.Uri {
        return buildResourceUri({
            tenantId: tenant.id,
            tenantName: tenant.name,
            objectType: "Rule",
            objectName: ruleName
        });
    }

    /**
     * Prompts for optional rule arguments as a JSON object.
     * Returns {} if left empty, or undefined if the user cancelled.
     */
    private async promptRuleArguments(): Promise<Record<string, unknown> | undefined> {
        const input = await vscode.window.showInputBox({
            prompt: "Enter the rule arguments as a JSON object (optional)",
            placeHolder: "{ \"identityName\": \"spadmin\" }",
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (isEmpty(value)) {
                    return "";
                }
                try {
                    const parsed = JSON.parse(value);
                    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
                        ? "" : "The arguments must be a JSON object";
                } catch {
                    return "Invalid JSON";
                }
            }
        });
        if (input === undefined) {
            return undefined;
        }
        return isEmpty(input) ? {} : JSON.parse(input);
    }

    /** Displays the rule result in the IdentityIQ output channel */
    private showResult(tenant: TenantInfo, ruleName: string, args: Record<string, unknown>, result: RunRuleResult): void {
        this.outputChannel ??= vscode.window.createOutputChannel("IdentityIQ");
        const output = this.outputChannel;
        output.appendLine("─".repeat(80));
        output.appendLine(`Rule: ${ruleName}`);
        output.appendLine(`Environment: ${tenant.name} (${tenant.url})`);
        output.appendLine(`Date: ${new Date().toISOString()}`);
        if (Object.keys(args).length > 0) {
            output.appendLine(`Arguments: ${JSON.stringify(args)}`);
        }
        if (result.executionTimeMs !== undefined) {
            output.appendLine(`Execution time: ${result.executionTimeMs} ms`);
        }
        output.appendLine("Result:");
        output.appendLine(typeof result.result === "string"
            ? result.result
            : JSON.stringify(result.result, null, 2));
        output.show(true);
    }

    private isRuleXmlEditorActive(): boolean {
        const document = vscode.window.activeTextEditor?.document;
        return !!document && document.uri.path.toLowerCase().endsWith(".xml");
    }

    public dispose(): void {
        this.outputChannel?.dispose();
    }
}
