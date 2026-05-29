import type { Diagnostic } from "../../core/diagnostics/diagnostic";

type OpenCodeLogSink = (event: {
  body: {
    service: "0xcraft";
    level: "debug" | "info" | "warn" | "error";
    message: string;
    extra: Record<string, unknown>;
  };
}) => unknown;

interface OpenCodeClientShape {
  app?: {
    log?: unknown;
  };
}

export interface OpenCodeLogger {
  log: (diagnostic: Diagnostic) => void;
}

function isOpenCodeClientShape(value: unknown): value is OpenCodeClientShape {
  return typeof value === "object" && value !== null;
}

function getLogSink(client: unknown): OpenCodeLogSink | undefined {
  if (!isOpenCodeClientShape(client)) return undefined;
  const log = client.app?.log;
  return typeof log === "function" ? (log.bind(client.app) as OpenCodeLogSink) : undefined;
}

function severityToLevel(severity: Diagnostic["severity"]): "debug" | "info" | "warn" | "error" {
  switch (severity) {
    case "error":
      return "error";
    case "warn":
      return "warn";
    case "info":
      return "info";
  }
}

function fallbackToConsole(diag: Diagnostic): void {
  if (diag.severity !== "warn" && diag.severity !== "error") return;
  const line = `[0xcraft] ${diag.message}`;
  if (diag.severity === "error") {
    console.error(line);
    return;
  }
  console.warn(line);
}

export function createOpenCodeLogger(args: { client?: unknown } = {}): OpenCodeLogger {
  const sink = getLogSink(args.client);

  return {
    log(diag: Diagnostic): void {
      if (!sink) {
        fallbackToConsole(diag);
        return;
      }

      try {
        const result = sink({
          body: {
            service: "0xcraft",
            level: severityToLevel(diag.severity),
            message: diag.message,
            extra: { code: diag.code, ...((diag.details as Record<string, unknown>) ?? {}) },
          },
        });

        if (result && typeof (result as Promise<unknown>).then === "function") {
          void (result as Promise<unknown>).catch(() => undefined);
        }
      } catch {
        // Logging is best-effort; sink failures must never affect plugin behavior.
      }
    },
  };
}
