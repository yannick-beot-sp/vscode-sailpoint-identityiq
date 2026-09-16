# Identity View — UI specification

Source of truth for the Identity webview in this VS Code extension. Distinct
from the changelog and from the REST contract in
[plugin-api.md](plugin-api.md). Reference wireframes:
`Identity Webview Wireframes.dc.html` (retained options **1a**, **2a**,
**3a/3b**).

## Goal / out of scope (v1)

- Read-only **custom editor** for objects matching `iiq:/**/Identity/**/*.xml`.
  The UI is designed so it can become editable later (v2).
- **No Save / POST in v1.** No local SSB XML.
- Workgroup objects in the tree keep the default XML editor. This webview is
  only for regular Identity objects (`workgroup = false`).

## Opening

- `CustomReadonlyEditorProvider` id `iiq.identityViewer`, `priority: "default"`,
  selector `iiq:/**/Identity/**/*.xml`.
- Click in the tree, `vscode.open`, or a link `iiq://…/Identity/…` opens the
  webview.
- Identity XML is **never fetched** until **View XML** is invoked.

## Commands

| Command | Id | Behaviour |
|---|---|---|
| View XML | `iiq.identity.view-xml` | `vscode.openWith(uri, "default")` |
| View Identity | `iiq.identity.view` | `vscode.openWith(uri, "iiq.identityViewer")` |
| Refresh all | `iiq.identity.refresh` | Reload the full identity cube |

Contribution points:

- **View XML**: `editor/title` when the active editor is the Identity custom
  editor; Identity object context menu in the tree.
- **View Identity**: `editor/title` when a text editor is open on
  `iiq://…/Identity/…` XML.
- **Refresh all**: `editor/title` and a button in the webview header.

**Per-tab refresh** is a control in each tab’s toolbar (not a palette
command). It reloads only that section (`?section=`).

## Layout

Fixed header + horizontal tabs (wireframes 1a / 2a). **No avatar** — header
is text and badges only.

### Header (always visible)

- Title: `displayName`.
- Inline badges: Inactive / Active, Correlated, Protected (Protected only
  when true).
- Secondary line: `name` · `email` · `type` · `id` (`id` is copy-on-click;
  copy icon on hover).
- Meta: Manager (clickable identity reference), lastRefresh, lastLogin,
  environment.
- Refresh-all button.

### Tabs

Attributes · Accounts · Roles · Entitlements · Capabilities · Workgroups ·
QuickLinks.

Tabs wrap when the panel is narrow. Keyboard focus with arrow keys. Each tab
shows its item count as a compact badge.

## Attributes tab

- **No Standard / Extended split.** One flat list, filterable by attribute
  name.
- Every attribute has a **displayed type**: `boolean`, `string`, `date`,
  `identity` (reference to another Identity). Type drives value rendering:
  - `boolean` → compact badge (`true` / `false`).
  - `string` → plain text.
  - `date` → short format, muted tone.
  - `identity` → clickable value (standard link style). v2 may navigate to
    **View Identity** for the target.
- **Responsive grid**, not one value per row:
  `grid-template-columns: repeat(auto-fit, minmax(90px, 1fr))`. Label above
  the value (vertically compact). Collapses to one column on a narrow panel
  with **no media query**.
- Long values (e.g. email): `grid-column: span N` for extra width, then
  `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` plus native
  `title` for the full value on hover. Copy remains available on click,
  independent of truncation.
- Controls are laid out so a future edit mode can reuse the same grid (value
  becomes editable according to type).

## Accounts tab

Table: Application, Native identity, Disabled. Copy per cell. Filter across
the displayed fields. **Group by** Application (default), Native identity or
Disabled. When grouped, the grouping column is omitted from the table.
Client-side pages of 100 rows. Per-tab refresh.

Click the native identity → **side drawer** with the account detail: the
display name as the title, last aggregation directly under it, and
**Enabled**/**Disabled**, **Locked**/**Unlocked**, plus **Manually correlated**
only when that flag is true. The body lists application and instance, plus **every
attribute the connector aggregated** (one per line, untruncated: a DN or a
multi-valued group list is what the drawer is opened for). Loaded lazily
from the `Link` id the row carries; a row without one stays a plain copyable
value. Aggregated credentials are never returned (see the exclusions below).

## Roles tab

- One row per role (key = Bundle name); never duplicated.
- The **role type** (business, it, organizational…) is a badge on the row:
  it separates an assignable business role from the IT role it grants, and
  reading it must not require opening the drawer.
- **Classifications** of the Bundle are badges on the same row.
- Combinable status badges:
  - **Assigned** (positive `RoleAssignment`).
  - **Detected**.
  - **Negative** (`RoleAssignment.isNegative()` — warning badge, always
    shown even if the role is no longer detected; the stock IIQ UI does not
    expose this).
- Secondary line: source / assignmentId / assigner for assigned and negative.
- Nested roles are shown below the role assignment that granted/detected them.
  The lineage comes from permitted `RoleAssignment`s and
  `RoleDetection.assignmentIds`, and is retained while filtering.
- Click on the name → **side drawer** (not a centered pop-in; wireframe 2a)
  with Bundle detail (type, owner, description, disabled, …) and a View XML
  link for the role.
- Count = distinct roles (including negative-only). Per-tab refresh.
- Filter across name, provenance, parent role, and classifications.
- **Group by** Lineage (default: the assignment/detection tree), Type, Name,
  Classification or Status. Grouping flattens the tree. Client-side pages of
  100 rows apply when grouped.

## Entitlements tab

Table: Application, Account, Attribute, Entitlement, Classification, Granted
by role; copy. There is no Type column: `IdentityEntitlement.type` is
`Entitlement` on almost every row (ManagedAttribute Entitlement vs
Permission, sometimes a schema type such as `group`). When it is not
`Entitlement`, a badge is shown next to the value; the drawer still has the
full type.

Account is the native identity of the Link that holds the entitlement;
clicking it switches to the **Accounts** tab filtered on that account, which
is where its flags and aggregated attributes are read. Classifications of
the ManagedAttribute are badges.

**Group by** Application (default) or Classification. An entitlement with
several classifications appears in each matching group. The grouping column
is omitted from the table.

Filter across all displayed fields. **Only additional entitlements** restricts
the table to entitlements without a granting role.

IIQ assigned and detected roles live in the same `IdentityEntitlement`
table; they are **not** listed here (Roles tab).

Click Attribute or Entitlement → side drawer for the ManagedAttribute
(application, type, value, displayName, classifications, owner, …).

Per-tab refresh. The webview pages 100 rows at a time. The plugin does not
page the REST payload: it returns at most 2000 entitlements for one cube.

## Capabilities tab

Two groups (or a Source column): **Direct** (`getCapabilities()`) vs
**Inherited** (effective minus direct, typically via workgroups). One row per
capability; if inherited, show the source workgroup(s). Copy the name.

## Workgroups tab

Workgroups the identity is a member of (`getWorkgroups()`): name,
displayName, short description. Copy. Click → Identity workgroup drawer (or
View Identity in v2), which also lists the **capabilities the workgroup
grants** — the counterpart of the source workgroup shown next to an inherited
capability. Distinct from the tree’s XML editor for Workgroup objects.

## QuickLinks tab

QuickLinks whose attached **population** (`DynamicScope`) matches this
identity, as `Matchmaker` would evaluate the selector. A population with no
selector is treated as everyone. One row per QuickLink; several matching
populations of the same QuickLink are listed together.

Table: QuickLink, Category, Populations, Disabled. Filter across those
fields. Click the QuickLink → side drawer (View XML of the QuickLink). Click
a population → side drawer (View XML of the `DynamicScope`). Per-tab
refresh.

## Tables

Every table (Accounts, Entitlements, Capabilities, QuickLinks) has
**resizable columns**: drag the right edge of a header, double-click it to go
back to automatic widths. A resized table switches to a fixed layout, sizes
itself to the sum of its columns and scrolls horizontally.

A column can be narrowed **below the width of its values** (down to 40 px):
a DN such as `CN=Phillip Ray,OU=Singapore,…,DC=com` never fits a readable
width, so the value is truncated with an ellipsis and stays available in the
cell tooltip, in the drawer, and on copy. Badge lists wrap instead of
truncating.

Widths are kept per table in the webview state, so filtering, a tab refresh
or a reload of the view does not undo a drag.

## Detail drawer (replaces a centered pop-in)

- Right-hand panel, not a centered modal, not a new VS Code tab.
- Focus trap; **Esc** closes.
- Lazy load: `GET` object summary (Bundle / ManagedAttribute / Link),
  **never** the Identity XML.
- Actions: Copy id/name, View XML of the object (`vscode.openWith` on its
  `iiq://` URI).
- States inside the drawer: spinner, error.

## JSON model

Consumed by the webview; REST details and envelope live in
[plugin-api.md](plugin-api.md) when these endpoints are added.

- Full cube: `GET /identities/{nameOrId}/view`
- Tab refresh: `GET /identities/{nameOrId}/view?section=attributes|accounts|roles|entitlements|capabilities|workgroups|quicklinks`

Attributes are a **flat** list — no standard/extended split in the payload:

```json
{ "name": "firstname", "type": "string", "value": "Ada", "label": "First name" }
```

`type` is one of `"boolean" | "string" | "date" | "identity"`.

Accounts carry the id of their `Link`, which the account drawer resolves:

```json
{ "id": "…", "application": "Active Directory",
  "nativeIdentity": "CN=Ada,DC=example", "disabled": false }
```

Roles:

```json
{
  "name": "Employee",
  "type": "business",
  "assigned": true,
  "detected": true,
  "negative": false,
  "source": "LCM",
  "assignmentId": "…",
  "parentRoleNames": [],
  "classifications": ["SOX"]
}
```

Entitlements:

```json
{
  "application": "Active Directory",
  "nativeIdentity": "CN=Ada,DC=example",
  "type": "group",
  "name": "memberOf",
  "value": "CN=Finance",
  "grantedByRole": "Employee",
  "classifications": ["PCI"]
}
```

Capabilities:

```json
{ "name": "IdentityAdministrator", "inherited": true, "workgroups": ["IT Admins"] }
```

QuickLinks:

```json
{
  "name": "Manage User Access",
  "category": "Tasks",
  "action": "manageAccess",
  "disabled": false,
  "populations": [{ "id": "…", "name": "Everyone", "description": "All identities" }]
}
```

Drawer detail:

- `GET /objects/Bundle/{nameOrId}/summary`
- `GET /objects/ManagedAttribute/{nameOrId}/summary`
- `GET /objects/Link/{id}/summary` — the account detail. A `Link` has no
  name: `name` is its native identity, and `attributes` is the flat account
  attribute list, in the same shape as the identity attributes.

**Exclude** from the Attributes tab: secrets (`password`, `passwordHistory`,
`AuthenticationAnswers`, `VerificationToken`) and fields already shown in
the header or another tab (`manager`, `lastRefresh`, `lastLogin`,
`displayName`, `email`, `type`, `inactive`, `correlated`, `protected`,
`assignedRoles`, `detectedRoles`, `bundles`, `capabilities`, `workgroups`,
…). **Exclude** from an account detail: `password`, `passwordHistory` and
every attribute declared `secret` in the `Link` ObjectConfig.

A `section` request answers with the same cube shape, with only the requested
section populated — that is all a tab refresh consumes. The executable
reference for these payloads is `MockPluginServer.seedIdentityView` /
`seedObjectSummary` in `src/test/mockPluginServer.ts`, which the integration
tests run the real client against.

## Implementation

| Concern | Where |
|---|---|
| Payload types shared by the extension and the webview | `src/identity/identityViewModel.ts` |
| URI → environment → endpoint resolution | `src/identity/identityViewLoader.ts` |
| Custom editor, commands, webview messaging | `src/identity/IdentityViewProvider.ts` |
| Webview UI (no framework, DOM only) | `src/webview/identityView/main.ts` |
| Styles | `resources/webview/identityView.css` |

The webview bundle is built by `esbuild.js` (one bundle per folder under
`src/webview`, so `identityView/main.ts` becomes
`dist/webview/identityView.js`). The environment is resolved **once**, before
the request: the header names the environment the data actually came from,
even if that environment is removed while the cube is loading.

## Global states

Spinner on first load, plugin error, empty state per tab.

## Accessibility

Tabs are keyboard-navigable (arrow keys). Drawer closes with Esc. Tables use
semantic structure (`table` / `th` / `td`, or equivalent with roles). Column
resizing is pointer-only: the handles stay out of the tab order so they do
not come between the links of a row.

## Visual quality

VS Code theme tokens (`var(--vscode-*)`). No gradients, drop shadows, emoji,
or external fonts. Semantic badge colours (`charts.green` / `charts.blue` /
`charts.yellow` or `editorWarning`) — Negative must be readable in ~200 ms.
Readable density at 13–14 px.

## Later (v2+)

Edit (PATCH/POST), manager click → navigation, Link XML, policy violations,
identity-to-identity navigation from an `identity`-typed attribute.
