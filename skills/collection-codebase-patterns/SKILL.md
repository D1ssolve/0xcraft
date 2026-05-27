---
name: collection-codebase-patterns
description: Use when changing Collection .NET layered app, especially export/session/plugin/DAL/Backend/BLL/S3 code; checklist prevents review mistakes around layer boundaries, exceptions, filters, constraints, streaming, and contracts.
---

# Collection Codebase Patterns

Use before implementation in `collection` repo when touching Backend, BLL, DAL, Contracts, Frontend, S3, exports, sessions, or plugins. Rules below come from HEAD export fixes (`09ea17b`).

## Pre-flight checklist

- Read `.ai/adr.md` and `.ai/tasks.md` if present; inspect latest related commit/diff for existing direction.
- Keep layer direction: Frontend/Backend -> Contracts + BLL -> DAL. DAL must not reference Contracts or Frontend.
- Prefer existing repo primitives: `BllException`, `IUnitOfWork.Commit()`/`CommitResult`, EF configurations, protobuf contracts, keyed DI.
- Add tests for non-trivial behavior; otherwise verify build/test path from `AGENTS.md`.

## Layer boundaries

- Backend/gRPC service: authentication, request null checks, transport parsing only. Delegate business flow to BLL managers.
- BLL manager: enrich filters with auth context, validate, create sessions, handle `CommitResult`, orchestrate plugins/storage.
- DAL: persistence model, EF relationships, indexes, migrations, repositories. No `Collection.Contracts` dependency, no UI/frontend constants.
- Contracts: transport DTOs/enums only. Do not force DAL seed data or entity model to depend on contract enum types.

## Exception strategy

- In BLL flow, throw `BllException` or domain subclass (`DuplicateExportException : BllException`). Let middleware/host map response.
- Do not throw `RpcException` from BLL managers/plugins; keep transport exceptions at transport edge only.
- Convert DB constraint failures through `CommitResult` in BLL. Log context, then throw domain exception for expected conflicts.

## Export/plugin conventions

- Use one generic export endpoint shape: `ExportRequest { TypeId, FilterJson }`; plugin resolves behavior by type.
- Stable invariant: each export `TypeId` resolves to exactly one handler that owns enrichment, validation, record retrieval, file naming, and entity prefix.
- Current HEAD implementation uses keyed `IPlugin` DI resolution by type key (`AddKeyedScoped(..., "ExportPlugin{typeId}")`). Treat this as current choice, not permanent architecture law.
- Typed-plugin evolution is acceptable if the invariant holds: one handler per `TypeId`, explicit zero/multiple detection, same filter lifecycle, no DAL/UI leakage.
- Put auth-dependent enrichment in BLL plugin/manager, not frontend or DAL.

## Filter storage and types

- Store export filters as `System.Text.Json.JsonDocument` in DAL model.
- Configure EF column as PostgreSQL `jsonb`: `.HasColumnType("jsonb")`.
- Parse/serialize at edges: Backend parses request JSON to `JsonDocument`; BLL plugins deserialize concrete DTOs for validation/query building.
- Do not store JSON filters as plain `string`/`text` when DB JSON semantics are needed.

## DAL naming and relationships

- Use `CreatedById` for creator/user ownership fields; add navigation `CreatedBy` and required FK.
- Add required FK for session type: `TypeId` + `Type` navigation.
- Seed DAL lookup rows from DAL constants/entities, not contract enums.
- Keep EF config complete: required fields, relationships, indexes, table names, enum type names.

## Constraints and duplicate handling

See **implementation-patterns** → `db-constraint-conflict-detection` for the full pattern.

Short rules:
- Enforce duplicate active exports in DB with unique filtered index, e.g. `(CreatedById, TypeId)` where status in `pending/exporting`.
- Do not rely on pre-check repository methods like `HasActiveExport`; they race.
- In BLL, handle `CommitResult.ConstraintViolation { Type: Unique }`, log user/type, throw `DuplicateExportException`.

## Streaming and memory

See **implementation-patterns** → `streaming-file-export` for the full pattern.

Short rules:
- Do not materialize export files in `MemoryStream` for upload.
- Stream records to a temp file with `IReportWriter.Write(...)` returning row count; delete temp file in `finally`.
- If count > 0, reopen temp file for S3 upload. If count == 0, mark exported/empty without upload.
- Writer should consume `IAsyncEnumerable<object>` with `WithCancellation(ct)`, write header from first record type, and return count.
- Storage manager uploads `Stream`; it should not know record DTO types or write reports itself.
- Pass `CancellationToken` only when downstream API actually accepts/propagates it; do not add decorative `ct.ThrowIfCancellationRequested()` before sync-only calls.

## Contract/frontend leakage guardrails

- Frontend may use contract DTOs/enums to call service.
- Backend may parse contract request and call BLL.
- BLL may depend on contract DTOs/enums only at established feature boundaries (for example request/filter DTO deserialization); DAL must stay independent.
- Never reference frontend constants/contracts from DAL migrations/entities/configurations.

## Final review before coding done

- Layer dependencies clean? DAL has no Contracts/Frontend reference.
- Expected conflicts enforced by DB constraint and mapped in BLL? (→ see `implementation-patterns/db-constraint-conflict-detection`)
- Filters are `JsonDocument` + `jsonb` where persisted?
- Export path avoids in-memory file buffering? (→ see `implementation-patterns/streaming-file-export`)
- Plugin registration guarantees unique type resolution?
- Cancellation tokens are propagated, not decorative?
