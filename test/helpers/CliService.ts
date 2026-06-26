import { CliService } from "../../src/cli/CliService.js"
import { Effect, Layer } from "effect"

export const makeTest = (output?: string): Layer.Layer<CliService> =>
  Layer.succeed(CliService, {
    run: () => Effect.succeed(output ?? "test output"),
  })
