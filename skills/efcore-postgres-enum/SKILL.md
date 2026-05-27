---
name: efcore-postgres-enum
description: "Mandatory workflow for PostgreSQL enum synchronization across C# enums, Npgsql token mappings, NpgsqlContributor registration, and EF Core migrations. Trigger on: enum value add/remove, new enum type creation, ALTER TYPE, CREATE TYPE, EnumTokens or NpgsqlContributor changes, or migration errors like '22P02 invalid input value for enum'. Do NOT use for migrations that do not touch PostgreSQL enums. Output: exact file checklist, safe migration patterns, and raw SQL fallback for unsupported operations."
---

# PostgreSQL Enums with EF Core & Npgsql

PostgreSQL native enums require four-layer synchronization: the C# enum, token mapping class, Npgsql contributor registration, and EF Core migration. Skipping any layer causes runtime failures.

---

## Operation 1: Add a Value to an Existing Enum

### Checklist (4 files)

1. `Features/{Feature}/Public/Enums/{EnumName}.cs` — add C# enum member
2. `Features/{Feature}/Infrastructure/Persistence/Tokens/{EnumName}EnumTokens.cs` — add constant + dictionary entry
3. Migration file — replace EF-generated `AlterDatabase()` with raw `ALTER TYPE ... ADD VALUE`
4. Verify compilation and tests

### Step 1 — C# Enum

```csharp
public enum OtpCodeStatus
{
    Pending  = 0,
    Sent     = 1,
    Verified = 2,
    Canceled = 3,
    Failed   = 4   // new
}
```

### Step 2 — EnumTokens

Add the constant and the dictionary entry in `TokenMapBacking`:

```csharp
public sealed class OtpCodeStatusEnumTokens : INpgsqlNameTranslator
{
    public const string Pending  = "pending";
    public const string Sent     = "sent";
    public const string Verified = "verified";
    public const string Canceled = "canceled";
    public const string Failed   = "failed";   // new

    private static readonly Dictionary<OtpCodeStatus, string> TokenMapBacking = new()
    {
        [OtpCodeStatus.Pending]  = Pending,
        [OtpCodeStatus.Sent]     = Sent,
        [OtpCodeStatus.Verified] = Verified,
        [OtpCodeStatus.Canceled] = Canceled,
        [OtpCodeStatus.Failed]   = Failed,     // new
    };
    // ...
}
```

### Step 3 — Migration

EF generates an `AlterDatabase()` block with `Npgsql:Enum` annotations — **this does not execute any DDL in PostgreSQL**. Replace the generated body entirely:

```csharp
protected override void Up(MigrationBuilder migrationBuilder)
{
    // ALTER TYPE ... ADD VALUE must run outside a transaction.
    // EF issue: https://github.com/dotnet/efcore/issues/35096
    migrationBuilder.Sql(
        "ALTER TYPE {schema}.{enum_type} ADD VALUE IF NOT EXISTS '{value}';",
        suppressTransaction: true);
}

protected override void Down(MigrationBuilder migrationBuilder)
{
    // PostgreSQL does not support DROP VALUE on an enum.
    // To roll back: recreate the type without the value (see Operation 3).
}
```

**Critical rules:**

- Always use `suppressTransaction: true` — `ADD VALUE` is non-transactional in PostgreSQL.
- Always use `IF NOT EXISTS` — makes the migration idempotent and safe to re-run.
- The `AlterDatabase()` annotations exist only so EF's snapshot stays consistent; they generate no DDL.

---

## Operation 2: Create a New Enum Type

### Checklist (5 files)

1. `Features/{Feature}/Public/Enums/{EnumName}.cs` — create C# enum
2. `Features/{Feature}/Infrastructure/Persistence/Tokens/{EnumName}EnumTokens.cs` — create token class
3. `Features/{Feature}/Infrastructure/Persistence/{Feature}NpgsqlContributor.cs` — register mapping
4. Migration — EF auto-generates `HasPostgresEnum`; no manual SQL needed
5. Entity configuration — set `HasColumnType`

### Step 1 — C# Enum

```csharp
namespace GatewayService.Features.Auth.Public.Enums;

public enum MyNewStatus
{
    Active   = 0,
    Inactive = 1,
    Deleted  = 2,
}
```

### Step 2 — EnumTokens

```csharp
public sealed class MyNewStatusEnumTokens : INpgsqlNameTranslator
{
    public const string Active   = "active";
    public const string Inactive = "inactive";
    public const string Deleted  = "deleted";

    private static readonly Dictionary<MyNewStatus, string> TokenMapBacking = new()
    {
        [MyNewStatus.Active]   = Active,
        [MyNewStatus.Inactive] = Inactive,
        [MyNewStatus.Deleted]  = Deleted,
    };

    public static IReadOnlyDictionary<MyNewStatus, string> TokenMap => TokenMapBacking;
    public static string GetTypeName() => "my_new_status";

    public string TranslateTypeName(string clrName) => GetTypeName();
    public string TranslateMemberName(string clrName) =>
        Enum.Parse<MyNewStatus>(clrName).ToToken();
}

public static class MyNewStatusExtensions
{
    public static string ToToken(this MyNewStatus value) =>
        MyNewStatusEnumTokens.TokenMap.GetValueOrDefault(value, value.ToString());
}
```

### Step 3 — NpgsqlContributor

Register in **both** methods:

```csharp
public override void ConfigureDataSource(NpgsqlDataSourceBuilder builder) =>
    builder
        // ... existing enums ...
        .MapEnum<MyNewStatus>(
            Qualify(MyNewStatusEnumTokens.GetTypeName()),
            new MyNewStatusEnumTokens());

public override void ConfigureEf(NpgsqlDbContextOptionsBuilder npgsql) =>
    npgsql
        // ... existing enums ...
        .MapEnum<MyNewStatus>(MyNewStatusEnumTokens.GetTypeName(), SchemaName);
```

### Step 4 — Migration

Run `dotnet ef migrations add {Name} --context {DbContext}`. EF will auto-generate the `HasPostgresEnum` call in the Designer and emit `CREATE TYPE` DDL — **no manual SQL required** for new types.

### Step 5 — Entity Configuration

```csharp
builder.Property(x => x.Status)
    .HasColumnType("my_new_status")
    .HasColumnName("status");
```

---

## Operation 3: Remove a Value from an Existing Enum (Down Migration)

PostgreSQL has no `DROP VALUE`. The only safe approach is to recreate the type.

### Pre-flight checks

```sql
-- 1. Find all columns using this enum type
SELECT table_name, column_name
FROM information_schema.columns
WHERE udt_name = 'export_type';

-- 2. Confirm no rows contain the value being removed
SELECT COUNT(*) FROM your_table WHERE your_column = 'contact_results';
```

If rows exist, migrate them first:

```sql
UPDATE your_table SET your_column = 'users' WHERE your_column = 'contact_results';
```

### Recreate pattern

```sql
-- 1. New type with the value removed
CREATE TYPE export_type_new AS ENUM ('users');

-- 2. Migrate every column that uses the old type (repeat per table/column)
ALTER TABLE your_table
    ALTER COLUMN your_column TYPE export_type_new
    USING your_column::text::export_type_new;

-- 3. Drop the old type
DROP TYPE export_type;

-- 4. Rename to the original name
ALTER TYPE export_type_new RENAME TO export_type;
```

In a Down migration, wrap this in `migrationBuilder.Sql(..., suppressTransaction: true)` for each statement, or execute via a raw SQL script outside EF.

---

## Troubleshooting

| Error                                               | Root cause                                  | Fix                                                               |
| --------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `22P02: invalid input value for enum`               | Value exists in C# but not in PostgreSQL    | Add `ALTER TYPE ... ADD VALUE` migration                          |
| `42710: enum label already exists`                  | Migration ran without `IF NOT EXISTS`       | Add `IF NOT EXISTS`; mark migration as applied manually if needed |
| `Cannot convert 'Failed' to type 'otp_code_status'` | `EnumTokens` not updated                    | Add constant + `TokenMapBacking` entry                            |
| `ALTER TYPE cannot run inside transaction`          | Missing `suppressTransaction: true`         | Always set this flag for `ADD VALUE`                              |
| `AlterDatabase()` generates no DDL                  | Expected — EF annotations are snapshot-only | Write explicit `migrationBuilder.Sql()` for all enum DDL          |

---

## File Map

```txt
Features/{Feature}/
├── Public/
│   └── Enums/
│       └── {EnumName}.cs                        # C# enum definition
└── Infrastructure/
    └── Persistence/
        ├── Tokens/
        │   └── {EnumName}EnumTokens.cs           # Token constants + INpgsqlNameTranslator
        ├── {Feature}NpgsqlContributor.cs          # MapEnum registrations (DataSource + EF)
        └── Migrations/
            └── {Timestamp}_{TicketId}_{Name}.cs  # Migration — manual SQL for enum DDL
```
