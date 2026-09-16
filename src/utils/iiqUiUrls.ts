/**
 * Direct links into the IdentityIQ desktop UI for object types that have a
 * stable, id-addressable page. Types without an entry (Form, Rule,
 * ObjectConfig, QuickLink, …) cannot be opened by URL: they live only on
 * the Debug object browser (session-based) or on a page that is not keyed
 * by object id.
 *
 * Classic JSF editors take `forceLoad=true` so a leftover conversation on
 * the same page does not ignore the id in the query string.
 */

type UiUrlBuilder = (objectId: string) => string;

const UI_URL_BUILDERS: Record<string, UiUrlBuilder> = {
    Application: id => `/define/applications/application.jsf?appId=${id}&forceLoad=true`,
    Bundle: id => `/define/roles/role.jsf?id=${id}&forceLoad=true`,
    Identity: id => `/ui/rest/redirect?rp1=/identities/identities.jsf&rp2=identities/${id}/attributes`,
    TaskDefinition: id => `/define/tasks/taskDefinition.jsf?id=${id}&forceLoad=true`,
    Workgroup: id => `/define/groups/workgroup.jsf?id=${id}&forceLoad=true`,
    Workflow: id => `/define/workflow/workflow.jsf?id=${id}&forceLoad=true`
};

export function objectTypeHasUiPage(objectType: string): boolean {
    return Object.prototype.hasOwnProperty.call(UI_URL_BUILDERS, objectType);
}

/**
 * Absolute URL of the IdentityIQ page for this object, or `undefined` when
 * the type has no deep-linkable UI.
 */
export function buildObjectUiUrl(
    tenantUrl: string, objectType: string, objectId: string
): string | undefined {
    const builder = UI_URL_BUILDERS[objectType];
    if (!builder || !objectId) {
        return undefined;
    }
    const base = tenantUrl.replace(/\/+$/, "");
    return base + builder(encodeURIComponent(objectId));
}
