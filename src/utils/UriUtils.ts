import { Uri } from "vscode";
import { DIFF_SCHEME, URI_SCHEME } from "../constants";

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

/** Filename of the IdentityIQ configuration file exposed through the virtual FS */
export const IIQ_CONFIG_FILE = "iiq.properties";

/** Path segment grouping server-side config files (`.../config/iiq.properties`) */
export const IIQ_CONFIG_SEGMENT = "config";

/**
 * URI of the environment's `iiq.properties` file:
 * `iiq://<tenantId>/<tenant display name>/config/iiq.properties`
 */
export interface IIQConfigUriParts {
    kind: "config";
    tenantId: string;
    tenantName: string;
    fileName: typeof IIQ_CONFIG_FILE;
}

export type IIQUriParts = ({ kind: "object" } & IIQResourceUriParts) | IIQConfigUriParts;

export function buildConfigUri(tenantId: string, tenantName: string, scheme: string = URI_SCHEME): Uri {
    return Uri.from({
        scheme,
        authority: tenantId.toLowerCase(),
        path: "/" + [tenantName, IIQ_CONFIG_SEGMENT, IIQ_CONFIG_FILE].map(encodePathSegment).join("/")
    });
}

/**
 * Parses a virtual IIQ URI: either an object (`.../<Type>/<id>/<name>.xml`)
 * or the environment config file (`.../config/iiq.properties`).
 */
export function parseIiqUri(uri: Uri): IIQUriParts {
    const segments = uri.path.split("/").filter(s => s.length > 0).map(decodePathSegment);
    if (segments.length === 3
        && segments[1] === IIQ_CONFIG_SEGMENT
        && segments[2].toLowerCase() === IIQ_CONFIG_FILE) {
        return {
            kind: "config",
            tenantId: uri.authority,
            tenantName: segments[0],
            fileName: IIQ_CONFIG_FILE
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
    if (segments.length === 4) {
        return {
            tenantId: uri.authority,
            tenantName: segments[0],
            objectType: segments[1],
            objectId: segments[2],
            objectName: segments[3].replace(/\.xml$/i, "")
        };
    }
    if (segments.length === 3) {
        const idOrName = segments[2].replace(/\.xml$/i, "");
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
