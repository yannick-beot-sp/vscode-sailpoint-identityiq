/**
 * Hover inside BeanShell regions: signatures of the hovered member (with
 * overloads), type of variables and rule arguments, identity of classes.
 */

import * as vscode from "vscode";
import { BeanshellLanguageService } from "../index";
import { BeanshellRegion } from "../beanshellRegions";
import { getContextVariables } from "../ruleContexts";
import { analyzeScope, extractChainBeforeOffset } from "../scopeAnalyzer";
import { ClassIndexService, ClassMembers } from "../java/ClassIndexService";
import { inferChainTypeWithRecovery, resolveSimpleName } from "../typeResolver";

export class BeanshellHoverProvider implements vscode.HoverProvider {

    constructor(private readonly service: BeanshellLanguageService) { }

    public async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {

        if (!this.service.isEnabled()) {
            return undefined;
        }
        const region = this.service.regions.getRegionAt(document, position);
        if (!region) {
            return undefined;
        }
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }
        const word = document.getText(wordRange);
        const index = await this.service.getIndex();
        if (token.isCancellationRequested) {
            return undefined;
        }

        const regionText = document.getText().substring(region.start, region.end);
        const wordOffset = document.offsetAt(wordRange.start) - region.start;

        // Member of a chain: `expression.word`
        const charBefore = regionText[wordOffset - 1];
        if (charBefore === ".") {
            const markdown = await this.hoverMember(regionText, wordOffset, word, region, index);
            return markdown ? new vscode.Hover(markdown, wordRange) : undefined;
        }

        // Plain identifier: variable, rule argument, user method or class
        const markdown = this.hoverIdentifier(regionText, wordOffset, word, region, index);
        return markdown ? new vscode.Hover(markdown, wordRange) : undefined;
    }

    private async hoverMember(regionText: string, wordOffset: number, word: string,
        region: BeanshellRegion, index: ClassIndexService): Promise<vscode.MarkdownString | undefined> {

        const chain = extractChainBeforeOffset(regionText, wordOffset);
        if (!chain) {
            return undefined;
        }
        const scope = analyzeScope(regionText, wordOffset);
        const resolved = await inferChainTypeWithRecovery(chain, scope, getContextVariables(region), index);
        if (!resolved) {
            return undefined;
        }
        if (resolved.typeName.endsWith("[]")) {
            return word === "length" ? codeBlock("int length") : undefined;
        }

        const members = await index.getAllMembers(resolved.typeName);
        const methods = members.methods.filter(m => m.name === word);
        if (methods.length > 0) {
            const markdown = new vscode.MarkdownString();
            for (const method of methods.slice(0, 8)) {
                appendMethodHover(markdown, method);
            }
            if (methods.length > 8) {
                markdown.appendText(`… ${methods.length - 8} more overloads`);
            }
            return markdown;
        }
        const field = members.fields.find(f => f.name === word);
        if (field) {
            const markdown = codeBlock(
                `${field.genericType ?? simpleName(field.type)} ${field.name}`);
            markdown.appendMarkdown(`\n_${field.declaringClass}_`);
            if (field.isDeprecated) {
                markdown.appendMarkdown("\n\n**@Deprecated**");
            }
            return markdown;
        }
        return undefined;
    }

    private hoverIdentifier(regionText: string, wordOffset: number, word: string,
        region: BeanshellRegion, index: ClassIndexService): vscode.MarkdownString | undefined {

        const scope = analyzeScope(regionText, wordOffset + word.length);

        const contextVariable = getContextVariables(region).find(v => v.name === word);
        if (contextVariable) {
            const markdown = codeBlock(
                `(variable) ${contextVariable.type ?? "Object"} ${word}`);
            markdown.appendMarkdown(region.ruleType
                ? `\nRule argument (${region.ruleType})`
                : "\nPredefined variable");
            return markdown;
        }

        const variable = scope.variables.find(v => v.name === word);
        if (variable) {
            return codeBlock(`(variable) ${variable.type ?? "Object"} ${word}`);
        }

        const method = scope.methods.find(m => m.name === word);
        if (method) {
            const params = method.parameters
                .map(p => `${p.type ?? "Object"} ${p.name}`).join(", ");
            return codeBlock(`${method.returnType} ${word}(${params})`);
        }

        const fqcn = word.includes(".")
            ? word
            : resolveSimpleName(word, scope, index);
        if (fqcn && index.hasClass(fqcn)) {
            return codeBlock(`class ${fqcn}`);
        }
        return undefined;
    }
}

function appendMethodHover(markdown: vscode.MarkdownString,
    method: ClassMembers["methods"][number]): void {

    const signature = method.genericSignature
        ? `${method.name}${method.genericSignature}`
        : `${simpleName(method.returnType)} ${method.name}(` +
        method.parameters.map(p => `${simpleName(p.type)} ${p.name}`).join(", ") + ")";
    markdown.appendCodeblock(signature, "java");
    markdown.appendMarkdown(`_${method.declaringClass}_`);
    if (method.isDeprecated) {
        markdown.appendMarkdown(" — **@Deprecated**");
    }
    markdown.appendMarkdown("\n\n");
}

function codeBlock(content: string): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();
    markdown.appendCodeblock(content, "java");
    return markdown;
}

function simpleName(typeName: string): string {
    return typeName.replace(/[A-Za-z_$][\w$]*\./g, "");
}
