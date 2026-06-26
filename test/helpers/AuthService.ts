import { AuthService } from "../../src/auth/AuthService.js"
import { Effect, Layer } from "effect"

export const makeTest = (accessToken?: string): Layer.Layer<AuthService> =>
  Layer.succeed(AuthService, {
    getAccessToken: (_nickname: string) => Effect.succeed(accessToken ?? "test-access-token"),
    runDeviceFlow: (_nickname: string) =>
      Effect.succeed({
        tokens: {
          accessToken: accessToken ?? "test-access-token",
          refreshToken: "test-refresh",
          expiry: new Date(Date.now() + 3600000).toISOString(),
        },
        email: "test@example.com",
      }),
  })
