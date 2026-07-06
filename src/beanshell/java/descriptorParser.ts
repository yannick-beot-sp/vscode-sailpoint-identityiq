/**
 * Parsers for JVM type descriptors (JVMS §4.3) and for the generic
 * "Signature" attribute (JVMS §4.7.9.1).
 *
 * Descriptors give the erased types used for type inference; the generic
 * signature is only rendered to a human-readable string for display.
 */

const PRIMITIVES: Record<string, string> = {
    B: "byte",
    C: "char",
    D: "double",
    F: "float",
    I: "int",
    J: "long",
    S: "short",
    Z: "boolean",
    V: "void"
};

export interface MethodDescriptor {
    parameterTypes: string[];
    returnType: string;
}

/** Parses a field descriptor, e.g. "[Ljava/lang/String;" → "java.lang.String[]" */
export function parseFieldDescriptor(descriptor: string): string {
    return parseType(descriptor, { offset: 0 });
}

/** Parses a method descriptor, e.g. "(Ljava/lang/String;I)V" */
export function parseMethodDescriptor(descriptor: string): MethodDescriptor {
    if (descriptor[0] !== "(") {
        throw new Error(`Invalid method descriptor: ${descriptor}`);
    }
    const pos = { offset: 1 };
    const parameterTypes: string[] = [];
    while (descriptor[pos.offset] !== ")") {
        parameterTypes.push(parseType(descriptor, pos));
    }
    pos.offset++; // skip ')'
    return { parameterTypes, returnType: parseType(descriptor, pos) };
}

interface Position { offset: number; }

function parseType(descriptor: string, pos: Position): string {
    const c = descriptor[pos.offset];
    if (c === undefined) {
        throw new Error(`Truncated descriptor: ${descriptor}`);
    }
    if (PRIMITIVES[c]) {
        pos.offset++;
        return PRIMITIVES[c];
    }
    if (c === "L") {
        const end = descriptor.indexOf(";", pos.offset);
        if (end === -1) {
            throw new Error(`Truncated descriptor: ${descriptor}`);
        }
        const name = descriptor.substring(pos.offset + 1, end).replace(/\//g, ".");
        pos.offset = end + 1;
        return name;
    }
    if (c === "[") {
        pos.offset++;
        return parseType(descriptor, pos) + "[]";
    }
    throw new Error(`Unexpected character '${c}' in descriptor: ${descriptor}`);
}

/**
 * Renders a generic method Signature attribute to a human-readable string,
 * e.g. "(Ljava/util/List<Lsailpoint/object/Filter;>;)Ljava/util/Iterator<Lsailpoint/object/Identity;>;"
 * → "(List<Filter>) : Iterator<Identity>".
 * Returns undefined when the signature cannot be parsed (best effort only).
 */
export function formatGenericMethodSignature(signature: string): string | undefined {
    try {
        const pos = { offset: 0 };
        // Ignore the method type parameters (<T:...>) if present
        if (signature[pos.offset] === "<") {
            skipBalanced(signature, pos, "<", ">");
        }
        if (signature[pos.offset] !== "(") {
            return undefined;
        }
        pos.offset++;
        const params: string[] = [];
        while (signature[pos.offset] !== ")") {
            params.push(parseGenericType(signature, pos));
        }
        pos.offset++; // skip ')'
        const returnType = parseGenericType(signature, pos);
        return `(${params.join(", ")}) : ${returnType}`;
    } catch {
        return undefined;
    }
}

/**
 * Renders a generic field/variable Signature attribute to a human-readable
 * string, e.g. "Ljava/util/List<Lsailpoint/object/Link;>;" → "List<Link>".
 */
export function formatGenericTypeSignature(signature: string): string | undefined {
    try {
        const pos = { offset: 0 };
        const result = parseGenericType(signature, pos);
        return pos.offset === signature.length ? result : undefined;
    } catch {
        return undefined;
    }
}

/** Parses one JavaTypeSignature, rendering simple names for readability */
function parseGenericType(signature: string, pos: Position): string {
    const c = signature[pos.offset];
    if (c === undefined) {
        throw new Error("truncated");
    }
    if (PRIMITIVES[c]) {
        pos.offset++;
        return PRIMITIVES[c];
    }
    if (c === "[") {
        pos.offset++;
        return parseGenericType(signature, pos) + "[]";
    }
    if (c === "T") {
        // Type variable: TE;
        const end = signature.indexOf(";", pos.offset);
        if (end === -1) {
            throw new Error("truncated");
        }
        const name = signature.substring(pos.offset + 1, end);
        pos.offset = end + 1;
        return name;
    }
    if (c === "L") {
        return parseClassTypeSignature(signature, pos);
    }
    throw new Error(`unexpected '${c}'`);
}

function parseClassTypeSignature(signature: string, pos: Position): string {
    pos.offset++; // skip 'L'
    let rendered = "";   // already-rendered prefix (outer classes with type args)
    let identifier = ""; // identifier being accumulated
    for (; ;) {
        const c = signature[pos.offset];
        if (c === undefined) {
            throw new Error("truncated");
        }
        if (c === "/") {
            identifier = ""; // package segment: dropped for readability
            pos.offset++;
        } else if (c === "<") {
            rendered += identifier + parseTypeArguments(signature, pos);
            identifier = "";
        } else if (c === ".") {
            rendered += identifier + "."; // inner class separator
            identifier = "";
            pos.offset++;
        } else if (c === ";") {
            pos.offset++;
            return rendered + identifier;
        } else {
            identifier += c;
            pos.offset++;
        }
    }
}

function parseTypeArguments(signature: string, pos: Position): string {
    pos.offset++; // skip '<'
    const args: string[] = [];
    while (signature[pos.offset] !== ">") {
        const c = signature[pos.offset];
        if (c === "*") {
            pos.offset++;
            args.push("?");
        } else if (c === "+") {
            pos.offset++;
            args.push("? extends " + parseGenericType(signature, pos));
        } else if (c === "-") {
            pos.offset++;
            args.push("? super " + parseGenericType(signature, pos));
        } else {
            args.push(parseGenericType(signature, pos));
        }
    }
    pos.offset++; // skip '>'
    return `<${args.join(", ")}>`;
}

function skipBalanced(text: string, pos: Position, open: string, close: string): void {
    let depth = 0;
    do {
        const c = text[pos.offset];
        if (c === undefined) {
            throw new Error("truncated");
        }
        if (c === open) {
            depth++;
        } else if (c === close) {
            depth--;
        }
        pos.offset++;
    } while (depth > 0);
}
