import { ConfigStore } from "../storage/ConfigStore.js"
import { TokenStore, TokenStoreError } from "../storage/TokenStore.js"
import { AccountStore, AccountStoreError } from "../storage/AccountStore.js"
import { PlatformService } from "../platform/PlatformService.js"
import { CalendarApi, type Event, type WorkingLocation } from "../calendar/CalendarApi.js"
import {
  AuthService,
} from "../auth/AuthService.js"
import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
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

const NICKNAME_RE = /^[a-zA-Z0-9_-]+$/

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

const formatEventsJson = (
  events: readonly Event[],
  workingLocations: readonly WorkingLocation[]
): string => {
  const result: Record<string, unknown> = {
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      ...(e.location ? { location: e.location } : {}),
      ...(e.description ? { description: e.description } : {}),
      ...(e.htmlLink ? { htmlLink: e.htmlLink } : {}),
      ...(e.conferenceLink ? { conferenceLink: e.conferenceLink } : {}),
    })),
  }
  if (workingLocations.length > 0) {
    result.workingLocations = workingLocations.map((wl) => ({
      id: wl.id,
      label: wl.label,
      start: wl.start,
      end: wl.end,
      type: wl.type,
    }))
  }
  return stringifyJson(result)
}

const formatEventsHuman = (
  events: readonly Event[],
  workingLocations: readonly WorkingLocation[],
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

  if (workingLocations.length > 0) {
    lines.push("")
    lines.push("📍 Working location")
    lines.push("─".repeat(40))
    for (const wl of workingLocations) {
      const start = formatTime(wl.start, timeZone)
      const end = formatTime(wl.end, timeZone)
      const timeRange = `${start}–${end}`
      lines.push(` ${timeRange}   ${wl.label}`)
    }
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

const parseDate = (
  dateStr: string,
  timeZone: string
): Effect.Effect<DateTime.DateTime, CliError> => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!parts) {
    return Effect.fail(
      new CliError({ message: `Invalid date: ${dateStr}. Use YYYY-MM-DD format.` })
    )
  }
  const [, y, m, d] = parts
  const year = parseInt(y!)
  const month = parseInt(m!)
  const day = parseInt(d!)

  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0)
  const offsetStr = getTimezoneOffset(utcMidnight, timeZone)
  const offsetMatch = offsetStr.match(/([+-])(\d{2}):(\d{2})/)
  if (!offsetMatch) {
    return Effect.fail(
      new CliError({ message: `Invalid date: ${dateStr}. Use YYYY-MM-DD format.` })
    )
  }
  const [, offsetSign, offsetHours, offsetMinutes] = offsetMatch
  const sign = offsetSign === "-" ? -1 : 1
  const offsetMs =
    sign * (parseInt(offsetHours!) * 3600000 + parseInt(offsetMinutes!) * 60000)

  const targetEpoch = utcMidnight - offsetMs
  const dtOpt = DateTime.make(targetEpoch)
  if (Option.isNone(dtOpt)) {
    return Effect.fail(
      new CliError({ message: `Invalid date: ${dateStr}. Use YYYY-MM-DD format.` })
    )
  }

  return Effect.succeed(DateTime.unsafeSetZoneNamed(dtOpt.value, timeZone))
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

export const make = (options?: {
  timeZone?: string
}) =>
  Layer.effect(
    CliService,
    Effect.gen(function* () {
      const calendarApi = yield* CalendarApi
      const configStore = yield* ConfigStore
      const tokenStore = yield* TokenStore
      const accountStore = yield* AccountStore
      const platform = yield* PlatformService
      const authService = yield* AuthService
      const timeZone =
        options?.timeZone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone

      const resolveNickname = (
        accountFlag: string | undefined,
      ): Effect.Effect<string, CliError> =>
        Effect.gen(function* () {
          if (accountFlag) {
            const accounts = yield* accountStore.list().pipe(
              Effect.mapError((cause: AccountStoreError) =>
                new CliError({ message: `Failed to list accounts: ${cause.message}` })
              )
            )
            const found = accounts.some((a) => a.nickname === accountFlag)
            if (!found) {
              const names = accounts.map((a) => a.nickname).join(", ")
              return yield* new CliError({
                message: `Unknown account '${accountFlag}'. Available: ${names}`,
              })
            }
            return accountFlag
          }

          const defaultNickname = yield* accountStore.getDefault().pipe(
            Effect.mapError((cause: AccountStoreError) =>
              new CliError({ message: `Failed to get default account: ${cause.message}` })
            )
          )

          if (Option.isNone(defaultNickname)) {
            const accounts = yield* accountStore.list().pipe(
              Effect.mapError((cause: AccountStoreError) =>
                new CliError({ message: `Failed to list accounts: ${cause.message}` })
              )
            )
            if (accounts.length === 0) {
              return yield* new CliError({
                message:
                  "No accounts configured. Run 'termeeting setup' to configure OAuth credentials, then 'termeeting account add <nickname>' to add an account.",
              })
            }
            return yield* new CliError({
              message: "No default account set. Use --account or set a default with 'termeeting account set-default <nickname>'.",
            })
          }

          return defaultNickname.value
        })

      const prompt = (question: string): Effect.Effect<string, CliError> =>
        platform.prompt(question).pipe(
          Effect.mapError(
            (cause) =>
              new CliError({ message: `Input error: ${cause.message}` })
          )
        )

      const fs = yield* FileSystem
      const pathUtil = yield* Path

      const migrateIfNeeded = (): Effect.Effect<void, CliError> =>
        Effect.gen(function* () {
          const accounts = yield* accountStore.list().pipe(
            Effect.mapError((cause: AccountStoreError) =>
              new CliError({ message: `Failed to check accounts: ${cause.message}` })
            )
          )
          if (accounts.length > 0) return

          const oldTokenFile = pathUtil.join(platform.homeDir, ".config", "termeeting", "google-token.json")

          const exists = yield* fs.exists(oldTokenFile).pipe(
            Effect.mapError(() => new CliError({ message: "Failed to check old token file" }))
          )
          if (!exists) return

          const content = yield* fs.readFileString(oldTokenFile).pipe(
            Effect.mapError(() => new CliError({ message: "Failed to read old token file" }))
          )

          const result = yield* Schema.decodeUnknown(
            Schema.parseJson(
              Schema.Struct({
                accessToken: Schema.String,
                refreshToken: Schema.String,
                expiry: Schema.String,
              })
            )
          )(content).pipe(
            Effect.mapError(() =>
              new CliError({ message: "Invalid legacy token file — please run 'termeeting setup' again." })
            )
          )

          yield* Console.log("")
          yield* Console.log("Detected legacy token file. Let's migrate to multi-account.")
          const nickname = yield* prompt("Nickname for this account (e.g., work): ")

          if (!NICKNAME_RE.test(nickname) || !nickname.trim()) {
            return yield* new CliError({
              message: "Invalid nickname. Use letters, numbers, hyphens, and underscores only.",
            })
          }

          yield* tokenStore.write(nickname.trim(), result).pipe(
            Effect.mapError((cause: TokenStoreError) =>
              new CliError({ message: `Failed to migrate tokens: ${cause.message}` })
            )
          )

          yield* fs.remove(oldTokenFile).pipe(
            Effect.catchAll(() => Effect.void)
          )

          yield* accountStore.add({
            nickname: nickname.trim(),
            email: "unknown",
          }).pipe(
            Effect.mapError((cause: AccountStoreError) =>
              new CliError({ message: `Failed to register account: ${cause.message}` })
            )
          )

          yield* Console.log(`Migration complete! Account '${nickname.trim()}' is ready.`)
        })

      const runEvents = (
        nickname: string,
        json: boolean,
        dateStr: string | undefined
      ): Effect.Effect<string, CliError> =>
        Effect.gen(function* () {
          const now = DateTime.unsafeNow()
          const targetDate = dateStr
            ? yield* parseDate(dateStr, timeZone)
            : now

          const dateLabel = formatDateLabel(targetDate, now, timeZone)
          const { timeMin, timeMax } = formatDateRange(targetDate, timeZone)

          const { events, workingLocations } = yield* calendarApi
            .getEvents(nickname, timeMin, timeMax, timeZone)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new CliError({
                    message: `Failed to fetch events: ${cause.message}`,
                  })
              )
            )

          if (json) {
            return formatEventsJson(events, workingLocations)
          }

          if (events.length === 0 && workingLocations.length === 0) {
            return `📅 ${dateLabel}\n\nNo events scheduled.`
          }

          return formatEventsHuman(events, workingLocations, dateLabel, timeZone)
        })

      const runNext = (nickname: string, json: boolean): Effect.Effect<string, CliError> =>
        Effect.gen(function* () {
          const now = DateTime.unsafeNow()
          const { timeMin, timeMax } = formatDateRange(now, timeZone)

          const { events } = yield* calendarApi
            .getEvents(nickname, timeMin, timeMax, timeZone)
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

              const nickname = "default"

              const result = yield* authService
                .runDeviceFlow(nickname)
                .pipe(Effect.either)

              if (Either.isRight(result)) {
                const { email } = result.right
                yield* accountStore
                  .add({ nickname, email })
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new CliError({
                          message: `Failed to save account: ${cause.message}`,
                        }),
                    ),
                  )
                return "Setup complete!\n\nYou're all set! Run 'termeeting' to view your events."
              }

              const error = result.left
              return yield* new CliError({
                message: `Setup failed: ${error.message}`,
              })
            })

          return yield* attempt()
        })

      const runAccountAdd = (nickname: string | undefined): Effect.Effect<string, CliError> =>
        Effect.gen(function* () {
          const config = yield* configStore.read().pipe(
            Effect.mapError((cause) =>
              new CliError({ message: `Failed to read config: ${cause.message}` })
            )
          )
          if (Option.isNone(config)) {
            return yield* new CliError({
              message: "Not configured. Run 'termeeting setup' first to configure OAuth credentials.",
            })
          }

          const nick = nickname ?? (yield* prompt("Account nickname (e.g., work): "))
          if (!NICKNAME_RE.test(nick) || !nick.trim()) {
            return yield* new CliError({
              message: "Invalid nickname. Use letters, numbers, hyphens, and underscores only.",
            })
          }

          const { email } = yield* authService.runDeviceFlow(nick.trim()).pipe(
            Effect.mapError((cause) =>
              new CliError({ message: `Authentication failed: ${cause.message}` })
            )
          )

          yield* accountStore.add({ nickname: nick.trim(), email }).pipe(
            Effect.mapError((cause) =>
              new CliError({ message: `Failed to save account: ${cause.message}` })
            )
          )

          return `Account '${nick.trim()}' (${email}) added successfully.`
        })

      const runAccountList = (json: boolean): Effect.Effect<string, CliError> =>
        Effect.gen(function* () {
          const accounts = yield* accountStore.list().pipe(
            Effect.mapError((cause) =>
              new CliError({ message: `Failed to list accounts: ${cause.message}` })
            )
          )

          if (accounts.length === 0) {
            return "No accounts configured."
          }

          if (json) {
            return stringifyJson(accounts)
          }

          const defaultNickname = yield* accountStore.getDefault().pipe(
            Effect.mapError((cause) =>
              new CliError({ message: `Failed to get default: ${cause.message}` })
            )
          )

          const lines: string[] = []
          for (const a of accounts) {
            const marker = Option.isSome(defaultNickname) && defaultNickname.value === a.nickname
              ? "  (default)"
              : ""
            lines.push(`  ${a.nickname}   ${a.email}${marker}`)
          }
          return lines.join("\n")
        })

      const runAccountRemove = (nickname: string | undefined): Effect.Effect<string, CliError> =>
        Effect.gen(function* () {
          if (!nickname) {
            return yield* new CliError({
              message: "Usage: termeeting account remove <nickname>",
            })
          }

          yield* accountStore.remove(nickname).pipe(
            Effect.mapError((cause) =>
              new CliError({ message: `Failed to remove account: ${cause.message}` })
            )
          )

          yield* tokenStore.deleteToken(nickname).pipe(
            Effect.mapError((cause) =>
              new CliError({ message: `Failed to remove token: ${cause.message}` })
            )
          )

          return `Account '${nickname}' removed.`
        })

      const runAccountSetDefault = (nickname: string | undefined): Effect.Effect<string, CliError> =>
        Effect.gen(function* () {
          if (!nickname) {
            return yield* new CliError({
              message: "Usage: termeeting account set-default <nickname>",
            })
          }

          yield* accountStore.setDefault(nickname).pipe(
            Effect.mapError((cause) =>
              new CliError({ message: `Failed to set default account: ${cause.message}` })
            )
          )

          return `Default account set to '${nickname}'.`
        })

      const runAccount = (args: readonly string[]): Effect.Effect<string, CliError> => {
        const sub = args[1]
        switch (sub) {
          case "add":
            return runAccountAdd(args[2])
          case "list":
            return runAccountList(args.includes("--json") || args.includes("-j"))
          case "remove":
            return runAccountRemove(args[2])
          case "set-default":
            return runAccountSetDefault(args[2])
          default:
            return Effect.fail(
              new CliError({
                message: `Unknown account command: '${sub}'. Available: add, list, remove, set-default.`,
              })
            )
        }
      }

      const extractAccountFlag = (args: readonly string[]): string | undefined => {
        const idx = args.findIndex((a) => a === "--account" || a === "-a")
        if (idx >= 0 && idx + 1 < args.length) {
          return args[idx + 1]
        }
        return undefined
      }

      const run = (args: readonly string[]): Effect.Effect<string, CliError> =>
        Effect.gen(function* () {
          yield* migrateIfNeeded()

          if (args[0] === "account") {
            return yield* runAccount(args)
          }

          if (args[0] === "setup") {
            return yield* runSetup()
          }

          const accountFlag = extractAccountFlag(args)
          const nickname = yield* resolveNickname(accountFlag)

          if (args[0] === "next") {
            const json = args.includes("--json") || args.includes("-j")
            return yield* runNext(nickname, json)
          }

          const json = args.includes("--json") || args.includes("-j")
          const dateIdx = args.findIndex(
            (a) => a === "--date" || a === "-d"
          )
          const dateStr =
            dateIdx >= 0 && dateIdx + 1 < args.length
              ? args[dateIdx + 1]
              : undefined

          return yield* runEvents(nickname, json, dateStr)
        })

      return { run } as const
    })
  )

export const makeTest = (output?: string): Layer.Layer<CliService> =>
  Layer.succeed(CliService, {
    run: () => Effect.succeed(output ?? "test output"),
  })
