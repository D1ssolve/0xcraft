import { describe, expect, test } from "bun:test";
import { mergeConfig } from "../../../core/config";
import type { SkillDefinition } from "../../../core/skills";
import { mapSkillsToOpencode, selectEnabledSkills } from "./skills";

const skills: SkillDefinition[] = [
  {
    id: "alpha",
    name: "Alpha",
    description: "Alpha skill",
    skillFile: "skills/alpha/SKILL.md",
    tags: [],
  },
  {
    id: "beta",
    name: "Beta",
    description: "Beta skill",
    skillFile: "skills/beta/SKILL.md",
    tags: [],
  },
];

describe("OpenCode skills mapper", () => {
  test("disabled.skills filters out matching skill ids", () => {
    const selected = selectEnabledSkills(skills, mergeConfig({ disabled: { skills: ["beta"] } }));

    expect(selected.map((skill) => skill.id)).toEqual(["alpha"]);
  });

  test("enabled.skills acts as positive allow-list when non-empty", () => {
    const selected = selectEnabledSkills(skills, mergeConfig({ enabled: { skills: ["beta"] } }));

    expect(selected.map((skill) => skill.id)).toEqual(["beta"]);
  });

  test("skill paths derive from skillFile directory relative to package root", () => {
    expect(mapSkillsToOpencode({ skills, packageRoot: "/repo/pkg" })).toEqual({
      paths: ["/repo/pkg/skills/alpha", "/repo/pkg/skills/beta"],
    });
  });

  test("duplicate skill paths are deduped", () => {
    const duplicatePathSkills: SkillDefinition[] = [
      skills[0]!,
      { ...skills[1]!, skillFile: "skills/alpha/SKILL.md" },
    ];

    expect(mapSkillsToOpencode({ skills: duplicatePathSkills, packageRoot: "/repo/pkg" })).toEqual({
      paths: ["/repo/pkg/skills/alpha"],
    });
  });
});
