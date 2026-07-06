/**
 * Aggregated index of the Java classes available for BeanShell completion.
 *
 * Sources are searched in order: the jars of the configured classpath first
 * (so an IdentityIQ class can shadow a JDK one), then the bundled JDK core
 * index. Class names are indexed eagerly (cheap: zip central directories);
 * class members are parsed lazily, one class at a time, behind an LRU cache.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { parseClassFile } from "./classFileParser";
import { JarFile } from "./jarReader";
import { JavaClassInfo, JavaFieldInfo, JavaMethodInfo } from "./model";

/** A provider of Java class metadata (a jar, the JDK index...) */
export interface ClassSource {
    /** All fully qualified class names, known without parsing anything */
    listClassNames(): ReadonlyArray<string>;
    /** Full metadata of one class, parsed on demand */
    loadClass(fqcn: string): Promise<JavaClassInfo | undefined>;
    dispose(): void;
}

/** A member together with the class that declares it (used by hover) */
export type MemberOf<T> = T & { declaringClass: string };

/** All members reachable on a class, inherited ones included */
export interface ClassMembers {
    fields: MemberOf<JavaFieldInfo>[];
    methods: MemberOf<JavaMethodInfo>[];
}

const MEMBER_CACHE_SIZE = 200;

export class ClassIndexService {

    /** simple name → FQCNs bearing that name */
    private readonly bySimpleName = new Map<string, string[]>();
    /** package name → direct children */
    private readonly packages = new Map<string, { packages: Set<string>; classes: string[] }>();
    /** FQCN → owning source */
    private readonly sourceByClass = new Map<string, ClassSource>();

    private readonly classCache = new Map<string, Promise<JavaClassInfo | undefined>>();
    private readonly membersCache = new Map<string, Promise<ClassMembers>>();

    /** Paths of the configured classpath that could not be read */
    public readonly invalidPaths: string[];

    private constructor(private readonly sources: ClassSource[], invalidPaths: string[]) {
        this.invalidPaths = invalidPaths;
        // First source wins for duplicated class names
        for (const source of sources) {
            for (const fqcn of source.listClassNames()) {
                if (this.sourceByClass.has(fqcn)) {
                    continue;
                }
                this.sourceByClass.set(fqcn, source);
                this.indexName(fqcn);
            }
        }
    }

    /**
     * Builds the index from the configured classpath entries (jar files or
     * folders containing jars) and the bundled JDK core index.
     */
    public static async build(classpath: string[], jdkSource?: ClassSource): Promise<ClassIndexService> {
        const { jarPaths, invalidPaths } = await expandClasspath(classpath);
        const sources: ClassSource[] = [];
        for (const jarPath of jarPaths) {
            try {
                sources.push(await JarClassSource.open(jarPath));
            } catch {
                invalidPaths.push(jarPath);
            }
        }
        if (jdkSource) {
            sources.push(jdkSource);
        }
        return new ClassIndexService(sources, invalidPaths);
    }

    /** Total number of indexed classes (all sources) */
    public get classCount(): number {
        return this.sourceByClass.size;
    }

    /** FQCNs of the classes with the given simple name */
    public findBySimpleName(simpleName: string): string[] {
        return this.bySimpleName.get(simpleName) ?? [];
    }

    /** Simple names starting with the prefix, with their FQCNs (capped) */
    public findSimpleNamesByPrefix(prefix: string, limit: number): Map<string, string[]> {
        const result = new Map<string, string[]>();
        for (const [simpleName, fqcns] of this.bySimpleName) {
            if (simpleName.startsWith(prefix)) {
                result.set(simpleName, fqcns);
                if (result.size >= limit) {
                    break;
                }
            }
        }
        return result;
    }

    /** Direct children of a package: sub-packages and class simple names */
    public getPackageChildren(packageName: string): { packages: string[]; classes: string[] } {
        const entry = this.packages.get(packageName);
        if (!entry) {
            return { packages: [], classes: [] };
        }
        return { packages: [...entry.packages].sort(), classes: [...entry.classes].sort() };
    }

    public hasClass(fqcn: string): boolean {
        return this.sourceByClass.has(fqcn);
    }

    /** Full metadata of a class (cached), or undefined if unknown/unreadable */
    public getClass(fqcn: string): Promise<JavaClassInfo | undefined> {
        const source = this.sourceByClass.get(fqcn);
        if (!source) {
            return Promise.resolve(undefined);
        }
        let cached = this.classCache.get(fqcn);
        if (!cached) {
            cached = source.loadClass(fqcn).catch(() => undefined);
            this.cacheWithEviction(this.classCache, fqcn, cached);
        } else {
            // Refresh the LRU position
            this.classCache.delete(fqcn);
            this.classCache.set(fqcn, cached);
        }
        return cached;
    }

    /**
     * All members reachable on a class: its own, plus the ones inherited from
     * its superclasses and interfaces. Overridden members are reported once,
     * on the most derived class. The walk stops silently on classes missing
     * from the classpath.
     */
    public getAllMembers(fqcn: string): Promise<ClassMembers> {
        let cached = this.membersCache.get(fqcn);
        if (!cached) {
            cached = this.collectMembers(fqcn);
            this.cacheWithEviction(this.membersCache, fqcn, cached);
        }
        return cached;
    }

    public dispose(): void {
        for (const source of this.sources) {
            source.dispose();
        }
        this.classCache.clear();
        this.membersCache.clear();
    }

    private async collectMembers(fqcn: string): Promise<ClassMembers> {
        const methods: MemberOf<JavaMethodInfo>[] = [];
        const fields: MemberOf<JavaFieldInfo>[] = [];
        const seenMethods = new Set<string>();
        const seenFields = new Set<string>();
        const visited = new Set<string>();
        const queue: string[] = [fqcn];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) {
                continue;
            }
            visited.add(current);
            const info = await this.getClass(current);
            if (!info) {
                continue;
            }
            for (const method of info.methods) {
                // Constructors are not inherited
                if (method.name === "<init>" && current !== fqcn) {
                    continue;
                }
                // Overload identity by name + erased parameter types: raw
                // descriptors are not comparable across sources (jar vs JDK index)
                const key = `${method.name}(${method.parameters.map(p => p.type).join(",")})`;
                if (!seenMethods.has(key)) {
                    seenMethods.add(key);
                    methods.push({ ...method, declaringClass: current });
                }
            }
            for (const field of info.fields) {
                if (!seenFields.has(field.name)) {
                    seenFields.add(field.name);
                    fields.push({ ...field, declaringClass: current });
                }
            }
            if (info.superclass) {
                queue.push(info.superclass);
            }
            queue.push(...info.interfaces);
        }
        return { fields, methods };
    }

    private indexName(fqcn: string): void {
        const lastDot = fqcn.lastIndexOf(".");
        const simpleName = fqcn.substring(lastDot + 1);
        const packageName = lastDot === -1 ? "" : fqcn.substring(0, lastDot);

        const names = this.bySimpleName.get(simpleName);
        if (names) {
            names.push(fqcn);
        } else {
            this.bySimpleName.set(simpleName, [fqcn]);
        }

        this.packageEntry(packageName).classes.push(simpleName);
        // Register the package chain: sailpoint.api → sailpoint → ""
        let child = packageName;
        while (child !== "") {
            const dot = child.lastIndexOf(".");
            const parent = dot === -1 ? "" : child.substring(0, dot);
            this.packageEntry(parent).packages.add(child.substring(dot + 1));
            child = parent;
        }
    }

    private packageEntry(packageName: string) {
        let entry = this.packages.get(packageName);
        if (!entry) {
            entry = { packages: new Set<string>(), classes: [] };
            this.packages.set(packageName, entry);
        }
        return entry;
    }

    private cacheWithEviction<V>(cache: Map<string, V>, key: string, value: V): void {
        cache.set(key, value);
        if (cache.size > MEMBER_CACHE_SIZE) {
            // Map preserves insertion order: the first key is the oldest
            cache.delete(cache.keys().next().value!);
        }
    }
}

/** Expands classpath entries: folders are replaced by the jars they contain */
async function expandClasspath(classpath: string[]):
    Promise<{ jarPaths: string[]; invalidPaths: string[] }> {

    const jarPaths: string[] = [];
    const invalidPaths: string[] = [];
    for (const entry of classpath) {
        try {
            const stat = await fs.stat(entry);
            if (stat.isDirectory()) {
                const children = await fs.readdir(entry);
                jarPaths.push(...children
                    .filter(name => name.toLowerCase().endsWith(".jar"))
                    .sort()
                    .map(name => path.join(entry, name)));
            } else {
                jarPaths.push(entry);
            }
        } catch {
            invalidPaths.push(entry);
        }
    }
    return { jarPaths, invalidPaths };
}

/** Jar-backed class source: names from the central directory, lazy parsing */
export class JarClassSource implements ClassSource {

    /** FQCN → zip entry name */
    private readonly entryByClass = new Map<string, string>();

    private constructor(private readonly jar: JarFile) {
        for (const entryName of jar.listEntryNames()) {
            if (!entryName.endsWith(".class")) {
                continue;
            }
            const internalName = entryName.substring(0, entryName.length - ".class".length);
            // Skip inner/anonymous classes and module/package descriptors
            if (internalName.includes("$")
                || internalName.endsWith("module-info")
                || internalName.endsWith("package-info")) {
                continue;
            }
            this.entryByClass.set(internalName.replace(/\//g, "."), entryName);
        }
    }

    public static async open(jarPath: string): Promise<JarClassSource> {
        return new JarClassSource(await JarFile.open(jarPath));
    }

    public listClassNames(): ReadonlyArray<string> {
        return [...this.entryByClass.keys()];
    }

    public async loadClass(fqcn: string): Promise<JavaClassInfo | undefined> {
        const entryName = this.entryByClass.get(fqcn);
        if (!entryName) {
            return undefined;
        }
        const buffer = await this.jar.readEntry(entryName);
        return buffer ? parseClassFile(buffer) : undefined;
    }

    public dispose(): void {
        this.jar.close();
    }
}
