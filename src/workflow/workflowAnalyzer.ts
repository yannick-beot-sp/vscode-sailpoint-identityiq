/**
 * Static analysis of a parsed workflow: structural problems that are easy to
 * miss in the raw XML (dangling transitions, unreachable steps...). The
 * issues are displayed in the preview panel next to the graph.
 */

import { WorkflowIssue, WorkflowModel, WorkflowStep } from "./workflowModel";

export function analyzeWorkflow(model: WorkflowModel): WorkflowIssue[] {
    const issues: WorkflowIssue[] = [];
    const stepsByName = new Map<string, WorkflowStep[]>();
    for (const step of model.steps) {
        const list = stepsByName.get(step.name);
        if (list) {
            list.push(step);
        } else {
            stepsByName.set(step.name, [step]);
        }
    }

    // Duplicate step names: transition targets become ambiguous.
    for (const [name, steps] of stepsByName) {
        if (steps.length > 1) {
            for (const step of steps.slice(1)) {
                issues.push({
                    severity: "error",
                    message: `Duplicate step name "${name}": transition targets are ambiguous`,
                    stepId: step.id,
                    start: step.start,
                    end: step.end
                });
            }
        }
    }

    const startSteps = model.steps.filter(s => s.kind === "start");
    if (model.steps.length > 0 && startSteps.length === 0) {
        issues.push({
            severity: "warning",
            message: "No Start step found (icon=\"Start\" or named \"Start\")",
            start: model.start,
            end: model.end
        });
    }
    if (model.steps.length > 0 && !model.steps.some(s => s.kind === "stop")) {
        issues.push({
            severity: "warning",
            message: "No Stop/End step found (icon=\"Stop\" or named \"Stop\"/\"End\")",
            start: model.start,
            end: model.end
        });
    }

    for (const step of model.steps) {
        let unconditionalSeen = false;
        for (const transition of step.transitions) {
            // Unknown target
            if (!stepsByName.has(transition.to)) {
                issues.push({
                    severity: "error",
                    message: `Step "${step.name}": transition to unknown step "${transition.to}"`,
                    stepId: step.id,
                    start: transition.start,
                    end: transition.end
                });
            }
            // Transitions after an unconditional one can never be taken
            if (unconditionalSeen) {
                issues.push({
                    severity: "warning",
                    message: `Step "${step.name}": transition to "${transition.to}" is unreachable (a previous transition has no "when" condition)`,
                    stepId: step.id,
                    start: transition.start,
                    end: transition.end
                });
            }
            // Unconditional self-loop never terminates
            if (!transition.when && transition.to === step.name) {
                issues.push({
                    severity: "warning",
                    message: `Step "${step.name}": unconditional transition to itself (infinite loop)`,
                    stepId: step.id,
                    start: transition.start,
                    end: transition.end
                });
            }
            if (!transition.when) {
                unconditionalSeen = true;
            }
        }

        // With conditional transitions only, the workflow silently ends when
        // no condition matches — usually an oversight.
        if (step.transitions.length > 0 && !unconditionalSeen) {
            const last = step.transitions[step.transitions.length - 1];
            issues.push({
                severity: "info",
                message: `Step "${step.name}": all transitions are conditional; the workflow ends here when none matches`,
                stepId: step.id,
                start: last.start,
                end: last.end
            });
        }

        // Dead end that is not a terminal step
        if (step.transitions.length === 0 && step.kind !== "stop") {
            issues.push({
                severity: "warning",
                message: `Step "${step.name}" has no outgoing transition: the workflow ends after it`,
                stepId: step.id,
                start: step.start,
                end: step.end
            });
        }
    }

    // Reachability from the Start step(s) (or the first step as a fallback,
    // which is where IIQ begins execution when there is no Start).
    if (model.steps.length > 0) {
        const roots = startSteps.length > 0 ? startSteps : [model.steps[0]];
        // Steps marked catches="..." are entered by the engine, not by transitions.
        for (const step of model.steps) {
            if (step.catches) {
                roots.push(step);
            }
        }
        const reachable = new Set<string>();
        const queue = [...roots];
        while (queue.length > 0) {
            const step = queue.pop()!;
            if (reachable.has(step.id)) {
                continue;
            }
            reachable.add(step.id);
            for (const transition of step.transitions) {
                for (const target of stepsByName.get(transition.to) ?? []) {
                    queue.push(target);
                }
            }
        }
        for (const step of model.steps) {
            if (!reachable.has(step.id)) {
                issues.push({
                    severity: "warning",
                    message: `Step "${step.name}" is unreachable: no transition leads to it`,
                    stepId: step.id,
                    start: step.start,
                    end: step.end
                });
            }
        }
    }

    const severityRank = { error: 0, warning: 1, info: 2 } as const;
    return issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.start - b.start);
}
