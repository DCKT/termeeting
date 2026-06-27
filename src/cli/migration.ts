import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import { Prompt } from "@effect/cli"
import { TokenStore, TokenStoreError } from "../storage/TokenStore.js"
import { AccountStore, AccountStoreError } from "../storage/AccountStore.js"
import { Config, Console, Effect, Schema } from "effect"

export class MigrationError extends Schema.TaggedError<MigrationError>()(
  "MigrationError",
  {
    message: Schema.String,
  }
) {}

const NICKNAME_RE = /^[a-zA-Z0-9_-]+$/

export const migrateIfNeeded = () =>
  Effect.gen(function* () {
    const accountStore = yield* AccountStore
    const tokenStore = yield* TokenStore
    const fs = yield* FileSystem
    const path = yield* Path
    const homeDir = yield* Config.string("HOME").pipe(Config.withDefault("/tmp"))

    const accounts = yield* accountStore.list().pipe(
      Effect.mapError((cause: AccountStoreError) =>
        new MigrationError({ message: `Failed to check accounts: ${cause.message}` })
      )
    )
    if (accounts.length > 0) return

    const oldTokenFile = path.join(homeDir, ".config", "termeeting", "google-token.json")

    const exists = yield* fs.exists(oldTokenFile).pipe(
      Effect.mapError(() => new MigrationError({ message: "Failed to check old token file" }))
    )
    if (!exists) return

    const content = yield* fs.readFileString(oldTokenFile).pipe(
      Effect.mapError(() => new MigrationError({ message: "Failed to read old token file" }))
    )

    const result = yield* Schema.decodeUnknown(
      Schema.parseJson(
        Schema.Struct({
          accessToken: Schema.String,
          refreshToken: Schema.String,
          expiry: Schema.String,
        })
      )
    )(content).pipe(
      Effect.mapError(() =>
        new MigrationError({ message: "Invalid legacy token file — please run 'termeeting setup' again." })
      )
    )

    yield* Console.log("")
    yield* Console.log("Detected legacy token file. Let's migrate to multi-account.")
    const nickname = yield* Prompt.text({
      message: "Nickname for this account (e.g., work)",
    }).pipe(
      Effect.mapError((cause) =>
        new MigrationError({ message: `Input error: ${cause.message}` })
      )
    )

    if (!NICKNAME_RE.test(nickname) || !nickname.trim()) {
      return yield* new MigrationError({
        message: "Invalid nickname. Use letters, numbers, hyphens, and underscores only.",
      })
    }

    yield* tokenStore.write(nickname.trim(), result).pipe(
      Effect.mapError((cause: TokenStoreError) =>
        new MigrationError({ message: `Failed to migrate tokens: ${cause.message}` })
      )
    )

    yield* fs.remove(oldTokenFile).pipe(
      Effect.catchAll(() => Effect.void)
    )

    yield* accountStore.add({
      nickname: nickname.trim(),
      email: "unknown",
    }).pipe(
      Effect.mapError((cause: AccountStoreError) =>
        new MigrationError({ message: `Failed to register account: ${cause.message}` })
      )
    )

    yield* Console.log(`Migration complete! Account '${nickname.trim()}' is ready.`)
  })
