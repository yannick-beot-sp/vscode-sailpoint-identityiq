/**
 * Data model shared between the extension host (parser/analyzer) and the
 * workflow preview webview. Everything is plain JSON-serializable data so it
 * can travel through `webview.postMessage`.
 *
 * Offsets (`start`/`end`) are character offsets in the source document, used
 * by the webview to ask the extension to reveal an element in the editor.
 */

/** Visual/behavioral category of a step, in detection priority order. */
export type StepKind =
    | "start"       // entry point (icon="Start" or named "Start")
    | "stop"        // terminal step (icon="Stop" or named "Stop"/"End")
    | "approval"    // contains an <Approval> (form or approval work item)
    | "subprocess"  // contains a <WorkflowRef> (calls another workflow)
    | "call"        // action="call:someMethod" (workflow library call)
    | "rule"        // action="rule:Some Rule"
    | "action"      // other action="..." (legacy library call form, e.g. sendEmail)
    | "script"      // contains a <Script><Source> to execute
    | "generic";    // none of the above (no-op / structural step)

export interface WorkflowArg {
    name: string;
    /** Literal value attribute; undefined when the Arg is computed by a nested <Script>. */
    value?: string;
    /** True when the Arg value comes from a nested <Script>. */
    script?: boolean;
}

export interface WorkflowTransition {
    /** Name of the target step, as written in the `to` attribute. */
    to: string;
    /** Condition (`when` attribute); undefined for an unconditional transition. */
    when?: string;
    /** True for the fall-through edge synthesized when explicitTransitions is off. */
    implicit?: boolean;
    start: number;
    end: number;
}

export interface WorkflowStep {
    /** Unique id within the model (steps may have duplicate names). */
    id: string;
    name: string;
    kind: StepKind;
    /** Value of the `icon` attribute (Task, Email, Message...), a rendering hint from the IIQ GUI editor. */
    icon?: string;
    /** Raw `action` attribute. */
    action?: string;
    /** Short label derived from the action (method name after "call:", rule name after "rule:"...). */
    actionLabel?: string;
    /** BeanShell condition (`condition` attribute): the step only executes when it evaluates to true. */
    condition?: string;
    resultVariable?: string;
    /** `catches` attribute (e.g. "complete"): the step is an error/completion handler. */
    catches?: string;
    /** Name of the workflow referenced by <WorkflowRef>, for subprocess steps. */
    subprocess?: string;
    /** Owner of the <Approval>, for approval steps. */
    approvalOwner?: string;
    /** Value of the workItemForm Arg of the <Approval>, when present. */
    approvalForm?: string;
    /** True when the step has a <Replicator> (fan-out over a list). */
    replicator?: boolean;
    /** First lines of the <Script><Source>, for the details panel. */
    scriptPreview?: string;
    args: WorkflowArg[];
    transitions: WorkflowTransition[];
    start: number;
    end: number;
}

export interface WorkflowVariable {
    name: string;
    input?: boolean;
    output?: boolean;
    required?: boolean;
    initializer?: string;
    /** Text of the nested <Description>, shown as a tooltip in the details panel. */
    description?: string;
}

export interface WorkflowModel {
    name: string;
    /** Workflow `type` attribute (IdentityLifecycle, LCMProvisioning...). */
    type?: string;
    libraries?: string;
    description?: string;
    /**
     * When false (IIQ default), a step without matching transition falls
     * through to the next step in document order; the parser then synthesizes
     * implicit transitions.
     */
    explicitTransitions: boolean;
    variables: WorkflowVariable[];
    steps: WorkflowStep[];
    start: number;
    end: number;
}

export type IssueSeverity = "error" | "warning" | "info";

export interface WorkflowIssue {
    severity: IssueSeverity;
    message: string;
    /** Id of the step the issue relates to, when applicable. */
    stepId?: string;
    start: number;
    end: number;
}
