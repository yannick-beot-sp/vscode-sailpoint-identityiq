package com.sailpoint.se.plugin.vscode.service;

import java.util.Locale;

import sailpoint.api.SailPointContext;
import sailpoint.tools.GeneralException;

/**
 * What the service layer needs from the current REST request. Implemented by
 * the JAX-RS wrappers (BasePluginResource differs between IdentityIQ 8 and 9),
 * which keeps the service free of any JAX-RS dependency.
 */
public interface RequestEnvironment {

    /** SailPointContext of the current request */
    SailPointContext getContext();

    /** Name of the logged-in user */
    String getLoggedInUserName() throws GeneralException;

    /** Locale of the current request */
    Locale getLocale();
}
