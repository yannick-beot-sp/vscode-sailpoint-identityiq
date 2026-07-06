/**
 * Type resolution for BeanShell expressions: simple name → FQCN, and
 * inference of the type of an expression chain (variables, method calls,
 * fields, casts, constructions) against the class index.
 */

import { ClassIndexService } from "./java/ClassIndexService";
import { ChainSegment, LocalVariable, ScopeInfo } from "./scopeAnalyzer";

/** Packages implicitly imported by BeanShell (the ones the index covers) */
export const DEFAULT_IMPORTS = ["java.lang", "java.util", "java.io", "java.net"];

/** Resolved type of an expression */
export interface ResolvedType {
    /** FQCN, or primitive name; arrays end with [] */
    typeName: string;
    /** True when the expression designates the class itself (static access) */
    isStatic: boolean;
}

/**
 * Resolves a type name as written in the source (simple or qualified,
 * possibly with array suffixes) to a FQCN known by the index.
 */
export function resolveTypeName(written: string, scope: ScopeInfo,
    index: ClassIndexService): string | undefined {

    let arraySuffix = "";
    let base = written;
    while (base.endsWith("[]")) {
        arraySuffix += "[]";
        base = base.slice(0, -2);
    }
    if (isPrimitiveName(base)) {
        return base + arraySuffix;
    }
    // Qualified name: taken as-is when the index knows it
    if (base.includes(".")) {
        return index.hasClass(base) ? base + arraySuffix : undefined;
    }
    const resolved = resolveSimpleName(base, scope, index);
    return resolved ? resolved + arraySuffix : undefined;
}

/** Resolves a simple class name to a FQCN, following the import rules */
export function resolveSimpleName(simpleName: string, scope: ScopeInfo,
    index: ClassIndexService): string | undefined {

    // 1. Explicit import
    const explicit = scope.imports.find(fqcn => fqcn.endsWith("." + simpleName));
    if (explicit) {
        return explicit;
    }
    // 2. Wildcard imports, then BeanShell default imports
    for (const packageName of [...scope.wildcardImports, ...DEFAULT_IMPORTS]) {
        const candidate = `${packageName}.${simpleName}`;
        if (index.hasClass(candidate)) {
            return candidate;
        }
    }
    // 3. Unambiguous global match
    const global = index.findBySimpleName(simpleName);
    return global.length === 1 ? global[0] : undefined;
}

/**
 * Infers the type of an expression chain, retrying without the leading
 * segments when the chain crosses a line break and does not resolve: a
 * trailing `foo.` on the previous line usually belongs to another statement
 * being typed, not to a multi-line chain.
 */
export async function inferChainTypeWithRecovery(segments: ChainSegment[], scope: ScopeInfo,
    contextVariables: LocalVariable[], index: ClassIndexService):
    Promise<ResolvedType | undefined> {

    let candidate = segments;
    for (; ;) {
        const resolved = await inferChainType(candidate, scope, contextVariables, index);
        if (resolved) {
            return resolved;
        }
        let lastBreak = -1;
        for (let i = 1; i < candidate.length; i++) {
            if (candidate[i].newlineBefore) {
                lastBreak = i;
            }
        }
        if (lastBreak <= 0) {
            return undefined;
        }
        candidate = candidate.slice(lastBreak);
    }
}

/**
 * Infers the type of an expression chain (as extracted by
 * extractChainBeforeOffset). Returns undefined when any step is unknown.
 */
export async function inferChainType(segments: ChainSegment[], scope: ScopeInfo,
    contextVariables: LocalVariable[], index: ClassIndexService):
    Promise<ResolvedType | undefined> {

    let current: ResolvedType | undefined;
    let position = 0;

    // Resolve the head of the chain
    const head = segments[0];
    switch (head.kind) {
        case "string":
            current = { typeName: "java.lang.String", isStatic: false };
            position = 1;
            break;
        case "new":
        case "cast": {
            const typeName = resolveTypeName(head.typeName, scope, index);
            if (!typeName) {
                return undefined;
            }
            current = { typeName, isStatic: false };
            position = 1;
            break;
        }
        case "name": {
            // Local variable or rule context variable...
            const variable = scope.variables.find(v => v.name === head.name)
                ?? contextVariables.find(v => v.name === head.name);
            if (variable) {
                if (!variable.type) {
                    return undefined;
                }
                const typeName = resolveTypeName(variable.type, scope, index);
                if (!typeName) {
                    return undefined;
                }
                current = { typeName, isStatic: false };
                position = 1;
                break;
            }
            // ... or a class name (static access), possibly written as a
            // package chain: sailpoint.object.Identity.
            const staticType = resolveStaticHead(segments, scope, index);
            if (!staticType) {
                return undefined;
            }
            current = { typeName: staticType.typeName, isStatic: true };
            position = staticType.consumed;
            break;
        }
        case "call": {
            // Call of a user-defined method of the script
            const method = scope.methods.find(m => m.name === head.name);
            if (!method) {
                return undefined;
            }
            const typeName = resolveTypeName(method.returnType, scope, index);
            if (!typeName) {
                return undefined;
            }
            current = { typeName, isStatic: false };
            position = 1;
            break;
        }
        default:
            return undefined;
    }

    // Resolve the rest of the chain through class members
    for (; position < segments.length; position++) {
        const segment = segments[position];

        if (segment.kind === "index") {
            if (!current.typeName.endsWith("[]")) {
                return undefined;
            }
            current = { typeName: current.typeName.slice(0, -2), isStatic: false };
            continue;
        }
        if (segment.kind !== "name" && segment.kind !== "call") {
            return undefined;
        }

        // Arrays only expose length (int)
        if (current.typeName.endsWith("[]")) {
            if (segment.kind === "name" && segment.name === "length") {
                current = { typeName: "int", isStatic: false };
                continue;
            }
            return undefined;
        }
        if (isPrimitiveName(current.typeName)) {
            return undefined;
        }

        const members = await index.getAllMembers(current.typeName);
        let memberType: string | undefined;
        if (segment.kind === "call") {
            const overloads = members.methods.filter(m => m.name === segment.name
                && (!current!.isStatic || m.isStatic));
            // Overload selection is approximate: first public overload
            memberType = (overloads.find(m => m.isPublic) ?? overloads[0])?.returnType;
        } else {
            const field = members.fields.find(f => f.name === segment.name
                && (!current!.isStatic || f.isStatic));
            memberType = field?.type;
        }
        if (!memberType) {
            return undefined;
        }
        current = { typeName: memberType, isStatic: false };
    }
    return current;
}

/**
 * Resolves a chain head made of name segments as a class reference:
 * either a simple name (Identity) or a package chain (sailpoint.object.Identity).
 * Returns the FQCN and the number of consumed segments.
 */
function resolveStaticHead(segments: ChainSegment[], scope: ScopeInfo,
    index: ClassIndexService): { typeName: string; consumed: number } | undefined {

    const first = segments[0];
    if (first.kind !== "name") {
        return undefined;
    }
    const simple = resolveSimpleName(first.name, scope, index);
    if (simple) {
        return { typeName: simple, consumed: 1 };
    }
    // Accumulate name segments into a qualified name known by the index
    let qualified = first.name;
    for (let i = 1; i < segments.length; i++) {
        const segment = segments[i];
        if (segment.kind !== "name") {
            return undefined;
        }
        qualified += "." + segment.name;
        if (index.hasClass(qualified)) {
            return { typeName: qualified, consumed: i + 1 };
        }
    }
    return undefined;
}

function isPrimitiveName(name: string): boolean {
    return ["int", "long", "short", "byte", "boolean", "char", "float", "double", "void"]
        .includes(name);
}
