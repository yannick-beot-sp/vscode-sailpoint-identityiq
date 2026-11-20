package com.sailpoint.se.plugin.vscode.service;

import java.util.function.Consumer;
import java.util.regex.Pattern;

import sailpoint.object.Filter;

/**
 * Decides whether the {@code query} parameter of the list endpoint is a
 * plain name search or an IdentityIQ filter string.
 *
 * <p>A cheap syntactic pre-check looks for filter tokens. Plain words are a
 * case-insensitive "name contains" search, never parsed. Anything filter-like
 * is compiled with {@link Filter#compile(String)} (a parser: the string is
 * never evaluated as a script nor concatenated into HQL/SQL) and, if a
 * validator is given, checked against the target class. A filter-like input
 * that does not compile or validate is rejected, with no silent fallback to a
 * name search.
 */
public final class QueryFilterResolver {

    /** Error code of the 400 response for an invalid query */
    public static final String INVALID_FILTER = "INVALID_FILTER";

    /** Maximum accepted length of the query, to guard against costly queries */
    public static final int MAX_QUERY_LENGTH = 1000;

    public static final String MODE_NAME = "name";
    public static final String MODE_ADVANCED = "advanced";

    private static final Pattern FILTER_TOKENS = Pattern.compile(
            "==|!|<|>|&&|\\|\\||\\(|\\)"
            + "|\\.(startsWith|endsWith|contains|equals|isEmpty|containsAll|equalsIgnoreCase)\\b"
            + "|\\bin\\s*\\{|\\blike\\b");

    /** Outcome of the resolution */
    public static final class Result {
        private final String mode;
        private final Filter filter;

        Result(String mode, Filter filter) {
            this.mode = mode;
            this.filter = filter;
        }

        /** {@link #MODE_NAME} or {@link #MODE_ADVANCED}; null when there is no filter */
        public String getMode() {
            return mode;
        }

        /** Filter to apply to the count and page queries; null when there is no filter */
        public Filter getFilter() {
            return filter;
        }
    }

    private QueryFilterResolver() {
    }

    /** Whether the input contains an operator or syntax token of the filter language */
    public static boolean looksLikeFilter(String query) {
        return query != null && FILTER_TOKENS.matcher(query).find();
    }

    /**
     * @param query raw user input
     * @param validator checks the compiled filter against the target class
     *        (throws on failure); may be null
     * @throws DevToolsException 400 {@link #INVALID_FILTER} when the input is
     *         filter-like but does not compile or validate
     */
    public static Result resolve(String query, Consumer<Filter> validator) {
        String trimmed = query == null ? "" : query.trim();
        if (trimmed.isEmpty()) {
            return new Result(null, null);
        }
        if (trimmed.length() > MAX_QUERY_LENGTH) {
            throw new DevToolsException(400, INVALID_FILTER,
                    "The query is too long (maximum " + MAX_QUERY_LENGTH + " characters)");
        }
        if (!looksLikeFilter(trimmed)) {
            return new Result(MODE_NAME, nameFilter(trimmed));
        }
        try {
            Filter filter = Filter.compile(trimmed);
            if (filter == null) {
                throw new IllegalArgumentException("The filter is empty");
            }
            if (validator != null) {
                validator.accept(filter);
            }
            return new Result(MODE_ADVANCED, filter);
        } catch (Exception e) {
            String message = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            throw new DevToolsException(400, INVALID_FILTER, message);
        }
    }

    /** Case-insensitive "name contains" filter */
    public static Filter nameFilter(String name) {
        return Filter.ignoreCase(Filter.like("name", name, Filter.MatchMode.ANYWHERE));
    }
}
