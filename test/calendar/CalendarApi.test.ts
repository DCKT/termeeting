import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpClient } from "@effect/platform/HttpClient"
import { AuthService, AuthError } from "../../src/auth/AuthService.js"
import { CalendarApi, CalendarError, make, makeTest } from "../../src/calendar/CalendarApi.js"

const mockCalendarResponse = {
  items: [
    {
      id: "evt1",
      summary: "Standup",
      start: { dateTime: "2026-06-25T09:00:00+02:00" },
      end: { dateTime: "2026-06-25T09:30:00+02:00" },
      location: "Room 3",
      htmlLink: "https://calendar.google.com/evt1",
    },
    {
      id: "evt2",
      summary: "Design review",
      start: { dateTime: "2026-06-25T14:00:00+02:00" },
      end: { dateTime: "2026-06-25T15:00:00+02:00" },
      conferenceData: {
        entryPoints: [{ uri: "https://meet.google.com/abc-def" }],
      },
    },
  ],
}

describe("CalendarApi", () => {
  const authLayer = Layer.succeed(AuthService, {
    getAccessToken: () => Effect.succeed("test-token"),
  })

  it.effect("fetches and parses events", () =>
    Effect.gen(function* () {
      const api = yield* CalendarApi
      const events = yield* api.getEvents(
        "2026-06-25T00:00:00+02:00",
        "2026-06-26T00:00:00+02:00",
        "Europe/Paris"
      )

      expect(events.length).toBe(2)
      expect(events[0]?.title).toBe("Standup")
      expect(events[0]?.location).toBe("Room 3")
      expect(events[0]?.start).toBe("2026-06-25T09:00:00+02:00")

      expect(events[1]?.title).toBe("Design review")
      expect(events[1]?.conferenceLink).toBe("https://meet.google.com/abc-def")
    }).pipe(
      Effect.provide(
        make.pipe(
          Layer.provideMerge(authLayer),
          Layer.provideMerge(
            Layer.succeed(HttpClient, {
              execute: () =>
                Effect.succeed({
                  status: 200,
                  json: Effect.succeed(mockCalendarResponse),
                } as any),
              get: () =>
                Effect.succeed({
                  status: 200,
                  json: Effect.succeed(mockCalendarResponse),
                } as any),
              post: () => Effect.succeed({} as any),
              head: () => Effect.succeed({} as any),
              patch: () => Effect.succeed({} as any),
              put: () => Effect.succeed({} as any),
              del: () => Effect.succeed({} as any),
              options: () => Effect.succeed({} as any),
            } as any)
          )
        )
      )
    )
  )

  it.effect("returns empty array when no events", () =>
    Effect.gen(function* () {
      const api = yield* CalendarApi
      const events = yield* api.getEvents(
        "2026-06-25T00:00:00Z",
        "2026-06-26T00:00:00Z",
        "UTC"
      )
      expect(events.length).toBe(0)
    }).pipe(
      Effect.provide(
        make.pipe(
          Layer.provideMerge(authLayer),
          Layer.provideMerge(
            Layer.succeed(HttpClient, {
              execute: () => Effect.succeed({} as any),
              get: () =>
                Effect.succeed({
                  status: 200,
                  json: Effect.succeed({ items: [] }),
                } as any),
              post: () => Effect.succeed({} as any),
              head: () => Effect.succeed({} as any),
              patch: () => Effect.succeed({} as any),
              put: () => Effect.succeed({} as any),
              del: () => Effect.succeed({} as any),
              options: () => Effect.succeed({} as any),
            } as any)
          )
        )
      )
    )
  )

  it.effect("handles missing summary gracefully", () =>
    Effect.gen(function* () {
      const api = yield* CalendarApi
      const events = yield* api.getEvents(
        "2026-06-25T00:00:00Z",
        "2026-06-26T00:00:00Z",
        "UTC"
      )
      expect(events[0]?.title).toBe("(untitled)")
    }).pipe(
      Effect.provide(
        make.pipe(
          Layer.provideMerge(authLayer),
          Layer.provideMerge(
            Layer.succeed(HttpClient, {
              execute: () => Effect.succeed({} as any),
              get: () =>
                Effect.succeed({
                  status: 200,
                  json: Effect.succeed({
                    items: [
                      {
                        id: "evt1",
                        start: { dateTime: "2026-06-25T10:00:00Z" },
                        end: { dateTime: "2026-06-25T11:00:00Z" },
                      },
                    ],
                  }),
                } as any),
              post: () => Effect.succeed({} as any),
              head: () => Effect.succeed({} as any),
              patch: () => Effect.succeed({} as any),
              put: () => Effect.succeed({} as any),
              del: () => Effect.succeed({} as any),
              options: () => Effect.succeed({} as any),
            } as any)
          )
        )
      )
    )
  )

  it.effect("fails on API error", () =>
    Effect.gen(function* () {
      const api = yield* CalendarApi
      const error = yield* api
        .getEvents("2026-06-25T00:00:00Z", "2026-06-26T00:00:00Z", "UTC")
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(CalendarError)
      expect(error.message).toContain("Calendar API error")
    }).pipe(
      Effect.provide(
        make.pipe(
          Layer.provideMerge(authLayer),
          Layer.provideMerge(
            Layer.succeed(HttpClient, {
              execute: () => Effect.succeed({} as any),
              get: () =>
                Effect.succeed({
                  status: 200,
                  json: Effect.succeed({
                    error: { message: "Invalid request" },
                  }),
                } as any),
              post: () => Effect.succeed({} as any),
              head: () => Effect.succeed({} as any),
              patch: () => Effect.succeed({} as any),
              put: () => Effect.succeed({} as any),
              del: () => Effect.succeed({} as any),
              options: () => Effect.succeed({} as any),
            } as any)
          )
        )
      )
    )
  )

  it.effect("fails on auth error", () =>
    Effect.gen(function* () {
      const api = yield* CalendarApi
      const error = yield* api
        .getEvents("2026-06-25T00:00:00Z", "2026-06-26T00:00:00Z", "UTC")
        .pipe(Effect.flip)
      expect(error).toBeInstanceOf(CalendarError)
      expect(error.message).toContain("Authentication failed")
    }).pipe(
      Effect.provide(
        make.pipe(
          Layer.provideMerge(
            Layer.succeed(AuthService, {
              getAccessToken: () =>
                Effect.fail(new AuthError({ message: "test" })),
            })
          ),
          Layer.provideMerge(
            Layer.succeed(HttpClient, {
              execute: () => Effect.succeed({} as any),
              get: () => Effect.succeed({} as any),
              post: () => Effect.succeed({} as any),
              head: () => Effect.succeed({} as any),
              patch: () => Effect.succeed({} as any),
              put: () => Effect.succeed({} as any),
              del: () => Effect.succeed({} as any),
              options: () => Effect.succeed({} as any),
            } as any)
          )
        )
      )
    )
  )

  it.effect("makeTest returns mock events", () =>
    Effect.gen(function* () {
      const api = yield* CalendarApi
      const events = yield* api.getEvents("", "", "")
      expect(events.length).toBe(1)
      expect(events[0]?.title).toBe("Mock Event")
    }).pipe(
      Effect.provide(
        makeTest([{ id: "1", title: "Mock Event", start: "", end: "" }])
      )
    )
  )
})
