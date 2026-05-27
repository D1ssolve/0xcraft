# Spec Template

> Minimal template for `.ai/spec.md`.
> Replace placeholders, then remove the example before finalizing.

## [Feature Name]

- Status: DRAFT | APPROVED | FINAL
- Complexity: S | M | L
- Stack: [main tech]

### 1. Why

- Background: [why this feature exists]
- In scope: [what is included]
- Out of scope: [what is excluded]
- Actors:
- [Actor/System] -> [role or interaction]
- [Actor/System] -> [role or interaction]

### 2. Requirements

#### FR-001: [Requirement Name]

- Goal: [user story or functional goal]
- Priority: Must | Should | Could
- Acceptance:
- Given [context], when [action], then [result]
- Given [edge case], when [action], then [result]

#### FR-002: [Requirement Name]

- Goal: [user story or functional goal]
- Priority: Must | Should | Could
- Acceptance:
- Given [context], when [action], then [result]

### 3. Design

- Interfaces:
- [HTTP/Event/Command] -> [purpose] -> [FR ref]
- [HTTP/Event/Command] -> [purpose] -> [FR ref]
- Data/state:
- [Entity] { field: type, field: type } [important constraints]
- [State or invariant]
- Failures:
- [scenario] -> [status/event/code] -> [system action]
- [scenario] -> [status/event/code] -> [system action]

---

## Example

### Tenant Onboarding API

- Status: APPROVED
- Complexity: M
- Stack: .NET 8, PostgreSQL, Keycloak

### Why Example

- Background: New tenants are onboarded manually; this is slow and creates setup drift.
- In scope: tenant creation, realm provisioning, schema creation, API key generation.
- Out of scope: billing, admin UI, legacy data migration.
- Actors:
- Platform Admin -> creates tenant via API
- Keycloak -> provisions tenant realm
- PostgreSQL -> creates isolated schema

### Requirements Example

#### FR-001: Provision Tenant

- Goal: Create tenant resources across DB, IDP, and secrets storage in one flow.
- Priority: Must
- Acceptance:
- Given a valid payload, when onboarding starts, then schema, realm, and API key are created and status becomes Active.
- Given Keycloak succeeds but DB creation fails, when the workflow aborts, then created external resources are rolled back and status becomes Failed.

#### FR-002: Deactivate Tenant

- Goal: Disable tenant access without deleting retained data.
- Priority: Should
- Acceptance:
- Given an active tenant, when it is deleted, then access is disabled and status becomes Deleted while data remains restorable.

### Design Example

- Interfaces:
- POST /api/v1/tenants -> create tenant and start provisioning -> FR-001
- DELETE /api/v1/tenants/{id} -> soft delete tenant -> FR-002
- Data/state:
- Tenant { id: uuid, slug: string, status: enum, realmId: string? } [slug unique; status in Provisioning|Active|Deleted|Failed]
- Provisioning is compensating: partial success must be rolled back.
- Failures:
- duplicate slug -> 409 slug_taken -> reject request
- Keycloak timeout -> 503 idp_timeout -> retry or compensate
