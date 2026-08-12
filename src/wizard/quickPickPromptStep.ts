import { QuickPickItem, QuickPickOptions } from "vscode";
import { showQuickPick } from "../utils/showQuickPick";
import { convertPascalCase2SpaceBased, isEmpty } from "../utils/stringUtils";
import { GoBackError } from "../errors";
import { Wizard } from "./wizard";
import { WizardContext } from "./wizardContext";
import { WizardPromptStep } from "./wizardPromptStep";

export interface QuickPickPromptStepOptions<T extends WizardContext, TPick extends QuickPickItem> {
    /** Name of the property set in the wizard context */
    name: string;
    displayName?: string;
    options?: QuickPickOptions;
    items: string[] | TPick[] | ((context: T) => string[] | TPick[] | Promise<string[] | TPick[]>);
    /** Maps the picked item(s) to the value(s) stored in the context */
     
    project?(value: TPick): any;
    /** Skip the prompt if there is only one item */
    skipIfOne?: boolean;
    shouldPrompt?: boolean | ((wizardContext: T) => boolean);
}

/** Wizard step displaying a quick pick and storing the selection in the context */
export class QuickPickPromptStep<T extends WizardContext, TPick extends QuickPickItem> extends WizardPromptStep<T> {
    protected readonly _options: QuickPickOptions;
    private readonly _name: string;
    private readonly _skipIfOne: boolean;
    private readonly _items: string[] | TPick[] | ((context: T) => string[] | TPick[] | Promise<string[] | TPick[]>);
     
    private readonly _project?: (value: TPick) => any;

    constructor(stepOptions: QuickPickPromptStepOptions<T, TPick>) {
        super();
        this._name = stepOptions.name;
        this.id = this._name;
        const displayName = stepOptions.displayName ?? convertPascalCase2SpaceBased(this._name).toLowerCase();

        this._options = { ...stepOptions.options };
        if (isEmpty(this._options.placeHolder)) {
            this._options.placeHolder = this._options.canPickMany
                ? `Choose ${displayName}`
                : `Choose one ${displayName}`;
        }
        this._items = stepOptions.items;
        this._project = stepOptions.project;
        this._skipIfOne = stepOptions.skipIfOne ?? false;

        if (stepOptions.shouldPrompt !== undefined) {
            const shouldPrompt = stepOptions.shouldPrompt;
            this.shouldPrompt = typeof shouldPrompt === "boolean" ? () => shouldPrompt : shouldPrompt;
        }
    }

    public async prompt(wizard: Wizard<T>, wizardContext: T): Promise<void> {
        const items = this.getPicks(wizardContext);
        try {
             
            let value: any = await showQuickPick(
                wizard,
                items,
                this._options,
                this._skipIfOne,
                this.onWayback
            );
            if (this._project) {
                value = this._options.canPickMany
                    ? (value as TPick[]).map(this._project)
                    : this._project(value as TPick);
            }
            (wizardContext as WizardContext)[this._name] = value;
        } catch (err) {
            if (err instanceof GoBackError) {
                this.onWayback = false;
            }
            throw err;
        }
    }

    protected async getPicks(wizardContext: T): Promise<TPick[]> {
        let items: string[] | TPick[] = typeof this._items === "function"
            ? await this._items(wizardContext)
            : this._items;

        if (Array.isArray(items) && items.every(it => typeof it === "string")) {
            items = (items as string[]).map(it => ({ label: it } as TPick));
        }
        return items as TPick[];
    }
}
