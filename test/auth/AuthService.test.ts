import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { HttpClient } from "@effect/platform/HttpClient"
import { ConfigStore, ConfigStoreError } from "../../src/storage/ConfigStore.js"
import { TokenStore, TokenStoreError } from "../../src/storage/TokenStore.js"
import {
  AuthService,
  AuthError,
  AuthRetryableError,
  AuthFatalError,
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
  get: () => Effect.succeed({} as any),
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
  it.effect("returns access token when valid tokens exist", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const token = yield* auth.getAccessToken()
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
              read: () =>
                Effect.succeed(
                  Option.some({
                    accessToken: "valid-access-token",
                    refreshToken: "refresh",
                    expiry: new Date(Date.now() + 3600000).toISOString(),
                  })
                ),
              write: () => Effect.void,
            })
          )
        )
      )
    )
  )

  it.effect("refreshes tokens when expired", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const token = yield* auth.getAccessToken()
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
              get: () => Effect.succeed({} as any),
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
              read: () =>
                Effect.succeed(
                  Option.some({
                    accessToken: "expired-token",
                    refreshToken: "refresh-token",
                    expiry: new Date(Date.now() - 3600000).toISOString(),
                  })
                ),
              write: () => Effect.void,
            })
          ),
          Layer.provideMerge(mockPlatform)
        )
      )
    )
  )

  it.effect("fails when config is missing", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const error = yield* auth.getAccessToken().pipe(Effect.flip)
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
            })
          )
        )
      )
    )
  )

  it.effect("fails when config store errors", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const error = yield* auth.getAccessToken().pipe(Effect.flip)
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
            })
          )
        )
      )
    )
  )

  it.effect("fails when token store errors", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const error = yield* auth.getAccessToken().pipe(Effect.flip)
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
            })
          )
        )
      )
    )
  )

  it.effect("makeTest returns mock token", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const token = yield* auth.getAccessToken()
      expect(token).toBe("test-access-token")
    }).pipe(Effect.provide(makeTest("test-access-token")))
  )

  describe("authenticate", () => {
    it.effect("fails when config is missing", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService
        const error = yield* auth.authenticate().pipe(Effect.flip)
        expect(error).toBeInstanceOf(AuthFatalError)
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
              })
            )
          )
        )
      )
    )

    it.effect("fails when config store errors", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService
        const error = yield* auth.authenticate().pipe(Effect.flip)
        expect(error).toBeInstanceOf(AuthFatalError)
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
              })
            )
          )
        )
      )
    )

    it.effect("makeTest authenticate returns void", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService
        const result = yield* auth.authenticate()
        expect(result).toBeUndefined()
      }).pipe(Effect.provide(makeTest()))
    )
  })
})
