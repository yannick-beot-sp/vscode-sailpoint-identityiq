/**
 * Signature help inside BeanShell regions: overloads of the method being
 * called (member calls, user methods, constructors) with the active
 * parameter tracked across commas.
 */

import * as vscode from "vscode";
import { BeanshellLanguageService } from "../index";
import { BeanshellRegion } from "../beanshellRegions";
import { getContextVariables } from "../ruleContexts";
import { analyzeScope, extractChainBeforeOffset, LocalVariable, UserMethod } from "../scopeAnalyzer";
import { ClassIndexService, ClassMembers } from "../java/ClassIndexService";
import { Token, tokenize } from "../tokenizer";
import { inferChainTypeWithRecovery, resolveTypeName } from "../typeResolver";

export class BeanshellSignatureHelpProvider implements vscode.SignatureHelpProvider {

    constructor(private readonly service: BeanshellLanguageService) { }

    public async provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.SignatureHelp | undefined> {

        if (!this.service.isEnabled()) {
            return undefined;
        }
        const region = this.service.regions.getRegionAt(document, position);
        if (!region) {
            return undefined;
        }
        const regionText = document.getText().substring(region.start, region.end);
        const cursorOffset = document.offsetAt(position) - region.start;

        const call = findEnclosingCall(regionText, cursorOffset);
        if (!call) {
            return undefined;
        }
        const index = await this.service.getIndex();
        if (token.isCancellationRequested) {
            return undefined;
        }

        const signatures = await this.collectSignatures(regionText, call, region, index);
        if (!signatures || signatures.length === 0) {
            return undefined;
        }

        const help = new vscode.SignatureHelp();
        help.signatures = signatures;
        help.activeParameter = call.activeParameter;
        // First overload that can still accept the active parameter
        const bestMatch = signatures.findIndex(
            s => s.parameters.length > call.activeParameter);
        help.activeSignature = bestMatch === -1 ? 0 : bestMatch;
        return help;
    }

    private async collectSignatures(regionText: string, call: EnclosingCall,
        region: BeanshellRegion,
        index: ClassIndexService): Promise<vscode.SignatureInformation[] | undefined> {

        const scope = analyzeScope(regionText, call.nameToken.start);
        const contextVariables = getContextVariables(region);

        // Constructor: new X(...)
        if (call.isConstructor) {
            const typeName = resolveTypeName(call.qualifiedName, scope, index);
            if (!typeName) {
                return undefined;
            }
            const members = await index.getAllMembers(typeName);
            const constructors = members.methods.filter(
                m => m.name === "<init>" && m.declaringClass === typeName);
            return constructors.map(c => buildSignature(c, simpleName(typeName)));
        }

        // Member call: expression.name(...)
        if (call.isMemberCall) {
            const chain = extractChainBeforeOffset(regionText, call.nameToken.start);
            if (!chain) {
                return undefined;
            }
            const resolved = await inferChainTypeWithRecovery(chain, scope, contextVariables, index);
            if (!resolved || resolved.typeName.endsWith("[]")) {
                return undefined;
            }
            const members = await index.getAllMembers(resolved.typeName);
            const overloads = members.methods.filter(m => m.name === call.nameToken.text
                && m.isPublic && (!resolved.isStatic || m.isStatic));
            return overloads.map(m => buildSignature(m, m.name));
        }

        // Bare call: a user-defined method of the script
        const userMethod = scope.methods.find(m => m.name === call.nameToken.text);
        if (userMethod) {
            return [buildUserMethodSignature(userMethod)];
        }
        return undefined;
    }
}

interface EnclosingCall {
    /** The called name (method or constructed class simple name) */
    nameToken: Token;
    /** Full qualified name for constructions: new java.util.HashMap( */
    qualifiedName: string;
    isConstructor: boolean;
    isMemberCall: boolean;
    /** Number of top-level commas before the cursor */
    activeParameter: number;
}

/** Finds the innermost call the cursor is inside of */
function findEnclosingCall(regionText: string, cursorOffset: number): EnclosingCall | undefined {
    const tokens = tokenize(regionText).filter(t => t.kind !== "comment");

    // Track the stack of open parentheses up to the cursor
    const stack: { openIndex: number; commas: number }[] = [];
    for (let i = 0; i < tokens.length && tokens[i].end <= cursorOffset; i++) {
        const text = tokens[i].text;
        if (text === "(") {
            stack.push({ openIndex: i, commas: 0 });
        } else if (text === ")") {
            stack.pop();
        } else if (text === "," && stack.length > 0) {
            stack[stack.length - 1].commas++;
        }
    }

    // The innermost open paren directly preceded by an identifier is a call
    while (stack.length > 0) {
        const { openIndex, commas } = stack.pop()!;
        const nameToken = tokens[openIndex - 1];
        if (nameToken?.kind !== "identifier") {
            continue; // grouping parentheses: look at the outer level
        }
        // Qualified name and possible `new`: new java.util.HashMap(
        let start = openIndex - 1;
        let qualifiedName = nameToken.text;
        while (tokens[start - 1]?.text === "." && tokens[start - 2]?.kind === "identifier") {
            qualifiedName = `${tokens[start - 2].text}.${qualifiedName}`;
            start -= 2;
        }
        const beforeName = tokens[start - 1];
        const isConstructor = beforeName?.kind === "keyword" && beforeName.text === "new";
        const isMemberCall = !isConstructor && tokens[openIndex - 2]?.text === ".";
        return { nameToken, qualifiedName, isConstructor, isMemberCall, activeParameter: commas };
    }
    return undefined;
}

/** Builds the SignatureInformation of a parsed Java method */
function buildSignature(method: ClassMembers["methods"][number],
    displayName: string): vscode.SignatureInformation {

    let label = `${displayName}(`;
    const parameters: vscode.ParameterInformation[] = [];
    method.parameters.forEach((parameter, index) => {
        if (index > 0) {
            label += ", ";
        }
        const text = `${simpleName(parameter.type)} ${parameter.name}`;
        parameters.push(new vscode.ParameterInformation([label.length, label.length + text.length]));
        label += text;
    });
    label += `) : ${simpleName(method.returnType)}`;

    const signature = new vscode.SignatureInformation(label);
    signature.parameters = parameters;
    signature.documentation = new vscode.MarkdownString(
        `_${method.declaringClass}_` + (method.isDeprecated ? " — **@Deprecated**" : ""));
    return signature;
}

function buildUserMethodSignature(method: UserMethod): vscode.SignatureInformation {
    let label = `${method.name}(`;
    const parameters: vscode.ParameterInformation[] = [];
    method.parameters.forEach((parameter: LocalVariable, index: number) => {
        if (index > 0) {
            label += ", ";
        }
        const text = `${parameter.type ?? "Object"} ${parameter.name}`;
        parameters.push(new vscode.ParameterInformation([label.length, label.length + text.length]));
        label += text;
    });
    label += `) : ${method.returnType}`;

    const signature = new vscode.SignatureInformation(label);
    signature.parameters = parameters;
    return signature;
}

function simpleName(typeName: string): string {
    return typeName.replace(/[A-Za-z_$][\w$]*\./g, "");
}
