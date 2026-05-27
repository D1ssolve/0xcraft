import { describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import type { SkillDefinition } from "../../../core/skills";
import { createClaudeCodeFilesystemWriter } from "../filesystem";
import { generateClaudeCodeSkills } from "./skills";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function createSkill(root: string, skillId: string, files: Record<string, string> = {}): SkillDefinition {
  const skillDirectory = path.join(root, "skills", skillId);
  fs.mkdirSync(skillDirectory, { recursive: true });
  fs.writeFileSync(path.join(skillDirectory, "SKILL.md"), `# ${skillId}\n\nUse this skill.`);

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(skillDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  return {
    id: skillId,
    name: skillId,
    description: `Description for ${skillId}`,
    skillFile: `skills/${skillId}/SKILL.md`,
    tags: ["fixture"],
  };
}

describe("generateClaudeCodeSkills", () => {
  test("copies enabled skills to Claude skill directories with supporting files", () => {
    const packageRoot = makeTempDir("0xcraft-claude-skills-package-");
    const outputRoot = makeTempDir("0xcraft-claude-skills-output-");
    const enabledSkill = createSkill(packageRoot, "enabled-skill", {
      "reference/example.md": "example",
      "scripts/run.sh": "#!/usr/bin/env bash\n",
    });
    const disabledSkill = createSkill(packageRoot, "disabled-skill", {
      "reference/omitted.md": "omitted",
    });
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeSkills({
      skills: [enabledSkill, disabledSkill],
      disabledSkillIds: ["disabled-skill"],
      packageRoot,
      writer,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.emittedFiles).toEqual([
      "skills/enabled-skill/SKILL.md",
      "skills/enabled-skill/reference/example.md",
      "skills/enabled-skill/scripts/run.sh",
    ]);
    expect(result.skills).toEqual([
      {
        id: "enabled-skill",
        namespace: "/0xcraft:enabled-skill",
      },
    ]);
    expect(readText(path.join(outputRoot, "skills", "enabled-skill", "SKILL.md"))).toBe(`---
name: enabled-skill
description: "Description for enabled-skill"
---

# enabled-skill

Use this skill.
`);
    expect(readText(path.join(outputRoot, "skills", "enabled-skill", "reference", "example.md"))).toBe("example");
    expect(fs.existsSync(path.join(outputRoot, "skills", "disabled-skill", "SKILL.md"))).toBe(false);
  });

  test("normalizes copied SKILL.md frontmatter to Claude-compatible fields", () => {
    const packageRoot = makeTempDir("0xcraft-claude-skills-frontmatter-package-");
    const outputRoot = makeTempDir("0xcraft-claude-skills-frontmatter-output-");
    const skill = createSkill(packageRoot, "frontmatter-skill");
    fs.writeFileSync(path.join(packageRoot, "skills", "frontmatter-skill", "SKILL.md"), `---
name: frontmatter-skill
description: >
  Source description with YAML folded scalar.
metadata:
  source-only: true
---

# Source Body
`);
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeSkills({
      skills: [skill],
      packageRoot,
      writer,
    });

    expect(result.diagnostics).toEqual([]);
    expect(readText(path.join(outputRoot, "skills", "frontmatter-skill", "SKILL.md"))).toBe(`---
name: frontmatter-skill
description: "Description for frontmatter-skill"
---

# Source Body
`);
  });

  test("reports missing SKILL.md files and continues with valid skills", () => {
    const packageRoot = makeTempDir("0xcraft-claude-skills-missing-package-");
    const outputRoot = makeTempDir("0xcraft-claude-skills-missing-output-");
    const validSkill = createSkill(packageRoot, "valid-skill");
    const missingSkill: SkillDefinition = {
      id: "missing-skill",
      name: "Missing Skill",
      description: "Missing fixture",
      skillFile: "skills/missing-skill/SKILL.md",
      tags: ["fixture"],
    };
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeSkills({
      skills: [missingSkill, validSkill],
      packageRoot,
      writer,
    });

    expect(result.emittedFiles).toEqual(["skills/valid-skill/SKILL.md"]);
    expect(result.skills).toEqual([
      {
        id: "valid-skill",
        namespace: "/0xcraft:valid-skill",
      },
    ]);
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "claude.skill.missing_file",
        skillId: "missing-skill",
        skillFile: "skills/missing-skill/SKILL.md",
        message: "Skill `missing-skill` was omitted because skills/missing-skill/SKILL.md does not exist.",
      },
    ]);
  });

  test("does not auto-register skill-embedded MCP servers", () => {
    const packageRoot = makeTempDir("0xcraft-claude-skills-mcp-package-");
    const outputRoot = makeTempDir("0xcraft-claude-skills-mcp-output-");
    const skillWithMcp: SkillDefinition = {
      ...createSkill(packageRoot, "mcp-skill"),
      mcpServers: [
        {
          name: "fixture-mcp",
          type: "local",
          command: ["fixture"],
        },
      ],
    };
    const writer = createClaudeCodeFilesystemWriter({ outputRoot });

    const result = generateClaudeCodeSkills({
      skills: [skillWithMcp],
      packageRoot,
      writer,
    });

    expect(result.skills).toEqual([
      {
        id: "mcp-skill",
        namespace: "/0xcraft:mcp-skill",
      },
    ]);
    expect(result.mcpServers).toEqual([]);
    expect(fs.existsSync(path.join(outputRoot, ".mcp.json"))).toBe(false);
  });
});
