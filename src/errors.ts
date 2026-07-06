export class UserCancelledError extends Error {
    _isUserCancelledError = true;
    constructor() {
        super("Operation cancelled.");
    }
}

export function isUserCancelledError(error: unknown): error is UserCancelledError {
    return !!error &&
        typeof error === "object" &&
        "_isUserCancelledError" in error &&
        error._isUserCancelledError === true;
}

/** Thrown by wizard prompts when the user clicks the "Back" button */
export class GoBackError extends Error {
    constructor() {
        super("Go back.");
    }
}
