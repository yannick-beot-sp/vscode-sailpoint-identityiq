import { InputBoxOptions } from "vscode";
import { WizardContext } from "./wizardContext";

export interface ExtInputBoxOptions extends InputBoxOptions {
    /** Value pre-filled in the input box */
    default?: string;
    shouldPrompt?: (wizardContext: WizardContext) => boolean;
    afterPrompt?: (wizardContext: WizardContext) => Promise<void>;
}
