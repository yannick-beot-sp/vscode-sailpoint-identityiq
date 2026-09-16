import {
    ACCOUNT_GROUP_BY,
    AccountGroupBy,
    DetailObjectType,
    ENTITLEMENT_GROUP_BY,
    EntitlementGroupBy,
    filteredIdentityAccounts,
    filteredIdentityEntitlements,
    filteredIdentityQuickLinks,
    filteredIdentityRoles,
    groupedIdentityAccounts,
    groupedIdentityEntitlements,
    groupedIdentityRoles,
    IDENTITY_SECTIONS,
    IDENTITY_TABLE_PAGE_SIZE,
    IdentityAccountView,
    IdentityAttributeView,
    IdentityEntitlementView,
    IdentityPopulationView,
    IdentityQuickLinkView,
    IdentityReference,
    IdentityRoleView,
    IdentitySection,
    IdentityView,
    IdentityWorkgroupView,
    NamedGroup,
    ObjectSummaryView,
    pageOfGroups,
    ROLE_GROUP_BY,
    RoleGroupBy
} from "../../identity/identityViewModel";

declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

type IncomingMessage =
    | { type: "loading"; section?: IdentitySection }
    | { type: "update"; model: IdentityView; section?: IdentitySection }
    | { type: "error"; message: string; section?: IdentitySection }
    | { type: "detailLoading" }
    | { type: "detail"; objectType: DetailObjectType; detail: ObjectSummaryView }
    | { type: "detailError"; message: string };

/** Narrowest a column can be dragged, in pixels */
const MIN_COLUMN_WIDTH = 40;

const vscode = acquireVsCodeApi();
const app = requiredElement("app");
let model: IdentityView | undefined;
let activeSection: IdentitySection = restoreSection();
/** Column widths the user dragged, per table; absent means automatic */
const columnWidths: Record<string, number[]> = restoreColumnWidths();
let loadingSection: IdentitySection | "all" | undefined = "all";
let globalError: string | undefined;
let sectionError: string | undefined;
const sectionFilters: Partial<Record<IdentitySection, string>> = {};
const sectionPages: Partial<Record<IdentitySection, number>> = {};
let onlyAdditionalEntitlements = false;
let entitlementGroupBy: EntitlementGroupBy = "application";
let accountGroupBy: AccountGroupBy = "application";
let roleGroupBy: RoleGroupBy = "none";
let drawer: {
    open: boolean;
    loading?: boolean;
    objectType?: DetailObjectType | "Workgroup" | "QuickLink" | "DynamicScope";
    detail?: ObjectSummaryView;
    error?: string;
} = { open: false };
let drawerReturnFocus: HTMLElement | null = null;

window.addEventListener("message", event => {
    const message = event.data as IncomingMessage;
    switch (message.type) {
        case "loading":
            loadingSection = message.section ?? "all";
            globalError = undefined;
            if (message.section) {
                sectionError = undefined;
            }
            break;
        case "update":
            model = message.model;
            loadingSection = undefined;
            globalError = undefined;
            sectionError = undefined;
            break;
        case "error":
            loadingSection = undefined;
            if (message.section) {
                sectionError = message.message;
            } else {
                globalError = message.message;
            }
            break;
        case "detailLoading":
            drawer = { ...drawer, open: true, loading: true, error: undefined };
            break;
        case "detail":
            drawer = {
                open: true,
                objectType: message.objectType,
                detail: message.detail,
                loading: false
            };
            break;
        case "detailError":
            drawer = { ...drawer, open: true, loading: false, error: message.message };
            break;
    }
    render();
});

document.addEventListener("keydown", event => {
    if (!drawer.open) {
        return;
    }
    if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
    } else if (event.key === "Tab") {
        trapDrawerFocus(event);
    }
});

vscode.postMessage({ type: "ready" });
render();

function render(): void {
    app.replaceChildren();
    if (!model && loadingSection === "all") {
        app.append(stateMessage("Loading identity…", true));
        return;
    }
    if (!model && globalError) {
        app.append(errorState(globalError, () => refresh()));
        return;
    }
    if (!model) {
        return;
    }

    app.append(renderHeader(model), renderTabs(model), renderSection(model));
    if (drawer.open) {
        app.append(renderDrawer());
        requestAnimationFrame(() => document.querySelector<HTMLElement>(".drawer-close")?.focus());
    }
}

function renderHeader(identity: IdentityView): HTMLElement {
    const header = el("header", "identity-header");
    const titleRow = el("div", "title-row");
    titleRow.append(textEl("h1", identity.displayName || identity.name));
    titleRow.append(badge(identity.inactive ? "Inactive" : "Active", identity.inactive ? "warning" : "success"));
    if (identity.correlated) {
        titleRow.append(badge("Correlated", "info"));
    }
    if (identity.protected) {
        titleRow.append(badge("Protected", "warning"));
    }
    const spacer = el("span", "spacer");
    titleRow.append(spacer, button("Refresh all", "refresh-btn", () => refresh()));

    const secondary = el("div", "secondary");
    appendSeparated(secondary, [
        copyValue(identity.name),
        identity.email ? copyValue(identity.email) : undefined,
        identity.type ? textEl("span", identity.type) : undefined,
        copyValue(identity.id, "Copy id")
    ]);

    const meta = el("dl", "header-meta");
    appendMeta(meta, "Manager", identity.manager
        ? identityLink(identity.manager)
        : muted("—"));
    appendMeta(meta, "Last refresh", dateValue(identity.lastRefresh));
    appendMeta(meta, "Last login", dateValue(identity.lastLogin));
    appendMeta(meta, "Environment", textEl("span", identity.environment || "—"));
    header.append(titleRow, secondary, meta);
    return header;
}

function renderTabs(identity: IdentityView): HTMLElement {
    const tabs = el("div", "tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Identity sections");
    IDENTITY_SECTIONS.forEach((section, index) => {
        const selected = activeSection === section;
        const count = identity[section].length;
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "tab";
        const countBadge = textEl("span", String(count), "tab-count");
        countBadge.setAttribute("aria-hidden", "true");
        tab.append(textEl("span", label(section)), countBadge);
        tab.addEventListener("click", () => selectSection(section));
        tab.id = `tab-${section}`;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-label", `${label(section)}, ${count}`);
        tab.setAttribute("aria-selected", String(selected));
        tab.setAttribute("aria-controls", `panel-${section}`);
        tab.tabIndex = selected ? 0 : -1;
        tab.addEventListener("keydown", event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                return;
            }
            event.preventDefault();
            let next = index;
            if (event.key === "ArrowLeft") {
                next = (index - 1 + IDENTITY_SECTIONS.length) % IDENTITY_SECTIONS.length;
            } else if (event.key === "ArrowRight") {
                next = (index + 1) % IDENTITY_SECTIONS.length;
            } else {
                next = event.key === "Home" ? 0 : IDENTITY_SECTIONS.length - 1;
            }
            selectSection(IDENTITY_SECTIONS[next], true);
        });
        tabs.append(tab);
    });
    return tabs;
}

function renderSection(identity: IdentityView): HTMLElement {
    const panel = el("main", "section-panel");
    panel.id = `panel-${activeSection}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `tab-${activeSection}`);

    const toolbar = el("div", "section-toolbar");
    toolbar.append(textEl("h2", label(activeSection)), el("span", "spacer"));
    if (["attributes", "accounts", "roles", "entitlements", "quicklinks"].includes(activeSection)) {
        const filter = document.createElement("input");
        filter.type = "search";
        filter.placeholder = `Filter ${label(activeSection).toLowerCase()}`;
        filter.setAttribute("aria-label", `Filter ${label(activeSection).toLowerCase()}`);
        filter.value = sectionFilters[activeSection] ?? "";
        filter.addEventListener("input", () => {
            sectionFilters[activeSection] = filter.value;
            sectionPages[activeSection] = 1;
            renderKeepingFocus(".section-toolbar input[type='search']");
        });
        toolbar.append(filter);
    }
    if (activeSection === "accounts") {
        toolbar.append(groupByControl(
            "account-group-by", accountGroupBy, ACCOUNT_GROUP_BY, value => {
                accountGroupBy = value;
                sectionPages.accounts = 1;
                renderKeepingFocus("#account-group-by");
            }));
    }
    if (activeSection === "roles") {
        toolbar.append(groupByControl(
            "role-group-by", roleGroupBy, ROLE_GROUP_BY, value => {
                roleGroupBy = value;
                sectionPages.roles = 1;
                renderKeepingFocus("#role-group-by");
            }));
    }
    if (activeSection === "entitlements") {
        toolbar.append(groupByControl(
            "entitlement-group-by", entitlementGroupBy, ENTITLEMENT_GROUP_BY, value => {
                entitlementGroupBy = value;
                sectionPages.entitlements = 1;
                renderKeepingFocus("#entitlement-group-by");
            }));
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.id = "only-additional-entitlements";
        checkbox.checked = onlyAdditionalEntitlements;
        checkbox.addEventListener("change", () => {
            onlyAdditionalEntitlements = checkbox.checked;
            sectionPages.entitlements = 1;
            render();
            requestAnimationFrame(() => document.getElementById(checkbox.id)?.focus());
        });
        const checkboxLabel = el("label", "checkbox-label");
        checkboxLabel.htmlFor = checkbox.id;
        checkboxLabel.append(checkbox, textEl("span", "Only additional entitlements"));
        toolbar.append(checkboxLabel);
    }
    toolbar.append(button("Refresh tab", "secondary-btn", () => refresh(activeSection)));
    panel.append(toolbar);

    if (loadingSection === activeSection) {
        panel.append(stateMessage(`Refreshing ${label(activeSection).toLowerCase()}…`, true));
        return panel;
    }
    if (sectionError) {
        panel.append(errorState(sectionError, () => refresh(activeSection)));
        return panel;
    }

    const content = sectionContent(identity);
    panel.append(content ?? stateMessage(`No ${label(activeSection).toLowerCase()} found.`));
    return panel;
}

function sectionContent(identity: IdentityView): HTMLElement | undefined {
    switch (activeSection) {
        case "attributes":
            return renderAttributes(identity.attributes);
        case "accounts":
            return renderAccounts(identity.accounts, sectionFilters.accounts ?? "");
        case "roles":
            return renderRoles(identity.roles, sectionFilters.roles ?? "");
        case "entitlements":
            return renderEntitlements(identity.entitlements, sectionFilters.entitlements ?? "");
        case "capabilities":
            return identity.capabilities.length ? table(
                "capabilities",
                ["Name", "Source", "Workgroups"],
                identity.capabilities.map(capability => [
                    copyValue(capability.name),
                    textEl("span", capability.inherited ? "Inherited" : "Direct"),
                    textEl("span", capability.workgroups.join(", ") || "—")
                ])) : undefined;
        case "workgroups":
            return renderWorkgroups(identity.workgroups);
        case "quicklinks":
            return renderQuickLinks(identity.quicklinks, sectionFilters.quicklinks ?? "");
    }
}

/**
 * The native identity opens the account detail drawer. Without a Link id
 * there is nothing to load, so the cell stays a plain copyable value.
 */
function accountLink(account: IdentityAccountView): HTMLElement {
    const id = account.id;
    if (!id) {
        return copyValue(account.nativeIdentity);
    }
    const element = button(account.nativeIdentity, "link-btn", event =>
        openRemoteDrawer(event.currentTarget as HTMLElement, "Link", id));
    // A DN outgrows any reasonable column width: keep it readable on hover.
    element.title = account.nativeIdentity;
    return element;
}

function renderAttributes(attributes: IdentityAttributeView[]): HTMLElement | undefined {
    const filtered = attributes.filter(attribute =>
        attribute.name.toLocaleLowerCase().includes(
            (sectionFilters.attributes ?? "").trim().toLocaleLowerCase()));
    return filtered.length ? attributeGrid(filtered) : undefined;
}

function attributeGrid(attributes: IdentityAttributeView[]): HTMLElement {
    const grid = el("div", "attribute-grid");
    for (const attribute of attributes) {
        const item = el("div", "attribute");
        if (String(attribute.value ?? "").length > 30) {
            item.classList.add("attribute-wide");
        }
        item.append(textEl("div", attribute.label || attribute.name, "attribute-label"));
        const display = attributeValue(attribute);
        display.classList.add("attribute-value");
        item.append(display);
        grid.append(item);
    }
    return grid;
}

function attributeValue(attribute: IdentityAttributeView): HTMLElement {
    const value = attribute.value === null ? "—" : String(attribute.value);
    if (attribute.type === "boolean") {
        return badge(value, attribute.value === true ? "success" : "neutral");
    }
    if (attribute.type === "date") {
        return copyValue(formatDate(value), value);
    }
    if (attribute.type === "identity") {
        return identityLink(attribute.identity ?? { name: value });
    }
    return copyValue(value);
}

function renderAccounts(accounts: IdentityAccountView[], filter: string): HTMLElement | undefined {
    const filtered = filteredIdentityAccounts(accounts, filter);
    if (!filtered.length) {
        return undefined;
    }
    const paged = pageOfGroups(
        groupedIdentityAccounts(filtered, accountGroupBy),
        sectionPages.accounts ?? 1);
    sectionPages.accounts = paged.page;
    const hideApplication = accountGroupBy === "application";
    const hideNativeIdentity = accountGroupBy === "nativeIdentity";
    const hideDisabled = accountGroupBy === "disabled";
    const headers = [
        hideApplication ? undefined : "Application",
        hideNativeIdentity ? undefined : "Native identity",
        hideDisabled ? undefined : "Disabled"
    ].filter((header): header is string => Boolean(header));
    return pagedSection(paged, "accounts", group => table(
        "accounts",
        headers,
        group.items.map(account => [
            hideApplication ? undefined : copyValue(account.application),
            hideNativeIdentity ? undefined : accountLink(account),
            hideDisabled ? undefined : badge(String(account.disabled), account.disabled ? "warning" : "success")
        ].filter((cell): cell is HTMLElement => Boolean(cell)))));
}

function renderRoles(roles: IdentityRoleView[], filter: string): HTMLElement | undefined {
    const matching = filteredIdentityRoles(roles, filter);
    if (!matching.length) {
        return undefined;
    }
    if (roleGroupBy === "none") {
        return roleTree(roles, matching);
    }
    const paged = pageOfGroups(groupedIdentityRoles(matching, roleGroupBy), sectionPages.roles ?? 1);
    sectionPages.roles = paged.page;
    return pagedSection(paged, "roles", group => {
        const list = el("div", "card-list");
        group.items.forEach(role => list.append(renderRoleRow(role)));
        return list;
    });
}

function roleTree(roles: IdentityRoleView[], matching: IdentityRoleView[]): HTMLElement {
    // Keep ancestors of matches visible so a filtered child retains its lineage.
    const byName = new Map(roles.map(role => [role.name, role]));
    const included = new Set(matching.map(role => role.name));
    const includeParents = (role: IdentityRoleView): void => {
        for (const parentName of role.parentRoleNames ?? []) {
            const parent = byName.get(parentName);
            if (parent && !included.has(parentName)) {
                included.add(parentName);
                includeParents(parent);
            }
        }
    };
    matching.forEach(includeParents);

    const children = new Map<string, IdentityRoleView[]>();
    const roots: IdentityRoleView[] = [];
    for (const role of roles.filter(candidate => included.has(candidate.name))) {
        const parent = role.parentRoleNames?.find(name => included.has(name));
        if (!parent || parent === role.name) {
            roots.push(role);
        } else {
            const siblings = children.get(parent) ?? [];
            siblings.push(role);
            children.set(parent, siblings);
        }
    }

    const list = el("div", "card-list role-tree");
    const rendered = new Set<string>();
    const appendRole = (role: IdentityRoleView, parent: HTMLElement): void => {
        if (rendered.has(role.name)) {return;}
        rendered.add(role.name);
        const node = el("div", "role-tree-node");
        node.append(renderRoleRow(role));
        const descendants = children.get(role.name);
        if (descendants?.length) {
            const nested = el("div", "role-tree-children");
            descendants.forEach(child => appendRole(child, nested));
            node.append(nested);
        }
        parent.append(node);
    };
    roots.forEach(role => appendRole(role, list));
    roles.filter(role => included.has(role.name)).forEach(role => appendRole(role, list));
    return list;
}

function renderRoleRow(role: IdentityRoleView): HTMLElement {
    const row = el("div", "list-row");
    const main = el("div", "list-main");
    const roleButton = button(role.name, "link-btn", event =>
        openRemoteDrawer(event.currentTarget as HTMLElement, "Bundle", role.id || role.name));
    const statuses = el("span", "status-list");
    if (role.type) {statuses.append(badge(role.type, "neutral"));}
    appendClassificationBadges(statuses, role.classifications);
    if (role.assigned) {statuses.append(badge("Assigned", "info"));}
    if (role.detected) {statuses.append(badge("Detected", "success"));}
    if (role.negative) {statuses.append(badge("Negative", "warning"));}
    main.append(roleButton, statuses);
    const parents = role.parentRoleNames?.length
        ? `Granted by ${role.parentRoleNames.join(", ")}`
        : undefined;
    const secondary = [parents, role.source, role.assignmentId, role.assigner].filter(Boolean).join(" · ");
    row.append(main);
    if (secondary) {row.append(textEl("div", secondary, "row-secondary"));}
    return row;
}

function renderEntitlements(entitlements: IdentityEntitlementView[], filter: string): HTMLElement | undefined {
    const filtered = filteredIdentityEntitlements(entitlements, filter, onlyAdditionalEntitlements);
    if (!filtered.length) {
        return undefined;
    }
    const paged = pageOfGroups(
        groupedIdentityEntitlements(filtered, entitlementGroupBy),
        sectionPages.entitlements ?? 1);
    sectionPages.entitlements = paged.page;
    const hideApplication = entitlementGroupBy === "application";
    const hideClassification = entitlementGroupBy === "classification";
    const headers = [
        hideApplication ? undefined : "Application",
        "Account",
        "Attribute",
        "Entitlement",
        hideClassification ? undefined : "Classification",
        "Granted by role"
    ].filter((header): header is string => Boolean(header));
    return pagedSection(paged, "entitlements", group => table(
        "entitlements",
        headers,
        group.items.map(entitlement => [
            hideApplication ? undefined : copyValue(entitlement.application),
            accountCell(entitlement.nativeIdentity),
            detailButton(entitlement.name, entitlement),
            wrapEntitlementCell(detailButton(entitlement.value, entitlement), entitlement.type),
            hideClassification ? undefined : classificationCell(entitlement.classifications),
            copyValue(entitlement.grantedByRole || "—")
        ].filter((cell): cell is HTMLElement => Boolean(cell)))));
}

function wrapEntitlementCell(content: HTMLElement, type?: string): HTMLElement {
    if (!type || type === "Entitlement") {
        return content;
    }
    const cell = el("span", "entitlement-name-cell");
    cell.append(content, badge(type, "neutral"));
    return cell;
}

function classificationCell(names?: string[]): HTMLElement {
    const list = el("span", "status-list");
    appendClassificationBadges(list, names);
    return list.childElementCount ? list : muted("—");
}

function appendClassificationBadges(parent: HTMLElement, names?: string[]): void {
    for (const name of names ?? []) {
        if (name) {
            parent.append(badge(name, "classification"));
        }
    }
}

/**
 * The account holding the entitlement leads to the Accounts tab, filtered on
 * it: that tab is where the account itself — its flags and its aggregated
 * attributes — is read.
 */
function accountCell(nativeIdentity?: string): HTMLElement {
    if (!nativeIdentity) {
        return muted("—");
    }
    const element = button(nativeIdentity, "link-btn", () => {
        sectionFilters.accounts = nativeIdentity;
        selectSection("accounts", true);
    });
    element.title = `Show ${nativeIdentity} in Accounts`;
    return element;
}

function detailButton(labelText: string, entitlement: IdentityEntitlementView): HTMLElement {
    const element = button(labelText, "link-btn", event => openRemoteDrawer(
        event.currentTarget as HTMLElement,
        "ManagedAttribute",
        entitlement.managedAttributeId || entitlement.id || entitlement.value));
    // The cell is clipped to its column: the full value stays readable.
    element.title = labelText;
    return element;
}

function renderWorkgroups(workgroups: IdentityWorkgroupView[]): HTMLElement | undefined {
    if (!workgroups.length) {
        return undefined;
    }
    const list = el("div", "card-list");
    for (const workgroup of workgroups) {
        const row = el("div", "list-row");
        const name = button(workgroup.displayName || workgroup.name, "link-btn", event => {
            drawerReturnFocus = event.currentTarget as HTMLElement;
            drawer = {
                open: true,
                objectType: "Workgroup",
                detail: {
                    id: workgroup.id,
                    name: workgroup.name,
                    displayName: workgroup.displayName,
                    description: workgroup.description,
                    capabilities: workgroup.capabilities
                }
            };
            render();
        });
        row.append(name);
        if (workgroup.description) {
            row.append(textEl("div", workgroup.description, "row-secondary clamp"));
        }
        list.append(row);
    }
    return list;
}

function renderQuickLinks(quickLinks: IdentityQuickLinkView[], filter: string): HTMLElement | undefined {
    const filtered = filteredIdentityQuickLinks(quickLinks, filter);
    if (!filtered.length) {
        return undefined;
    }
    return table(
        "quicklinks",
        ["QuickLink", "Category", "Populations", "Disabled"],
        filtered.map(quickLink => [
            button(quickLink.name, "link-btn", event => openQuickLinkDrawer(
                event.currentTarget as HTMLElement, quickLink)),
            copyValue(quickLink.category || "—"),
            populationList(quickLink.populations),
            badge(String(quickLink.disabled), quickLink.disabled ? "warning" : "success")
        ]));
}

function populationList(populations: IdentityPopulationView[]): HTMLElement {
    const wrap = el("span", "population-list");
    populations.forEach((population, index) => {
        if (index) {
            wrap.append(textEl("span", ", ", "separator"));
        }
        wrap.append(button(population.name, "link-btn", event => {
            drawerReturnFocus = event.currentTarget as HTMLElement;
            drawer = {
                open: true,
                objectType: "DynamicScope",
                detail: {
                    id: population.id,
                    name: population.name,
                    displayName: population.name,
                    description: population.description
                }
            };
            render();
        }));
    });
    return wrap;
}

function openQuickLinkDrawer(trigger: HTMLElement, quickLink: IdentityQuickLinkView): void {
    drawerReturnFocus = trigger;
    drawer = {
        open: true,
        objectType: "QuickLink",
        detail: {
            id: quickLink.id,
            name: quickLink.name,
            displayName: quickLink.name,
            type: quickLink.category,
            action: quickLink.action,
            disabled: quickLink.disabled,
            populations: quickLink.populations.map(population => population.name)
        }
    };
    render();
}

function renderDrawer(): HTMLElement {
    const backdrop = el("div", "drawer-backdrop");
    backdrop.addEventListener("mousedown", event => {
        if (event.target === backdrop) {closeDrawer();}
    });
    const aside = el("aside", "drawer");
    aside.setAttribute("role", "dialog");
    aside.setAttribute("aria-modal", "true");
    aside.setAttribute("aria-labelledby", "drawer-title");

    const header = el("div", "drawer-header");
    const heading = el("div", "drawer-heading");
    const detail = drawer.detail;
    const title = textEl("h2", detail?.displayName || detail?.name || "Object details");
    title.id = "drawer-title";
    heading.append(title);
    if (drawer.objectType === "Link" && detail && !drawer.loading) {
        if (detail.lastRefresh) {
            heading.append(textEl("div", `Last refresh ${formatDate(detail.lastRefresh)}`, "drawer-last-refresh"));
        }
        heading.append(accountFlagBadges(detail));
    }
    header.append(heading, button("Close", "drawer-close secondary-btn", () => closeDrawer()));
    aside.append(header);

    if (drawer.loading) {
        aside.append(stateMessage("Loading details…", true));
    } else if (drawer.error) {
        aside.append(errorState(drawer.error, () => closeDrawer()));
    } else if (drawer.detail) {
        aside.append(renderDetail(drawer.detail));
    }
    backdrop.append(aside);
    return backdrop;
}

function renderDetail(detail: ObjectSummaryView): HTMLElement {
    const body = el("div", "drawer-body");
    const actions = el("div", "drawer-actions");
    actions.append(button("Copy name", "secondary-btn", () => copy(detail.name)));
    if (detail.id) {actions.append(button("Copy id", "secondary-btn", () => copy(detail.id!)));}
    if (drawer.objectType) {
        actions.append(button("View XML", "primary-btn", () => vscode.postMessage({
            type: "openXml",
            objectType: drawer.objectType,
            id: detail.id,
            name: detail.name
        })));
    }
    body.append(actions);
    // An account has no name of its own: its identifier on the application is
    // its native identity, and labelling it "Name" would be a lie. Display
    // name, last refresh and disabled/locked/manually correlated live in the
    // drawer heading as the title, a subtitle and badges.
    const isAccount = drawer.objectType === "Link";
    const values: Array<[string, string | undefined]> = [
        [isAccount ? "Native identity" : "Name", detail.name]
    ];
    if (!isAccount) {
        values.push(["Display name", detail.displayName]);
    }
    values.push(
        ["Type", detail.type],
        ["Application", detail.application],
        ["Instance", detail.instance],
        ["Value", detail.value],
        ["Owner", detail.owner?.displayName || detail.owner?.name]
    );
    if (!isAccount) {
        values.push(
            ["Disabled", detail.disabled === undefined ? undefined : String(detail.disabled)],
            ["Locked", detail.locked === undefined ? undefined : String(detail.locked)],
            ["Manually correlated",
                detail.manuallyCorrelated === undefined ? undefined : String(detail.manuallyCorrelated)],
            ["Last refresh", detail.lastRefresh ? formatDate(detail.lastRefresh) : undefined]
        );
    }
    values.push(
        ["Classifications", detail.classifications?.join(", ")],
        ["Capabilities", detail.capabilities?.join(", ")],
        ["Action", detail.action],
        ["Populations", detail.populations?.join(", ")],
        ["Description", detail.description]
    );
    const dl = el("dl", "detail-list");
    for (const [name, value] of values) {
        if (value !== undefined && value !== "") {
            appendMeta(dl, name, copyValue(value));
        }
    }
    body.append(dl);
    if (detail.attributes?.length) {
        body.append(
            textEl("h3", "Account attributes", "drawer-subtitle"),
            attributeGrid(detail.attributes));
    }
    return body;
}

function groupByControl<T extends string>(
    id: string,
    value: T,
    options: ReadonlyArray<{ id: T; label: string }>,
    onChange: (value: T) => void
): HTMLElement {
    const wrap = el("label", "group-by-label");
    wrap.append(textEl("span", "Group by"));
    const select = document.createElement("select");
    select.id = id;
    select.setAttribute("aria-label", "Group by");
    for (const option of options) {
        const element = document.createElement("option");
        element.value = option.id;
        element.textContent = option.label;
        if (option.id === value) {
            element.selected = true;
        }
        select.append(element);
    }
    select.addEventListener("change", () => onChange(select.value as T));
    wrap.append(select);
    return wrap;
}

function pagedSection<T>(
    paged: ReturnType<typeof pageOfGroups<T>>,
    section: IdentitySection,
    renderGroup: (group: NamedGroup<T>) => HTMLElement
): HTMLElement {
    const wrap = el("div", "paged-section");
    for (const group of paged.groups) {
        if (group.label) {
            const heading = el("h3", "group-heading");
            heading.append(
                textEl("span", group.label),
                textEl("span", String(group.total ?? group.items.length), "group-count"));
            wrap.append(heading);
        }
        wrap.append(renderGroup(group));
    }
    if (paged.pageCount > 1) {
        wrap.append(pager(paged, section));
    }
    return wrap;
}

function pager<T>(
    paged: ReturnType<typeof pageOfGroups<T>>,
    section: IdentitySection
): HTMLElement {
    const bar = el("div", "pager");
    const from = (paged.page - 1) * IDENTITY_TABLE_PAGE_SIZE + 1;
    const to = Math.min(paged.page * IDENTITY_TABLE_PAGE_SIZE, paged.total);
    const previous = button("Previous", "secondary-btn", () => {
        sectionPages[section] = paged.page - 1;
        render();
    });
    previous.disabled = paged.page <= 1;
    const next = button("Next", "secondary-btn", () => {
        sectionPages[section] = paged.page + 1;
        render();
    });
    next.disabled = paged.page >= paged.pageCount;
    bar.append(
        previous,
        textEl("span", `${from}–${to} of ${paged.total}`),
        next);
    return bar;
}

function renderKeepingFocus(selector: string): void {
    const current = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
    const start = current instanceof HTMLInputElement ? current.selectionStart : undefined;
    const end = current instanceof HTMLInputElement ? current.selectionEnd : undefined;
    render();
    requestAnimationFrame(() => {
        const replacement = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
        replacement?.focus();
        if (replacement instanceof HTMLInputElement && typeof start === "number" && typeof end === "number") {
            replacement.setSelectionRange(start, end);
        }
    });
}

/**
 * A table whose columns are resizable by dragging the right edge of a
 * header, double-click to go back to automatic widths. Widths are kept per
 * table (`key`) so a re-render — filtering, a tab refresh, a reload of the
 * webview — does not undo the drag.
 */
function table(key: string, headers: string[], rows: HTMLElement[][]): HTMLElement {
    const wrapper = el("div", "table-scroll");
    const tableElement = document.createElement("table");
    const group = document.createElement("colgroup");
    const columns = headers.map(() => {
        const column = document.createElement("col");
        group.append(column);
        return column;
    });
    const stored = columnWidths[key];
    if (stored?.length === headers.length) {
        applyColumnWidths(tableElement, columns, stored);
    }

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    headers.forEach((header, index) => {
        const th = document.createElement("th");
        th.scope = "col";
        th.append(document.createTextNode(header), columnResizer(key, tableElement, columns, index));
        headRow.append(th);
    });
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const values of rows) {
        const row = document.createElement("tr");
        for (const value of values) {
            const td = document.createElement("td");
            td.append(value);
            row.append(td);
        }
        body.append(row);
    }
    tableElement.append(group, head, body);
    wrapper.append(tableElement);
    return wrapper;
}

function columnResizer(
    key: string,
    tableElement: HTMLTableElement,
    columns: HTMLTableColElement[],
    index: number
): HTMLElement {
    const handle = el("span", "col-resizer");
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.title = "Drag to resize, double-click to reset";
    handle.addEventListener("pointerdown", event => {
        // Without this the drag selects the header text instead of resizing.
        event.preventDefault();
        const widths = frozenColumnWidths(key, tableElement, columns);
        const startX = event.clientX;
        const startWidth = widths[index];
        handle.setPointerCapture(event.pointerId);
        const resize = (move: PointerEvent): void => {
            widths[index] = Math.max(MIN_COLUMN_WIDTH, startWidth + move.clientX - startX);
            applyColumnWidths(tableElement, columns, widths);
        };
        const stop = (): void => {
            handle.removeEventListener("pointermove", resize);
            handle.removeEventListener("pointerup", stop);
            handle.removeEventListener("pointercancel", stop);
            columnWidths[key] = [...widths];
            persistState();
        };
        handle.addEventListener("pointermove", resize);
        handle.addEventListener("pointerup", stop);
        handle.addEventListener("pointercancel", stop);
    });
    handle.addEventListener("dblclick", () => {
        delete columnWidths[key];
        persistState();
        render();
    });
    return handle;
}

/**
 * Widths a drag starts from: the ones already stored, or what the browser
 * currently displays, so switching to a fixed layout does not move anything
 * under the pointer.
 */
function frozenColumnWidths(
    key: string,
    tableElement: HTMLTableElement,
    columns: HTMLTableColElement[]
): number[] {
    const stored = columnWidths[key];
    const widths = stored?.length === columns.length
        ? [...stored]
        : [...(tableElement.tHead?.rows[0].cells ?? [])]
            .map(cell => Math.max(MIN_COLUMN_WIDTH, cell.getBoundingClientRect().width));
    applyColumnWidths(tableElement, columns, widths);
    return widths;
}

/**
 * A width is only authoritative under a fixed layout: the default one
 * redistributes columns to fit their content. The table then sizes itself
 * to the sum of its columns and `.table-scroll` scrolls it horizontally.
 */
function applyColumnWidths(
    tableElement: HTMLTableElement,
    columns: HTMLTableColElement[],
    widths: number[]
): void {
    tableElement.classList.add("table-fixed");
    tableElement.style.width = `${widths.reduce((total, width) => total + width, 0)}px`;
    columns.forEach((column, index) => {
        column.style.width = `${widths[index]}px`;
    });
}

function selectSection(section: IdentitySection, focus = false): void {
    activeSection = section;
    sectionError = undefined;
    persistState();
    render();
    if (focus) {requestAnimationFrame(() => document.getElementById(`tab-${section}`)?.focus());}
}

function refresh(section?: IdentitySection): void {
    vscode.postMessage({ type: "refresh", section });
}

function openRemoteDrawer(
    trigger: HTMLElement,
    objectType: DetailObjectType,
    nameOrId: string
): void {
    drawerReturnFocus = trigger;
    drawer = { open: true, loading: true, objectType };
    render();
    vscode.postMessage({ type: "loadDetail", objectType, nameOrId });
}

function closeDrawer(): void {
    drawer = { open: false };
    render();
    requestAnimationFrame(() => drawerReturnFocus?.focus());
}

function trapDrawerFocus(event: KeyboardEvent): void {
    const drawerElement = document.querySelector<HTMLElement>(".drawer");
    if (!drawerElement) {return;}
    const focusable = [...drawerElement.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
    if (!focusable.length) {return;}
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function copyValue(value: string, title = `Copy ${value}`): HTMLElement {
    const element = button(value, "copy-value", () => copy(value));
    element.title = title;
    return element;
}

function identityLink(reference: IdentityReference): HTMLElement {
    const display = reference.displayName || reference.name;
    const element = button(display, "link-btn", () => vscode.postMessage({
        type: "openIdentity",
        id: reference.id,
        name: reference.name
    }));
    element.title = `Open ${reference.name}`;
    return element;
}

function copy(value: string): void {
    vscode.postMessage({ type: "copy", value });
}

function appendMeta(parent: HTMLElement, name: string, value: HTMLElement): void {
    const dd = document.createElement("dd");
    dd.append(value);
    parent.append(textEl("dt", name), dd);
}

function appendSeparated(parent: HTMLElement, values: Array<HTMLElement | undefined>): void {
    values.filter((value): value is HTMLElement => Boolean(value)).forEach((value, index) => {
        if (index) {parent.append(textEl("span", "·", "separator"));}
        parent.append(value);
    });
}

function stateMessage(message: string, busy = false): HTMLElement {
    const state = el("div", "state");
    if (busy) {
        const spinner = el("span", "spinner");
        spinner.setAttribute("aria-hidden", "true");
        state.setAttribute("aria-busy", "true");
        state.append(spinner);
    }
    state.append(textEl("span", message));
    return state;
}

function errorState(message: string, retry: () => void): HTMLElement {
    const state = el("div", "state error-state");
    state.append(textEl("p", message), button("Retry", "secondary-btn", retry));
    return state;
}

function accountFlagBadges(detail: ObjectSummaryView): HTMLElement {
    const list = el("div", "status-list");
    list.append(
        badge(detail.disabled ? "Disabled" : "Enabled", detail.disabled ? "warning" : "success"),
        badge(detail.locked ? "Locked" : "Unlocked", detail.locked ? "warning" : "success")
    );
    if (detail.manuallyCorrelated) {
        list.append(badge("Manually correlated", "info"));
    }
    return list;
}

function badge(value: string, tone: "success" | "info" | "warning" | "neutral" | "classification"): HTMLElement {
    return textEl("span", value, `badge badge-${tone}`);
}

function muted(value: string): HTMLElement {
    return textEl("span", value, "muted");
}

function dateValue(value?: string): HTMLElement {
    return value ? copyValue(formatDate(value), value) : muted("—");
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function label(section: IdentitySection): string {
    switch (section) {
        case "quicklinks":
            return "QuickLinks";
        default:
            return section[0].toUpperCase() + section.slice(1);
    }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (className) {element.className = className;}
    return element;
}

function textEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text: string,
    className?: string
): HTMLElementTagNameMap[K] {
    const element = el(tag, className);
    element.textContent = text;
    return element;
}

function button(
    text: string,
    className: string,
    listener: (event: MouseEvent) => void
): HTMLButtonElement {
    const element = textEl("button", text, className);
    element.type = "button";
    element.addEventListener("click", listener);
    return element;
}

function requiredElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {throw new Error(`Missing #${id}`);}
    return element;
}

function persistState(): void {
    vscode.setState({ activeSection, columnWidths });
}

function restoreSection(): IdentitySection {
    const state = vscode.getState() as { activeSection?: unknown } | undefined;
    return typeof state?.activeSection === "string"
        && (IDENTITY_SECTIONS as readonly string[]).includes(state.activeSection)
        ? state.activeSection as IdentitySection
        : "attributes";
}

function restoreColumnWidths(): Record<string, number[]> {
    const state = vscode.getState() as { columnWidths?: unknown } | undefined;
    const stored = state?.columnWidths;
    if (!stored || typeof stored !== "object") {
        return {};
    }
    const widths: Record<string, number[]> = {};
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
        if (Array.isArray(value) && value.every(width => typeof width === "number" && width > 0)) {
            widths[key] = value as number[];
        }
    }
    return widths;
}
