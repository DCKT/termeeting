import { TokenStore, type TokenSet } from "../../src/storage/TokenStore.js"
import { Effect, Layer, Option } from "effect"

export const makeTest = (tokensByNickname?: Record<string, TokenSet>): Layer.Layer<TokenStore> =>
  Layer.succeed(TokenStore, {
    read: (nickname: string) => {
      const tokens = tokensByNickname?.[nickname]
      return Effect.succeed(tokens ? Option.some(tokens) : Option.none())
    },
    write: (_nickname: string, _tokens: TokenSet) => Effect.void,
    deleteToken: (_nickname: string) => Effect.void,
  })
