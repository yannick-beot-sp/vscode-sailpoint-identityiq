/**
 * Minimal Java .class file parser (JVMS §4).
 *
 * Extracts only what BeanShell completion needs: class name, kind, access
 * flags, superclass/interfaces, and the public shape of fields and methods
 * (descriptors, parameter names when compiled with -g or -parameters,
 * generic signatures for display, deprecation).
 * The bytecode itself is never interpreted.
 */

import {
    formatGenericMethodSignature,
    formatGenericTypeSignature,
    parseFieldDescriptor,
    parseMethodDescriptor
} from "./descriptorParser";
import { JavaClassInfo, JavaFieldInfo, JavaMethodInfo, JavaParameterInfo } from "./model";

// Access flags (JVMS table 4.1-B, 4.5-A, 4.6-A)
const ACC_PUBLIC = 0x0001;
const ACC_STATIC = 0x0008;
const ACC_FINAL = 0x0010;
const ACC_BRIDGE = 0x0040;
const ACC_INTERFACE = 0x0200;
const ACC_ABSTRACT = 0x0400;
const ACC_SYNTHETIC = 0x1000;
const ACC_ANNOTATION = 0x2000;
const ACC_ENUM = 0x4000;

// Constant pool tags (JVMS table 4.4-A)
const enum ConstantTag {
    Utf8 = 1,
    Integer = 3,
    Float = 4,
    Long = 5,
    Double = 6,
    Class = 7,
    String = 8,
    FieldRef = 9,
    MethodRef = 10,
    InterfaceMethodRef = 11,
    NameAndType = 12,
    MethodHandle = 15,
    MethodType = 16,
    Dynamic = 17,
    InvokeDynamic = 18,
    Module = 19,
    Package = 20
}

/** Parses a .class file. Throws on malformed input. */
export function parseClassFile(buffer: Buffer): JavaClassInfo {
    const reader = new Reader(buffer);
    if (reader.u4() !== 0xCAFEBABE) {
        throw new Error("Not a Java class file");
    }
    reader.skip(4); // minor + major version

    const pool = readConstantPool(reader);
    const utf8 = (index: number): string => {
        const value = pool.utf8[index];
        if (value === undefined) {
            throw new Error(`Invalid Utf8 constant #${index}`);
        }
        return value;
    };
    const className = (index: number): string =>
        utf8(pool.classNameIndex[index]).replace(/\//g, ".");

    const accessFlags = reader.u2();
    const thisClass = className(reader.u2());
    const superIndex = reader.u2();
    const superclass = superIndex === 0 ? undefined : className(superIndex);

    const interfaceCount = reader.u2();
    const interfaces: string[] = [];
    for (let i = 0; i < interfaceCount; i++) {
        interfaces.push(className(reader.u2()));
    }

    const fields: JavaFieldInfo[] = [];
    const fieldCount = reader.u2();
    for (let i = 0; i < fieldCount; i++) {
        const field = readField(reader, utf8);
        if (field) {
            fields.push(field);
        }
    }

    const methods: JavaMethodInfo[] = [];
    const methodCount = reader.u2();
    for (let i = 0; i < methodCount; i++) {
        const method = readMethod(reader, utf8);
        if (method) {
            methods.push(method);
        }
    }

    const classAttributes = readAttributes(reader, utf8);

    const lastDot = thisClass.lastIndexOf(".");
    let kind: JavaClassInfo["kind"] = "class";
    if (accessFlags & ACC_ANNOTATION) {
        kind = "annotation";
    } else if (accessFlags & ACC_INTERFACE) {
        kind = "interface";
    } else if (accessFlags & ACC_ENUM) {
        kind = "enum";
    }

    return {
        fqcn: thisClass,
        packageName: lastDot === -1 ? "" : thisClass.substring(0, lastDot),
        simpleName: thisClass.substring(lastDot + 1),
        kind,
        isPublic: (accessFlags & ACC_PUBLIC) !== 0,
        isAbstract: (accessFlags & ACC_ABSTRACT) !== 0,
        isDeprecated: classAttributes.deprecated,
        superclass,
        interfaces,
        fields,
        methods
    };
}

class Reader {
    private offset = 0;
    constructor(private readonly buffer: Buffer) { }

    u1(): number { return this.buffer.readUInt8(this.offset++); }
    u2(): number { const v = this.buffer.readUInt16BE(this.offset); this.offset += 2; return v; }
    u4(): number { const v = this.buffer.readUInt32BE(this.offset); this.offset += 4; return v; }
    utf8(length: number): string {
        // Java modified UTF-8 differs from UTF-8 only for NUL and supplementary
        // characters, which never occur in identifiers/descriptors we care about.
        const value = this.buffer.toString("utf8", this.offset, this.offset + length);
        this.offset += length;
        return value;
    }
    skip(length: number): void { this.offset += length; }
    slice(length: number): Reader {
        const sub = new Reader(this.buffer.subarray(this.offset, this.offset + length));
        this.offset += length;
        return sub;
    }
}

interface ConstantPool {
    /** index → string for Utf8 constants */
    utf8: Record<number, string>;
    /** index → name_index for Class constants */
    classNameIndex: Record<number, number>;
}

function readConstantPool(reader: Reader): ConstantPool {
    const count = reader.u2();
    const pool: ConstantPool = { utf8: {}, classNameIndex: {} };
    for (let i = 1; i < count; i++) {
        const tag = reader.u1();
        switch (tag) {
            case ConstantTag.Utf8:
                pool.utf8[i] = reader.utf8(reader.u2());
                break;
            case ConstantTag.Class:
                pool.classNameIndex[i] = reader.u2();
                break;
            case ConstantTag.String:
            case ConstantTag.MethodType:
            case ConstantTag.Module:
            case ConstantTag.Package:
                reader.skip(2);
                break;
            case ConstantTag.MethodHandle:
                reader.skip(3);
                break;
            case ConstantTag.Integer:
            case ConstantTag.Float:
            case ConstantTag.FieldRef:
            case ConstantTag.MethodRef:
            case ConstantTag.InterfaceMethodRef:
            case ConstantTag.NameAndType:
            case ConstantTag.Dynamic:
            case ConstantTag.InvokeDynamic:
                reader.skip(4);
                break;
            case ConstantTag.Long:
            case ConstantTag.Double:
                reader.skip(8);
                i++; // 8-byte constants take two pool slots
                break;
            default:
                throw new Error(`Unknown constant pool tag ${tag}`);
        }
    }
    return pool;
}

interface MemberAttributes {
    deprecated: boolean;
    /** Raw generic Signature attribute */
    signature?: string;
    /** Parameter names from the MethodParameters attribute */
    methodParameters?: string[];
    /** slot index → name, from the Code attribute's LocalVariableTable */
    localVariables?: Map<number, string>;
}

function readAttributes(reader: Reader, utf8: (i: number) => string): MemberAttributes {
    const result: MemberAttributes = { deprecated: false };
    const count = reader.u2();
    for (let i = 0; i < count; i++) {
        const name = utf8(reader.u2());
        const length = reader.u4();
        switch (name) {
            case "Deprecated":
                result.deprecated = true;
                reader.skip(length);
                break;
            case "Signature":
                result.signature = utf8(reader.slice(length).u2());
                break;
            case "MethodParameters": {
                const sub = reader.slice(length);
                const parameterCount = sub.u1();
                const names: string[] = [];
                for (let p = 0; p < parameterCount; p++) {
                    const nameIndex = sub.u2();
                    sub.skip(2); // access_flags
                    names.push(nameIndex === 0 ? "" : utf8(nameIndex));
                }
                result.methodParameters = names;
                break;
            }
            case "Code": {
                const sub = reader.slice(length);
                sub.skip(4); // max_stack + max_locals
                sub.skip(sub.u4()); // bytecode
                sub.skip(sub.u2() * 8); // exception table
                const codeAttributes = sub.u2();
                for (let a = 0; a < codeAttributes; a++) {
                    const attrName = utf8(sub.u2());
                    const attrLength = sub.u4();
                    if (attrName === "LocalVariableTable") {
                        const table = sub.slice(attrLength);
                        const entries = table.u2();
                        const locals = new Map<number, string>();
                        for (let e = 0; e < entries; e++) {
                            const startPc = table.u2();
                            table.skip(2); // length
                            const nameIndex = table.u2();
                            table.skip(2); // descriptor_index
                            const slot = table.u2();
                            // Parameters are the variables live from pc 0
                            if (startPc === 0 && !locals.has(slot)) {
                                locals.set(slot, utf8(nameIndex));
                            }
                        }
                        result.localVariables = locals;
                    } else {
                        sub.skip(attrLength);
                    }
                }
                break;
            }
            default:
                reader.skip(length);
                break;
        }
    }
    return result;
}

function readField(reader: Reader, utf8: (i: number) => string): JavaFieldInfo | undefined {
    const accessFlags = reader.u2();
    const name = utf8(reader.u2());
    const descriptor = utf8(reader.u2());
    const attributes = readAttributes(reader, utf8);

    if (accessFlags & ACC_SYNTHETIC) {
        return undefined;
    }
    return {
        name,
        type: parseFieldDescriptor(descriptor),
        genericType: attributes.signature
            ? formatGenericTypeSignature(attributes.signature)
            : undefined,
        isStatic: (accessFlags & ACC_STATIC) !== 0,
        isPublic: (accessFlags & ACC_PUBLIC) !== 0,
        isFinal: (accessFlags & ACC_FINAL) !== 0,
        isDeprecated: attributes.deprecated
    };
}

function readMethod(reader: Reader, utf8: (i: number) => string): JavaMethodInfo | undefined {
    const accessFlags = reader.u2();
    const name = utf8(reader.u2());
    const descriptor = utf8(reader.u2());
    const attributes = readAttributes(reader, utf8);

    if ((accessFlags & (ACC_SYNTHETIC | ACC_BRIDGE)) || name === "<clinit>") {
        return undefined;
    }

    const { parameterTypes, returnType } = parseMethodDescriptor(descriptor);
    const isStatic = (accessFlags & ACC_STATIC) !== 0;
    const parameters: JavaParameterInfo[] = parameterTypes.map((type, index) => ({
        name: resolveParameterName(attributes, parameterTypes, index, isStatic),
        type
    }));

    return {
        name,
        descriptor,
        returnType,
        parameters,
        genericSignature: attributes.signature
            ? formatGenericMethodSignature(attributes.signature)
            : undefined,
        isStatic,
        isPublic: (accessFlags & ACC_PUBLIC) !== 0,
        isDeprecated: attributes.deprecated
    };
}

function resolveParameterName(attributes: MemberAttributes, parameterTypes: string[],
    index: number, isStatic: boolean): string {

    const fromMethodParameters = attributes.methodParameters?.[index];
    if (fromMethodParameters) {
        return fromMethodParameters;
    }
    if (attributes.localVariables) {
        // Compute the variable slot: 'this' occupies slot 0 of instance
        // methods, long/double parameters occupy two slots.
        let slot = isStatic ? 0 : 1;
        for (let i = 0; i < index; i++) {
            slot += parameterTypes[i] === "long" || parameterTypes[i] === "double" ? 2 : 1;
        }
        const name = attributes.localVariables.get(slot);
        if (name) {
            return name;
        }
    }
    return `arg${index}`;
}
