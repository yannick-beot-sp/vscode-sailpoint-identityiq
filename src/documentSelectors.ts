/**
 * Document selectors shared by the language features that operate on
 * IdentityIQ XML (BeanShell assistance, DTD-driven XML completion).
 */

import * as vscode from "vscode";
import { DIFF_SCHEME, URI_SCHEME } from "./constants";

/** XML documents where IIQ-specific language features apply: virtual IIQ files, local files, untitled buffers */
export const IIQ_XML_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
    { language: "xml", scheme: URI_SCHEME },
    { language: "xml", scheme: DIFF_SCHEME },
    { language: "xml", scheme: "file" },
    { language: "xml", scheme: "untitled" }
];
