import { HttpClient } from "@effect/platform/HttpClient"
import { post, bodyJson } from "@effect/platform/HttpClientRequest"
import { PlatformService } from "../platform/PlatformService.js"
import { ConfigStore } from "../storage/ConfigStore.js"
import { TokenStore, type TokenSet } from "../storage/TokenStore.js"
import {
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
  Console,
  Schedule,
} from "effect"

export class AuthError extends Schema.TaggedError<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export class AuthService extends Context.Tag("AuthService")<
  AuthService,
  {
    readonly getAccessToken: (nickname: string) => Effect.Effect<string, AuthError>
    readonly runDeviceFlow: (nickname: string) => Effect.Effect<TokenAndEmail, AuthError>
  }
>() {}

export interface TokenAndEmail {
  readonly tokens: TokenSet
  readonly email: string
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
const GOOGLE_CALENDAR_PRIMARY_URL = "https://www.googleapis.com/calendar/v3/calendars/primary"
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"

const TokenResponseSchema = Schema.Struct({
  refresh_token: Schema.optional(Schema.String),
  access_token: Schema.String,
  expires_in: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
})

type TokenResponse = typeof TokenResponseSchema.Type

export const make = Layer.effect(
  AuthService,
  Effect.gen(function* () {
    const configStore = yield* ConfigStore
    const tokenStore = yield* TokenStore
    const client = yield* HttpClient
    const platform = yield* PlatformService

    const parseTokenResponse = (
      raw: unknown,
    ): Effect.Effect<TokenResponse, AuthError> =>
      Schema.decodeUnknown(TokenResponseSchema)(raw).pipe(
        Effect.mapError(
          (cause) =>
            new AuthError({ message: "Failed to parse token response", cause }),
        ),
      )

    const makeTokenSet = (
      json: TokenResponse,
      existingRefreshToken?: string,
    ): Effect.Effect<TokenSet, AuthError> => {
      if (json.error) {
        return Effect.fail(
          new AuthError({
            message: `Token exchange failed: ${json.error} — ${json.error_description ?? ""}`,
          }),
        )
      }

      return Effect.gen(function* () {
        const nowMs = DateTime.toEpochMillis(DateTime.unsafeNow())
        const expiresIn = json.expires_in ?? 3599
        const expiryDate = DateTime.unsafeMake(
          nowMs + expiresIn * 1000 - 60000,
        )

        return {
          accessToken: json.access_token,
          refreshToken: json.refresh_token ?? existingRefreshToken ?? "",
          expiry: DateTime.formatIso(expiryDate),
        }
      })
    }

    const requestDeviceCode = (
      clientId: string,
    ): Effect.Effect<
      { deviceCode: string; userCode: string; verificationUrl: string; intervalSec: number },
      AuthError
    > =>
      Effect.gen(function* () {
        const request = yield* bodyJson(post(GOOGLE_DEVICE_CODE_URL), {
          client_id: clientId,
          scope: CALENDAR_SCOPE,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new AuthError({ message: "Failed to build device code request", cause }),
          ),
        )

        const rawResp = yield* client.execute(request).pipe(
          Effect.mapError(
            (cause) =>
              new AuthError({ message: "Device code request failed", cause }),
          ),
        )

        const raw = yield* rawResp.json.pipe(
          Effect.mapError(
            (cause) =>
              new AuthError({ message: "Failed to parse device code response", cause }),
          ),
        )

        if (typeof raw !== "object" || raw === null) {
          return yield* new AuthError({ message: "Invalid device code response: not an object" })
        }

        const obj = raw as Record<string, unknown>

        if (typeof obj.error === "string") {
          return yield* new AuthError({
            message: `Device code request failed: ${obj.error} — ${obj.error_description ?? ""}`,
          })
        }

        const deviceCode = obj.device_code
        const userCode = obj.user_code
        const verificationUrl = obj.verification_url
        const interval = obj.interval

        if (typeof deviceCode !== "string" || typeof userCode !== "string" || typeof verificationUrl !== "string") {
          return yield* new AuthError({
            message: "Invalid device code response: missing required fields",
          })
        }

        return {
          deviceCode,
          userCode,
          verificationUrl,
          intervalSec: typeof interval === "number" ? interval : 5,
        }
      })

    const checkPendingError = (
      raw: unknown,
    ): Effect.Effect<void, AuthError> =>
      Effect.gen(function* () {
        if (typeof raw !== "object" || raw === null) return
        const obj = raw as Record<string, unknown>
        const err = obj["error"]
        if (typeof err === "string") {
          const desc = typeof obj["error_description"] === "string" ? obj["error_description"] : ""
          if (err === "authorization_pending" || err === "slow_down") {
            return yield* new AuthError({ message: `${err}: ${desc}` })
          }
          if (err === "expired_token") {
            return yield* new AuthError({ message: "Device code expired. Please try again." })
          }
        }
      })

    const pollForTokens = (
      clientId: string,
      clientSecret: string,
      deviceCode: string,
    ): Effect.Effect<TokenSet, AuthError> => {
      const attempt = (): Effect.Effect<TokenSet, AuthError> =>
        Effect.gen(function* () {
          const request = yield* bodyJson(post(GOOGLE_TOKEN_URL), {
            client_id: clientId,
            client_secret: clientSecret,
            device_code: deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }).pipe(
            Effect.mapError(
              (cause) =>
                new AuthError({
                  message: "Failed to build token request",
                  cause,
                }),
            ),
          )

          const response = yield* client.execute(request).pipe(
            Effect.mapError(
              (cause) =>
                new AuthError({
                  message: "Token exchange request failed",
                  cause,
                }),
            ),
          )

          const raw = yield* response.json.pipe(
            Effect.mapError(
              (cause) =>
                new AuthError({
                  message: "Failed to parse token response",
                  cause,
                }),
            ),
          )

          yield* checkPendingError(raw)

          const json = yield* parseTokenResponse(raw)

          return yield* makeTokenSet(json)
        })

      return attempt().pipe(
        Effect.retry({
          schedule: Schedule.spaced("5 seconds"),
          while: (error) => {
            if (Schema.is(AuthError)(error)) {
              const msg = error.message
              return (
                msg.includes("authorization_pending") ||
                msg.includes("slow_down")
              )
            }
            return false
          },
        }),
        Effect.catchAll((error) => {
          if (Schema.is(AuthError)(error) && error.message.includes("expired_token")) {
            return Effect.fail(new AuthError({ message: "Device code expired. Please try again." }))
          }
          return Effect.fail(error)
        }),
      )
    }

    const resolveEmail = (
      accessToken: string,
    ): Effect.Effect<string, AuthError> =>
      Effect.gen(function* () {
        const response = yield* client
          .get(GOOGLE_CALENDAR_PRIMARY_URL, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          .pipe(
            Effect.mapError((cause) =>
              new AuthError({ message: "Failed to fetch calendar info", cause }),
            )
          )

        const raw = yield* response.json.pipe(
          Effect.mapError((cause) =>
            new AuthError({ message: "Failed to parse calendar info response", cause }),
          )
        )

        if (typeof raw !== "object" || raw === null) {
          return yield* new AuthError({ message: "Invalid calendar info response" })
        }

        const obj = raw as Record<string, unknown>
        const email = obj["id"]

        if (typeof email !== "string") {
          return yield* new AuthError({ message: "Could not resolve email from calendar info" })
        }

        return email
      })

    const refreshAccessToken = (
      clientId: string,
      clientSecret: string,
      refreshToken: string,
    ): Effect.Effect<TokenSet, AuthError> =>
      Effect.gen(function* () {
        const request = yield* bodyJson(post(GOOGLE_TOKEN_URL), {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }).pipe(
          Effect.mapError(
            (cause) =>
              new AuthError({
                message: "Failed to build refresh request",
                cause,
              }),
          ),
        )

        const response = yield* client.execute(request).pipe(
          Effect.mapError(
            (cause) =>
              new AuthError({
                message: "Token refresh request failed",
                cause,
              }),
          ),
        )

        const raw = yield* response.json.pipe(
          Effect.mapError(
            (cause) =>
              new AuthError({
                message: "Failed to parse refresh response",
                cause,
              }),
          ),
        )

        const json = yield* parseTokenResponse(raw)
        return yield* makeTokenSet(json, refreshToken)
      })

    const doDeviceFlow = (
      clientId: string,
      clientSecret: string,
    ): Effect.Effect<TokenSet, AuthError> =>
      Effect.gen(function* () {
        const { deviceCode, userCode, verificationUrl } =
          yield* requestDeviceCode(clientId)

        yield* Console.log("")
        yield* Console.log("━━━ Google Calendar Authorization ━━━")
        yield* Console.log("")
        yield* Console.log(`  1. Open: ${verificationUrl}`)
        yield* Console.log(`  2. Enter code: ${userCode}`)
        yield* Console.log("")

        yield* platform.openUrl(verificationUrl).pipe(
          Effect.catchAll(() =>
            Console.log("  (Browser could not be opened automatically)"),
          ),
        )

        yield* Console.log("  Waiting for authorization...")

        const tokens = yield* pollForTokens(clientId, clientSecret, deviceCode)

        yield* Console.log("  Authorization successful!")
        return tokens
      })

    const runDeviceFlow = (nickname: string): Effect.Effect<TokenAndEmail, AuthError> =>
      Effect.gen(function* () {
        const config = yield* configStore
          .read()
          .pipe(
            Effect.mapError(
              (cause) =>
                new AuthError({ message: "Failed to read config", cause }),
            ),
          )

        if (Option.isNone(config)) {
          return yield* new AuthError({
            message: "Not configured. Run 'termeeting setup' first.",
          })
        }

        const { clientId, clientSecret } = config.value

        const tokens = yield* doDeviceFlow(clientId, clientSecret)
        const email = yield* resolveEmail(tokens.accessToken)

        yield* tokenStore
          .write(nickname, tokens)
          .pipe(
            Effect.mapError(
              (cause) =>
                new AuthError({ message: "Failed to store tokens", cause }),
            ),
          )

        return { tokens, email }
      }).pipe(Effect.provideService(PlatformService, platform))

    const getAccessToken = (nickname: string): Effect.Effect<string, AuthError> =>
      Effect.gen(function* () {
        const config = yield* configStore
          .read()
          .pipe(
            Effect.mapError(
              (cause) =>
                new AuthError({ message: "Failed to read config", cause }),
            ),
          )

        if (Option.isNone(config)) {
          return yield* new AuthError({
            message: "Not configured. Run 'termeeting setup' first.",
          })
        }

        const { clientId, clientSecret } = config.value

        const tokens = yield* tokenStore
          .read(nickname)
          .pipe(
            Effect.mapError(
              (cause) =>
                new AuthError({ message: "Failed to read tokens", cause }),
            ),
          )

        if (Option.isSome(tokens)) {
          const nowMs = DateTime.toEpochMillis(DateTime.unsafeNow())
          const expiryMs = DateTime.toEpochMillis(
            DateTime.unsafeMake(tokens.value.expiry),
          )
          if (nowMs < expiryMs) {
            return tokens.value.accessToken
          }

          const freshTokens = yield* refreshAccessToken(
            clientId,
            clientSecret,
            tokens.value.refreshToken,
          )

          yield* tokenStore.write(nickname, freshTokens).pipe(
            Effect.mapError(
              (cause) =>
                new AuthError({
                  message: "Failed to store refreshed tokens",
                  cause,
                }),
            ),
          )

          return freshTokens.accessToken
        }

        const { tokens: newTokens } = yield* runDeviceFlow(nickname)

        return newTokens.accessToken
      }).pipe(Effect.provideService(PlatformService, platform))

    return { getAccessToken, runDeviceFlow } as const
  }),
)

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
