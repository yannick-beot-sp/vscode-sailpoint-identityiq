package com.sailpoint.se.plugin.vscode.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class QueryFilterResolverTest {

    @Test
    void emptyQueryMeansNoFilter() {
        for (String query : new String[] { null, "", "   " }) {
            QueryFilterResolver.Result result = QueryFilterResolver.resolve(query, null);
            assertNull(result.getFilter());
            assertNull(result.getMode());
        }
    }

    @Test
    void plainWordIsANameSearch() {
        QueryFilterResolver.Result result = QueryFilterResolver.resolve("  john ", null);
        assertEquals("name", result.getMode());
        assertNotNull(result.getFilter());
    }

    @Test
    void plainWordIsNeverParsedNorValidated() {
        QueryFilterResolver.resolve("john.doe", f -> {
            throw new IllegalStateException("must not be called");
        });
    }

    @Test
    void validFilterIsAdvanced() {
        for (String query : new String[] {
                "department == \"Finance\"",
                "department == \"Finance\" && inactive == false",
                "name.startsWith(\"a\")" }) {
            QueryFilterResolver.Result result = QueryFilterResolver.resolve(query, null);
            assertEquals("advanced", result.getMode(), query);
            assertNotNull(result.getFilter(), query);
        }
    }

    @Test
    void invalidSyntaxIsRejectedWithoutFallback() {
        DevToolsException e = assertThrows(DevToolsException.class,
                () -> QueryFilterResolver.resolve("department ==", null));
        assertEquals(400, e.getStatus());
        assertEquals("INVALID_FILTER", e.getCode());
    }

    @Test
    void unknownPropertyIsRejectedByTheValidator() {
        DevToolsException e = assertThrows(DevToolsException.class,
                () -> QueryFilterResolver.resolve("foo == \"x\"", f -> {
                    throw new IllegalArgumentException("could not resolve property: foo");
                }));
        assertEquals(400, e.getStatus());
        assertEquals("INVALID_FILTER", e.getCode());
        assertTrue(e.getMessage().contains("foo"));
    }

    @Test
    void nameWithSpecialCharactersIsFilterLike() {
        assertTrue(QueryFilterResolver.looksLikeFilter("A&&B"));
        assertTrue(QueryFilterResolver.looksLikeFilter("Dept (Finance)"));
        assertThrows(DevToolsException.class, () -> QueryFilterResolver.resolve("A&&B", null));
        // The documented escape hatch
        assertEquals("advanced", QueryFilterResolver.resolve("name == \"A&&B\"", null).getMode());
        assertEquals("advanced", QueryFilterResolver.resolve("name.contains(\"A&&B\")", null).getMode());
    }

    @Test
    void plainTextIsNotFilterLike() {
        assertFalse(QueryFilterResolver.looksLikeFilter("john"));
        assertFalse(QueryFilterResolver.looksLikeFilter("Service Account-1_x"));
    }

    @Test
    void tooLongQueryIsRejected() {
        String query = "a".repeat(QueryFilterResolver.MAX_QUERY_LENGTH + 1);
        DevToolsException e = assertThrows(DevToolsException.class,
                () -> QueryFilterResolver.resolve(query, null));
        assertEquals("INVALID_FILTER", e.getCode());
    }
}
