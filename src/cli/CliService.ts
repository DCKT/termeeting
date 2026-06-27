import { Command, Args, Options, Prompt } from "@effect/cli";
import { ConfigStore } from "../storage/ConfigStore.js";
import { TokenStore } from "../storage/TokenStore.js";
import { AccountStore, AccountStoreError } from "../storage/AccountStore.js";
import {
  CalendarApi,
  type Event,
  type WorkingLocation,
} from "../calendar/CalendarApi.js";
import { AuthService } from "../auth/AuthService.js";
import {
  Context,
  DateTime,
  Effect,
  Either,
  Layer,
  Console,
  Option,
  Redacted,
  Schema,
} from "effect";

export class CliError extends Schema.TaggedError<CliError>()("CliError", {
  message: Schema.String,
}) {}

export class CliService extends Context.Tag("CliService")<
  CliService,
  {
    readonly command: Command.Command<any, any, any, any>;
  }
>() {}

const NICKNAME_RE = /^[a-zA-Z0-9_-]+$/;

const formatTime = (isoString: string, timeZone: string): string => {
  const dtOpt = DateTime.make(isoString);
  if (Option.isNone(dtOpt)) return "??:??";
  const zoned = DateTime.unsafeSetZoneNamed(dtOpt.value, timeZone);
  return DateTime.format(zoned, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const formatDateLabel = (
  targetDate: DateTime.DateTime,
  now: DateTime.DateTime,
  timeZone: string,
): string => {
  const targetZoned = DateTime.unsafeSetZoneNamed(targetDate, timeZone);
  const nowZoned = DateTime.unsafeSetZoneNamed(now, timeZone);
  const isToday =
    DateTime.formatIsoDate(targetZoned) === DateTime.formatIsoDate(nowZoned);

  const formatted = DateTime.format(targetZoned, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return isToday ? `Today — ${formatted}` : formatted;
};

const stringifyJson = (data: unknown): string =>
  JSON.stringify(Schema.encodeUnknownSync(Schema.Unknown)(data), null, 2);

const formatEventsJson = (
  events: readonly Event[],
  workingLocations: readonly WorkingLocation[],
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
  };
  if (workingLocations.length > 0) {
    result.workingLocations = workingLocations.map((wl) => ({
      id: wl.id,
      label: wl.label,
      start: wl.start,
      end: wl.end,
      type: wl.type,
    }));
  }
  return stringifyJson(result);
};

const formatEventsHuman = (
  events: readonly Event[],
  workingLocations: readonly WorkingLocation[],
  dateLabel: string,
  timeZone: string,
): string => {
  const lines: string[] = [];
  lines.push(`📅 ${dateLabel}`);
  lines.push("─".repeat(40));

  for (const event of events) {
    const start = formatTime(event.start, timeZone);
    const end = formatTime(event.end, timeZone);
    const timeRange = `${start}–${end}`;

    const detail = event.location ?? event.conferenceLink ?? "";

    const line = ` ${timeRange}   ${event.title}${detail ? `   ${detail}` : ""}`;
    lines.push(line);
  }

  if (workingLocations.length > 0) {
    lines.push("");
    lines.push("📍 Working location");
    lines.push("─".repeat(40));
    for (const wl of workingLocations) {
      const start = formatTime(wl.start, timeZone);
      const end = formatTime(wl.end, timeZone);
      const timeRange = `${start}–${end}`;
      lines.push(` ${timeRange}   ${wl.label}`);
    }
  }

  return lines.join("\n");
};

const formatNextEventHuman = (event: Event, timeZone: string): string => {
  const now = DateTime.unsafeNow();
  const dateLabel = formatDateLabel(now, now, timeZone);
  const lines: string[] = [];
  lines.push(`📅 Next — ${dateLabel}`);
  lines.push("─".repeat(40));

  const start = formatTime(event.start, timeZone);
  const end = formatTime(event.end, timeZone);
  const timeRange = `${start}–${end}`;
  const detail = event.location ?? event.conferenceLink ?? "";

  lines.push(` ${timeRange}   ${event.title}${detail ? `   ${detail}` : ""}`);

  return lines.join("\n");
};

const parseDate = (
  dateStr: string,
  timeZone: string,
): Effect.Effect<DateTime.DateTime, CliError> => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!parts) {
    return Effect.fail(
      new CliError({
        message: `Invalid date: ${dateStr}. Use YYYY-MM-DD format.`,
      }),
    );
  }
  const [, y, m, d] = parts;
  const year = parseInt(y!);
  const month = parseInt(m!);
  const day = parseInt(d!);

  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offsetStr = getTimezoneOffset(utcMidnight, timeZone);
  const offsetMatch = offsetStr.match(/([+-])(\d{2}):(\d{2})/);
  if (!offsetMatch) {
    return Effect.fail(
      new CliError({
        message: `Invalid date: ${dateStr}. Use YYYY-MM-DD format.`,
      }),
    );
  }
  const [, offsetSign, offsetHours, offsetMinutes] = offsetMatch;
  const sign = offsetSign === "-" ? -1 : 1;
  const offsetMs =
    sign *
    (parseInt(offsetHours!) * 3600000 + parseInt(offsetMinutes!) * 60000);

  const targetEpoch = utcMidnight - offsetMs;
  const dtOpt = DateTime.make(targetEpoch);
  if (Option.isNone(dtOpt)) {
    return Effect.fail(
      new CliError({
        message: `Invalid date: ${dateStr}. Use YYYY-MM-DD format.`,
      }),
    );
  }

  return Effect.succeed(DateTime.unsafeSetZoneNamed(dtOpt.value, timeZone));
};

const getTimezoneOffset = (epochMs: number, timeZone: string): string => {
  const parts = Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(epochMs);
  const tzPart = parts.find((p) => p.type === "timeZoneName");
  const raw = tzPart?.value ?? "GMT";
  return raw === "GMT" ? "+00:00" : raw.replace("GMT", "");
};

const formatTimestamp = (epochMs: number, timeZone: string): string => {
  const dateFmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = dateFmt.format(epochMs);
  return `${dateStr}T00:00:00${getTimezoneOffset(epochMs, timeZone)}`;
};

const formatDateRange = (
  date: DateTime.DateTime,
  timeZone: string,
): { timeMin: string; timeMax: string } => {
  const timeMin = formatTimestamp(date.epochMillis, timeZone);
  const nextDay = DateTime.add(date, { days: 1 });
  const timeMax = formatTimestamp(nextDay.epochMillis, timeZone);
  return { timeMin, timeMax };
};

const resolveNickname = (accountFlag: Option.Option<string>) =>
  Effect.gen(function* () {
    const accountStore = yield* AccountStore;

    if (Option.isSome(accountFlag)) {
      const accounts = yield* accountStore.list().pipe(
        Effect.mapError(
          (cause: AccountStoreError) =>
            new CliError({
              message: `Failed to list accounts: ${cause.message}`,
            }),
        ),
      );
      const found = accounts.some((a) => a.nickname === accountFlag.value);
      if (!found) {
        const names = accounts.map((a) => a.nickname).join(", ");
        return yield* new CliError({
          message: `Unknown account '${accountFlag.value}'. Available: ${names}`,
        });
      }
      return accountFlag.value;
    }

    const defaultNickname = yield* accountStore.getDefault().pipe(
      Effect.mapError(
        (cause: AccountStoreError) =>
          new CliError({
            message: `Failed to get default account: ${cause.message}`,
          }),
      ),
    );

    if (Option.isNone(defaultNickname)) {
      const accounts = yield* accountStore.list().pipe(
        Effect.mapError(
          (cause: AccountStoreError) =>
            new CliError({
              message: `Failed to list accounts: ${cause.message}`,
            }),
        ),
      );
      if (accounts.length === 0) {
        return yield* new CliError({
          message:
            "No accounts configured. Run 'termeeting setup' to configure OAuth credentials, then 'termeeting account add <nickname>' to add an account.",
        });
      }
      return yield* new CliError({
        message:
          "No default account set. Use --account or set a default with 'termeeting account set-default <nickname>'.",
      });
    }

    return defaultNickname.value;
  });

export const handleEvents =
  (timeZone: string) =>
  (config: {
    json: boolean;
    account: Option.Option<string>;
    date: Option.Option<string>;
  }) =>
    Effect.gen(function* () {
      const calendarApi = yield* CalendarApi;

      const nickname = yield* resolveNickname(config.account);

      const now = DateTime.unsafeNow();
      const targetDate = Option.isSome(config.date)
        ? yield* parseDate(config.date.value, timeZone)
        : now;

      const dateLabel = formatDateLabel(targetDate, now, timeZone);
      const { timeMin, timeMax } = formatDateRange(targetDate, timeZone);

      const { events, workingLocations } = yield* calendarApi
        .getEvents(nickname, timeMin, timeMax, timeZone)
        .pipe(
          Effect.mapError(
            (cause) =>
              new CliError({
                message: `Failed to fetch events: ${cause.message}`,
              }),
          ),
        );

      if (config.json) {
        yield* Console.log(formatEventsJson(events, workingLocations));
        return;
      }

      if (events.length === 0 && workingLocations.length === 0) {
        yield* Console.log(`📅 ${dateLabel}\n\nNo events scheduled.`);
        return;
      }

      yield* Console.log(
        formatEventsHuman(events, workingLocations, dateLabel, timeZone),
      );
    });

export const handleNext =
  (timeZone: string) =>
  (config: { json: boolean; account: Option.Option<string> }) =>
    Effect.gen(function* () {
      const calendarApi = yield* CalendarApi;

      const nickname = yield* resolveNickname(config.account);

      const now = DateTime.unsafeNow();
      const { timeMin, timeMax } = formatDateRange(now, timeZone);

      const { events } = yield* calendarApi
        .getEvents(nickname, timeMin, timeMax, timeZone)
        .pipe(
          Effect.mapError(
            (cause) =>
              new CliError({
                message: `Failed to fetch events: ${cause.message}`,
              }),
          ),
        );

      const upcoming = events.filter((e) => {
        const endOpt = DateTime.make(e.end);
        if (Option.isNone(endOpt)) return false;
        return endOpt.value.epochMillis > now.epochMillis;
      });

      const next = upcoming[0];
      if (!next) {
        yield* Console.log("No upcoming events today.");
        return;
      }

      if (config.json) {
        yield* Console.log(
          stringifyJson({
            id: next.id,
            title: next.title,
            start: next.start,
            end: next.end,
            ...(next.location ? { location: next.location } : {}),
            ...(next.description ? { description: next.description } : {}),
            ...(next.htmlLink ? { htmlLink: next.htmlLink } : {}),
            ...(next.conferenceLink
              ? { conferenceLink: next.conferenceLink }
              : {}),
          }),
        );
        return;
      }

      yield* Console.log(formatNextEventHuman(next, timeZone));
    });

export const handleSetup = (_config: Record<string, never>) =>
  Effect.gen(function* () {
    const configStore = yield* ConfigStore;
    const authService = yield* AuthService;
    const accountStore = yield* AccountStore;
    const tokenStore = yield* TokenStore;

    yield* Console.log("Termeeting — Google OAuth Setup");
    yield* Console.log("");

    const clientId = yield* Prompt.text({
      message: "Google OAuth Client ID",
    }).pipe(
      Effect.mapError(
        (cause) => new CliError({ message: `Input error: ${cause.message}` }),
      ),
    );
    if (!clientId.trim()) {
      return yield* new CliError({
        message: "Client ID is required.",
      });
    }

    const clientSecret = Redacted.value(
      yield* Prompt.password({
        message: "Google OAuth Client Secret",
      }).pipe(
        Effect.mapError(
          (cause) => new CliError({ message: `Input error: ${cause.message}` }),
        ),
      ),
    );
    if (!clientSecret.trim()) {
      return yield* new CliError({
        message: "Client Secret is required.",
      });
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
      );

    const nickname = "default";

    const result = yield* authService.runDeviceFlow(nickname).pipe(
      Effect.mapError(
        (cause) => new CliError({ message: `Setup failed: ${cause.message}` }),
      ),
      Effect.either,
    );

    if (Either.isRight(result)) {
      const { email } = result.right;
      yield* accountStore.add({ nickname, email }).pipe(
        Effect.mapError(
          (cause) =>
            new CliError({
              message: `Failed to save account: ${cause.message}`,
            }),
        ),
      );
      yield* Console.log("");
      yield* Console.log("Setup complete!");
      yield* Console.log("");
      yield* Console.log(
        "You're all set! Run 'termeeting' to view your events.",
      );
      return;
    }

    const error = result.left;
    yield* tokenStore
      .deleteToken("default")
      .pipe(Effect.catchAll(() => Effect.void));
    return yield* new CliError({
      message: `Setup failed: ${error.message}`,
    });
  });

export const handleAccountList = (config: { json: boolean }) =>
  Effect.gen(function* () {
    const accountStore = yield* AccountStore;

    const accounts = yield* accountStore.list().pipe(
      Effect.mapError(
        (cause) =>
          new CliError({
            message: `Failed to list accounts: ${cause.message}`,
          }),
      ),
    );

    if (accounts.length === 0) {
      yield* Console.log("No accounts configured.");
      return;
    }

    if (config.json) {
      yield* Console.log(stringifyJson(accounts));
      return;
    }

    const defaultNickname = yield* accountStore.getDefault().pipe(
      Effect.mapError(
        (cause) =>
          new CliError({
            message: `Failed to get default: ${cause.message}`,
          }),
      ),
    );

    const lines: string[] = [];
    for (const a of accounts) {
      const marker =
        Option.isSome(defaultNickname) && defaultNickname.value === a.nickname
          ? "  (default)"
          : "";
      lines.push(`  ${a.nickname}   ${a.email}${marker}`);
    }
    yield* Console.log(lines.join("\n"));
  });

export const handleAccountAdd = (config: { nickname: Option.Option<string> }) =>
  Effect.gen(function* () {
    const configStore = yield* ConfigStore;
    const authService = yield* AuthService;
    const accountStore = yield* AccountStore;

    const storeConfig = yield* configStore.read().pipe(
      Effect.mapError(
        (cause) =>
          new CliError({
            message: `Failed to read config: ${cause.message}`,
          }),
      ),
    );
    if (Option.isNone(storeConfig)) {
      return yield* new CliError({
        message:
          "Not configured. Run 'termeeting setup' first to configure OAuth credentials.",
      });
    }

    const nick = Option.isSome(config.nickname)
      ? config.nickname.value
      : yield* Prompt.text({
          message: "Account nickname (e.g., work)",
        }).pipe(
          Effect.mapError(
            (cause) =>
              new CliError({ message: `Input error: ${cause.message}` }),
          ),
        );

    if (!NICKNAME_RE.test(nick) || !nick.trim()) {
      return yield* new CliError({
        message:
          "Invalid nickname. Use letters, numbers, hyphens, and underscores only.",
      });
    }

    const { email } = yield* authService.runDeviceFlow(nick.trim()).pipe(
      Effect.mapError(
        (cause) =>
          new CliError({
            message: `Authentication failed: ${cause.message}`,
          }),
      ),
    );

    yield* accountStore.add({ nickname: nick.trim(), email }).pipe(
      Effect.mapError(
        (cause) =>
          new CliError({
            message: `Failed to save account: ${cause.message}`,
          }),
      ),
    );

    yield* Console.log(
      `Account '${nick.trim()}' (${email}) added successfully.`,
    );
  });

export const handleAccountRemove = (config: { nickname: string }) =>
  Effect.gen(function* () {
    const accountStore = yield* AccountStore;
    const tokenStore = yield* TokenStore;

    yield* accountStore.remove(config.nickname).pipe(
      Effect.mapError(
        (cause) =>
          new CliError({
            message: `Failed to remove account: ${cause.message}`,
          }),
      ),
    );

    yield* tokenStore.deleteToken(config.nickname).pipe(
      Effect.mapError(
        (cause) =>
          new CliError({
            message: `Failed to remove token: ${cause.message}`,
          }),
      ),
    );

    yield* Console.log(`Account '${config.nickname}' removed.`);
  });

export const handleAccountSetDefault = (config: { nickname: string }) =>
  Effect.gen(function* () {
    const accountStore = yield* AccountStore;

    yield* accountStore.setDefault(config.nickname).pipe(
      Effect.mapError(
        (cause) =>
          new CliError({
            message: `Failed to set default account: ${cause.message}`,
          }),
      ),
    );

    yield* Console.log(`Default account set to '${config.nickname}'.`);
  });

const jsonOption = Options.boolean("json").pipe(
  Options.withAlias("j"),
  Options.withDescription("Output as JSON"),
);
const accountOption = Options.text("account").pipe(
  Options.withAlias("a"),
  Options.optional,
);
const dateOption = Options.text("date").pipe(
  Options.withAlias("d"),
  Options.optional,
);

export const make = (options?: { timeZone?: string }) =>
  Layer.effect(
    CliService,
    Effect.gen(function* () {
      const timeZone =
        options?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

      const events = Command.make(
        "termeeting",
        {
          json: jsonOption,
          account: accountOption,
          date: dateOption,
        },
        handleEvents(timeZone),
      );

      const next = Command.make(
        "next",
        {
          json: jsonOption,
          account: accountOption,
        },
        handleNext(timeZone),
      );

      const setup = Command.make("setup", {}, handleSetup);

      const accountList = Command.make(
        "list",
        {
          json: jsonOption,
        },
        handleAccountList,
      );

      const accountAdd = Command.make(
        "add",
        {
          nickname: Args.text({ name: "nickname" }).pipe(
            Args.optional,
            Args.withDescription("Account nickname"),
          ),
        },
        handleAccountAdd,
      );

      const accountRemove = Command.make(
        "remove",
        {
          nickname: Args.text({ name: "nickname" }),
        },
        handleAccountRemove,
      );

      const accountSetDefault = Command.make(
        "set-default",
        {
          nickname: Args.text({ name: "nickname" }),
        },
        handleAccountSetDefault,
      );

      const account = Command.make("account").pipe(
        Command.withSubcommands([
          accountList,
          accountAdd,
          accountRemove,
          accountSetDefault,
        ]),
      );

      const command = events.pipe(
        Command.withSubcommands([next, setup, account]),
      );

      return { command } as const;
    }),
  );
