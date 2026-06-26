import { BunContext, BunRuntime } from "@effect/platform-bun"
import { FetchHttpClient } from "@effect/platform"
import { make as platformServiceMake } from "./platform/PlatformService.js"
import { make as configStoreMake } from "./storage/ConfigStore.js"
import { make as tokenStoreMake } from "./storage/TokenStore.js"
import { make as accountStoreMake } from "./storage/AccountStore.js"
import { make as authServiceMake } from "./auth/AuthService.js"
import { make as calendarApiMake } from "./calendar/CalendarApi.js"
import { CliService, make as cliServiceMake } from "./cli/CliService.js"
import { Console, Effect, Layer } from "effect"

const appLayer = cliServiceMake().pipe(
  Layer.provide(calendarApiMake),
  Layer.provide(authServiceMake),
  Layer.provide(accountStoreMake),
  Layer.provide(tokenStoreMake),
  Layer.provide(configStoreMake),
  Layer.provide(platformServiceMake),
  Layer.provide(BunContext.layer),
  Layer.provide(FetchHttpClient.layer)
)

const program = Effect.gen(function* () {
  const cli = yield* CliService
  const args = process.argv.slice(2)
  const output = yield* cli.run(args)
  yield* Console.log(output)
}).pipe(
  Effect.catchAllDefect((defect) =>
    Console.error("Unexpected error:", defect)
  ),
  Effect.catchAll((error: unknown) =>
    Console.error(String(error))
  ),
  Effect.provide(appLayer)
)

BunRuntime.runMain(program, { disableErrorReporting: true })
