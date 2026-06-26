import { HttpClient } from "@effect/platform/HttpClient"
import { AuthService } from "../auth/AuthService.js"
import { Context, Effect, Layer, Schema } from "effect"

export interface Event {
  readonly id: string
  readonly title: string
  readonly start: string
  readonly end: string
  readonly location: string | undefined
  readonly description: string | undefined
  readonly htmlLink: string | undefined
  readonly conferenceLink: string | undefined
}

export class CalendarError extends Schema.TaggedError<CalendarError>()(
  "CalendarError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

export class CalendarApi extends Context.Tag("CalendarApi")<
  CalendarApi,
  {
    readonly getEvents: (
      timeMin: string,
      timeMax: string,
      timeZone: string
    ) => Effect.Effect<readonly Event[], CalendarError>
  }
>() {}

const GoogleCalendarEventSchema = Schema.Struct({
  id: Schema.String,
  summary: Schema.optional(Schema.String),
  start: Schema.Struct({
    dateTime: Schema.optional(Schema.String),
    date: Schema.optional(Schema.String),
  }),
  end: Schema.Struct({
    dateTime: Schema.optional(Schema.String),
    date: Schema.optional(Schema.String),
  }),
  location: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  htmlLink: Schema.optional(Schema.String),
  conferenceData: Schema.optional(Schema.Struct({
    entryPoints: Schema.optional(Schema.Array(Schema.Struct({
      uri: Schema.optional(Schema.String),
    }))),
  })),
})

const GoogleCalendarResponseSchema = Schema.Struct({
  items: Schema.optional(Schema.Array(GoogleCalendarEventSchema)),
  error: Schema.optional(Schema.Struct({
    message: Schema.String,
  })),
})

type GoogleCalendarEvent = typeof GoogleCalendarEventSchema.Type

const parseEvent = (raw: GoogleCalendarEvent): Event => {
  const conferenceLink =
    raw.conferenceData?.entryPoints?.[0]?.uri

  return {
    id: raw.id,
    title: raw.summary ?? "(untitled)",
    start: raw.start.dateTime ?? raw.start.date ?? "",
    end: raw.end.dateTime ?? raw.end.date ?? "",
    location: raw.location,
    description: raw.description,
    htmlLink: raw.htmlLink,
    conferenceLink,
  }
}

export const make = Layer.effect(
  CalendarApi,
  Effect.gen(function* () {
    const auth = yield* AuthService
    const client = yield* HttpClient

    const getEvents = (
      timeMin: string,
      timeMax: string,
      timeZone: string
    ): Effect.Effect<readonly Event[], CalendarError> =>
      Effect.gen(function* () {
        const accessToken = yield* auth.getAccessToken().pipe(
          Effect.mapError((cause) =>
            new CalendarError({
              message: "Authentication failed",
              cause,
            })
          )
        )

        const response = yield* client
          .get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            {
              urlParams: {
                timeMin,
                timeMax,
                timeZone,
                singleEvents: "true",
                orderBy: "startTime",
              },
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            }
          )
          .pipe(
            Effect.mapError((cause) =>
              new CalendarError({
                message: "Failed to fetch calendar events",
                cause,
              })
            )
          )

        const raw = yield* response.json.pipe(
          Effect.mapError((cause) =>
            new CalendarError({
              message: "Failed to parse response",
              cause,
            })
          )
        )

        const json = yield* Schema.decodeUnknown(GoogleCalendarResponseSchema)(raw).pipe(
          Effect.mapError((cause) =>
            new CalendarError({
              message: "Invalid response format",
              cause,
            })
          )
        )

        if (json.error) {
          return yield* new CalendarError({
            message: `Calendar API error: ${json.error.message}`,
          })
        }

        return (json.items ?? []).map(parseEvent)
      })

    return { getEvents } as const
  })
)

export const makeTest = (events?: readonly Event[]): Layer.Layer<CalendarApi> =>
  Layer.succeed(CalendarApi, {
    getEvents: () => Effect.succeed(events ?? []),
  })
