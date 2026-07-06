import { Uri } from "vscode";
import { DIFF_SCHEME, URI_SCHEME } from "../constants";

/**
 * Structure of a resource URI handled by the virtual file system provider:
 *
 *     iiq://<tenantId>/<tenant display name>/<ObjectType>/<object name>.xml
 *
 * - The authority is the tenant id (immutable, lowercase) so that resources
 *   can be resolved even if the tenant is renamed.
 * - The first path segment is the tenant display name, only used to make the
 *   path human-readable (editor tooltip, breadcrumb...).
 */
export interface IIQResourceUriParts {
    tenantId: string;
    tenantName: string;
    objectType: string;
    objectName: string;
}

export function buildResourceUri(parts: IIQResourceUriParts, scheme: string = URI_SCHEME): Uri {
    return Uri.from({
        scheme,
        authority: parts.tenantId.toLowerCase(),
        path: "/" + [
            parts.tenantName,
            parts.objectType,
            `${parts.objectName}.xml`
        ].map(encodePathSegment).join("/")
    });
}

export function buildDiffResourceUri(parts: IIQResourceUriParts): Uri {
    return buildResourceUri(parts, DIFF_SCHEME);
}

/**
 * Parses a URI produced by {@link buildResourceUri}.
 * Throws if the URI does not have the expected structure.
 */
export function parseResourceUri(uri: Uri): IIQResourceUriParts {
    const segments = uri.path.split("/").filter(s => s.length > 0).map(decodePathSegment);
    if (segments.length !== 3) {
        throw new Error(`Invalid IdentityIQ resource URI: ${uri.toString()}`);
    }
    return {
        tenantId: uri.authority,
        tenantName: segments[0],
        objectType: segments[1],
        objectName: segments[2].replace(/\.xml$/i, "")
    };
}

/** Encodes a path segment, keeping it readable (only / and % are problematic) */
function encodePathSegment(segment: string): string {
    return segment.replace(/%/g, "%25").replace(/\//g, "%2F");
}

function decodePathSegment(segment: string): string {
    return segment.replace(/%2F/g, "/").replace(/%25/g, "%");
}
