import { z } from "zod";

export const REFERENCE_FILENAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}\.(md|txt)$/;

export const ReferenceFilename = z.string().regex(
  REFERENCE_FILENAME_RE,
  "Reference filename must match [a-z0-9][a-z0-9_-]{0,62}.(md|txt)",
);

export const ReferencesMap = z.record(ReferenceFilename, z.string()).optional();

export type ReferencesMap = z.infer<typeof ReferencesMap>;
