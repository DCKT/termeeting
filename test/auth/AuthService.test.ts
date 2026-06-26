import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { HttpClient } from "@effect/platform/HttpClient"
import { ConfigStore, ConfigStoreError } from "../../src/storage/ConfigStore.js"
import { TokenStore, TokenStoreError } from "../../src/storage/TokenStore.js"
import {
  AuthService,
  AuthError,
  make,
  makeTest,
} from "../../src/auth/AuthService.js"
import { PlatformService, makeTest as platformMakeTest } from "../../src/platform/PlatformService.js"

const mockPlatform = platformMakeTest()

const mockHttpClient = Layer.succeed(HttpClient, {
  execute: () =>
    Effect.succeed({
      status: 200,
      json: Effect.succeed({}),
    } as any),
  get: () =>
    Effect.succeed({
      status: 200,
      json: Effect.succeed({}),
    } as any),
  post: () => Effect.succeed({} as any),
  head: () => Effect.succeed({} as any),
  patch: () => Effect.succeed({} as any),
  put: () => Effect.succeed({} as any),
  del: () => Effect.succeed({} as any),
  options: () => Effect.succeed({} as any),
} as any)

const baseLayer = make.pipe(
  Layer.provideMerge(mockHttpClient),
  Layer.provideMerge(mockPlatform)
)

describe("AuthService", () => {
  it.effect("getAccessToken returns token when valid tokens exist", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const token = yield* auth.getAccessToken("work")
      expect(token).toBe("valid-access-token")
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            Layer.succeed(ConfigStore, {
              read: () =>
                Effect.succeed(
                  Option.some({ clientId: "id", clientSecret: "secret" })
                ),
              write: () => Effect.void,
            })
          ),
          Layer.provideMerge(
            Layer.succeed(TokenStore, {
              read: (_nickname: string) =>
                Effect.succeed(
                  Option.some({
                    accessToken: "valid-access-token",
                    refreshToken: "refresh",
                    expiry: new Date(Date.now() + 3600000).toISOString(),
                  })
                ),
              write: () => Effect.void,
              deleteToken: () => Effect.void,
            })
          )
        )
      )
    )
  )

  it.effect("refreshes tokens when expired", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const token = yield* auth.getAccessToken("work")
      expect(token).toBe("refreshed-token")
    }).pipe(
      Effect.provide(
        make.pipe(
          Layer.provideMerge(
            Layer.succeed(HttpClient, {
              execute: () =>
                Effect.succeed({
                  status: 200,
                  json: Effect.succeed({
                    access_token: "refreshed-token",
                    expires_in: 3600,
                    refresh_token: "new-refresh",
                  }),
                } as any),
              get: () =>
                Effect.succeed({
                  status: 200,
                  json: Effect.succeed({ id: "test@example.com" }),
                } as any),
              post: () => Effect.succeed({} as any),
              head: () => Effect.succeed({} as any),
              patch: () => Effect.succeed({} as any),
              put: () => Effect.succeed({} as any),
              del: () => Effect.succeed({} as any),
              options: () => Effect.succeed({} as any),
            } as any)
          ),
          Layer.provideMerge(
            Layer.succeed(ConfigStore, {
              read: () =>
                Effect.succeed(
                  Option.some({ clientId: "id", clientSecret: "secret" })
                ),
              write: () => Effect.void,
            })
          ),
          Layer.provideMerge(
            Layer.succeed(TokenStore, {
              read: (_nickname: string) =>
                Effect.succeed(
                  Option.some({
                    accessToken: "expired-token",
                    refreshToken: "refresh-token",
                    expiry: new Date(Date.now() - 3600000).toISOString(),
                  })
                ),
              write: () => Effect.void,
              deleteToken: () => Effect.void,
            })
          ),
          Layer.provideMerge(mockPlatform)
        )
      )
    )
  )

  it.effect("getAccessToken fails when config is missing", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const error = yield* auth.getAccessToken("work").pipe(Effect.flip)
      expect(error).toBeInstanceOf(AuthError)
      expect(error.message).toContain("Not configured")
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            Layer.succeed(ConfigStore, {
              read: () => Effect.succeed(Option.none()),
              write: () => Effect.void,
            })
          ),
          Layer.provideMerge(
            Layer.succeed(TokenStore, {
              read: () => Effect.succeed(Option.none()),
              write: () => Effect.void,
              deleteToken: () => Effect.void,
            })
          )
        )
      )
    )
  )

  it.effect("getAccessToken fails when config store errors", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const error = yield* auth.getAccessToken("work").pipe(Effect.flip)
      expect(error).toBeInstanceOf(AuthError)
      expect(error.message).toContain("Failed to read config")
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            Layer.succeed(ConfigStore, {
              read: () =>
                Effect.fail(
                  new ConfigStoreError({ message: "disk failure" })
                ),
              write: () => Effect.void,
            })
          ),
          Layer.provideMerge(
            Layer.succeed(TokenStore, {
              read: () => Effect.succeed(Option.none()),
              write: () => Effect.void,
              deleteToken: () => Effect.void,
            })
          )
        )
      )
    )
  )

  it.effect("getAccessToken fails when token store errors", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const error = yield* auth.getAccessToken("work").pipe(Effect.flip)
      expect(error).toBeInstanceOf(AuthError)
      expect(error.message).toContain("Failed to read tokens")
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            Layer.succeed(ConfigStore, {
              read: () =>
                Effect.succeed(
                  Option.some({ clientId: "id", clientSecret: "secret" })
                ),
              write: () => Effect.void,
            })
          ),
          Layer.provideMerge(
            Layer.succeed(TokenStore, {
              read: () =>
                Effect.fail(
                  new TokenStoreError({ message: "disk failure" })
                ),
              write: () => Effect.void,
              deleteToken: () => Effect.void,
            })
          )
        )
      )
    )
  )

  it.effect("makeTest returns mock token", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const token = yield* auth.getAccessToken("any")
      expect(token).toBe("test-access-token")
    }).pipe(Effect.provide(makeTest("test-access-token")))
  )
})
