import { ConfigStore } from "../storage/ConfigStore.js"
import { PlatformService } from "../platform/PlatformService.js"
import { CalendarApi, type Event } from "../calendar/CalendarApi.js"
import {
  AuthService,
} from "../auth/AuthService.js"
import { Context, DateTime, Effect, Either, Layer, Console, Option, Schema } from "effect"

export class CliError extends Schema.TaggedError<CliError>()(
  "CliError",
  {
    message: Schema.String,
  }
) {}

export class CliService extends Context.Tag("CliService")<
  CliService,
  {
    readonly run: (args: readonly string[]) => Effect.Effect<string, CliError>
  }
>() {}

const formatTime = (isoString: string, timeZone: string): string => {
  const dtOpt = DateTime.make(isoString)
  if (Option.isNone(dtOpt)) return "??:??"
  const zoned = DateTime.unsafeSetZoneNamed(dtOpt.value, timeZone)
  return DateTime.format(zoned, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

const formatDateLabel = (
  targetDate: DateTime.DateTime,
  now: DateTime.DateTime,
  timeZone: string
): string => {
  const targetZoned = DateTime.unsafeSetZoneNamed(targetDate, timeZone)
  const nowZoned = DateTime.unsafeSetZoneNamed(now, timeZone)
  const isToday =
    DateTime.formatIsoDate(targetZoned) === DateTime.formatIsoDate(nowZoned)

  const formatted = DateTime.format(targetZoned, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  return isToday ? `Today — ${formatted}` : formatted
}

const stringifyJson = (data: unknown): string =>
  JSON.stringify(Schema.encodeUnknownSync(Schema.Unknown)(data), null, 2)

const formatEventsJson = (events: readonly Event[]): string => {
  const output = events.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: e.description } : {}),
    ...(e.htmlLink ? { htmlLink: e.htmlLink } : {}),
    ...(e.conferenceLink ? { conferenceLink: e.conferenceLink } : {}),
  }))
  return stringifyJson(output)
}

const formatEventsHuman = (
  events: readonly Event[],
  dateLabel: string,
  timeZone: string
): string => {
  const lines: string[] = []
  lines.push(`📅 ${dateLabel}`)
  lines.push("─".repeat(40))

  for (const event of events) {
    const start = formatTime(event.start, timeZone)
    const end = formatTime(event.end, timeZone)
    const timeRange = `${start}–${end}`

    const detail = event.location ?? event.conferenceLink ?? ""

    const line = ` ${timeRange}   ${event.title}${detail ? `   ${detail}` : ""}`
    lines.push(line)
  }

  return lines.join("\n")
}

const formatNextEventHuman = (
  event: Event,
  timeZone: string
): string => {
  const now = DateTime.unsafeNow()
  const dateLabel = formatDateLabel(now, now, timeZone)
  const lines: string[] = []
  lines.push(`📅 Next — ${dateLabel}`)
  lines.push("─".repeat(40))

  const start = formatTime(event.start, timeZone)
  const end = formatTime(event.end, timeZone)
  const timeRange = `${start}–${end}`
  const detail = event.location ?? event.conferenceLink ?? ""

  lines.push(` ${timeRange}   ${event.title}${detail ? `   ${detail}` : ""}`)

  return lines.join("\n")
}

const parseDate = (dateStr: string): Effect.Effect<DateTime.DateTime, CliError> => {
  const dtOpt = DateTime.make(dateStr + "T00:00:00")
  if (Option.isNone(dtOpt)) {
    return Effect.fail(
      new CliError({ message: `Invalid date: ${dateStr}. Use YYYY-MM-DD format.` })
    )
  }
  return Effect.succeed(dtOpt.value)
}

const getTimezoneOffset = (epochMs: number, timeZone: string): string => {
  const parts = Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(epochMs)
  const tzPart = parts.find((p) => p.type === "timeZoneName")
  const raw = tzPart?.value ?? "GMT"
  return raw === "GMT" ? "+00:00" : raw.replace("GMT", "")
}

const formatTimestamp = (epochMs: number, timeZone: string): string => {
  const dateFmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const dateStr = dateFmt.format(epochMs)
  return `${dateStr}T00:00:00${getTimezoneOffset(epochMs, timeZone)}`
}

const formatDateRange = (
  date: DateTime.DateTime,
  timeZone: string
): { timeMin: string; timeMax: string } => {
  const timeMin = formatTimestamp(date.epochMillis, timeZone)
  const nextDay = DateTime.add(date, { days: 1 })
  const timeMax = formatTimestamp(nextDay.epochMillis, timeZone)
  return { timeMin, timeMax }
}

export const make = Layer.effect(
  CliService,
  Effect.gen(function* () {
    const calendarApi = yield* CalendarApi
    const configStore = yield* ConfigStore
    const platform = yield* PlatformService
    const authService = yield* AuthService

    const prompt = (question: string): Effect.Effect<string, CliError> =>
      platform.prompt(question).pipe(
        Effect.mapError(
          (cause) =>
            new CliError({ message: `Input error: ${cause.message}` })
        )
      )

    const runEvents = (
      json: boolean,
      dateStr: string | undefined
    ): Effect.Effect<string, CliError> =>
      Effect.gen(function* () {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const now = DateTime.unsafeNow()
        const targetDate = dateStr
          ? yield* parseDate(dateStr)
          : now

        const dateLabel = formatDateLabel(targetDate, now, timeZone)
        const { timeMin, timeMax } = formatDateRange(targetDate, timeZone)

        const events = yield* calendarApi
          .getEvents(timeMin, timeMax, timeZone)
          .pipe(
            Effect.mapError(
              (cause) =>
                new CliError({
                  message: `Failed to fetch events: ${cause.message}`,
                })
            )
          )

        if (json) {
          return formatEventsJson(events)
        }

        if (events.length === 0) {
          return `📅 ${dateLabel}\n\nNo events scheduled.`
        }

        return formatEventsHuman(events, dateLabel, timeZone)
      })

    const runNext = (json: boolean): Effect.Effect<string, CliError> =>
      Effect.gen(function* () {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const now = DateTime.unsafeNow()
        const { timeMin, timeMax } = formatDateRange(now, timeZone)

        const events = yield* calendarApi
          .getEvents(timeMin, timeMax, timeZone)
          .pipe(
            Effect.mapError(
              (cause) =>
                new CliError({
                  message: `Failed to fetch events: ${cause.message}`,
                })
            )
          )

        const upcoming = events.filter((e) => {
          const endOpt = DateTime.make(e.end)
          if (Option.isNone(endOpt)) return false
          return endOpt.value.epochMillis > now.epochMillis
        })

        const next = upcoming[0]
        if (!next) {
          return "No upcoming events today."
        }

        if (json) {
          return stringifyJson({
            id: next.id,
            title: next.title,
            start: next.start,
            end: next.end,
            ...(next.location ? { location: next.location } : {}),
            ...(next.description ? { description: next.description } : {}),
            ...(next.htmlLink ? { htmlLink: next.htmlLink } : {}),
            ...(next.conferenceLink ? { conferenceLink: next.conferenceLink } : {}),
          })
        }

        return formatNextEventHuman(next, timeZone)
      })

    const runSetup = (): Effect.Effect<string, CliError> =>
      Effect.gen(function* () {
        yield* Console.log("Termeeting — Google OAuth Setup")
        yield* Console.log("")

        const attempt = (): Effect.Effect<string, CliError> =>
          Effect.gen(function* () {
            const clientId = yield* prompt("Google OAuth Client ID: ")
            if (!clientId.trim()) {
              return yield* new CliError({
                message: "Client ID is required.",
              })
            }

            const clientSecret = yield* prompt(
              "Google OAuth Client Secret: ",
            )
            if (!clientSecret.trim()) {
              return yield* new CliError({
                message: "Client Secret is required.",
              })
            }

            yield* configStore
              .write({
                clientId: clientId.trim(),
                clientSecret: clientSecret.trim(),
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new CliError({
                      message: `Failed to save config: ${cause.message}`,
                    }),
                ),
              )

            const result = yield* authService
              .authenticate()
              .pipe(Effect.either)

            if (Either.isRight(result)) {
              return "Setup complete!\n\nYou're all set! Run 'termeeting' to view your events."
            }

            const error = result.left
            if (error._tag === "AuthRetryableError") {
              yield* Console.log("")
              yield* Console.log(
                `Authentication failed: ${error.message}`,
              )
              yield* Console.log(
                "Please check your credentials and try again.\n",
              )
              return yield* attempt()
            }

            return yield* new CliError({
              message: `Setup failed: ${error.message}`,
            })
          })

        return yield* attempt()
      })

    const run = (args: readonly string[]): Effect.Effect<string, CliError> =>
      Effect.gen(function* () {
        if (args[0] === "setup") {
          return yield* runSetup()
        }

        if (args[0] === "next") {
          const json = args.includes("--json") || args.includes("-j")
          return yield* runNext(json)
        }

        const json = args.includes("--json") || args.includes("-j")
        const dateIdx = args.findIndex(
          (a) => a === "--date" || a === "-d"
        )
        const dateStr =
          dateIdx >= 0 && dateIdx + 1 < args.length
            ? args[dateIdx + 1]
            : undefined

        return yield* runEvents(json, dateStr)
      })

    return { run } as const
  })
)

export const makeTest = (output?: string): Layer.Layer<CliService> =>
  Layer.succeed(CliService, {
    run: () => Effect.succeed(output ?? "test output"),
  })
