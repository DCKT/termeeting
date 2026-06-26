import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import { PlatformService } from "../platform/PlatformService.js"
import { Context, Effect, Layer, Option, Schema } from "effect"

const AccountSchema = Schema.Struct({
  nickname: Schema.String,
  email: Schema.String,
})

const RegistrySchema = Schema.Struct({
  accounts: Schema.Array(AccountSchema),
  default: Schema.optional(Schema.String),
})

const serializeRegistry = Schema.encodeSync(
  Schema.parseJson(RegistrySchema)
)

export interface Account {
  readonly nickname: string
  readonly email: string
}

export class AccountStoreError extends Schema.TaggedError<AccountStoreError>()(
  "AccountStoreError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

export class AccountStore extends Context.Tag("AccountStore")<
  AccountStore,
  {
    readonly list: () => Effect.Effect<readonly Account[], AccountStoreError>
    readonly add: (account: Account) => Effect.Effect<void, AccountStoreError>
    readonly remove: (nickname: string) => Effect.Effect<void, AccountStoreError>
    readonly getDefault: () => Effect.Effect<Option.Option<string>, AccountStoreError>
    readonly setDefault: (nickname: string) => Effect.Effect<void, AccountStoreError>
  }
>() {}

export const make = Layer.effect(
  AccountStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const path = yield* Path
    const platform = yield* PlatformService
    const configDir = path.join(platform.homeDir, ".config", "termeeting")
    const registryFile = path.join(configDir, "accounts.json")

    const ensureDir = (): Effect.Effect<void, AccountStoreError> =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(configDir).pipe(
          Effect.mapError((cause) =>
            new AccountStoreError({
              message: "Failed to check config directory existence",
              cause,
            })
          )
        )
        if (!exists) {
          yield* fs.makeDirectory(configDir, { recursive: true }).pipe(
            Effect.mapError((cause) =>
              new AccountStoreError({
                message: "Failed to create config directory",
                cause,
              })
            )
          )
        }
      })

    const readRegistry = (): Effect.Effect<{
      accounts: readonly Account[]
      default: string | undefined
    }, AccountStoreError> =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(registryFile).pipe(
          Effect.mapError((cause) =>
            new AccountStoreError({
              message: "Failed to check registry file existence",
              cause,
            })
          )
        )
        if (!exists) {
          return { accounts: [] as readonly Account[], default: undefined }
        }
        const content = yield* fs.readFileString(registryFile).pipe(
          Effect.mapError((cause) =>
            new AccountStoreError({
              message: "Failed to read registry file",
              cause,
            })
          )
        )
        const data = yield* Schema.decodeUnknown(
          Schema.parseJson(RegistrySchema)
        )(content).pipe(
          Effect.mapError((cause) =>
            new AccountStoreError({
              message: "Invalid registry file",
              cause,
            })
          )
        )
        return { accounts: data.accounts, default: data.default }
      })

    const writeRegistry = (accounts: readonly Account[], defaultNickname: string | undefined): Effect.Effect<void, AccountStoreError> =>
      Effect.gen(function* () {
        yield* ensureDir()
        yield* fs.writeFileString(
          registryFile,
          serializeRegistry({ accounts: accounts as Account[], default: defaultNickname })
        ).pipe(
          Effect.mapError((cause) =>
            new AccountStoreError({
              message: "Failed to write registry file",
              cause,
            })
          )
        )
      })

    const list = (): Effect.Effect<readonly Account[], AccountStoreError> =>
      Effect.gen(function* () {
        const { accounts } = yield* readRegistry()
        return accounts
      })

    const add = (account: Account): Effect.Effect<void, AccountStoreError> =>
      Effect.gen(function* () {
        const { accounts, default: def } = yield* readRegistry()
        const exists = accounts.some((a) => a.nickname === account.nickname)
        if (exists) {
          return yield* new AccountStoreError({
            message: `Account '${account.nickname}' already exists.`,
          })
        }
        const updated = [...accounts, account]
        const newDefault = accounts.length === 0 ? account.nickname : def
        yield* writeRegistry(updated, newDefault)
      })

    const remove = (nickname: string): Effect.Effect<void, AccountStoreError> =>
      Effect.gen(function* () {
        const { accounts, default: def } = yield* readRegistry()
        const filtered = accounts.filter((a) => a.nickname !== nickname)
        if (filtered.length === accounts.length) {
          return yield* new AccountStoreError({
            message: `Account '${nickname}' not found.`,
          })
        }
        const newDefault = def === nickname ? undefined : def
        yield* writeRegistry(filtered, newDefault)
      })

    const getDefault = (): Effect.Effect<Option.Option<string>, AccountStoreError> =>
      Effect.gen(function* () {
        const { default: def } = yield* readRegistry()
        return def ? Option.some(def) : Option.none()
      })

    const setDefault = (nickname: string): Effect.Effect<void, AccountStoreError> =>
      Effect.gen(function* () {
        const { accounts } = yield* readRegistry()
        const found = accounts.some((a) => a.nickname === nickname)
        if (!found) {
          return yield* new AccountStoreError({
            message: `Account '${nickname}' not found.`,
          })
        }
        yield* writeRegistry(accounts, nickname)
      })

    return { list, add, remove, getDefault, setDefault } as const
  })
)

export const makeTest = (accounts?: readonly Account[], defaultNickname?: string): Layer.Layer<AccountStore> =>
  Layer.succeed(AccountStore, {
    list: () => Effect.succeed(accounts ?? []),
    add: (_account: Account) => Effect.void,
    remove: (_nickname: string) => Effect.void,
    getDefault: () => Effect.succeed(defaultNickname ? Option.some(defaultNickname) : Option.none()),
    setDefault: (_nickname: string) => Effect.void,
  })
