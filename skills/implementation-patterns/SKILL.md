---
name: implementation-patterns
description: >
  Concrete implementation patterns and techniques for .NET backend systems.
  Use when implementing any of: background worker task claiming that must survive pod kills or
  DB outages (lease/heartbeat pattern); race-free duplicate detection without pre-check queries;
  streaming large file exports without MemoryStream.
  Triggers on: lease pattern, LockToken, LockedUntil, heartbeat worker, background job,
  task queue DB, crash-safe processing, distributed lock, stale task recovery,
  unique constraint conflict, CommitResult, duplicate active record, HasActiveExport,
  streaming export, temp file upload, MemoryStream OOM, IAsyncEnumerable export,
  FOR UPDATE SKIP LOCKED.
---

# Implementation Patterns

Navigation guide. Read the reference file for the specific pattern you need.

## Available Patterns

| Pattern | Reference File | Use When |
|---|---|---|
| **Lease-Based Background Processing** | [references/lease-based-processing.md](references/lease-based-processing.md) | Background worker claims DB tasks; must survive pod kills, DB outages, duplicate processing |
| **Race-Free Duplicate Detection** | [references/db-constraint-conflict-detection.md](references/db-constraint-conflict-detection.md) | Prevent duplicate active records (e.g. active exports per user); pre-check queries race |
| **Streaming File Export** | [references/streaming-file-export.md](references/streaming-file-export.md) | Export large datasets to file for S3/storage upload; avoid MemoryStream buffering |

## Quick Decision

- Worker claims tasks from a DB table, must handle crashes/kills → **lease-based-processing**
- "User already has an active X" constraint without a pre-check query → **db-constraint-conflict-detection**
- Export N rows to CSV/Excel and upload to S3, N is large or unbounded → **streaming-file-export**
