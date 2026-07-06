/**
 * DTD-driven completion for IdentityIQ XML documents: child elements
 * (respecting content-model order/cardinality), attribute names, and
 * enumerated attribute values. One provider class, not three, since all
 * three completion kinds answer the same provideCompletionItems entry
 * point and are simply dispatched on CursorContext.kind.
 */

import * as vscode from "vscode";
import { DtdModel } from "../dtd/dtdModel";
import { nextElements as matchNextElements } from "../dtd/contentModelMatcher";
import { CursorContext, getCursorContext } from "../xmlCursorContext";
import type { XmlLanguageService } from "../index";

export class XmlCompletionProvider implements vscode.CompletionItemProvider {

    constructor(private readonly service: XmlLanguageService) { }

    public async provideCompletionItems(
        document: vscode.TextDocument, position: vscode.Position
    ): Promise<vscode.CompletionItem[] | undefined> {
        if (!this.service.isEnabled()) {
            return undefined;
        }
        const { model } = await this.service.getDtd();
        const context = getCursorContext(document.getText(), document.offsetAt(position));

        switch (context.kind) {
            case "elementContent":
                return completeElements(context, model, document, position);
            case "startTag":
                return completeAttributeNames(context, model);
            case "attributeValue":
                return completeAttributeValues(context, model);
            default:
                return undefined;
        }
    }
}

function completeElements(
    context: Extract<CursorContext, { kind: "elementContent" }>, model: DtdModel,
    document: vscode.TextDocument, position: vscode.Position
): vscode.CompletionItem[] | undefined {
    if (!context.parentElementName) {
        return undefined;
    }
    const parentDecl = model.get(context.parentElementName);
    if (!parentDecl) {
        return undefined;
    }
    const { nextElements: names } = matchNextElements(parentDecl.contentModel, context.siblingsSoFar);

    // A '<' (and any partial name after it) already typed right before the
    // cursor must be replaced by the accepted completion, not left in place
    // next to it — otherwise accepting "ObjectAttribute" after typing '<'
    // would produce "<<ObjectAttribute>...".
    const replaceRange = context.openBracketOffset !== undefined
        ? new vscode.Range(document.positionAt(context.openBracketOffset), position)
        : undefined;

    return names.map((name, index) => {
        const childDecl = model.get(name);
        const isEmpty = childDecl?.contentModel.kind === "empty";
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Class);
        item.insertText = new vscode.SnippetString(isEmpty ? `<${name}/>$0` : `<${name}>$0</${name}>`);
        if (replaceRange) {
            item.range = replaceRange;
            // The replace range starts at '<', which is not part of `name` —
            // without this, VS Code filters the item out as soon as further
            // characters are typed, since it matches the typed text (e.g.
            // "<O") against the label ("ObjectAttribute") and finds no match.
            item.filterText = `<${name}`;
        }
        // Preserve DTD declaration order (already a natural "most likely first" ordering) rather than alphabetizing.
        item.sortText = String(index).padStart(4, "0");
        return item;
    });
}

function completeAttributeNames(
    context: Extract<CursorContext, { kind: "startTag" }>, model: DtdModel
): vscode.CompletionItem[] | undefined {
    const decl = model.get(context.elementName);
    if (!decl) {
        return undefined;
    }
    const existing = new Set(context.existingAttributes);
    return decl.attributes
        .filter(attribute => !existing.has(attribute.name))
        .map(attribute => {
            const item = new vscode.CompletionItem(attribute.name, vscode.CompletionItemKind.Property);
            item.insertText = new vscode.SnippetString(`${attribute.name}="$0"`);
            if (attribute.type.kind === "enumeration") {
                // Immediately reopen the suggest widget so the enumerated values show up without an extra keystroke.
                item.command = { command: "editor.action.triggerSuggest", title: "" };
            }
            return item;
        });
}

function completeAttributeValues(
    context: Extract<CursorContext, { kind: "attributeValue" }>, model: DtdModel
): vscode.CompletionItem[] | undefined {
    const decl = model.get(context.elementName);
    const attribute = decl?.attributes.find(a => a.name === context.attributeName);
    if (!attribute || attribute.type.kind !== "enumeration") {
        return undefined;
    }
    return attribute.type.values
        .filter(value => value.startsWith(context.valueSoFar))
        .map(value => new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember));
}
