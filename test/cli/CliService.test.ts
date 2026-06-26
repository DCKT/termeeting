import { describe, it, expect } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { FileSystem } from "@effect/platform/FileSystem";
import { Path } from "@effect/platform/Path";
import { ConfigStore } from "../../src/storage/ConfigStore.js";
import { TokenStore } from "../../src/storage/TokenStore.js";
import { AccountStore } from "../../src/storage/AccountStore.js";
import { PlatformService } from "../../src/platform/PlatformService.js";
import { makeTest as platformMakeTest } from "../helpers/PlatformService.js";
import { CalendarApi } from "../../src/calendar/CalendarApi.js";
import { AuthService } from "../../src/auth/AuthService.js";
import { CliService, CliError, make } from "../../src/cli/CliService.js";
import { makeTest } from "../helpers/CliService.js";

const mockPlatform = platformMakeTest();

const mockFs = Layer.succeed(FileSystem, {
  exists: () => Effect.succeed(false),
  readFileString: () => Effect.succeed(""),
  writeFileString: () => Effect.void,
  makeDirectory: () => Effect.void,
  remove: () => Effect.void,
  access: () => Effect.void,
  copy: () => Effect.void,
  copyFile: () => Effect.void,
  chmod: () => Effect.void,
  chown: () => Effect.void,
  link: () => Effect.void,
  makeTempDirectory: () => Effect.fail(new Error("unused") as any),
  makeTempDirectoryScoped: () => Effect.fail(new Error("unused") as any),
  makeTempFile: () => Effect.fail(new Error("unused") as any),
  makeTempFileScoped: () => Effect.fail(new Error("unused") as any),
  open: () => Effect.fail(new Error("unused") as any),
  readDirectory: () => Effect.fail(new Error("unused") as any),
  readFile: () => Effect.fail(new Error("unused") as any),
  readLink: () => Effect.fail(new Error("unused") as any),
  realPath: () => Effect.fail(new Error("unused") as any),
  rename: () => Effect.fail(new Error("unused") as any),
  symlink: () => Effect.fail(new Error("unused") as any),
  truncate: () => Effect.fail(new Error("unused") as any),
  utimes: () => Effect.fail(new Error("unused") as any),
  writeFile: () => Effect.fail(new Error("unused") as any),
  watch: () => Effect.fail(new Error("unused") as any),
} as any);

const mockPath = Layer.succeed(Path, {
  sep: "/",
  basename: (p: string) => p.split("/").pop() ?? "",
  dirname: (p: string) => p.split("/").slice(0, -1).join("/") || "/",
  extname: (p: string) => {
    const base = p.split("/").pop() ?? "";
    const idx = base.lastIndexOf(".");
    return idx > 0 ? base.slice(idx) : "";
  },
  format: () => "",
  fromFileUrl: () => Effect.succeed(""),
  isAbsolute: (p: string) => p.startsWith("/"),
  join: (...parts: Array<string>) => parts.join("/"),
  normalize: (p: string) => p,
  parse: (p: string) => {
    const base = p.split("/").pop() ?? "";
    const dir = p.split("/").slice(0, -1).join("/") || "/";
    const idx = base.lastIndexOf(".");
    return {
      root: "/",
      dir: dir,
      base: base,
      name: idx > 0 ? base.slice(0, idx) : base,
      ext: idx > 0 ? base.slice(idx) : "",
    };
  },
  relative: (_from: string, to: string) => to,
  resolve: (...args: Array<string>) => args.join("/"),
  toFileUrl: () => Effect.succeed(new URL("file:///")),
  toNamespacedPath: (p: string) => p,
} as any);

const baseServices = [mockFs, mockPath] as const;

describe("CliService", () => {
  const mockCalendarApi = (events: any[] = [], workingLocations: any[] = []) =>
    Layer.succeed(CalendarApi, {
      getEvents: () => Effect.succeed({ events, workingLocations }),
    });

  const mockConfigStore = Layer.succeed(ConfigStore, {
    read: () => Effect.succeed(Option.none()),
    write: () => Effect.void,
  });

  const mockTokenStore = Layer.succeed(TokenStore, {
    read: () => Effect.succeed(Option.none()),
    write: () => Effect.void,
    deleteToken: () => Effect.void,
  });

  const mockAuth = Layer.succeed(AuthService, {
    getAccessToken: () => Effect.succeed("token"),
    runDeviceFlow: () =>
      Effect.succeed({
        tokens: {
          accessToken: "test-token",
          refreshToken: "test-refresh",
          expiry: new Date(Date.now() + 3600000).toISOString(),
        },
        email: "test@example.com",
      }),
  });

  const mockAccountStore = (accounts: any[] = [], defaultNickname?: string) =>
    Layer.succeed(AccountStore, {
      list: () => Effect.succeed(accounts),
      add: () => Effect.void,
      remove: () => Effect.void,
      getDefault: () =>
        Effect.succeed(
          defaultNickname ? Option.some(defaultNickname) : Option.none(),
        ),
      setDefault: () => Effect.void,
    });

  it.effect("prints no events message when calendar is empty", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const output = yield* cli.run([]);
      expect(output).toContain("No events scheduled");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(mockCalendarApi([])),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [{ nickname: "default", email: "test@example.com" }],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("formats events in human-readable format", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const output = yield* cli.run([]);
      expect(output).toContain("Standup");
      expect(output).toContain("Room 3");
      expect(output).toContain("09:00");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(
            Layer.succeed(CalendarApi, {
              getEvents: () =>
                Effect.succeed({
                  events: [
                    {
                      id: "1",
                      title: "Standup",
                      start: "2026-06-25T09:00:00Z",
                      end: "2026-06-25T09:30:00Z",
                      location: "Room 3",
                    },
                  ],
                  workingLocations: [],
                }),
            }),
          ),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [{ nickname: "default", email: "test@example.com" }],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("outputs JSON when --json flag is set", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const output = yield* cli.run(["--json"]);
      const parsed = JSON.parse(output);
      expect(parsed.events.length).toBe(1);
      expect(parsed.events[0].title).toBe("Standup");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(
            Layer.succeed(CalendarApi, {
              getEvents: () =>
                Effect.succeed({
                  events: [
                    {
                      id: "1",
                      title: "Standup",
                      start: "2026-06-25T09:00:00Z",
                      end: "2026-06-25T10:00:00Z",
                    },
                  ],
                  workingLocations: [],
                }),
            }),
          ),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [{ nickname: "default", email: "test@example.com" }],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("outputs JSON when -j flag is set", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const output = yield* cli.run(["-j"]);
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed.events)).toBe(true);
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(mockCalendarApi()),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [{ nickname: "default", email: "test@example.com" }],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("filters by date when --date is provided", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const output = yield* cli.run(["--date", "2026-06-30"]);
      expect(output).toContain("June 30, 2026");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(mockCalendarApi()),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [{ nickname: "default", email: "test@example.com" }],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("rejects invalid date strings", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const error = yield* cli.run(["--date", "not-a-date"]).pipe(Effect.flip);
      expect(error).toBeInstanceOf(CliError);
      expect(error.message).toContain("Invalid date");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(mockCalendarApi()),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [{ nickname: "default", email: "test@example.com" }],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("handles calendar API errors", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const error = yield* cli.run([]).pipe(Effect.flip);
      expect(error.message).toContain("Failed to fetch events");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(
            Layer.succeed(CalendarApi, {
              getEvents: () => Effect.fail({ message: "API down" }),
            }),
          ),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [{ nickname: "default", email: "test@example.com" }],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("uses --account flag to select account", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const output = yield* cli.run(["--account", "work"]);
      expect(output).toContain("Standup");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(
            Layer.succeed(CalendarApi, {
              getEvents: () =>
                Effect.succeed({
                  events: [
                    {
                      id: "1",
                      title: "Standup",
                      start: "2026-06-25T09:00:00Z",
                      end: "2026-06-25T09:30:00Z",
                      location: "Room 3",
                    },
                  ],
                  workingLocations: [],
                }),
            }),
          ),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [
                { nickname: "default", email: "test@example.com" },
                { nickname: "work", email: "work@example.com" },
              ],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("errors on unknown --account", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const error = yield* cli
        .run(["--account", "nonexistent"])
        .pipe(Effect.flip);
      expect(error).toBeInstanceOf(CliError);
      expect(error.message).toContain("Unknown account");
      expect(error.message).toContain("Available:");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(mockCalendarApi()),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [{ nickname: "default", email: "test@example.com" }],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("errors when no default account set", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const error = yield* cli.run([]).pipe(Effect.flip);
      expect(error).toBeInstanceOf(CliError);
      expect(error.message).toContain("No default account");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(mockCalendarApi()),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore([{ nickname: "work", email: "work@example.com" }]),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("errors when no accounts configured at all", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const error = yield* cli.run([]).pipe(Effect.flip);
      expect(error).toBeInstanceOf(CliError);
      expect(error.message).toContain("No accounts configured");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(mockCalendarApi()),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(mockAccountStore()),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("shows working location in human output", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const output = yield* cli.run([]);
      expect(output).toContain("📍 Working location");
      expect(output).toContain("🏢 Working at HQ");
      expect(output).toContain("09:00");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(
            Layer.succeed(CalendarApi, {
              getEvents: () =>
                Effect.succeed({
                  events: [],
                  workingLocations: [
                    {
                      id: "wl1",
                      label: "🏢 Working at HQ",
                      start: "2026-06-25T09:00:00Z",
                      end: "2026-06-25T17:00:00Z",
                      type: "officeLocation",
                    },
                  ],
                }),
            }),
          ),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [{ nickname: "default", email: "test@example.com" }],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("shows both events and working locations", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const output = yield* cli.run([]);
      expect(output).toContain("Standup");
      expect(output).toContain("📍 Working location");
      expect(output).toContain("🏠 Working from home");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(
            Layer.succeed(CalendarApi, {
              getEvents: () =>
                Effect.succeed({
                  events: [
                    {
                      id: "1",
                      title: "Standup",
                      start: "2026-06-25T09:00:00Z",
                      end: "2026-06-25T09:30:00Z",
                    },
                  ],
                  workingLocations: [
                    {
                      id: "wl1",
                      label: "🏠 Working from home",
                      start: "2026-06-25T09:00:00Z",
                      end: "2026-06-25T17:00:00Z",
                      type: "homeOffice",
                    },
                  ],
                }),
            }),
          ),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [{ nickname: "default", email: "test@example.com" }],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  it.effect("includes working locations in JSON output", () =>
    Effect.gen(function* () {
      const cli = yield* CliService;
      const output = yield* cli.run(["--json"]);
      const parsed = JSON.parse(output);
      expect(parsed.events.length).toBe(1);
      expect(parsed.events[0].title).toBe("Standup");
      expect(parsed.workingLocations.length).toBe(1);
      expect(parsed.workingLocations[0].type).toBe("officeLocation");
      expect(parsed.workingLocations[0].label).toBe("🏢 Working at HQ");
    }).pipe(
      Effect.provide(
        make({ timeZone: "UTC" }).pipe(
          Layer.provideMerge(
            Layer.succeed(CalendarApi, {
              getEvents: () =>
                Effect.succeed({
                  events: [
                    {
                      id: "1",
                      title: "Standup",
                      start: "2026-06-25T09:00:00Z",
                      end: "2026-06-25T10:00:00Z",
                    },
                  ],
                  workingLocations: [
                    {
                      id: "wl1",
                      label: "🏢 Working at HQ",
                      start: "2026-06-25T09:00:00Z",
                      end: "2026-06-25T17:00:00Z",
                      type: "officeLocation",
                    },
                  ],
                }),
            }),
          ),
          Layer.provideMerge(mockConfigStore),
          Layer.provideMerge(mockTokenStore),
          Layer.provideMerge(mockAuth),
          Layer.provideMerge(
            mockAccountStore(
              [{ nickname: "default", email: "test@example.com" }],
              "default",
            ),
          ),
          Layer.provideMerge(mockPlatform),
          Layer.provideMerge(mockFs),
          Layer.provideMerge(mockPath),
        ),
      ),
    ),
  );

  describe("account list", () => {
    it.effect("shows account list", () =>
      Effect.gen(function* () {
        const cli = yield* CliService;
        const output = yield* cli.run(["account", "list"]);
        expect(output).toContain("work");
        expect(output).toContain("work@example.com");
        expect(output).toContain("(default)");
        expect(output).toContain("personal");
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendarApi()),
            Layer.provideMerge(mockConfigStore),
            Layer.provideMerge(mockTokenStore),
            Layer.provideMerge(mockAuth),
            Layer.provideMerge(
              Layer.succeed(AccountStore, {
                list: () =>
                  Effect.succeed([
                    { nickname: "work", email: "work@example.com" },
                    { nickname: "personal", email: "personal@example.com" },
                  ]),
                add: () => Effect.void,
                remove: () => Effect.void,
                getDefault: () => Effect.succeed(Option.some("work")),
                setDefault: () => Effect.void,
              }),
            ),
            Layer.provideMerge(mockPlatform),
            Layer.provideMerge(mockFs),
            Layer.provideMerge(mockPath),
          ),
        ),
      ),
    );

    it.effect("shows empty message", () =>
      Effect.gen(function* () {
        const cli = yield* CliService;
        const output = yield* cli.run(["account", "list"]);
        expect(output).toBe("No accounts configured.");
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendarApi()),
            Layer.provideMerge(mockConfigStore),
            Layer.provideMerge(mockTokenStore),
            Layer.provideMerge(mockAuth),
            Layer.provideMerge(mockAccountStore()),
            Layer.provideMerge(mockPlatform),
            Layer.provideMerge(mockFs),
            Layer.provideMerge(mockPath),
          ),
        ),
      ),
    );
  });

  describe("account add", () => {
    it.effect("adds an account", () =>
      Effect.gen(function* () {
        const cli = yield* CliService;
        const output = yield* cli.run(["account", "add", "work"]);
        expect(output).toContain("added successfully");
        expect(output).toContain("work");
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendarApi()),
            Layer.provideMerge(
              Layer.succeed(ConfigStore, {
                read: () =>
                  Effect.succeed(
                    Option.some({ clientId: "id", clientSecret: "secret" }),
                  ),
                write: () => Effect.void,
              }),
            ),
            Layer.provideMerge(mockTokenStore),
            Layer.provideMerge(mockAuth),
            Layer.provideMerge(mockAccountStore()),
            Layer.provideMerge(mockPlatform),
            Layer.provideMerge(mockFs),
            Layer.provideMerge(mockPath),
          ),
        ),
      ),
    );

    it.effect("errors without config", () =>
      Effect.gen(function* () {
        const cli = yield* CliService;
        const error = yield* cli
          .run(["account", "add", "work"])
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(CliError);
        expect(error.message).toContain("Not configured");
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendarApi()),
            Layer.provideMerge(mockConfigStore),
            Layer.provideMerge(mockTokenStore),
            Layer.provideMerge(mockAuth),
            Layer.provideMerge(mockAccountStore()),
            Layer.provideMerge(mockPlatform),
            Layer.provideMerge(mockFs),
            Layer.provideMerge(mockPath),
          ),
        ),
      ),
    );
  });

  describe("account remove", () => {
    it.effect("removes an account", () =>
      Effect.gen(function* () {
        const cli = yield* CliService;
        const output = yield* cli.run(["account", "remove", "work"]);
        expect(output).toContain("removed");
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendarApi()),
            Layer.provideMerge(mockConfigStore),
            Layer.provideMerge(mockTokenStore),
            Layer.provideMerge(mockAuth),
            Layer.provideMerge(mockAccountStore()),
            Layer.provideMerge(mockPlatform),
            Layer.provideMerge(mockFs),
            Layer.provideMerge(mockPath),
          ),
        ),
      ),
    );

    it.effect("errors without nickname", () =>
      Effect.gen(function* () {
        const cli = yield* CliService;
        const error = yield* cli.run(["account", "remove"]).pipe(Effect.flip);
        expect(error).toBeInstanceOf(CliError);
        expect(error.message).toContain("Usage");
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendarApi()),
            Layer.provideMerge(mockConfigStore),
            Layer.provideMerge(mockTokenStore),
            Layer.provideMerge(mockAuth),
            Layer.provideMerge(mockAccountStore()),
            Layer.provideMerge(mockPlatform),
            Layer.provideMerge(mockFs),
            Layer.provideMerge(mockPath),
          ),
        ),
      ),
    );
  });

  describe("account set-default", () => {
    it.effect("sets default account", () =>
      Effect.gen(function* () {
        const cli = yield* CliService;
        const output = yield* cli.run(["account", "set-default", "work"]);
        expect(output).toContain("Default account set to 'work'");
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendarApi()),
            Layer.provideMerge(mockConfigStore),
            Layer.provideMerge(mockTokenStore),
            Layer.provideMerge(mockAuth),
            Layer.provideMerge(mockAccountStore()),
            Layer.provideMerge(mockPlatform),
            Layer.provideMerge(mockFs),
            Layer.provideMerge(mockPath),
          ),
        ),
      ),
    );

    it.effect("errors without nickname", () =>
      Effect.gen(function* () {
        const cli = yield* CliService;
        const error = yield* cli
          .run(["account", "set-default"])
          .pipe(Effect.flip);
        expect(error).toBeInstanceOf(CliError);
        expect(error.message).toContain("Usage");
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendarApi()),
            Layer.provideMerge(mockConfigStore),
            Layer.provideMerge(mockTokenStore),
            Layer.provideMerge(mockAuth),
            Layer.provideMerge(mockAccountStore()),
            Layer.provideMerge(mockPlatform),
            Layer.provideMerge(mockFs),
            Layer.provideMerge(mockPath),
          ),
        ),
      ),
    );
  });

  describe("setup", () => {
    const mockCalendar = Layer.succeed(CalendarApi, {
      getEvents: () => Effect.succeed([]),
    });

    it.effect("prompts for credentials and creates account", () =>
      Effect.gen(function* () {
        const cli = yield* CliService;
        const output = yield* cli.run(["setup"]);
        expect(output).toContain("Setup complete");
      }).pipe(
        Effect.provide(
          make({ timeZone: "UTC" }).pipe(
            Layer.provideMerge(mockCalendar),
            Layer.provideMerge(
              Layer.succeed(ConfigStore, {
                read: () => Effect.succeed(Option.none()),
                write: () => Effect.void,
              }),
            ),
            Layer.provideMerge(mockTokenStore),
            Layer.provideMerge(mockAuth),
            Layer.provideMerge(mockAccountStore()),
            Layer.provideMerge(
              platformMakeTest({
                prompt: () => Effect.succeed("test-id"),
              }),
            ),
            Layer.provideMerge(mockFs),
            Layer.provideMerge(mockPath),
          ),
        ),
      ),
    );
  });
});
