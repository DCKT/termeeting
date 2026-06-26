import { ConfigStore, type Config } from "../../src/storage/ConfigStore.js"
import { Effect, Layer, Option } from "effect"

export const makeTest = (config?: Config): Layer.Layer<ConfigStore> =>
  Layer.succeed(ConfigStore, {
    read: () =>
      Effect.succeed(config ? Option.some(config) : Option.none()),
    write: (_config: Config) => Effect.void,
  })
