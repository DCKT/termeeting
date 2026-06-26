import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { ConfigStore } from "../../src/storage/ConfigStore.js"
import { PlatformService, makeTest as platformMakeTest } from "../../src/platform/PlatformService.js"
import { CalendarApi } from "../../src/calendar/CalendarApi.js"
import { AuthService, AuthRetryableError, AuthFatalError } from "../../src/auth/AuthService.js"
import { CliService, CliError, make, makeTest } from "../../src/cli/CliService.js"

const mockPlatform = platformMakeTest()

describe("CliService", () => {
  const mockCalendarApi = (events: any[] = []) =>
    Layer.succeed(CalendarApi, {
      getEvents: () => Effect.succeed(events),
    })

  const mockConfigStore = Layer.succeed(ConfigStore, {
    read: () => Effect.succeed(Option.none()),
    write: () => Effect.void,
  })

  const mockAuth = Layer.succeed(AuthService, {
    getAccessToken: () => Effect.succeed("token"),
    authenticate: () => Effect.void,
  })

  it.effect("prints no events message when calendar is empty", () =>
    Effect.gen(function* () {
      const cli = yield* CliService
      const output = yield* cli.run([])
      expect(output).toContain("No events scheduled")
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(mockCalendarApi([])),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(mockPlatform)
        )
      )
    )
  )

  it.effect("formats events in human-readable format", () =>
    Effect.gen(function* () {
      const cli = yield* CliService
      const output = yield* cli.run([])
      expect(output).toContain("Standup")
      expect(output).toContain("Room 3")
      expect(output).toContain("09:00")
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(
            Layer.succeed(CalendarApi, {
              getEvents: () =>
                Effect.succeed([
                  {
                    id: "1",
                    title: "Standup",
                    start: "2026-06-25T09:00:00Z",
                    end: "2026-06-25T09:30:00Z",
                    location: "Room 3",
                  },
                ]),
            })
          ),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(mockPlatform)
        )
      )
    )
  )

  it.effect("outputs JSON when --json flag is set", () =>
    Effect.gen(function* () {
      const cli = yield* CliService
      const output = yield* cli.run(["--json"])
      const parsed = JSON.parse(output)
      expect(parsed.length).toBe(1)
      expect(parsed[0].title).toBe("Standup")
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(
            Layer.succeed(CalendarApi, {
              getEvents: () =>
                Effect.succeed([
                  {
                    id: "1",
                    title: "Standup",
                    start: "2026-06-25T09:00:00Z",
                    end: "2026-06-25T10:00:00Z",
                  },
                ]),
            })
          ),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(mockPlatform)
        )      )
    )
  )

  it.effect("outputs JSON when -j flag is set", () =>
    Effect.gen(function* () {
      const cli = yield* CliService
      const output = yield* cli.run(["-j"])
      const parsed = JSON.parse(output)
      expect(Array.isArray(parsed)).toBe(true)
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(mockCalendarApi()),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(mockPlatform)
        )      )
    )
  )

  it.effect("filters by date when --date is provided", () =>
    Effect.gen(function* () {
      const cli = yield* CliService
      const output = yield* cli.run(["--date", "2026-06-30"])
      expect(output).toContain("June 30, 2026")
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(mockCalendarApi()),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(mockPlatform)
        )      )
    )
  )

  it.effect("rejects invalid date strings", () =>
    Effect.gen(function* () {
      const cli = yield* CliService
      const error = yield* cli.run(["--date", "not-a-date"]).pipe(
        Effect.flip
      )
      expect(error).toBeInstanceOf(CliError)
      expect(error.message).toContain("Invalid date")
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(mockCalendarApi()),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(mockPlatform)
        )      )
    )
  )

  it.effect("handles calendar API errors", () =>
    Effect.gen(function* () {
      const cli = yield* CliService
      const error = yield* cli.run([]).pipe(Effect.flip)
      expect(error.message).toContain("Failed to fetch events")
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(
            Layer.succeed(CalendarApi, {
              getEvents: () => Effect.fail({ message: "API down" }),
            })
          ),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(mockPlatform)
        )      )
    )
  )

  describe("setup", () => {
    const mockCalendar = Layer.succeed(CalendarApi, {
      getEvents: () => Effect.succeed([]),
    })

    const successAuth = Layer.succeed(AuthService, {
      getAccessToken: () => Effect.succeed("token"),
      authenticate: () => Effect.void,
    })

    it.effect("prompts for credentials and authenticates", () =>
      Effect.gen(function* () {
        const cli = yield* CliService
        const output = yield* cli.run(["setup"])
        expect(output).toContain("Setup complete")
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendar),
            Layer.provideMerge(
              Layer.succeed(ConfigStore, {
                read: () => Effect.succeed(Option.none()),
                write: () => Effect.void,
              })
            ),
            Layer.provideMerge(successAuth),
            Layer.provideMerge(
              platformMakeTest({
                prompt: () => Effect.succeed("test-id"),
              })
            )
          )
        )
      )
    )

    it.effect("rejects empty client ID", () =>
      Effect.gen(function* () {
        const cli = yield* CliService
        const error = yield* cli.run(["setup"]).pipe(Effect.flip)
        expect(error).toBeInstanceOf(CliError)
        expect(error.message).toContain("Client ID is required")
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendar),
            Layer.provideMerge(
              Layer.succeed(ConfigStore, {
                read: () => Effect.succeed(Option.none()),
                write: () => Effect.void,
              })
            ),
            Layer.provideMerge(successAuth),
            Layer.provideMerge(
              platformMakeTest({
                prompt: () => Effect.succeed(""),
              })
            )
          )
        )
      )
    )

    it.effect("rejects empty client secret", () => {
      let call = 0
      return Effect.gen(function* () {
        const cli = yield* CliService
        const error = yield* cli.run(["setup"]).pipe(Effect.flip)
        expect(error).toBeInstanceOf(CliError)
        expect(error.message).toContain("Client Secret is required")
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendar),
            Layer.provideMerge(
              Layer.succeed(ConfigStore, {
                read: () => Effect.succeed(Option.none()),
                write: () => Effect.void,
              })
            ),
            Layer.provideMerge(successAuth),
            Layer.provideMerge(
              platformMakeTest({
                prompt: () => {
                  call++
                  return call === 1
                    ? Effect.succeed("test-id")
                    : Effect.succeed("")
                },
              })
            )
          )
        )
      )
    })

    it.effect("retries on retryable auth error", () => {
      let authCalls = 0
      return Effect.gen(function* () {
        const cli = yield* CliService
        const output = yield* cli.run(["setup"])
        expect(output).toContain("Setup complete")
        expect(authCalls).toBe(2)
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendar),
            Layer.provideMerge(
              Layer.succeed(ConfigStore, {
                read: () => Effect.succeed(Option.none()),
                write: () => Effect.void,
              })
            ),
            Layer.provideMerge(
              Layer.succeed(AuthService, {
                getAccessToken: () => Effect.succeed("token"),
                authenticate: () => {
                  authCalls++
                  if (authCalls === 1) {
                    return Effect.fail(
                      new AuthRetryableError({
                        message: "invalid_client",
                      })
                    )
                  }
                  return Effect.void
                },
              })
            ),
            Layer.provideMerge(
              platformMakeTest({
                prompt: () => Effect.succeed("test-id"),
              })
            )
          )
        )
      )
    })

    it.effect("fails on fatal auth error", () =>
      Effect.gen(function* () {
        const cli = yield* CliService
        const error = yield* cli.run(["setup"]).pipe(Effect.flip)
        expect(error).toBeInstanceOf(CliError)
        expect(error.message).toContain("Setup failed")
        expect(error.message).toContain("Token exchange request failed")
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendar),
            Layer.provideMerge(
              Layer.succeed(ConfigStore, {
                read: () => Effect.succeed(Option.none()),
                write: () => Effect.void,
              })
            ),
            Layer.provideMerge(
              Layer.succeed(AuthService, {
                getAccessToken: () => Effect.succeed("token"),
                authenticate: () =>
                  Effect.fail(
                    new AuthFatalError({
                      message: "Token exchange request failed",
                    })
                  ),
              })
            ),
            Layer.provideMerge(
              platformMakeTest({
                prompt: () => Effect.succeed("test-id"),
              })
            )
          )
        )
      )
    )
  })
})
