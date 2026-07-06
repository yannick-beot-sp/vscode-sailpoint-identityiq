import { WizardContext } from "./wizardContext";
import { WizardPromptStep } from "./wizardPromptStep";

export interface IWizardOptions<T extends WizardContext> {
    /** Title displayed on top of every prompt of the wizard */
    title?: string;
    promptSteps?: WizardPromptStep<T>[];
    hideStepCount?: boolean;
}
