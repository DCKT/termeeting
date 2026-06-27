import { BunContext, BunRuntime } from "@effect/platform-bun"
import { FetchHttpClient } from "@effect/platform"
import { make as configStoreMake } from "./storage/ConfigStore.js"
import { make as tokenStoreMake } from "./storage/TokenStore.js"
import { make as accountStoreMake } from "./storage/AccountStore.js"
import { make as authServiceMake } from "./auth/AuthService.js"
import { make as calendarApiMake } from "./calendar/CalendarApi.js"
import { CliService, make as cliServiceMake } from "./cli/CliService.js"
import { migrateIfNeeded } from "./cli/migration.js"
import { Command } from "@effect/cli"
import { Console, Effect, Layer } from "effect"

const appLayer = cliServiceMake().pipe(
  Layer.provideMerge(calendarApiMake),
  Layer.provideMerge(authServiceMake),
  Layer.provideMerge(accountStoreMake),
  Layer.provideMerge(tokenStoreMake),
  Layer.provideMerge(configStoreMake),
  Layer.provideMerge(BunContext.layer),
  Layer.provideMerge(FetchHttpClient.layer),
)

const program = Effect.gen(function* () {
  yield* migrateIfNeeded().pipe(
    Effect.catchAll((e) => Console.error(`Migration skipped: ${String(e)}`)),
    Effect.provide(appLayer),
  )

  const cli = yield* CliService
  const cliRunner = Command.run(cli.command, { name: "termeeting", version: "1.1.0" })
  yield* cliRunner(process.argv)
}).pipe(
  Effect.catchAllDefect((defect) =>
    Console.error("Unexpected error:", defect)
  ),
  Effect.catchAll((error: unknown) =>
    Console.error(String(error))
  ),
  Effect.provide(appLayer),
)

BunRuntime.runMain(program as Effect.Effect<unknown>, { disableErrorReporting: true })
