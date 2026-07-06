/**
 * Completion inside BeanShell regions:
 * - packages and classes on an `import ...` line;
 * - members after `expression.` (type inference);
 * - variables, user methods, keywords and class names on bare identifiers.
 */

import * as vscode from "vscode";
import { BeanshellLanguageService } from "../index";
import { getBeanshellMaxCompletionItems } from "../../utils/configurationUtils";
import { BeanshellRegion } from "../beanshellRegions";
import { getContextVariables } from "../ruleContexts";
import { analyzeScope, extractChainBeforeOffset, ScopeInfo } from "../scopeAnalyzer";
import { ClassIndexService, ClassMembers } from "../java/ClassIndexService";
import { JavaMethodInfo } from "../java/model";
import { DEFAULT_IMPORTS, inferChainTypeWithRecovery } from "../typeResolver";

/** BeanShell/Java keywords offered on bare identifiers */
const KEYWORDS = [
    "import", "return", "if", "else", "for", "while", "do", "switch", "case",
    "break", "continue", "try", "catch", "finally", "throw", "new", "instanceof",
    "null", "true", "false", "void", "int", "long", "boolean", "double", "float",
    "char", "byte", "short", "static", "final", "class"
];

export class BeanshellCompletionProvider implements vscode.CompletionItemProvider {

    constructor(private readonly service: BeanshellLanguageService) { }

    public async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionList | undefined> {

        if (!this.service.isEnabled()) {
            return undefined;
        }
        const region = this.service.regions.getRegionAt(document, position);
        if (!region) {
            return undefined;
        }
        // Never block on the index build: answer with what is available and
        // let VS Code re-query (isIncomplete) once the index is ready.
        const index = this.service.getIndexIfReady();
        if (!index) {
            this.service.getIndex(); // kick off the build
        }

        // Import statement: complete the package tree
        const lineBeforeCursor = document.lineAt(position.line)
            .text.substring(0, position.character);
        const importMatch = lineBeforeCursor.match(/^\s*import\s+([\w.]*)$/);
        if (importMatch) {
            return index ? completeImport(importMatch[1], index)
                : new vscode.CompletionList([], true);
        }

        const regionText = document.getText().substring(region.start, region.end);
        const cursorOffset = document.offsetAt(position) - region.start;

        // Member access: complete after `expression.`
        const wordRange = document.getWordRangeAtPosition(position);
        const wordStart = wordRange ? wordRange.start : position;
        const charBefore = wordStart.character > 0
            ? document.lineAt(wordStart.line).text[wordStart.character - 1]
            : "";
        if (charBefore === ".") {
            return index ? completeMembers(regionText, cursorOffset, region, index, token)
                : new vscode.CompletionList([], true);
        }

        // Bare identifier: variables, methods, keywords, class names
        const prefix = wordRange
            ? document.getText(new vscode.Range(wordRange.start, position))
            : "";
        const scope = analyzeScope(regionText, cursorOffset);
        // Auto-import insertion point: after the leading newline of the CDATA
        const importPosition = document.positionAt(
            region.start + (regionText.startsWith("\n") ? 1 : 0));
        return completeIdentifier(prefix, scope, region, index, importPosition);
    }
}

/** Completion of `import sailpoint.ap...`: sub-packages and classes */
function completeImport(typed: string, index: ClassIndexService): vscode.CompletionList {
    const lastDot = typed.lastIndexOf(".");
    const parentPackage = lastDot === -1 ? "" : typed.substring(0, lastDot);
    const children = index.getPackageChildren(parentPackage);

    const items: vscode.CompletionItem[] = [];
    for (const packageName of children.packages) {
        const item = new vscode.CompletionItem(packageName, vscode.CompletionItemKind.Module);
        item.sortText = `0${packageName}`;
        items.push(item);
    }
    for (const className of children.classes) {
        const item = new vscode.CompletionItem(className, vscode.CompletionItemKind.Class);
        item.detail = parentPackage ? `${parentPackage}.${className}` : className;
        item.sortText = `1${className}`;
        items.push(item);
    }
    if (parentPackage) {
        const wildcard = new vscode.CompletionItem("*", vscode.CompletionItemKind.Module);
        wildcard.detail = `everything in ${parentPackage}`;
        wildcard.sortText = "2*";
        items.push(wildcard);
    }
    return new vscode.CompletionList(items, false);
}

/** Completion after `expression.`: fields and methods of the inferred type */
async function completeMembers(regionText: string, cursorOffset: number,
    region: BeanshellRegion, index: ClassIndexService,
    token: vscode.CancellationToken): Promise<vscode.CompletionList | undefined> {

    const chain = extractChainBeforeOffset(regionText, cursorOffset);
    if (!chain) {
        return undefined;
    }
    const scope = analyzeScope(regionText, cursorOffset);
    const resolved = await inferChainTypeWithRecovery(chain, scope, getContextVariables(region), index);
    if (!resolved || token.isCancellationRequested) {
        return undefined;
    }

    // Arrays only expose length
    if (resolved.typeName.endsWith("[]")) {
        const length = new vscode.CompletionItem("length", vscode.CompletionItemKind.Field);
        length.detail = "int";
        return new vscode.CompletionList([length], false);
    }

    const members = await index.getAllMembers(resolved.typeName);
    if (token.isCancellationRequested) {
        return undefined;
    }
    const items: vscode.CompletionItem[] = [];
    for (const method of members.methods) {
        if (!method.isPublic || method.name === "<init>") {
            continue;
        }
        if (resolved.isStatic && !method.isStatic) {
            continue;
        }
        items.push(methodItem(method, resolved.isStatic));
    }
    for (const field of members.fields) {
        if (!field.isPublic || (resolved.isStatic && !field.isStatic)) {
            continue;
        }
        items.push(fieldItem(field, resolved.isStatic));
    }
    return new vscode.CompletionList(items, false);
}

function methodItem(method: ClassMembers["methods"][number], staticContext: boolean): vscode.CompletionItem {
    const item = new vscode.CompletionItem(
        {
            label: method.name,
            detail: `(${method.parameters.map(p => simpleName(p.type)).join(", ")})`,
            description: simpleName(method.returnType)
        },
        vscode.CompletionItemKind.Method);
    item.detail = methodSignature(method);
    item.documentation = new vscode.MarkdownString(
        `_${method.declaringClass}_`);
    item.insertText = new vscode.SnippetString(
        method.parameters.length > 0 ? `${method.name}($0)` : `${method.name}()$0`);
    // Instance members first, then statics
    item.sortText = (!staticContext && method.isStatic ? "1" : "0") + method.name;
    item.filterText = method.name;
    if (method.isDeprecated) {
        item.tags = [vscode.CompletionItemTag.Deprecated];
    }
    return item;
}

function fieldItem(field: ClassMembers["fields"][number], staticContext: boolean): vscode.CompletionItem {
    const kind = field.isStatic && field.isFinal
        ? vscode.CompletionItemKind.Constant
        : vscode.CompletionItemKind.Field;
    const item = new vscode.CompletionItem(
        { label: field.name, description: simpleName(field.genericType ?? field.type) },
        kind);
    item.detail = `${field.genericType ?? simpleName(field.type)} ${field.name}`;
    item.documentation = new vscode.MarkdownString(`_${field.declaringClass}_`);
    item.sortText = (!staticContext && field.isStatic ? "1" : "0") + field.name;
    if (field.isDeprecated) {
        item.tags = [vscode.CompletionItemTag.Deprecated];
    }
    return item;
}

/**
 * Completion of a bare identifier: variables, methods, keywords, classes.
 * Class names are skipped while the index is still building (the list is
 * marked incomplete so VS Code queries again).
 */
function completeIdentifier(prefix: string, scope: ScopeInfo, region: BeanshellRegion,
    index: ClassIndexService | undefined, importPosition: vscode.Position): vscode.CompletionList {

    const items: vscode.CompletionItem[] = [];

    for (const variable of getContextVariables(region)) {
        const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
        item.detail = variable.type ? simpleName(variable.type) : undefined;
        item.documentation = region.ruleType
            ? `Rule argument (${region.ruleType})`
            : "Predefined variable";
        item.sortText = `0${variable.name}`;
        items.push(item);
    }
    for (const variable of scope.variables) {
        const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
        item.detail = variable.type ? simpleName(variable.type) : undefined;
        item.sortText = `0${variable.name}`;
        items.push(item);
    }
    for (const method of scope.methods) {
        const item = new vscode.CompletionItem(
            {
                label: method.name,
                detail: `(${method.parameters.map(p => simpleName(p.type ?? "?")).join(", ")})`,
                description: simpleName(method.returnType)
            },
            vscode.CompletionItemKind.Function);
        item.insertText = new vscode.SnippetString(
            method.parameters.length > 0 ? `${method.name}($0)` : `${method.name}()$0`);
        item.filterText = method.name;
        item.sortText = `1${method.name}`;
        items.push(item);
    }
    for (const keyword of KEYWORDS) {
        const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
        item.sortText = `2${keyword}`;
        items.push(item);
    }

    // Class names only from 2 typed characters, to keep the list relevant
    let isIncomplete = true;
    if (index && prefix.length >= 2) {
        const limit = getBeanshellMaxCompletionItems();
        const matches = index.findSimpleNamesByPrefix(prefix, limit);
        let count = 0;
        isIncomplete = matches.size >= limit;
        for (const [className, fqcns] of matches) {
            for (const fqcn of fqcns) {
                const item = new vscode.CompletionItem(className, vscode.CompletionItemKind.Class);
                item.detail = fqcn;
                item.sortText = `3${className}`;
                // Add the missing import along with the completion
                if (!isImported(fqcn, scope)) {
                    item.additionalTextEdits = [
                        vscode.TextEdit.insert(importPosition, `import ${fqcn};\n`)];
                }
                items.push(item);
                count++;
            }
            if (count >= limit) {
                isIncomplete = true;
                break;
            }
        }
    }
    return new vscode.CompletionList(items, isIncomplete);
}

/** Is the class already reachable without adding an import? */
function isImported(fqcn: string, scope: ScopeInfo): boolean {
    const packageName = fqcn.substring(0, fqcn.lastIndexOf("."));
    return scope.imports.includes(fqcn)
        || scope.wildcardImports.includes(packageName)
        || DEFAULT_IMPORTS.includes(packageName);
}

function methodSignature(method: JavaMethodInfo): string {
    if (method.genericSignature) {
        return `${method.name}${method.genericSignature}`;
    }
    const params = method.parameters
        .map(p => `${simpleName(p.type)} ${p.name}`)
        .join(", ");
    return `${simpleName(method.returnType)} ${method.name}(${params})`;
}

function simpleName(typeName: string): string {
    return typeName.replace(/[A-Za-z_$][\w$]*\./g, "");
}
