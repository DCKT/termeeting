import { PlatformService, PlatformError } from "../../src/platform/PlatformService.js"
import { Effect, Layer } from "effect"

export const makeTest = (
  overrides?: Partial<{
    homeDir: string
    openUrl: () => Effect.Effect<void, PlatformError>
    prompt: () => Effect.Effect<string, PlatformError>
  }>
): Layer.Layer<PlatformService> =>
  Layer.succeed(PlatformService, {
    homeDir: overrides?.homeDir ?? "/tmp",
    openUrl: overrides?.openUrl ?? (() => Effect.void),
    prompt: overrides?.prompt ?? (() => Effect.succeed("")),
  })
