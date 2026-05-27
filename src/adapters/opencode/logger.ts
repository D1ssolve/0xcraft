import type { DiagnosticEvent, DiagnosticSink } from "../../core/config/config-loader";

type OpenCodeLogSink = (event: {
  body: {
    service: "0xcraft";
    level: DiagnosticEvent["level"];
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
  log: DiagnosticSink;
}

function isOpenCodeClientShape(value: unknown): value is OpenCodeClientShape {
  return typeof value === "object" && value !== null;
}

function getLogSink(client: unknown): OpenCodeLogSink | undefined {
  if (!isOpenCodeClientShape(client)) return undefined;
  const log = client.app?.log;
  return typeof log === "function" ? log.bind(client.app) as OpenCodeLogSink : undefined;
}

function fallbackToConsole(event: DiagnosticEvent): void {
  if (event.level !== "warn" && event.level !== "error") return;
  const line = `[0xcraft] ${event.message}`;
  if (event.level === "error") {
    console.error(line);
    return;
  }
  console.warn(line);
}

export function createOpenCodeLogger(args: { client?: unknown } = {}): OpenCodeLogger {
  const sink = getLogSink(args.client);

  return {
    log(event: DiagnosticEvent): void {
      if (!sink) {
        fallbackToConsole(event);
        return;
      }

      try {
        const result = sink({
          body: {
            service: "0xcraft",
            level: event.level,
            message: event.message,
            extra: { code: event.code, ...(event.extra ?? {}) },
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
