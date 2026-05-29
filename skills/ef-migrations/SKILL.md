---
name: ef-migrations
description: "Exhaustive reference for EF Core migrations in a multi-project .NET solution with one or more DbContexts (PostgreSQL + Npgsql). Triggers on: migration/миграция keywords, any DB schema change request, dotnet ef commands (migrations add/remove/list/script, database update/drop). Skip when no schema change is involved. Covers: full CLI reference with all flags, project/startup-project setup, naming conventions, all available DbContexts, generated file anatomy, post-generation review, common manual fixes (enums, raw SQL, seed data, indexes), rollback strategies, SQL script generation for CI/CD, environment-specific connections, and file layout."
---

# EF Core Migrations — Exhaustive Reference

## Core Rules

1. **Migrations are created via CLI only** — never write migration files by hand.
2. **Naming format:** `{TICKET}_{Description}` — e.g. `ZA-186_AddOtpVendorsTable`.
3. **Always review** the generated files after creation and edit where needed.
4. **Always supply both `--project` and `--startup-project`** — EF tools resolve design-time services (connection string, DbContext factory) from the startup project.

---

## Project Layout Context

```
solution/
├── {StartupProject}/                 # ← --startup-project (entry point, has appsettings.json)
│   └── appsettings.json
└── {ContextProject}/                 # ← --project (contains DbContext + migrations)
  ├── {DbContext}.cs
  └── {MigrationsDir}/                # e.g. Migrations or Persistence/Migrations
```

| CLI Flag            | Points to                                                           | Typical value                         |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| `--project`         | Project that **contains** the migrations and DbContext              | `src/Modules/Identity.Infrastructure` |
| `--startup-project` | Project that **starts the app** and provides DI / connection string | `src/App.Host`                        |
| `--context`         | DbContext class name (required when multiple contexts exist)        | `IdentityDbContext`                   |
| `--output-dir`      | Relative path inside `--project` where files are generated          | `{MigrationsDir}`                     |
| `--namespace`       | Overrides the C# namespace of generated migration files             | `{MigrationsNamespace}`               |
| `--configuration`   | Build configuration passed to the startup project                   | `Development` / `Release`             |
| `--no-build`        | Skips the build step (use only when already built)                  | —                                     |
| `--verbose`         | Prints detailed MSBuild and EF diagnostic output                    | —                                     |

`{MigrationsProject}` = project that contains the target `DbContext` and migration files.
`{StartupProject}` = executable startup project used to resolve DI and connection strings.
`{MigrationsDir}` = migrations folder relative to `{MigrationsProject}`. `Persistence` is optional.

---

## Command Reference

### `migrations add` — Create a new migration

```bash
dotnet ef migrations add {TICKET}_{Description} \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject} \
  --output-dir {MigrationsDir} \
  --namespace {MigrationsNamespace}
```

**Minimal form** (when DbContext and output dir are already configured in the project):

```bash
dotnet ef migrations add PROJ-123_AddExampleTable \
  --context ExampleDbContext \
  --project {MigrationsProject} \
  --startup-project {StartupProject}
```

**Common wiring cases:**

```bash
# Case A: DbContext project and startup project are the same
dotnet ef migrations add PROJ-124_Init \
  --context ExampleDbContext \
  --project src/App.Host \
  --startup-project src/App.Host

# Case B: DbContext project and startup project are different
dotnet ef migrations add PROJ-125_AddOutbox \
  --context BillingDbContext \
  --project src/Modules/Billing.Infrastructure \
  --startup-project src/App.Host
```

Flag meanings and typical values are defined in the canonical CLI flag table in the "Project Layout Context" section above.

---

### `migrations remove` — Delete the last migration

Removes the latest migration files **and** reverts the model snapshot. Safe only if the migration has **not** been applied to the database.

```bash
dotnet ef migrations remove \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject}
```

> If the migration was already applied, run `database update {PreviousMigration}` first to revert the schema, then `migrations remove`.
>
> If a migration has been merged/shared with other developers, do **not** remove it. Create a new forward migration that reverts the change.

---

### `migrations list` — Show all migrations and their status

```bash
dotnet ef migrations list \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject}
```

Output marks each migration as `[applied]` or `[pending]`. Useful before deploying to verify drift.

---

### `migrations script` — Generate idempotent SQL for CI/CD

Produces a SQL script instead of applying migrations directly. Always use `--idempotent` in pipelines — it wraps each migration in an existence check so the script is safe to run multiple times.

```bash
# Full history → current HEAD (for initial provisioning)
dotnet ef migrations script \
  --idempotent \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject} \
  --output ./deploy/migrations.sql

# From a specific migration to HEAD (incremental deploy)
dotnet ef migrations script {FromMigration} \
  --idempotent \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject} \
  --output ./deploy/delta.sql

# Between two specific migrations
dotnet ef migrations script {FromMigration} {ToMigration} \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject} \
  --output ./deploy/patch.sql
```

| Flag                  | Description                                                                  |
| --------------------- | ---------------------------------------------------------------------------- |
| `--idempotent` / `-i` | Wraps each migration in `IF NOT EXISTS` guards                               |
| `--output` / `-o`     | Write SQL to file instead of stdout                                          |
| `--no-transactions`   | Omit `BEGIN`/`COMMIT` (needed for some DDL like `CREATE INDEX CONCURRENTLY`) |

---

### `database update` — Apply pending migrations

```bash
# Apply all pending migrations
dotnet ef database update \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject}

# Apply up to a specific migration (forward or backward)
dotnet ef database update {TargetMigrationName} \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject}

# Roll back ALL migrations (reverts schema changes introduced by migrations)
dotnet ef database update 0 \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject}

# Override connection string (useful in CI without changing appsettings)
dotnet ef database update \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject} \
  --connection "Host=localhost;Database=app_db;Username=app;Password=secret"
```

| Flag                    | Description                                  |
| ----------------------- | -------------------------------------------- |
| `{TargetMigrationName}` | Name of migration to migrate to (up or down) |
| `0`                     | Special value — reverts all migrations       |
| `--connection`          | Override the connection string at runtime    |
| `--no-build`            | Skip build (speeds up repeated local runs)   |

---

### `database drop` — Drop the database

```bash
dotnet ef database drop \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject} \
  --force   # skips confirmation prompt
```

Use only in local/dev environments. Never in staging or production.

---

### `dbcontext info` — Verify EF can resolve the DbContext

Run this to diagnose startup project or DI configuration issues before creating migrations.

```bash
dotnet ef dbcontext info \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject}
```

If `dbcontext info` fails with a connection or DI resolution error, set `ASPNETCORE_ENVIRONMENT` explicitly and verify `appsettings.{Environment}.json` contains the connection string before retrying.

---

### `dbcontext scaffold` — Reverse-engineer an existing schema

Generates entity classes and a DbContext from an existing database. Useful when taking over a legacy schema.

```bash
dotnet ef dbcontext scaffold \
  "Host=localhost;Database=app_db;Username=app;Password=secret" \
  Npgsql.EntityFrameworkCore.PostgreSQL \
  --context LegacyDbContext \
  --project {MigrationsProject} \
  --output-dir Models/Generated \
  --startup-project {StartupProject} \
  --force   # overwrites existing files
```

---

## Example DbContexts

| Module   | DbContext            | PostgreSQL Schema |
| -------- | -------------------- | ----------------- |
| Identity | `IdentityDbContext`  | `identity`        |
| Billing  | `BillingDbContext`   | `billing`         |
| Catalog  | `CatalogDbContext`   | `catalog`         |
| Orders   | `OrdersDbContext`    | `orders`          |
| Files    | `FileStoreDbContext` | `files`           |

When running any EF command, always specify `--context` explicitly — the tooling will fail if multiple contexts are discovered and none is specified.

Each migration belongs to exactly one `DbContext`. If a schema change spans multiple features/contexts, create separate migrations, one per affected `DbContext`.

---

## Naming Conventions

Format: **`{TICKET}_{Description}`**

- `TICKET` — Jira issue key (e.g. `ZA-186`).
- `_` — required separator.
- `Description` — PascalCase, concise, action-oriented verb + noun.

| ✅ Valid                    | ❌ Invalid         | Notes                                                                            |
| --------------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `ZA-186_AddOtpVendorsTable` | `addOtpVendors`    | Must be PascalCase                                                               |
| `ZA-175_FixOtpHiLoSequence` | `ZA175_Fix`        | Ticket must include dash                                                         |
| `ZA-163_Messaging`          | `ZA-163-Messaging` | Separator must be `_`, not `-`                                                   |
| `Init`                      | _(none)_           | Literal required name for the first migration of a new feature; no ticket prefix |

---

## Generated File Anatomy

EF generates three files per migration:

| File                             | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `{Timestamp}_{Name}.cs`          | `Up()` — apply change; `Down()` — revert change                 |
| `{Timestamp}_{Name}.Designer.cs` | Snapshot of the model at this migration point; **do not edit**  |
| `{DbContext}ModelSnapshot.cs`    | Cumulative model snapshot used by EF to diff the next migration |

### Typical `Up` / `Down` structure to review

```csharp
protected override void Up(MigrationBuilder migrationBuilder)
{
    migrationBuilder.CreateTable(
        name: "vendors",
        schema: "auth",
        columns: table => new { ... },
        constraints: table => { ... });
}

protected override void Down(MigrationBuilder migrationBuilder)
{
    migrationBuilder.DropTable(name: "vendors", schema: "auth");
}
```

Always verify:

- Correct **schema** is applied (matches DbContext schema).
- `Down()` fully reverses `Up()` — EF sometimes omits index drops.
- No unexpected `AlterDatabase()` calls (PostgreSQL enum issue — see below).

---

## Common Manual Fixes After Generation

### PostgreSQL Enums

EF generates `AlterDatabase()` for enum type changes, which Npgsql does not execute correctly. Remove those calls and use raw SQL or the `postgres-enum` skill instead.

```csharp
// ❌ Remove this — generated by EF, not supported by Npgsql
migrationBuilder.AlterDatabase()
    .Annotation("Npgsql:Enum:my_enum", "value1,value2");

// ✅ Use raw SQL
migrationBuilder.Sql("CREATE TYPE auth.my_enum AS ENUM ('value1', 'value2');");
```

---

### Raw SQL — DDL, Triggers, Views, Functions

```csharp
// suppressTransaction: true is required for statements that cannot run inside a transaction
// (e.g. CREATE INDEX CONCURRENTLY, CREATE TYPE, ALTER TYPE ... ADD VALUE)
migrationBuilder.Sql(@"
    CREATE INDEX CONCURRENTLY ix_vendors_name ON auth.vendors (name);
", suppressTransaction: true);

migrationBuilder.Sql(@"
    CREATE OR REPLACE FUNCTION auth.updated_at_trigger()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $$;
");
```

---

### Seed Data

```csharp
migrationBuilder.InsertData(
    schema: "auth",
    table: "vendors",
    columns: new[] { "id", "name", "is_active" },
    values: new object[] { 1, "DefaultVendor", true });

// Multiple rows
migrationBuilder.InsertData(
    schema: "auth",
    table: "vendors",
    columns: new[] { "id", "name" },
    values: new object[,]
    {
        { 1, "VendorA" },
        { 2, "VendorB" },
    });
```

---

### Custom Indexes

EF generates basic indexes but may miss partial, concurrent, or expression indexes:

```csharp
// Partial index
migrationBuilder.Sql(
    "CREATE INDEX ix_users_active ON auth.users (email) WHERE is_active = true;");

// Unique constraint via index (preferred over AddUniqueConstraint for PostgreSQL)
migrationBuilder.Sql(
    "CREATE UNIQUE INDEX uix_users_email ON auth.users (email);");
```

---

### Column Defaults and Sequences

```csharp
migrationBuilder.AddColumn<DateTime>(
    name: "created_at",
    schema: "auth",
    table: "vendors",
    nullable: false,
    defaultValueSql: "now()");

// HiLo sequence (if EF generates the wrong sequence name, fix it here)
migrationBuilder.Sql("CREATE SEQUENCE auth.vendors_hilo_seq INCREMENT BY 10 START WITH 1;");
```

---

## Rollback Strategies

| Scenario                                              | Command                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| Migration not yet applied — delete files              | `migrations remove`                                            |
| Migration applied locally — revert schema then delete | `database update {Previous}` → `migrations remove`             |
| Revert to specific point in any environment           | `database update {TargetMigrationName}`                        |
| Wipe all migrations from DB (keep files)              | `database update 0`                                            |
| Generate rollback SQL for ops team                    | `migrations script {Current} {Previous} --output rollback.sql` |

---

## Environment-Specific Connections

Do not modify `appsettings.json` to run migrations against a different environment. Override the connection string directly:

```bash
# Against staging DB
dotnet ef database update \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject} \
  --connection "Host=staging-db;Database=app_db;Username=app;Password=${STAGING_PASSWORD}"

# Using environment variable picked up by the startup project
ASPNETCORE_ENVIRONMENT=Staging dotnet ef migrations list \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject}
```

---

## CI/CD Integration Pattern

The recommended production deployment pattern avoids calling `database update` directly from the pipeline — use idempotent SQL scripts instead:

```bash
# 1. Generate SQL script during build
dotnet ef migrations script \
  --idempotent \
  --context {DbContext} \
  --project {MigrationsProject} \
  --startup-project {StartupProject} \
  --output ./artifacts/{dbcontext}_migrations.sql

# 2. Apply via psql in the deploy stage (no EF tooling needed on the server)
psql "$DATABASE_URL" -f ./artifacts/{dbcontext}_migrations.sql
```

This keeps the deployment atomic, auditable, and decoupled from the .NET runtime.

---

## File Layout

```
{ContextProject}/
└── {MigrationsDir}/
  ├── {Timestamp}_{Name}.cs            # Up() / Down() logic — review after generation
  ├── {Timestamp}_{Name}.Designer.cs   # EF metadata — do not edit
  └── {DbContext}ModelSnapshot.cs      # Aggregate snapshot — updated automatically
```

Migration timestamps are UTC-based and auto-generated by EF. Do not rename or reorder migration files — EF relies on lexicographic order for sequencing.
