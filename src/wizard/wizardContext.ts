/**
 * Bag of values collected by the wizard steps.
 * Each step stores its result under its own name.
 */
export interface WizardContext {
     
    [key: string]: any;
}
