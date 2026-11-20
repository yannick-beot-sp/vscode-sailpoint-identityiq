package com.sailpoint.se.plugin.vscode.dto;

import java.util.List;

import lombok.Builder;
import lombok.Value;

/**
 * One role of the Identity View cube (see docs/identity-webview.md). One
 * entry per Bundle: assignment and detection are combinable statuses of the
 * same row, never two rows.
 */
@Value
@Builder
public class IdentityRoleDto {
    /** Id of the Bundle, so the detail drawer can resolve it */
    String id;
    String name;
    /** Bundle type (business, it, organizational...), shown on the row */
    String type;
    /** Carries a positive RoleAssignment */
    boolean assigned;
    /** Matched by role detection */
    boolean detected;
    /** Carries a negative RoleAssignment: explicitly removed from the identity */
    boolean negative;
    /** Source of the assignment (LCM, Rule, UI...), null when only detected */
    String source;
    String assignmentId;
    String assigner;
    /** Roles whose assignment caused this role to be granted/detected */
    List<String> parentRoleNames;
    /** Displayable names of the Bundle classifications */
    List<String> classifications;
}
