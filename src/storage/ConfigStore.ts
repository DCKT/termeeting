import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import { PlatformService } from "../platform/PlatformService.js"
import { Context, Effect, Layer, Option, Schema } from "effect"

const ConfigSchema = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.String,
})

const serializeConfig = Schema.encodeSync(
  Schema.parseJson(ConfigSchema)
)

export interface Config {
  readonly clientId: string
  readonly clientSecret: string
}

export class ConfigStoreError extends Schema.TaggedError<ConfigStoreError>()(
  "ConfigStoreError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

export class ConfigStore extends Context.Tag("ConfigStore")<
  ConfigStore,
  {
    readonly read: () => Effect.Effect<Option.Option<Config>, ConfigStoreError>
    readonly write: (config: Config) => Effect.Effect<void, ConfigStoreError>
  }
>() {}

export const make = Layer.effect(
  ConfigStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const path = yield* Path
    const platform = yield* PlatformService
    const configDir = path.join(platform.homeDir, ".config", "termeeting")
    const configFile = path.join(configDir, "config.json")

    const ensureDir = (): Effect.Effect<void, ConfigStoreError> =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(configDir).pipe(
          Effect.mapError((cause) =>
            new ConfigStoreError({
              message: "Failed to check config directory existence",
              cause,
            })
          )
        )
        if (!exists) {
          yield* fs.makeDirectory(configDir, { recursive: true }).pipe(
            Effect.mapError((cause) =>
              new ConfigStoreError({
                message: "Failed to create config directory",
                cause,
              })
            )
          )
        }
      })

    const read = (): Effect.Effect<Option.Option<Config>, ConfigStoreError> =>
      Effect.gen(function* () {
        const exists = yield* fs.exists(configFile).pipe(
          Effect.mapError((cause) =>
            new ConfigStoreError({
              message: "Failed to check config file existence",
              cause,
            })
          )
        )
        if (!exists) {
          return Option.none()
        }
        const content = yield* fs.readFileString(configFile).pipe(
          Effect.mapError((cause) =>
            new ConfigStoreError({
              message: "Failed to read config file",
              cause,
            })
          )
        )
        const config = yield* Schema.decodeUnknown(
          Schema.parseJson(ConfigSchema)
        )(content).pipe(
          Effect.mapError((cause) =>
            new ConfigStoreError({
              message: "Invalid config file",
              cause,
            })
          )
        )
        return Option.some(config)
      })

    const write = (config: Config): Effect.Effect<void, ConfigStoreError> =>
      Effect.gen(function* () {
        yield* ensureDir()
        yield* fs.writeFileString(configFile, serializeConfig(config)).pipe(
          Effect.mapError((cause) =>
            new ConfigStoreError({
              message: "Failed to write config file",
              cause,
            })
          )
        )
      })

    return { read, write } as const
  })
)

