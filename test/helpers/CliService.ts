import { CliService } from "../../src/cli/CliService.js"
import { Command } from "@effect/cli"
import { Layer } from "effect"

export const makeTest = (): Layer.Layer<CliService> =>
  Layer.succeed(CliService, {
    command: Command.make("test"),
  } as any)
