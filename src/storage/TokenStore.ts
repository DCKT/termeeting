import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"

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
    readonly read: (nickname: string) => Effect.Effect<Option.Option<TokenSet>, TokenStoreError>
    readonly write: (nickname: string, tokens: TokenSet) => Effect.Effect<void, TokenStoreError>
    readonly deleteToken: (nickname: string) => Effect.Effect<void, TokenStoreError>
  }
>() {}

export const make = Layer.effect(
  TokenStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const path = yield* Path
    const homeDir = yield* Config.string("HOME").pipe(Config.withDefault("/tmp"))
    const configDir = path.join(homeDir, ".config", "termeeting")
    const tokensDir = path.join(configDir, "tokens")

    const ensureDir = (dir: string): Effect.Effect<void, TokenStoreError> =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(dir).pipe(
          Effect.mapError((cause) =>
            new TokenStoreError({
              message: "Failed to check directory existence",
              cause,
            })
          )
        )
        if (!exists) {
          yield* fs.makeDirectory(dir, { recursive: true }).pipe(
            Effect.mapError((cause) =>
              new TokenStoreError({
                message: "Failed to create directory",
                cause,
              })
            )
          )
        }
      })

    const tokenFile = (nickname: string) =>
      path.join(tokensDir, `${nickname}.json`)

    const read = (nickname: string): Effect.Effect<Option.Option<TokenSet>, TokenStoreError> =>
      Effect.gen(function* () {
        const file = tokenFile(nickname)
        const exists = yield* fs.exists(file).pipe(
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
        const content = yield* fs.readFileString(file).pipe(
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

    const write = (nickname: string, tokens: TokenSet): Effect.Effect<void, TokenStoreError> =>
      Effect.gen(function* () {
        yield* ensureDir(tokensDir)
        yield* fs.writeFileString(tokenFile(nickname), serializeTokens(tokens)).pipe(
          Effect.mapError((cause) =>
            new TokenStoreError({
              message: "Failed to write token file",
              cause,
            })
          )
        )
      })

    const deleteToken = (nickname: string): Effect.Effect<void, TokenStoreError> =>
      Effect.gen(function* () {
        const file = tokenFile(nickname)
        const exists = yield* fs.exists(file).pipe(
          Effect.mapError((cause) =>
            new TokenStoreError({
              message: "Failed to check token file existence",
              cause,
            })
          )
        )
        if (exists) {
          yield* fs.remove(file).pipe(
            Effect.mapError((cause) =>
              new TokenStoreError({
                message: "Failed to delete token file",
                cause,
              })
            )
          )
        }
      })

    return { read, write, deleteToken } as const
  })
)

