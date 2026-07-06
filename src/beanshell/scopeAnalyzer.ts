/**
 * Heuristic scope analysis of a BeanShell region: imports, local variable
 * declarations, user-defined methods, and the expression chain ending at the
 * cursor. BeanShell scripts are mostly flat, so scoping is approximated by
 * "declared lexically before the cursor".
 */

import { Token, tokenize } from "./tokenizer";

export interface LocalVariable {
    name: string;
    /** Declared or inferred Java type, as written (simple or qualified); undefined when unknown */
    type?: string;
}

export interface UserMethod {
    name: string;
    returnType: string;
    parameters: LocalVariable[];
}

export interface ScopeInfo {
    /** Explicit imports: FQCNs */
    imports: string[];
    /** Wildcard imports: package names */
    wildcardImports: string[];
    /** Variables declared before the cursor (user method parameters included) */
    variables: LocalVariable[];
    /** Methods defined in the script */
    methods: UserMethod[];
}

/** One step of the expression chain before the cursor */
export type ChainSegment = (
    | { kind: "name"; name: string }          // identity
    | { kind: "call"; name: string }          // getLinks(...)
    | { kind: "new"; typeName: string }       // new HashMap(...)
    | { kind: "cast"; typeName: string }      // ((Identity) obj)
    | { kind: "string" }                      // "literal"
    | { kind: "index" }                       // [i] array access
) & {
    /**
     * Set when the '.' before this segment crosses a line break: the chain
     * may actually be two statements (a dangling `foo.` being typed above).
     * Type inference retries without the segments before such a break.
     */
    newlineBefore?: boolean;
};

const STATEMENT_BOUNDARY = new Set([";", "{", "}", "(", ",", ":"]);

/** Analyzes the scope of a region for a cursor at the given region offset */
export function analyzeScope(text: string, cursorOffset: number): ScopeInfo {
    const tokens = tokenize(text).filter(t => t.kind !== "comment");
    const scope: ScopeInfo = { imports: [], wildcardImports: [], variables: [], methods: [] };
    const declared = new Set<string>();

    const addVariable = (variable: LocalVariable) => {
        if (!declared.has(variable.name)) {
            declared.add(variable.name);
            scope.variables.push(variable);
        }
    };

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // import a.b.C; / import a.b.*;
        if (token.kind === "keyword" && token.text === "import") {
            const path = readImportPath(tokens, i + 1, text);
            if (path) {
                if (path.name.endsWith(".*")) {
                    scope.wildcardImports.push(path.name.slice(0, -2));
                } else {
                    scope.imports.push(path.name);
                }
                i = path.next - 1;
            }
            continue;
        }

        // Typed declaration or user method: Type name ... / Type name(...) {
        const declaration = matchTypedDeclaration(tokens, i);
        if (declaration) {
            if (declaration.method) {
                scope.methods.push(declaration.method);
                // Flat-scope approximation: parameters are visible too
                if (declaration.nameToken.start <= cursorOffset) {
                    declaration.method.parameters.forEach(addVariable);
                }
            } else if (declaration.nameToken.start <= cursorOffset) {
                addVariable({ name: declaration.nameToken.text, type: declaration.type });
            }
            i = declaration.next - 1;
            continue;
        }

        // Untyped assignment at a statement start: name = new X(...) / name = "..."
        if (token.kind === "identifier"
            && tokens[i + 1]?.text === "=" && tokens[i + 2]?.text !== "="
            && isStatementStart(tokens, i)
            && token.start <= cursorOffset) {
            addVariable({ name: token.text, type: inferAssignedType(tokens, i + 2) });
        }
    }
    return scope;
}

/**
 * Extracts the expression chain ending just before `offset` (which points
 * right after the trailing '.', or at the partially typed member name).
 * Returns undefined when the expression is not resolvable.
 */
export function extractChainBeforeOffset(text: string, offset: number): ChainSegment[] | undefined {
    const tokens = tokenize(text).filter(t => t.kind !== "comment");

    // Index of the last token ending at or before the offset
    let last = -1;
    for (let i = 0; i < tokens.length && tokens[i].end <= offset; i++) {
        last = i;
    }
    // Drop the partially typed member name: `context.getOb|` → chain of `context.`
    if (last >= 0 && tokens[last].kind === "identifier"
        && tokens[last - 1]?.text === "." && tokens[last].end === offset) {
        last--;
    }
    if (last < 0 || tokens[last].text !== ".") {
        return undefined;
    }

    const segments: ChainSegment[] = [];

    /** Marks the segment following a '.' that crosses a line break */
    const markNewlineBoundary = (dotIndex: number) => {
        const next = tokens[dotIndex + 1];
        if (next && segments.length > 0
            && text.substring(tokens[dotIndex].end, next.start).includes("\n")) {
            segments[0].newlineBefore = true;
        }
    };

    let i = last - 1; // token before the trailing '.'
    walk: for (; ;) {
        const token = tokens[i];
        if (!token) {
            return undefined;
        }

        switch (true) {
            case token.kind === "string":
                segments.unshift({ kind: "string" });
                i--;
                break walk;

            case token.text === ".":
                // Continuation between two chain steps: a.b().c
                markNewlineBoundary(i);
                i--;
                continue;

            case token.text === "]": {
                const open = findMatchingBackward(tokens, i, "[", "]");
                if (open === -1) {
                    return undefined;
                }
                segments.unshift({ kind: "index" });
                i = open - 1;
                continue;
            }

            case token.text === ")": {
                const open = findMatchingBackward(tokens, i, "(", ")");
                if (open === -1) {
                    return undefined;
                }
                const before = tokens[open - 1];
                if (before?.kind === "identifier") {
                    segments.unshift({ kind: "call", name: before.text });
                    i = open - 2;
                    if (tokens[i]?.text === ".") {
                        markNewlineBoundary(i);
                        i--;
                        continue;
                    }
                    break walk; // head of the chain (possibly a `new` construction)
                }
                // Parenthesized expression: only the cast form ((Type) expr)
                // is resolvable, and it is necessarily the head of the chain
                const castType = matchCastContent(tokens, open + 1, i);
                if (castType) {
                    segments.unshift({ kind: "cast", typeName: castType });
                    break walk;
                }
                return undefined;
            }

            case token.kind === "identifier":
                segments.unshift({ kind: "name", name: token.text });
                i--;
                if (tokens[i]?.text === ".") {
                    markNewlineBoundary(i);
                    i--;
                    continue;
                }
                break walk;

            default:
                return undefined;
        }
    }

    // Fold a leading construction: `new HashMap(...)` or `new java.util.HashMap(...)`
    // ends up as leading name segments plus a call segment.
    if (tokens[i]?.kind === "keyword" && tokens[i].text === "new") {
        let k = 0;
        const packagePath: string[] = [];
        while (segments[k]?.kind === "name") {
            packagePath.push((segments[k] as { kind: "name"; name: string }).name);
            k++;
        }
        if (segments[k]?.kind !== "call") {
            return undefined; // `new Type.` without construction parens
        }
        const constructor = segments[k] as { kind: "call"; name: string };
        const typeName = [...packagePath, constructor.name].join(".");
        segments.splice(0, k + 1, { kind: "new", typeName });
    }
    return segments;
}

/**
 * Reads an import path. The path is bounded by the end of the line so that
 * an import being typed (`import com.` + newline) never swallows the next
 * statement.
 */
function readImportPath(tokens: Token[], start: number, text: string):
    { name: string; next: number } | undefined {

    let name = "";
    let i = start;
    let previousEnd: number | undefined;
    for (; ;) {
        const token = tokens[i];
        const isPathPart = token !== undefined
            && (token.kind === "identifier" || token.text === "*" || token.text === ".");
        if (!isPathPart) {
            break;
        }
        if (previousEnd !== undefined
            && text.substring(previousEnd, token.start).includes("\n")) {
            break; // the import statement stops at the end of the line
        }
        name += token.text;
        previousEnd = token.end;
        i++;
    }
    // Incomplete trailing dot: `import com.`
    while (name.endsWith(".")) {
        name = name.slice(0, -1);
    }
    return name ? { name, next: i } : undefined;
}

interface TypedDeclaration {
    type: string;
    nameToken: Token;
    method?: UserMethod;
    /** Index after the declaration name (and parameter list for a method) */
    next: number;
}

/**
 * Matches `Type name` at the given index: qualified type, optional generics
 * and array suffixes, then the declared name. Distinguishes variable
 * declarations (followed by = ; : ) ,) from method definitions (followed by
 * a parameter list and an opening brace).
 */
function matchTypedDeclaration(tokens: Token[], start: number): TypedDeclaration | undefined {
    const type = readType(tokens, start);
    if (!type) {
        return undefined;
    }
    const nameToken = tokens[type.next];
    if (nameToken?.kind !== "identifier") {
        return undefined;
    }
    const after = tokens[type.next + 1];

    if (after?.text === "(") {
        // Possible method definition: Type name(Type a, Type b) {
        const close = findMatchingForward(tokens, type.next + 1, "(", ")");
        if (close !== -1 && tokens[close + 1]?.text === "{") {
            const parameters: LocalVariable[] = [];
            let i = type.next + 2;
            while (i < close) {
                const parameterType = readType(tokens, i);
                if (parameterType && tokens[parameterType.next]?.kind === "identifier") {
                    parameters.push({
                        name: tokens[parameterType.next].text,
                        type: parameterType.name
                    });
                    i = parameterType.next + 1;
                } else {
                    i++;
                }
            }
            return {
                type: type.name,
                nameToken,
                method: { name: nameToken.text, returnType: type.name, parameters },
                next: close + 2
            };
        }
        return undefined;
    }

    if (after && ["=", ";", ":", ")", ","].includes(after.text)) {
        return { type: type.name, nameToken, next: type.next + 1 };
    }
    return undefined;
}

interface TypeMatch { name: string; next: number; }

/** Reads a type: qualified name or primitive, generics and [] suffixes */
function readType(tokens: Token[], start: number): TypeMatch | undefined {
    const first = tokens[start];
    let name: string;
    let i = start + 1;

    if (first?.kind === "identifier") {
        name = first.text;
        // Qualified name: sailpoint.object.Identity
        while (tokens[i]?.text === "." && tokens[i + 1]?.kind === "identifier") {
            name += "." + tokens[i + 1].text;
            i += 2;
        }
    } else if (first?.kind === "keyword" && isPrimitive(first.text)) {
        name = first.text;
    } else {
        return undefined;
    }

    // Generics: skipped (erasure), e.g. List<String>
    if (tokens[i]?.text === "<") {
        const close = findMatchingForward(tokens, i, "<", ">");
        if (close === -1) {
            return undefined;
        }
        i = close + 1;
    }
    // Array suffixes
    while (tokens[i]?.text === "[" && tokens[i + 1]?.text === "]") {
        name += "[]";
        i += 2;
    }
    return { name, next: i };
}

function isPrimitive(word: string): boolean {
    return ["int", "long", "short", "byte", "boolean", "char", "float", "double", "void"]
        .includes(word);
}

function isStatementStart(tokens: Token[], index: number): boolean {
    const previous = tokens[index - 1];
    return previous === undefined || STATEMENT_BOUNDARY.has(previous.text);
}

/** Infers the type assigned by the right-hand side starting at `start` */
function inferAssignedType(tokens: Token[], start: number): string | undefined {
    const first = tokens[start];
    if (first?.kind === "keyword" && first.text === "new") {
        const type = readType(tokens, start + 1);
        return type?.name;
    }
    if (first?.kind === "string") {
        return "java.lang.String";
    }
    return undefined;
}

/** Matches `(Type)` between exclusive bounds → the cast type name */
function matchCastContent(tokens: Token[], start: number, end: number): string | undefined {
    if (tokens[start]?.text !== "(") {
        return undefined;
    }
    const close = findMatchingForward(tokens, start, "(", ")");
    if (close === -1 || close >= end) {
        return undefined;
    }
    const type = readType(tokens, start + 1);
    if (!type || type.next !== close) {
        return undefined;
    }
    return type.name;
}

function findMatchingBackward(tokens: Token[], from: number, open: string, close: string): number {
    let depth = 0;
    for (let i = from; i >= 0; i--) {
        if (tokens[i].text === close) {
            depth++;
        } else if (tokens[i].text === open) {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

function findMatchingForward(tokens: Token[], from: number, open: string, close: string): number {
    let depth = 0;
    for (let i = from; i < tokens.length; i++) {
        if (tokens[i].text === open) {
            depth++;
        } else if (tokens[i].text === close) {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}
