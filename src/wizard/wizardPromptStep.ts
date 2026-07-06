import { Wizard } from "./wizard";
import { WizardContext } from "./wizardContext";
import { IWizardOptions } from "./wizardOptions";

/**
 * A single prompt of a wizard (input box, quick pick...).
 * Inspired by the vscode-azuretools wizard.
 */
export abstract class WizardPromptStep<T extends WizardContext> {
    public hideStepCount = false;
    public supportsDuplicateSteps = false;
    public effectiveTitle: string | undefined;
    public hasSubWizard = false;
    public numSubPromptSteps!: number;
    public prompted = false;
    /** true if prompted again because the back button was pushed */
    public onWayback = false;
    public id?: string;

    public abstract prompt(wizard: Wizard<T>, wizardContext: T): Promise<void>;

    public getSubWizard?(wizardContext: T): Promise<IWizardOptions<T> | undefined>;
    public undo?(wizardContext: T): void;
    public configureBeforePrompt?(wizardContext: T): Promise<void>;
    public afterPrompt?(wizardContext: T): Promise<void>;

    public shouldPrompt(wizardContext: T): boolean {
        // prompt if not prompted before and no value was pre-filled in the context
        return (!this.prompted && !(this.id && Object.prototype.hasOwnProperty.call(wizardContext, this.id)))
            || this.prompted;
    }

    public reset(): void {
        this.hasSubWizard = false;
    }
}
