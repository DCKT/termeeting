import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import { PlatformService } from "../platform/PlatformService.js"
import { Context, Effect, Layer, Option, Schema } from "effect"

const TokenSetSchema = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiry: Schema.String,
})

const serializeTokens = Schema.encodeSync(
  Schema.parseJson(TokenSetSchema)
)

export interface TokenSet {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiry: string
}

export class TokenStoreError extends Schema.TaggedError<TokenStoreError>()(
  "TokenStoreError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

export class TokenStore extends Context.Tag("TokenStore")<
  TokenStore,
  {
    readonly read: () => Effect.Effect<Option.Option<TokenSet>, TokenStoreError>
    readonly write: (tokens: TokenSet) => Effect.Effect<void, TokenStoreError>
  }
>() {}

export const make = Layer.effect(
  TokenStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const path = yield* Path
    const platform = yield* PlatformService
    const configDir = path.join(platform.homeDir, ".config", "termeeting")
    const tokenFile = path.join(configDir, "google-token.json")

    const ensureDir = (): Effect.Effect<void, TokenStoreError> =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(configDir).pipe(
          Effect.mapError((cause) =>
            new TokenStoreError({
              message: "Failed to check config directory existence",
              cause,
            })
          )
        )
        if (!exists) {
          yield* fs.makeDirectory(configDir, { recursive: true }).pipe(
            Effect.mapError((cause) =>
              new TokenStoreError({
                message: "Failed to create config directory",
                cause,
              })
            )
          )
        }
      })

    const read = (): Effect.Effect<Option.Option<TokenSet>, TokenStoreError> =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(tokenFile).pipe(
          Effect.mapError((cause) =>
            new TokenStoreError({
              message: "Failed to check token file existence",
              cause,
            })
          )
        )
        if (!exists) {
          return Option.none()
        }
        const content = yield* fs.readFileString(tokenFile).pipe(
          Effect.mapError((cause) =>
            new TokenStoreError({
              message: "Failed to read token file",
              cause,
            })
          )
        )
        const tokens = yield* Schema.decodeUnknown(
          Schema.parseJson(TokenSetSchema)
        )(content).pipe(
          Effect.mapError((cause) =>
            new TokenStoreError({
              message: "Invalid token file",
              cause,
            })
          )
        )
        return Option.some(tokens)
      })

    const write = (tokens: TokenSet): Effect.Effect<void, TokenStoreError> =>
      Effect.gen(function* () {
        yield* ensureDir()
        yield* fs.writeFileString(tokenFile, serializeTokens(tokens)).pipe(
          Effect.mapError((cause) =>
            new TokenStoreError({
              message: "Failed to write token file",
              cause,
            })
          )
        )
      })

    return { read, write } as const
  })
)

export const makeTest = (tokens?: TokenSet): Layer.Layer<TokenStore> =>
  Layer.succeed(TokenStore, {
    read: () =>
      Effect.succeed(tokens ? Option.some(tokens) : Option.none()),
    write: (_tokens: TokenSet) => Effect.void,
  })
