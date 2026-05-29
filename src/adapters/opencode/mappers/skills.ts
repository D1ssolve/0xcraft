import type { ZeroxCraftConfig } from "../../../core/config";
import type { SkillDefinition } from "../../../core/skills";

export interface MapSkillsInput {
  skills: ReadonlyArray<SkillDefinition>;
  packageRoot: string;
}

export interface OpencodeSkillsConfig {
  paths: string[];
}

export function mapSkillsToOpencode(input: MapSkillsInput): OpencodeSkillsConfig {
  const paths = new Set<string>();

  for (const skill of input.skills) {
    paths.add(`${input.packageRoot}/${skill.skillFile.replace(/\/SKILL\.md$/, "")}`);
  }

  return { paths: [...paths] };
}

/** Pure filter — moves the disabled/enabled gating logic out of the handler. */
export function selectEnabledSkills(
  skills: ReadonlyArray<SkillDefinition>,
  config: ZeroxCraftConfig,
): SkillDefinition[] {
  return skills.filter((skill) => {
    if (config.disabled.skills.includes(skill.id)) return false;
    if (config.enabled.skills.length > 0 && !config.enabled.skills.includes(skill.id)) return false;
    return true;
  });
}
