import * as assert from "assert";
import { getCursorContext } from "../../xml/xmlCursorContext";

/** Cursor is placed right after `marker` in `text`. */
function contextAfter(text: string, marker: string) {
    const offset = text.indexOf(marker) + marker.length;
    assert.ok(offset >= marker.length, `marker ${JSON.stringify(marker)} not found in text`);
    return getCursorContext(text, offset);
}

suite("XML cursor context Test Suite", () => {

    test("element content: parent and already-closed siblings, in order", () => {
        const xml = "<sailpoint><entry><key><String>x</String></key><";
        assert.deepStrictEqual(contextAfter(xml, "<sailpoint><entry><key><String>x</String></key><"),
            { kind: "elementContent", parentElementName: "entry", siblingsSoFar: ["key"], openBracketOffset: xml.lastIndexOf("<") });
    });

    test("element content at the very top level (no parent) when nothing is open", () => {
        const xml = "";
        assert.deepStrictEqual(getCursorContext(xml, 0),
            { kind: "elementContent", parentElementName: undefined, siblingsSoFar: [] });
    });

    test("self-closing tags are recorded as children without changing the current stack depth", () => {
        const xml = "<sailpoint><Argument name='a'/><";
        assert.deepStrictEqual(contextAfter(xml, "<sailpoint><Argument name='a'/><"),
            { kind: "elementContent", parentElementName: "sailpoint", siblingsSoFar: ["Argument"], openBracketOffset: xml.lastIndexOf("<") });
    });

    test("start tag: cursor after the element name and a space is attribute-name context", () => {
        const xml = "<AccountIconConfig ";
        assert.deepStrictEqual(contextAfter(xml, "<AccountIconConfig "),
            { kind: "startTag", elementName: "AccountIconConfig", existingAttributes: [] });
    });

    test("start tag: existing attributes are listed and excluded going forward", () => {
        const xml = '<AccountIconConfig attribute="x" source="y" ';
        const ctx = contextAfter(xml, '<AccountIconConfig attribute="x" source="y" ');
        assert.deepStrictEqual(ctx, {
            kind: "startTag",
            elementName: "AccountIconConfig",
            existingAttributes: ["attribute", "source"]
        });
    });

    test("attribute value: cursor right after the opening quote", () => {
        const xml = '<AttributeAssignment operation="';
        assert.deepStrictEqual(contextAfter(xml, '<AttributeAssignment operation="'),
            { kind: "attributeValue", elementName: "AttributeAssignment", attributeName: "operation", valueSoFar: "" });
    });

    test("attribute value: partial value typed so far is reported", () => {
        const xml = '<AttributeAssignment operation="Mod';
        assert.deepStrictEqual(contextAfter(xml, '<AttributeAssignment operation="Mod'),
            { kind: "attributeValue", elementName: "AttributeAssignment", attributeName: "operation", valueSoFar: "Mod" });
    });

    test("cursor still inside a partially-typed element name is still element-content context (lets VS Code keep filtering as the name is typed)", () => {
        const xml = "<sailpoint><AccountIcon";
        assert.deepStrictEqual(contextAfter(xml, "<sailpoint><AccountIcon"), {
            kind: "elementContent", parentElementName: "sailpoint", siblingsSoFar: [],
            openBracketOffset: xml.lastIndexOf("<")
        });
    });

    test("comments, CDATA, and processing instructions around the cursor are skipped, not corrupting the stack", () => {
        const xml = "<sailpoint><!-- <Rule name='Old'/> --><Rule name='New'><Source><![CDATA[ return 1; ]]></Source></Rule><";
        assert.deepStrictEqual(getCursorContext(xml, xml.length), {
            kind: "elementContent", parentElementName: "sailpoint", siblingsSoFar: ["Rule"],
            openBracketOffset: xml.lastIndexOf("<")
        });
    });

    test("cursor inside a comment/CDATA/PI/DOCTYPE returns none", () => {
        assert.deepStrictEqual(getCursorContext("<!-- some comment", 10), { kind: "none" });
        assert.deepStrictEqual(
            getCursorContext("<Rule><Source><![CDATA[ int x = <Foo> ", "<Rule><Source><![CDATA[ int x = <Foo".length),
            { kind: "none" });
        assert.deepStrictEqual(getCursorContext("<?xml version='1.0'?", 10), { kind: "none" });
        assert.deepStrictEqual(getCursorContext("<!DOCTYPE sailpoint PUBLIC ", 10), { kind: "none" });
    });

    test("mismatched closing tag recovers defensively: the open element is treated as closed", () => {
        const xml = "<sailpoint><Rule></NotRule><";
        assert.deepStrictEqual(contextAfter(xml, "<sailpoint><Rule></NotRule><"), {
            kind: "elementContent", parentElementName: "sailpoint", siblingsSoFar: ["Rule"],
            openBracketOffset: xml.lastIndexOf("<")
        });
    });

    test("a document being typed (unterminated start tag): element-content while typing the name, start tag once a space follows", () => {
        const xml = "<sailpoint><Attributes";
        assert.deepStrictEqual(contextAfter(xml, "<sailpoint><Attributes"), {
            kind: "elementContent", parentElementName: "sailpoint", siblingsSoFar: [],
            openBracketOffset: xml.lastIndexOf("<")
        });
        const xmlWithSpace = "<sailpoint><Attributes ";
        assert.deepStrictEqual(contextAfter(xmlWithSpace, "<sailpoint><Attributes "),
            { kind: "startTag", elementName: "Attributes", existingAttributes: [] });
    });

    test("plain content with no preceding '<' (e.g. Ctrl+Space mid-text) has no openBracketOffset to replace", () => {
        const xml = "<sailpoint>some text ";
        assert.deepStrictEqual(contextAfter(xml, "<sailpoint>some text "),
            { kind: "elementContent", parentElementName: "sailpoint", siblingsSoFar: [] });
    });
});
