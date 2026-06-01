import { z } from "zod";

export const PackResourceKind = z.enum(["agents", "skills", "hooks", "mcp", "commands"]);

export const PackResources = z
  .object({
    agents: z.array(z.string().min(1)).optional(),
    skills: z.array(z.string().min(1)).optional(),
    hooks: z.array(z.string().min(1)).optional(),
    mcp: z.array(z.string().min(1)).optional(),
    commands: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const PackManifest = z
  .object({
    schema: z.literal("0xcraft.pack.v1").optional(),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    peer0xcraft: z.string().optional(),
    resources: PackResources,
  })
  .strict();

export type PackResourceKind = z.infer<typeof PackResourceKind>;
export type PackResources = z.infer<typeof PackResources>;
export type PackManifest = z.infer<typeof PackManifest>;
