/*---------------------------------------------------------------------------------------------
 *  Adapted from vscode-azuretools (Microsoft, MIT License)
 *--------------------------------------------------------------------------------------------*/
import { Disposable, InputBox, InputBoxOptions, QuickInputButton, QuickInputButtons, window } from "vscode";
import { GoBackError, UserCancelledError } from "../errors";
import { ExtInputBoxOptions } from "../wizard/ExtInputBoxOptions";
import { Wizard } from "../wizard/wizard";
import { WizardContext } from "../wizard/wizardContext";

export type InputBoxValidationResult = Awaited<ReturnType<Required<InputBoxOptions>["validateInput"]>>;

/**
 * Shows an input box integrated with the wizard: title, step count,
 * back button and validation.
 */
export async function showInputBox<T extends WizardContext>(wizard: Wizard<T>, options: ExtInputBoxOptions): Promise<string> {
    const disposables: Disposable[] = [];
    try {
        const inputBox: InputBox = createInputBox(wizard, options);
        disposables.push(inputBox);

        const validateInput = (value: string) =>
            options.validateInput === undefined ? "" : options.validateInput(value);

        let latestValidation: Promise<InputBoxValidationResult> = Promise.resolve(validateInput(inputBox.value));
        return await new Promise<string>((resolve, reject): void => {
            disposables.push(
                inputBox.onDidChangeValue(async text => {
                    if (options.validateInput) {
                        const validation: Promise<InputBoxValidationResult> = Promise.resolve(validateInput(text));
                        latestValidation = validation;
                        const message: InputBoxValidationResult = await validation;
                        if (validation === latestValidation) {
                            inputBox.validationMessage = message || "";
                        }
                    }
                }),
                inputBox.onDidAccept(async () => {
                    // Run final validation and resolve if the value passes
                    inputBox.enabled = false;
                    inputBox.busy = true;
                    const validateInputResult: InputBoxValidationResult = await latestValidation;
                    if (!validateInputResult) {
                        resolve(inputBox.value);
                    } else {
                        inputBox.validationMessage = validateInputResult;
                    }
                    inputBox.enabled = true;
                    inputBox.busy = false;
                }),
                inputBox.onDidTriggerButton(btn => {
                    if (btn === QuickInputButtons.Back) {
                        reject(new GoBackError());
                    }
                }),
                inputBox.onDidHide(() => {
                    reject(new UserCancelledError());
                })
            );
            inputBox.show();
        });
    } finally {
        disposables.forEach(d => { d.dispose(); });
    }
}

function createInputBox<T extends WizardContext>(wizard: Wizard<T>, options: ExtInputBoxOptions): InputBox {
    const inputBox: InputBox = window.createInputBox();

    if (wizard && wizard.showTitle) {
        inputBox.title = wizard.title;
        if (!wizard.hideStepCount && wizard.title) {
            inputBox.step = wizard.currentStep;
            inputBox.totalSteps = wizard.totalSteps;
        }
    }

    const buttons: QuickInputButton[] = [];
    if (wizard.showBackButton) {
        buttons.push(QuickInputButtons.Back);
    }
    inputBox.buttons = buttons;

    if (options.ignoreFocusOut === undefined) {
        options.ignoreFocusOut = true;
    }

    inputBox.ignoreFocusOut = !!options.ignoreFocusOut;
    inputBox.password = !!options.password;
    inputBox.placeholder = options.placeHolder;
    inputBox.prompt = options.prompt;
    inputBox.title ??= options.title;
    if (!inputBox.password) {
        inputBox.value = options.default ?? wizard.getCachedInputBoxValue() ?? options.value ?? "";
    }
    return inputBox;
}
