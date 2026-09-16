import { Uri } from "vscode";
import { DIFF_SCHEME, LOG4J_CONFIG_FILE, URI_SCHEME } from "../constants";

/**
 * Structure of a resource URI handled by the virtual file system provider:
 *
 *     iiq://<tenantId>/<tenant display name>/<ObjectType>/<object id>/<object name>.xml
 *
 * - The authority is the tenant id (immutable, lowercase) so that resources
 *   can be resolved even if the tenant is renamed.
 * - The first path segment is the tenant display name, only used to make the
 *   path human-readable (editor tooltip, breadcrumb...).
 * - The id segment is used for API calls (stable after rename); the name
 *   segment keeps tab labels and breadcrumbs readable.
 */
export interface IIQResourceUriParts {
    tenantId: string;
    tenantName: string;
    objectType: string;
    /** Object id — passed as nameOrId to the plugin API */
    objectId: string;
    /** Display name shown in the editor tab and breadcrumb */
    objectName: string;
}

export function buildResourceUri(parts: IIQResourceUriParts, scheme: string = URI_SCHEME): Uri {
    return Uri.from({
        scheme,
        authority: parts.tenantId.toLowerCase(),
        path: "/" + [
            parts.tenantName,
            parts.objectType,
            parts.objectId,
            `${parts.objectName}.xml`
        ].map(encodePathSegment).join("/")
    });
}

export function buildDiffResourceUri(parts: IIQResourceUriParts): Uri {
    return buildResourceUri(parts, DIFF_SCHEME);
}

/** Path segment grouping server-side config files (`.../config/log4j2.properties`) */
export const IIQ_CONFIG_SEGMENT = "config";

/**
 * URI of the environment's Log4j2 configuration file:
 * `iiq://<tenantId>/<tenant display name>/config/<file name>`
 */
export interface IIQConfigUriParts {
    kind: "config";
    tenantId: string;
    tenantName: string;
    fileName: string;
}

export type IIQUriParts = ({ kind: "object" } & IIQResourceUriParts) | IIQConfigUriParts;

export function buildConfigUri(
    tenantId: string,
    tenantName: string,
    fileName: string = LOG4J_CONFIG_FILE,
    scheme: string = URI_SCHEME): Uri {
    return Uri.from({
        scheme,
        authority: tenantId.toLowerCase(),
        path: "/" + [tenantName, IIQ_CONFIG_SEGMENT, fileName].map(encodePathSegment).join("/")
    });
}

/**
 * Parses a virtual IIQ URI: either an object (`.../<Type>/<id>/<name>.xml`)
 * or the environment Log4j2 configuration file (`.../config/<file name>`).
 */
export function parseIiqUri(uri: Uri): IIQUriParts {
    const segments = uri.path.split("/").filter(s => s.length > 0).map(decodePathSegment);
    if (segments.length === 3 && segments[1] === IIQ_CONFIG_SEGMENT && segments[2].length > 0) {
        return {
            kind: "config",
            tenantId: uri.authority,
            tenantName: segments[0],
            fileName: segments[2]
        };
    }
    return { kind: "object", ...parseResourceUriFromSegments(uri, segments) };
}

export function isConfigUri(uri: Uri): boolean {
    try {
        return parseIiqUri(uri).kind === "config";
    } catch {
        return false;
    }
}

/**
 * Parses a URI produced by {@link buildResourceUri}.
 * Also accepts the legacy 3-segment form `.../<ObjectType>/<id>.xml`.
 * Throws if the URI does not have the expected structure.
 */
export function parseResourceUri(uri: Uri): IIQResourceUriParts {
    const segments = uri.path.split("/").filter(s => s.length > 0).map(decodePathSegment);
    return parseResourceUriFromSegments(uri, segments);
}

function parseResourceUriFromSegments(uri: Uri, segments: string[]): IIQResourceUriParts {
    const last = segments[segments.length - 1];
    // Object files always end with .xml so ancestor folders (tenant, type, id)
    // are not mistaken for resources. VS Code stats those parents before writeFile.
    if (!last || !/\.xml$/i.test(last)) {
        throw new Error(`Invalid IdentityIQ resource URI: ${uri.toString()}`);
    }
    if (segments.length === 4) {
        return {
            tenantId: uri.authority,
            tenantName: segments[0],
            objectType: segments[1],
            objectId: segments[2],
            objectName: last.replace(/\.xml$/i, "")
        };
    }
    if (segments.length === 3) {
        const idOrName = last.replace(/\.xml$/i, "");
        return {
            tenantId: uri.authority,
            tenantName: segments[0],
            objectType: segments[1],
            objectId: idOrName,
            objectName: idOrName
        };
    }
    throw new Error(`Invalid IdentityIQ resource URI: ${uri.toString()}`);
}

/** Encodes a path segment, keeping it readable (only / and % are problematic) */
function encodePathSegment(segment: string): string {
    return segment.replace(/%/g, "%25").replace(/\//g, "%2F");
}

function decodePathSegment(segment: string): string {
    return segment.replace(/%2F/g, "/").replace(/%25/g, "%");
}
