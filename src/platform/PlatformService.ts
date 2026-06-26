import { Context, Effect, Layer, Schema, Config } from "effect"
import { Command, CommandExecutor } from "@effect/platform"
import * as readline from "node:readline"

export class PlatformError extends Schema.TaggedError<PlatformError>()(
  "PlatformError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

export class PlatformService extends Context.Tag("PlatformService")<
  PlatformService,
  {
    readonly homeDir: string
    readonly openUrl: (url: string) => Effect.Effect<void, PlatformError>
    readonly prompt: (question: string) => Effect.Effect<string, PlatformError>
  }
>() {}

export const make = Layer.effect(
  PlatformService,
  Effect.gen(function* () {
    const homeDir = yield* Config.string("HOME").pipe(
      Config.withDefault("/tmp")
    )
    const executor = yield* CommandExecutor.CommandExecutor

    return {
      homeDir,

      openUrl: (url: string) =>
        executor.exitCode(Command.make("open", url)).pipe(
          Effect.mapError((cause) =>
            new PlatformError({ message: "Failed to open browser", cause })
          ),
          Effect.asVoid
        ),

      prompt: (question: string) =>
        Effect.async<string, PlatformError>((resume) => {
          const stdin = process.stdin
          const wasRaw = stdin.isTTY && stdin.isRaw

          if (wasRaw) {
            stdin.setRawMode(false)
          }

          const restore = () => {
            if (wasRaw && stdin.isTTY) {
              stdin.setRawMode(true)
            }
          }

          process.stdout.write(question)

          const rl = readline.createInterface({ input: stdin })
          let settled = false

          rl.once("line", (line) => {
            settled = true
            rl.close()
            restore()
            resume(Effect.succeed(line))
          })

          rl.once("close", () => {
            if (settled) return
            restore()
            resume(Effect.succeed(""))
          })

          return Effect.sync(() => {
            rl.close()
            restore()
          })
        }).pipe(
          Effect.mapError((cause) =>
            new PlatformError({ message: "Failed to prompt", cause })
          )
        ),
    } as const
  })
)

