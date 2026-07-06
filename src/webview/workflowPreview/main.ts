/**
 * Workflow preview webview script.
 *
 * Receives the parsed {@link WorkflowModel} and analysis issues from the
 * extension host, lays the steps out with dagre and renders an interactive
 * SVG graph: pan/zoom, node selection with a details sidebar, issues list,
 * and click-through to the XML source.
 */

import * as dagre from "@dagrejs/dagre";
import { StepKind, WorkflowIssue, WorkflowModel, WorkflowStep, WorkflowTransition } from "../../workflow/workflowModel";

interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): PersistedState | undefined;
    setState(state: PersistedState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface PersistedState {
    rankdir: "LR" | "TB";
    sidebarWidth?: number;
}

const vscode = acquireVsCodeApi();

const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_MIN_WIDTH = 110;
const NODE_MAX_WIDTH = 280;
const KIND_LABELS: Record<StepKind, string> = {
    start: "start",
    stop: "end",
    approval: "approval",
    subprocess: "subprocess",
    call: "call",
    rule: "rule",
    action: "action",
    script: "script",
    generic: "step"
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let model: WorkflowModel | null = null;
let issues: WorkflowIssue[] = [];
let selectedStepId: string | undefined;
let rankdir: "LR" | "TB" = vscode.getState()?.rankdir ?? "LR";
// Pan/zoom transform of the viewport group
let scale = 1;
let panX = 0;
let panY = 0;
let fitOnNextRender = true;

// ---------------------------------------------------------------------------
// Static DOM skeleton
// ---------------------------------------------------------------------------

const app = document.getElementById("app")!;
app.innerHTML = `
    <header class="toolbar">
        <span id="wfName" class="wf-name"></span>
        <span id="wfType" class="chip" hidden></span>
        <span class="spacer"></span>
        <span id="issueSummary" class="issue-summary"></span>
        <button id="btnDir" class="tool-btn" title="Toggle layout direction"></button>
        <button id="btnZoomOut" class="tool-btn" title="Zoom out">−</button>
        <span id="zoomLevel" class="zoom-level">100%</span>
        <button id="btnZoomIn" class="tool-btn" title="Zoom in">+</button>
        <button id="btnFit" class="tool-btn" title="Fit to view">Fit</button>
    </header>
    <div class="content">
        <div id="canvas" class="canvas">
            <svg id="svg" xmlns="${SVG_NS}">
                <defs>
                    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M 0 1 L 9 5 L 0 9 z"></path>
                    </marker>
                    <marker id="arrow-error" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M 0 1 L 9 5 L 0 9 z"></path>
                    </marker>
                </defs>
                <g id="viewport"></g>
            </svg>
            <div id="legend" class="legend"></div>
            <div id="empty" class="empty" hidden>No Workflow found in this document.</div>
        </div>
        <div id="resizer" class="resizer"></div>
        <aside id="sidebar" class="sidebar">
            <section id="issuesSection" hidden>
                <h2>Problems</h2>
                <ul id="issuesList" class="issues"></ul>
            </section>
            <section id="detailsSection">
                <h2 id="detailsTitle">Workflow</h2>
                <div id="detailsBody"></div>
            </section>
        </aside>
    </div>`;

const el = (id: string) => document.getElementById(id)!;
const svg = el("svg") as unknown as SVGSVGElement;
const viewport = el("viewport") as unknown as SVGGElement;
const canvas = el("canvas");
const sidebar = el("sidebar");

buildLegend();
setupSidebarResize();

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Measures text with the canvas 2D API for accurate node sizing. */
const measureContext = document.createElement("canvas").getContext("2d")!;
function textWidth(text: string, font: string): number {
    measureContext.font = font;
    return measureContext.measureText(text).width;
}

function bodyFont(size: number, bold = false): string {
    const family = getComputedStyle(document.body).getPropertyValue("--vscode-font-family") || "sans-serif";
    return `${bold ? "600 " : ""}${size}px ${family}`;
}

function truncate(text: string, max: number): string {
    return text.length > max ? text.substring(0, max - 1) + "…" : text;
}

/** Secondary line displayed under the step name, depending on its kind. */
function subLabel(step: WorkflowStep): string | undefined {
    switch (step.kind) {
        case "call": return `ƒ ${step.actionLabel}`;
        case "rule": return `rule: ${step.actionLabel}`;
        case "action": return `ƒ ${step.action}`;
        case "subprocess": return `↳ ${step.subprocess ?? "?"}`;
        case "approval": return step.approvalForm ? `form: ${step.approvalForm}` : (step.approvalOwner ? `owner: ${step.approvalOwner}` : "approval");
        case "script": return "script";
        default: return undefined;
    }
}

interface NodeInfo {
    step?: WorkflowStep;          // undefined for "missing target" ghost nodes
    missingName?: string;
    label: string;
    sub?: string;
    width: number;
    height: number;
}

function render(): void {
    viewport.innerHTML = "";
    const empty = el("empty");
    if (!model || model.steps.length === 0) {
        empty.hidden = false;
        return;
    }
    empty.hidden = true;

    const errorStepIds = new Set(issues.filter(i => i.severity === "error" && i.stepId).map(i => i.stepId!));

    // --- build graph -------------------------------------------------------
    const g = new dagre.graphlib.Graph<dagre.GraphLabel, dagre.NodeLabel, dagre.EdgeLabel>({ multigraph: true });
    g.setGraph({ rankdir, nodesep: 24, ranksep: rankdir === "LR" ? 55 : 45, marginx: 20, marginy: 20 });
    g.setDefaultEdgeLabel(() => ({}));

    const nodes = new Map<string, NodeInfo>();
    const stepIdsByName = new Map<string, string>();
    for (const step of model.steps) {
        if (!stepIdsByName.has(step.name)) {
            stepIdsByName.set(step.name, step.id);
        }
        const label = truncate(step.name, 32);
        const sub = subLabel(step);
        const subText = sub ? truncate(sub, 36) : undefined;
        const width = Math.min(NODE_MAX_WIDTH, Math.max(
            NODE_MIN_WIDTH,
            Math.ceil(Math.max(
                textWidth(label, bodyFont(13, true)),
                subText ? textWidth(subText, bodyFont(11)) : 0
            )) + 28
        ));
        const info: NodeInfo = { step, label, sub: subText, width, height: subText ? 52 : 38 };
        nodes.set(step.id, info);
        g.setNode(step.id, { width: info.width, height: info.height });
    }

    interface EdgeInfo {
        from: WorkflowStep;
        transition: WorkflowTransition;
        targetId: string;
        error: boolean;
        selfLoop: boolean;
    }
    const edges: EdgeInfo[] = [];
    for (const step of model.steps) {
        for (const transition of step.transitions) {
            let targetId = stepIdsByName.get(transition.to);
            let error = false;
            if (!targetId) {
                // Ghost node for a transition to a nonexistent step
                targetId = `missing:${transition.to}`;
                error = true;
                if (!nodes.has(targetId)) {
                    const label = truncate(transition.to, 32);
                    const width = Math.max(NODE_MIN_WIDTH, Math.ceil(textWidth(label, bodyFont(13, true))) + 28);
                    nodes.set(targetId, { missingName: transition.to, label, sub: "step not found", width, height: 52 });
                    g.setNode(targetId, { width, height: 52 });
                }
            }
            const selfLoop = targetId === step.id;
            const edge: EdgeInfo = { from: step, transition, targetId, error, selfLoop };
            edges.push(edge);
            if (!selfLoop) {
                const labelText = edgeLabel(transition);
                g.setEdge(step.id, targetId, labelText ? {
                    width: textWidth(truncate(labelText, 30), bodyFont(11)) + 8,
                    height: 16,
                    labelpos: "c"
                } : {}, String(edges.length - 1));
            }
        }
    }

    dagre.layout(g);

    // --- render edges (under nodes) ----------------------------------------
    for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        if (edge.selfLoop) {
            renderSelfLoop(g.node(edge.from.id), edge.transition);
            continue;
        }
        const layout = g.edge(edge.from.id, edge.targetId, String(i));
        if (layout) {
            renderEdge(edge.transition, layout, edge.error);
        }
    }

    // --- render nodes -------------------------------------------------------
    for (const [id, info] of nodes) {
        const pos = g.node(id);
        renderNode(id, info, pos.x ?? 0, pos.y ?? 0, errorStepIds.has(id));
    }

    if (fitOnNextRender) {
        fitOnNextRender = false;
        fitToView();
    } else {
        applyTransform();
    }
}

function edgeLabel(transition: WorkflowTransition): string | undefined {
    if (transition.implicit) {
        return "(next)";
    }
    return transition.when ? truncate(transition.when.trim().replace(/\s+/g, " "), 30) : undefined;
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) {
        element.setAttribute(key, value);
    }
    return element;
}

/** Path through the dagre points, with slight quadratic smoothing at bends. */
function edgePath(points: Array<{ x: number; y: number }>): string {
    if (points.length < 2) {
        return "";
    }
    let d = `M ${points[0].x} ${points[0].y}`;
    if (points.length === 2) {
        return d + ` L ${points[1].x} ${points[1].y}`;
    }
    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i];
        const next = points[i + 1];
        const midX = (p.x + next.x) / 2;
        const midY = (p.y + next.y) / 2;
        d += ` Q ${p.x} ${p.y} ${midX} ${midY}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
}

function renderEdge(transition: WorkflowTransition, layout: dagre.EdgeLabel, error: boolean): void {
    const group = svgElement("g");
    group.classList.add("edge");
    if (transition.when) { group.classList.add("conditional"); }
    if (transition.implicit) { group.classList.add("implicit"); }
    if (error) { group.classList.add("error"); }

    const path = svgElement("path", {
        d: edgePath(layout.points ?? []),
        "marker-end": error ? "url(#arrow-error)" : "url(#arrow)"
    });
    group.appendChild(path);

    const label = edgeLabel(transition);
    if (label && layout.x !== undefined && layout.y !== undefined) {
        appendEdgeLabel(group, label, transition.when, layout.x, layout.y);
    }
    viewport.appendChild(group);
}

/** Self-transitions are laid out manually as a small loop beside the node. */
function renderSelfLoop(pos: dagre.NodeLabel, transition: WorkflowTransition): void {
    const group = svgElement("g");
    group.classList.add("edge");
    if (transition.when) { group.classList.add("conditional"); }
    const x = (pos.x ?? 0) + pos.width / 2;
    const y = pos.y ?? 0;
    const d = `M ${x} ${y - 8} C ${x + 40} ${y - 26}, ${x + 40} ${y + 26}, ${x} ${y + 8}`;
    group.appendChild(svgElement("path", { d, "marker-end": "url(#arrow)" }));
    const label = edgeLabel(transition);
    if (label) {
        appendEdgeLabel(group, label, transition.when, x + 44, y);
    }
    viewport.appendChild(group);
}

function appendEdgeLabel(group: SVGGElement, label: string, fullText: string | undefined, x: number, y: number): void {
    const text = svgElement("text", { x: String(x), y: String(y), class: "edge-label" });
    text.textContent = label;
    if (fullText) {
        const title = svgElement("title");
        title.textContent = fullText;
        text.appendChild(title);
    }
    group.appendChild(text);
    // Background rectangle so the label stays readable over edges
    const box = text.getBBox?.();
    if (box && box.width > 0) {
        const rect = svgElement("rect", {
            x: String(box.x - 3), y: String(box.y - 1),
            width: String(box.width + 6), height: String(box.height + 2),
            class: "edge-label-bg", rx: "3"
        });
        group.insertBefore(rect, text);
    }
}

function renderNode(id: string, info: NodeInfo, x: number, y: number, hasError: boolean): void {
    const kind: StepKind | "missing" = info.step?.kind ?? "missing";
    const group = svgElement("g", { transform: `translate(${x - info.width / 2}, ${y - info.height / 2})` });
    group.classList.add("node", `node-${kind}`);
    if (hasError || kind === "missing") { group.classList.add("has-error"); }
    if (id === selectedStepId) { group.classList.add("selected"); }
    group.dataset.id = id;

    const stadium = kind === "start" || kind === "stop";
    group.appendChild(svgElement("rect", {
        class: "body",
        width: String(info.width),
        height: String(info.height),
        rx: stadium ? String(info.height / 2) : "6"
    }));
    if (kind === "subprocess") {
        // Double border: the classic notation for a call to another workflow
        group.appendChild(svgElement("rect", {
            class: "inner",
            x: "3", y: "3",
            width: String(info.width - 6),
            height: String(info.height - 6),
            rx: "4"
        }));
    }

    const centerY = info.sub ? 21 : info.height / 2 + 4;
    const name = svgElement("text", { x: String(info.width / 2), y: String(centerY), class: "node-name" });
    name.textContent = info.label;
    group.appendChild(name);
    if (info.sub) {
        const sub = svgElement("text", { x: String(info.width / 2), y: String(centerY + 17), class: "node-sub" });
        sub.textContent = info.sub;
        group.appendChild(sub);
    }

    // Badges: conditional execution, replicator, error handler
    const badges: Array<{ glyph: string; title: string }> = [];
    if (info.step?.condition) { badges.push({ glyph: "?", title: `Conditional step: ${info.step.condition}` }); }
    if (info.step?.replicator) { badges.push({ glyph: "≡", title: "Replicator: runs once per item" }); }
    if (info.step?.catches) { badges.push({ glyph: "⚡", title: `Catches: ${info.step.catches}` }); }
    if (hasError) { badges.push({ glyph: "!", title: "This step has errors (see Problems)" }); }
    badges.forEach((badge, i) => {
        const cx = info.width - 2 - i * 18;
        const badgeGroup = svgElement("g", { class: badge.glyph === "!" ? "badge badge-error" : "badge" });
        badgeGroup.appendChild(svgElement("circle", { cx: String(cx), cy: "2", r: "8" }));
        const glyph = svgElement("text", { x: String(cx), y: "6" });
        glyph.textContent = badge.glyph;
        badgeGroup.appendChild(glyph);
        const title = svgElement("title");
        title.textContent = badge.title;
        badgeGroup.appendChild(title);
        group.appendChild(badgeGroup);
    });

    const tooltip = svgElement("title");
    tooltip.textContent = info.step
        ? `${info.step.name}${info.step.action ? `\naction: ${info.step.action}` : ""}${info.step.condition ? `\ncondition: ${info.step.condition}` : ""}`
        : `No step is named "${info.missingName}"`;
    group.appendChild(tooltip);

    group.addEventListener("click", event => {
        event.stopPropagation();
        selectStep(info.step?.id);
    });
    group.addEventListener("dblclick", event => {
        event.stopPropagation();
        if (info.step) {
            vscode.postMessage({ type: "reveal", start: info.step.start, end: info.step.end });
        }
    });
    viewport.appendChild(group);
}

function buildLegend(): void {
    const legend = el("legend");
    const kinds: StepKind[] = ["start", "stop", "script", "call", "action", "rule", "approval", "subprocess"];
    for (const kind of kinds) {
        const item = document.createElement("span");
        item.className = `legend-item node-${kind}`;
        const dot = document.createElement("span");
        dot.className = "legend-dot";
        item.appendChild(dot);
        item.appendChild(document.createTextNode(KIND_LABELS[kind]));
        legend.appendChild(item);
    }
}

// ---------------------------------------------------------------------------
// Sidebar resize
// ---------------------------------------------------------------------------

function setupSidebarResize(): void {
    const resizer = el("resizer");
    const savedWidth = vscode.getState()?.sidebarWidth;
    if (savedWidth) {
        sidebar.style.width = `${savedWidth}px`;
    }

    let dragging = false;
    resizer.addEventListener("pointerdown", event => {
        dragging = true;
        resizer.classList.add("dragging");
        resizer.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    resizer.addEventListener("pointermove", event => {
        if (!dragging) {
            return;
        }
        const rect = document.querySelector(".content")!.getBoundingClientRect();
        const min = 220;
        const max = Math.min(640, rect.width - 260);
        const width = Math.min(max, Math.max(min, rect.right - event.clientX));
        sidebar.style.width = `${width}px`;
    });
    const stop = (event: PointerEvent): void => {
        if (!dragging) {
            return;
        }
        dragging = false;
        resizer.classList.remove("dragging");
        resizer.releasePointerCapture(event.pointerId);
        vscode.setState({ ...vscode.getState(), rankdir, sidebarWidth: sidebar.getBoundingClientRect().width });
    };
    resizer.addEventListener("pointerup", stop);
    resizer.addEventListener("pointercancel", stop);
}

// ---------------------------------------------------------------------------
// Selection & details sidebar
// ---------------------------------------------------------------------------

function selectStep(stepId: string | undefined): void {
    selectedStepId = stepId;
    for (const node of viewport.querySelectorAll<SVGGElement>(".node")) {
        node.classList.toggle("selected", node.dataset.id === stepId);
    }
    renderDetails();
}

/** Appends a label/value pair to a `.field-grid` container (CSS grid: label column + value column). */
function field(grid: HTMLElement, label: string, value: string, options?: { code?: boolean }): void {
    const dt = document.createElement("span");
    dt.className = "field-label";
    dt.textContent = label;
    grid.appendChild(dt);
    const dd = document.createElement(options?.code ? "code" : "span");
    dd.className = "field-value";
    dd.textContent = value;
    grid.appendChild(dd);
}

function fieldGrid(container: HTMLElement): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "field-grid";
    container.appendChild(grid);
    return grid;
}

function sectionHeading(container: HTMLElement, text: string, count?: number): void {
    const h = document.createElement("h3");
    h.textContent = text;
    if (count !== undefined) {
        const span = document.createElement("span");
        span.className = "count";
        span.textContent = ` (${count})`;
        h.appendChild(span);
    }
    container.appendChild(h);
}

function itemList(container: HTMLElement): HTMLElement {
    const ul = document.createElement("ul");
    ul.className = "item-list";
    container.appendChild(ul);
    return ul;
}

function pill(text: string, kind: "in" | "out" | "required" | "script"): HTMLElement {
    const span = document.createElement("span");
    span.className = `pill pill-${kind}`;
    span.textContent = text;
    return span;
}

/** Renders the workflow's variables, grouped into Input / Output / Local sections. */
function renderVariables(body: HTMLElement, variables: WorkflowModel["variables"]): void {
    if (variables.length === 0) {
        return;
    }
    const groups: Array<{ label: string; items: typeof variables }> = [
        { label: "Input variables", items: variables.filter(v => v.input) },
        { label: "Output variables", items: variables.filter(v => v.output && !v.input) },
        { label: "Local variables", items: variables.filter(v => !v.input && !v.output) }
    ];
    for (const group of groups) {
        if (group.items.length === 0) {
            continue;
        }
        sectionHeading(body, group.label, group.items.length);
        const ul = itemList(body);
        for (const variable of group.items) {
            const li = document.createElement("li");
            li.className = "item-row";
            if (variable.description) {
                li.title = variable.description;
            }
            const name = document.createElement("span");
            name.className = "item-name";
            name.textContent = variable.name;
            li.appendChild(name);
            if (variable.initializer !== undefined) {
                const eq = document.createElement("span");
                eq.className = "item-sep";
                eq.textContent = "=";
                li.appendChild(eq);
                const value = document.createElement("span");
                value.className = "item-value";
                value.textContent = truncate(variable.initializer, 60);
                li.appendChild(value);
            }
            const badges = document.createElement("span");
            badges.className = "item-badges";
            if (variable.required) { badges.appendChild(pill("req", "required")); }
            if (variable.description) {
                const info = document.createElement("span");
                info.className = "info-dot";
                info.textContent = "i";
                badges.appendChild(info);
            }
            li.appendChild(badges);
            ul.appendChild(li);
        }
    }
}

function renderDetails(): void {
    const title = el("detailsTitle");
    const body = el("detailsBody");
    body.innerHTML = "";
    if (!model) {
        title.textContent = "Workflow";
        return;
    }

    const step = model.steps.find(s => s.id === selectedStepId);
    if (!step) {
        // Workflow-level summary
        title.textContent = model.name;
        if (model.description) {
            const p = document.createElement("p");
            p.className = "description";
            p.textContent = model.description;
            body.appendChild(p);
        }
        const grid = fieldGrid(body);
        if (model.type) { field(grid, "Type", model.type); }
        if (model.libraries) { field(grid, "Libraries", model.libraries); }
        field(grid, "Explicit transitions", String(model.explicitTransitions));
        field(grid, "Steps", String(model.steps.length));

        renderVariables(body, model.variables);

        const hint = document.createElement("p");
        hint.className = "hint";
        hint.textContent = "Click a step for details. Double-click to open it in the editor.";
        body.appendChild(hint);
        return;
    }

    title.textContent = step.name;
    const chip = document.createElement("span");
    chip.className = `chip kind-chip node-${step.kind}`;
    chip.textContent = KIND_LABELS[step.kind];
    body.appendChild(chip);

    const grid = fieldGrid(body);
    if (step.action) { field(grid, "Action", step.action, { code: true }); }
    if (step.subprocess) { field(grid, "Workflow", step.subprocess); }
    if (step.approvalOwner) { field(grid, "Approval owner", step.approvalOwner, { code: true }); }
    if (step.approvalForm) { field(grid, "Form", step.approvalForm); }
    if (step.condition) { field(grid, "Condition", step.condition, { code: true }); }
    if (step.resultVariable) { field(grid, "Result variable", step.resultVariable, { code: true }); }
    if (step.catches) { field(grid, "Catches", step.catches); }
    if (step.replicator) { field(grid, "Replicator", "yes"); }

    if (step.args.length > 0) {
        sectionHeading(body, "Arguments", step.args.length);
        const ul = itemList(body);
        for (const arg of step.args) {
            const li = document.createElement("li");
            li.className = "item-row";
            const name = document.createElement("span");
            name.className = "item-name";
            name.textContent = arg.name;
            li.appendChild(name);
            const eq = document.createElement("span");
            eq.className = "item-sep";
            eq.textContent = "=";
            li.appendChild(eq);
            if (arg.script) {
                const value = document.createElement("span");
                value.className = "item-value";
                value.textContent = "";
                li.appendChild(value);
                const badges = document.createElement("span");
                badges.className = "item-badges";
                badges.appendChild(pill("script", "script"));
                li.appendChild(badges);
            } else {
                const value = document.createElement("span");
                value.className = "item-value";
                value.textContent = arg.value !== undefined ? truncate(arg.value, 60) : "(none)";
                li.appendChild(value);
            }
            ul.appendChild(li);
        }
    }

    if (step.transitions.length > 0) {
        sectionHeading(body, "Transitions");
        const ul = itemList(body);
        for (const transition of step.transitions) {
            const li = document.createElement("li");
            li.className = "item-row clickable";
            li.title = transition.when ?? "Click to reveal in the editor";
            const arrow = document.createElement("span");
            arrow.className = "transition-arrow";
            arrow.textContent = "→";
            li.appendChild(arrow);
            const target = document.createElement("span");
            target.className = "transition-target";
            target.textContent = transition.to;
            li.appendChild(target);
            if (transition.when) {
                const cond = document.createElement("span");
                cond.className = "transition-cond";
                cond.textContent = truncate(transition.when.trim().replace(/\s+/g, " "), 34);
                li.appendChild(cond);
            } else if (transition.implicit) {
                const implicitLabel = document.createElement("span");
                implicitLabel.className = "transition-implicit";
                implicitLabel.textContent = "implicit";
                li.appendChild(implicitLabel);
            }
            li.addEventListener("click", () => vscode.postMessage({ type: "reveal", start: transition.start, end: transition.end }));
            ul.appendChild(li);
        }
    }

    if (step.scriptPreview) {
        sectionHeading(body, "Script");
        const pre = document.createElement("pre");
        pre.textContent = step.scriptPreview;
        body.appendChild(pre);
    }

    const open = document.createElement("button");
    open.className = "open-btn";
    open.textContent = "Open in editor";
    open.addEventListener("click", () => vscode.postMessage({ type: "reveal", start: step.start, end: step.end }));
    body.appendChild(open);
}

// ---------------------------------------------------------------------------
// Issues sidebar section
// ---------------------------------------------------------------------------

function renderIssues(): void {
    const section = el("issuesSection");
    const list = el("issuesList");
    const summary = el("issueSummary");
    list.innerHTML = "";
    const errors = issues.filter(i => i.severity === "error").length;
    const warnings = issues.filter(i => i.severity === "warning").length;
    summary.textContent = issues.length === 0
        ? (model ? "✓ no problem" : "")
        : [errors ? `${errors} error${errors > 1 ? "s" : ""}` : "", warnings ? `${warnings} warning${warnings > 1 ? "s" : ""}` : ""]
            .filter(Boolean).join(", ");
    summary.classList.toggle("has-errors", errors > 0);
    summary.classList.toggle("ok", issues.length === 0 && model !== null);

    section.hidden = issues.length === 0;
    for (const issue of issues) {
        const li = document.createElement("li");
        li.className = `issue issue-${issue.severity}`;
        const icon = document.createElement("span");
        icon.className = "issue-icon";
        icon.textContent = issue.severity === "error" ? "✖" : issue.severity === "warning" ? "▲" : "ℹ";
        li.appendChild(icon);
        li.appendChild(document.createTextNode(issue.message));
        li.title = "Click to reveal in the editor";
        li.addEventListener("click", () => {
            if (issue.stepId) {
                selectStep(issue.stepId);
            }
            vscode.postMessage({ type: "reveal", start: issue.start, end: issue.end });
        });
        list.appendChild(li);
    }
}

// ---------------------------------------------------------------------------
// Pan & zoom
// ---------------------------------------------------------------------------

function applyTransform(): void {
    viewport.setAttribute("transform", `translate(${panX}, ${panY}) scale(${scale})`);
    el("zoomLevel").textContent = `${Math.round(scale * 100)}%`;
}

function zoomAt(factor: number, clientX: number, clientY: number): void {
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const newScale = Math.min(4, Math.max(0.1, scale * factor));
    // Keep the point under the cursor stationary
    panX = x - (x - panX) * (newScale / scale);
    panY = y - (y - panY) * (newScale / scale);
    scale = newScale;
    applyTransform();
}

function fitToView(): void {
    const bbox = viewport.getBBox();
    if (bbox.width === 0 || bbox.height === 0) {
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const padding = 24;
    scale = Math.min(1.5, Math.min(
        (rect.width - padding * 2) / bbox.width,
        (rect.height - padding * 2) / bbox.height
    ));
    panX = (rect.width - bbox.width * scale) / 2 - bbox.x * scale;
    panY = (rect.height - bbox.height * scale) / 2 - bbox.y * scale;
    applyTransform();
}

svg.addEventListener("wheel", event => {
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
}, { passive: false });

let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
svg.addEventListener("pointerdown", event => {
    // Capturing the pointer on the svg retargets the subsequent synthetic
    // click event to the svg itself (Chromium/Electron), which would fire
    // the deselect-on-background-click handler below instead of the node's
    // own click listener. Skip the pan/capture entirely when the gesture
    // starts on a node so its click reaches it normally.
    if ((event.target as Element).closest(".node")) {
        return;
    }
    dragging = true;
    dragStartX = event.clientX - panX;
    dragStartY = event.clientY - panY;
    svg.setPointerCapture(event.pointerId);
});
svg.addEventListener("pointermove", event => {
    if (dragging) {
        panX = event.clientX - dragStartX;
        panY = event.clientY - dragStartY;
        applyTransform();
    }
});
svg.addEventListener("pointerup", event => {
    dragging = false;
    svg.releasePointerCapture(event.pointerId);
});
svg.addEventListener("click", () => selectStep(undefined));

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function updateDirButton(): void {
    el("btnDir").textContent = rankdir === "LR" ? "⇥ Horizontal" : "⤓ Vertical";
}
updateDirButton();

el("btnDir").addEventListener("click", () => {
    rankdir = rankdir === "LR" ? "TB" : "LR";
    vscode.setState({ ...vscode.getState(), rankdir });
    updateDirButton();
    fitOnNextRender = true;
    render();
});
el("btnZoomIn").addEventListener("click", () => {
    const rect = svg.getBoundingClientRect();
    zoomAt(1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
});
el("btnZoomOut").addEventListener("click", () => {
    const rect = svg.getBoundingClientRect();
    zoomAt(1 / 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
});
el("btnFit").addEventListener("click", fitToView);

// ---------------------------------------------------------------------------
// Messages from the extension host
// ---------------------------------------------------------------------------

window.addEventListener("message", event => {
    const message = event.data as { type: string; model: WorkflowModel | null; issues: WorkflowIssue[] };
    if (message.type !== "update") {
        return;
    }
    const firstModel = model === null;
    model = message.model;
    issues = message.issues ?? [];
    if (firstModel) {
        fitOnNextRender = true;
    }
    if (selectedStepId && !model?.steps.some(s => s.id === selectedStepId)) {
        selectedStepId = undefined;
    }
    el("wfName").textContent = model?.name ?? "";
    const typeChip = el("wfType");
    typeChip.hidden = !model?.type;
    typeChip.textContent = model?.type ?? "";
    render();
    renderIssues();
    renderDetails();
});

vscode.postMessage({ type: "ready" });
