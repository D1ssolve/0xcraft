import {
  ConfigSchema,
  type ZeroxCraftConfig,
  type ZeroxCraftConfigInput,
} from "./config-schema";

export {
  DEFAULT_CONFIG as defaultConfig,
  ConfigSchema,
  zeroxCraftConfigSchema,
  type ZeroxCraftConfig,
  type ZeroxCraftConfigInput,
  type ZeroxCraftConfigParsed,
  type CodexPlatformConfig,
  type ClaudePlatformConfig,
  type OpencodePlatformConfig,
} from "./config-schema";

export type PartialZeroxCraftConfig = ZeroxCraftConfigInput;

export function mergeConfig(user: ZeroxCraftConfigInput): ZeroxCraftConfig {
  return ConfigSchema.parse(user);
}
