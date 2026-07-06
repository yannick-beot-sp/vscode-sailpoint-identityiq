/**
 * Data model of the Java class metadata used for BeanShell completion.
 * Produced by the .class parser (classFileParser.ts) and by the pre-generated
 * JDK core index (resources/jdk-core-index.json), which uses the same shape.
 */

export type JavaClassKind = "class" | "interface" | "enum" | "annotation";

export interface JavaClassInfo {
    /** Fully qualified class name, e.g. "sailpoint.api.SailPointContext" */
    fqcn: string;
    packageName: string;
    simpleName: string;
    kind: JavaClassKind;
    isPublic: boolean;
    isAbstract: boolean;
    isDeprecated: boolean;
    /** FQCN of the superclass, undefined for java.lang.Object */
    superclass?: string;
    /** FQCNs of the implemented interfaces */
    interfaces: string[];
    fields: JavaFieldInfo[];
    /** Constructors are included with the name "<init>" */
    methods: JavaMethodInfo[];
}

export interface JavaMethodInfo {
    name: string;
    /** Raw JVM descriptor, kept as the identity of an overload */
    descriptor: string;
    /** Erased return type: FQCN, primitive name or "void"; arrays end with [] */
    returnType: string;
    parameters: JavaParameterInfo[];
    /**
     * Human-readable generic signature, display only,
     * e.g. "(List<Filter>) : Iterator<Identity>"
     */
    genericSignature?: string;
    isStatic: boolean;
    isPublic: boolean;
    isDeprecated: boolean;
}

export interface JavaParameterInfo {
    /** Parameter name if available in the bytecode, else "arg0", "arg1"... */
    name: string;
    /** Erased type: FQCN, primitive name or array */
    type: string;
}

export interface JavaFieldInfo {
    name: string;
    /** Erased type: FQCN, primitive name or array */
    type: string;
    /** Human-readable generic type, display only, e.g. "List<Link>" */
    genericType?: string;
    isStatic: boolean;
    isPublic: boolean;
    isFinal: boolean;
    isDeprecated: boolean;
}
