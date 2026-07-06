/**
 * Random access to jar entries with yauzl.
 *
 * Only the zip central directory is read when a jar is opened (a few MB of
 * metadata for identityiq.jar) — entry contents are inflated one at a time on
 * demand. The file descriptor stays open for the lifetime of the JarFile;
 * callers must close() when the classpath configuration changes.
 */

import * as yauzl from "yauzl";

export class JarFile {
    private constructor(
        public readonly path: string,
        private readonly zipFile: yauzl.ZipFile,
        private readonly entries: Map<string, yauzl.Entry>) { }

    /** Opens a jar and reads its central directory */
    static open(path: string): Promise<JarFile> {
        return new Promise((resolve, reject) => {
            yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zipFile) => {
                if (err || !zipFile) {
                    return reject(err ?? new Error(`Cannot open ${path}`));
                }
                const entries = new Map<string, yauzl.Entry>();
                zipFile.on("entry", (entry: yauzl.Entry) => {
                    if (!entry.fileName.endsWith("/")) {
                        entries.set(entry.fileName, entry);
                    }
                    zipFile.readEntry();
                });
                zipFile.on("end", () => resolve(new JarFile(path, zipFile, entries)));
                zipFile.on("error", reject);
                zipFile.readEntry();
            });
        });
    }

    /** Names of all entries, e.g. "sailpoint/api/SailPointContext.class" */
    listEntryNames(): string[] {
        return [...this.entries.keys()];
    }

    hasEntry(name: string): boolean {
        return this.entries.has(name);
    }

    /** Inflates a single entry, or resolves undefined if it does not exist */
    readEntry(name: string): Promise<Buffer | undefined> {
        const entry = this.entries.get(name);
        if (!entry) {
            return Promise.resolve(undefined);
        }
        return new Promise((resolve, reject) => {
            this.zipFile.openReadStream(entry, (err, stream) => {
                if (err || !stream) {
                    return reject(err ?? new Error(`Cannot read ${name} in ${this.path}`));
                }
                const chunks: Buffer[] = [];
                stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                stream.on("end", () => resolve(Buffer.concat(chunks)));
                stream.on("error", reject);
            });
        });
    }

    close(): void {
        this.zipFile.close();
    }
}
