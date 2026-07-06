/**
 * Pure data model for a parsed DTD (element content models and attribute
 * lists). No vscode dependency so it stays trivially unit-testable.
 */

export type Cardinality = "one" | "optional" | "star" | "plus";

export type ContentModel =
    /** Element must be empty (no children, no text) */
    | { kind: "empty" }
    /** Element accepts text only, no child elements */
    | { kind: "pcdata" }
    /** Element accepts arbitrary content (DTD keyword ANY) */
    | { kind: "any" }
    | { kind: "element"; name: string; cardinality: Cardinality }
    | { kind: "sequence"; items: ContentModel[]; cardinality: Cardinality }
    | { kind: "choice"; items: ContentModel[]; cardinality: Cardinality };

export type AttributeType =
    | { kind: "cdata" }
    | { kind: "enumeration"; values: string[] };

export type AttributeDefault =
    | { kind: "implied" }
    | { kind: "required" }
    | { kind: "fixed"; value: string }
    | { kind: "default"; value: string };

export interface AttributeDecl {
    name: string;
    type: AttributeType;
    default: AttributeDefault;
}

export interface ElementDecl {
    name: string;
    contentModel: ContentModel;
    /** Declaration order preserved, for stable completion ordering */
    attributes: AttributeDecl[];
}

export type DtdModel = Map<string, ElementDecl>;
