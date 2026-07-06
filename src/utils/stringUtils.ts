export function isEmpty(value: string | null | undefined): boolean {
    return value === null || value === undefined || value.trim().length === 0;
}

export function isNotEmpty(value: string | null | undefined): value is string {
    return !isEmpty(value);
}

export function capitalizeFirstLetter(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Converts "objectType" or "ObjectType" to "object type" */
export function convertPascalCase2SpaceBased(value: string): string {
    return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

export function compareByName(a: { name: string }, b: { name: string }): number {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Makes a string safe to be used as a file name */
export function normalizeAsFilename(value: string): string {
    return value.replace(/[/\\:*?"<>|]/g, "_");
}
