/*---------------------------------------------------------------------------------------------
 *  Adapted from vscode-azuretools (Microsoft, MIT License)
 *--------------------------------------------------------------------------------------------*/
import { Disposable, QuickInputButton, QuickInputButtons, QuickPick, QuickPickItem, QuickPickOptions, window } from "vscode";
import { GoBackError, UserCancelledError } from "../errors";
import { Wizard } from "../wizard/wizard";
import { WizardContext } from "../wizard/wizardContext";

/**
 * Shows a quick pick integrated with the wizard: title, step count,
 * back button and restoration of previously picked items.
 */
export async function showQuickPick<TPick extends QuickPickItem, T extends WizardContext>(
    wizard: Wizard<T>,
    picks: TPick[] | Promise<TPick[]>,
    options: QuickPickOptions,
    skipIfOne?: boolean,
    onWayback = false
): Promise<TPick | TPick[]> {

    const disposables: Disposable[] = [];
    try {
        const quickPick: QuickPick<TPick> = createQuickPick(wizard, options);
        disposables.push(quickPick);
        // Show progress while loading quick picks
        quickPick.busy = true;
        quickPick.enabled = false;
        quickPick.placeholder = "Loading...";
        quickPick.show();

        picks = await picks;
        quickPick.items = restorePickedItems(picks, wizard);

        if (skipIfOne && quickPick.items && quickPick.items.length === 1) {
            if (onWayback) {
                // this prompt was probably skipped the first time: go back one more step
                throw new GoBackError();
            }
            quickPick.hide();
            return quickPick.items[0];
        }
        let zeroItem = false;
        if (quickPick.items.length === 0) {
            zeroItem = true;
            quickPick.canSelectMany = false;
            quickPick.items = [{ label: "No item" } as TPick];
        } else if (options.canPickMany) {
            quickPick.selectedItems = quickPick.items.filter(x => x.picked);
        } else {
            quickPick.activeItems = quickPick.items.filter(x => x.picked);
        }

        quickPick.placeholder = options.placeHolder;
        quickPick.busy = false;
        quickPick.enabled = true;

        return await new Promise<TPick | TPick[]>((resolve, reject) => {
            disposables.push(
                quickPick.onDidAccept(() => {
                    if (options.canPickMany) {
                        resolve(Array.from(quickPick.selectedItems));
                    } else {
                        const selectedItem: TPick | undefined = quickPick.selectedItems[0];
                        if (!zeroItem && selectedItem) {
                            resolve(selectedItem);
                        }
                    }
                }),
                quickPick.onDidTriggerButton(btn => {
                    if (btn === QuickInputButtons.Back) {
                        reject(new GoBackError());
                    }
                }),
                quickPick.onDidHide(() => {
                    reject(new UserCancelledError());
                })
            );
        });
    } finally {
        disposables.forEach(d => { d.dispose(); });
    }
}

function createQuickPick<TPick extends QuickPickItem, T extends WizardContext>(wizard: Wizard<T>, options: QuickPickOptions): QuickPick<TPick> {
    const quickPick: QuickPick<TPick> = window.createQuickPick<TPick>();

    if (wizard && wizard.showTitle) {
        quickPick.title = wizard.title;
        if (!wizard.hideStepCount && wizard.title) {
            quickPick.step = wizard.currentStep;
            quickPick.totalSteps = wizard.totalSteps;
        }
    }
    const buttons: QuickInputButton[] = [];
    if (wizard?.showBackButton) {
        buttons.push(QuickInputButtons.Back);
    }
    quickPick.buttons = buttons;

    if (options.ignoreFocusOut === undefined) {
        options.ignoreFocusOut = true;
    }
    if (options.canPickMany && options.placeHolder) {
        options.placeHolder += " (Press 'Space' to select and 'Enter' to confirm)";
    }

    quickPick.placeholder = options.placeHolder;
    quickPick.ignoreFocusOut = !!options.ignoreFocusOut;
    quickPick.matchOnDescription = !!options.matchOnDescription;
    quickPick.matchOnDetail = !!options.matchOnDetail;
    quickPick.canSelectMany = !!options.canPickMany;
    return quickPick;
}

/** Re-selects items that were picked before the user came back to this step */
function restorePickedItems<TPick extends QuickPickItem, T extends WizardContext>(picks: TPick[], wizard: Wizard<T>): TPick[] {
    const values = wizard.getCachedInputBoxValue();
    if (values === undefined) {
        return picks;
    }
    if (typeof values === "string") {
        return picks.map(x => ({ ...x, picked: x.label === values }));
    }
    if (Array.isArray(values)) {
        const labels = values.map(x => typeof x === "string" ? x : x.label);
        return picks.map(x => ({ ...x, picked: labels.includes(x.label) }));
    }
    return picks.map(x => ({ ...x, picked: values.label === x.label }));
}
