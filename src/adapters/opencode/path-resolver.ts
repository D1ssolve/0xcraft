export type OpenCodeEmitMode = "filesystem" | "plugin";

export interface OpenCodePathResolver {
  readonly mode: OpenCodeEmitMode;
  agentFile(id: string): string;
  agentReferencesDir(id: string): string;
  skillFile(id: string): string;
  skillReferencesDir(id: string): string;
  commandFile(id: string): string;
  hookFile(id: string): string;
  configFile(): string;
}

export class FilesystemPathResolver implements OpenCodePathResolver {
  readonly mode = "filesystem" as const;

  agentFile(id: string): string {
    return `.opencode/agents/${id}.md`;
  }

  agentReferencesDir(id: string): string {
    return `.opencode/agents/${id}/references`;
  }

  skillFile(id: string): string {
    return `.opencode/skills/${id}/SKILL.md`;
  }

  skillReferencesDir(id: string): string {
    return `.opencode/skills/${id}/references`;
  }

  commandFile(id: string): string {
    return `.opencode/commands/${id}.md`;
  }

  hookFile(id: string): string {
    return `.opencode/plugins/${id}.js`;
  }

  configFile(): string {
    return "opencode.json";
  }
}

export class PluginPathResolver implements OpenCodePathResolver {
  readonly mode = "plugin" as const;

  agentFile(id: string): string {
    return `.opencode-plugin/agents/${id}.md`;
  }

  agentReferencesDir(id: string): string {
    return `.opencode-plugin/agents/${id}/references`;
  }

  skillFile(id: string): string {
    return `.opencode-plugin/skills/${id}/SKILL.md`;
  }

  skillReferencesDir(id: string): string {
    return `.opencode-plugin/skills/${id}/references`;
  }

  commandFile(id: string): string {
    return `.opencode-plugin/commands/${id}.md`;
  }

  hookFile(_id: string): string {
    return ".opencode-plugin/index.js";
  }

  configFile(): string {
    return ".opencode-plugin/package.json";
  }
}

export function createPathResolver(mode: OpenCodeEmitMode): OpenCodePathResolver {
  return mode === "plugin" ? new PluginPathResolver() : new FilesystemPathResolver();
}
