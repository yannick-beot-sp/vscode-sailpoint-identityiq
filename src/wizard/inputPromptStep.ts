import { capitalizeFirstLetter, convertPascalCase2SpaceBased, isEmpty } from "../utils/stringUtils";
import { showInputBox } from "../utils/showInputBox";
import { ExtInputBoxOptions } from "./ExtInputBoxOptions";
import { Wizard } from "./wizard";
import { WizardContext } from "./wizardContext";
import { WizardPromptStep } from "./wizardPromptStep";

export interface InputPromptStepOptions {
    /** Name of the property set in the wizard context */
    name: string;
    displayName?: string;
    options?: ExtInputBoxOptions;
}

/** Wizard step displaying an input box and storing the value in the context */
export class InputPromptStep<T extends WizardContext> extends WizardPromptStep<T> {

    private readonly _options: ExtInputBoxOptions;
    private readonly _name: string;
    private readonly _displayName: string;

    constructor(inputPromptStepOptions: InputPromptStepOptions) {
        super();
        this._name = inputPromptStepOptions.name;
        this.id = this._name;
        this._displayName = inputPromptStepOptions.displayName ?? convertPascalCase2SpaceBased(this._name);
        this._options = { ...inputPromptStepOptions.options };

        if (isEmpty(this._options.prompt)) {
            this._options.prompt = `Enter the ${this._displayName.toLowerCase()}`;
        }
        if (isEmpty(this._options.placeHolder)) {
            this._options.placeHolder = capitalizeFirstLetter(this._displayName);
        }
        if (this._options.afterPrompt) {
            this.afterPrompt = this._options.afterPrompt;
        }
        if (this._options.shouldPrompt) {
            this.shouldPrompt = this._options.shouldPrompt;
        }
    }

    public async prompt(wizard: Wizard<T>, wizardContext: T): Promise<void> {
        const options = { ...this._options };
        if (wizardContext[this._name]) {
            options.default = wizardContext[this._name];
        }
        (wizardContext as WizardContext)[this._name] = await showInputBox(wizard, options);
    }
}
