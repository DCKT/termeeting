import { AccountStore, type Account } from "../../src/storage/AccountStore.js"
import { Effect, Layer, Option } from "effect"

export const makeTest = (accounts?: readonly Account[], defaultNickname?: string): Layer.Layer<AccountStore> =>
  Layer.succeed(AccountStore, {
    list: () => Effect.succeed(accounts ?? []),
    add: (_account: Account) => Effect.void,
    remove: (_nickname: string) => Effect.void,
    getDefault: () => Effect.succeed(defaultNickname ? Option.some(defaultNickname) : Option.none()),
    setDefault: (_nickname: string) => Effect.void,
  })
