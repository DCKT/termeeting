import { describe, it, expect } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { Console } from "effect"
import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import { ConfigStore } from "../../src/storage/ConfigStore.js"
import { TokenStore } from "../../src/storage/TokenStore.js"
import { AccountStore } from "../../src/storage/AccountStore.js"
import { CalendarApi } from "../../src/calendar/CalendarApi.js"
import { AuthService } from "../../src/auth/AuthService.js"
import { handleEvents, handleNext, handleAccountList, handleAccountRemove, handleAccountSetDefault, CliError } from "../../src/cli/CliService.js"

function makeCapturedConsole(captured: string[]) {
  const consoleTypeId = Symbol.for("effect/Console")
  return {
    [consoleTypeId]: consoleTypeId,
    assert: () => Effect.void,
    clear: Effect.void,
    count: () => Effect.void,
    countReset: () => Effect.void,
    debug(...args: string[]) { captured.push(args.join(" ")); return Effect.void },
    dir: () => Effect.void,
    dirxml: () => Effect.void,
    error(...args: string[]) { captured.push(args.join(" ")); return Effect.void },
    group: () => Effect.void,
    groupCollapsed: () => Effect.void,
    groupEnd: Effect.void,
    info(...args: string[]) { captured.push(args.join(" ")); return Effect.void },
    log(...args: string[]) { captured.push(args.join(" ")); return Effect.void },
    table: () => Effect.void,
    time: () => Effect.void,
    timeEnd: () => Effect.void,
    timeLog: () => Effect.void,
    trace: () => Effect.void,
    warn(...args: string[]) { captured.push(args.join(" ")); return Effect.void },
    unsafe: null as any,
  } as any
}

function makeFsStub() {
  return {
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
  } as any
}

function makePathStub() {
  return {
    sep: "/",
    basename: (p: string) => p.split("/").pop() ?? "",
    dirname: (p: string) => p.split("/").slice(0, -1).join("/") || "/",
    extname: (p: string) => {
      const base = p.split("/").pop() ?? ""
      const idx = base.lastIndexOf(".")
      return idx > 0 ? base.slice(idx) : ""
    },
    format: () => "",
    fromFileUrl: () => Effect.succeed(""),
    isAbsolute: (p: string) => p.startsWith("/"),
    join: (...parts: Array<string>) => parts.join("/"),
    normalize: (p: string) => p,
    parse: (p: string) => {
      const base = p.split("/").pop() ?? ""
      const dir = p.split("/").slice(0, -1).join("/") || "/"
      const idx = base.lastIndexOf(".")
      return {
        root: "/",
        dir: dir,
        base: base,
        name: idx > 0 ? base.slice(0, idx) : base,
        ext: idx > 0 ? base.slice(idx) : "",
      }
    },
    relative: (_from: string, to: string) => to,
    resolve: (...args: Array<string>) => args.join("/"),
    toFileUrl: () => Effect.succeed(new URL("file:///")),
    toNamespacedPath: (p: string) => p,
  } as any
}

const mockFs = Layer.succeed(FileSystem, makeFsStub())
const mockPath = Layer.succeed(Path, makePathStub())
const mockConfigStore = Layer.succeed(ConfigStore, {
  read: () => Effect.succeed(Option.none()),
  write: () => Effect.void,
})
const mockTokenStore = Layer.succeed(TokenStore, {
  read: () => Effect.succeed(Option.none()),
  write: () => Effect.void,
  deleteToken: () => Effect.void,
})
const mockAuth = Layer.succeed(AuthService, {
  getAccessToken: () => Effect.succeed("test-token"),
  runDeviceFlow: () =>
    Effect.succeed({
      tokens: {
        accessToken: "test-token",
        refreshToken: "test-refresh",
        expiry: new Date(Date.now() + 3600000).toISOString(),
      },
      email: "test@example.com",
    }),
})

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
  })

const homeProvider = ConfigProvider.fromJson({ HOME: "/home/user" }).pipe(
  Layer.setConfigProvider
)

describe("handleEvents", () => {
  it.effect("prints no events message when calendar is empty", () =>
    Effect.gen(function* () {
      const captured: string[] = []
      yield* handleEvents("UTC")({
        json: false,
        account: Option.none(),
        date: Option.none(),
      }).pipe(
        Console.withConsole(makeCapturedConsole(captured)),
        Effect.provide(
          Layer.succeed(CalendarApi, {
            getEvents: () => Effect.succeed({ events: [], workingLocations: [] }),
          })
        ),
        Effect.provide(mockConfigStore),
        Effect.provide(mockTokenStore),
        Effect.provide(mockAuth),
        Effect.provide(mockAccountStore(
          [{ nickname: "default", email: "test@example.com" }],
          "default",
        )),
        Effect.provide(mockFs),
        Effect.provide(mockPath),
        Effect.provide(homeProvider),
      )
      expect(captured.join(" ")).toContain("No events scheduled")
    })
  )

  it.effect("formats events in human-readable format", () =>
    Effect.gen(function* () {
      const captured: string[] = []
      yield* handleEvents("UTC")({
        json: false,
        account: Option.none(),
        date: Option.none(),
      }).pipe(
        Console.withConsole(makeCapturedConsole(captured)),
        Effect.provide(
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
          })
        ),
        Effect.provide(mockConfigStore),
        Effect.provide(mockTokenStore),
        Effect.provide(mockAuth),
        Effect.provide(mockAccountStore(
          [{ nickname: "default", email: "test@example.com" }],
          "default",
        )),
        Effect.provide(mockFs),
        Effect.provide(mockPath),
        Effect.provide(homeProvider),
      )
      expect(captured.join(" ")).toContain("Standup")
      expect(captured.join(" ")).toContain("Room 3")
      expect(captured.join(" ")).toContain("09:00")
    })
  )

  it.effect("outputs JSON when json flag is true", () =>
    Effect.gen(function* () {
      const captured: string[] = []
      yield* handleEvents("UTC")({
        json: true,
        account: Option.none(),
        date: Option.none(),
      }).pipe(
        Console.withConsole(makeCapturedConsole(captured)),
        Effect.provide(
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
          })
        ),
        Effect.provide(mockConfigStore),
        Effect.provide(mockTokenStore),
        Effect.provide(mockAuth),
        Effect.provide(mockAccountStore(
          [{ nickname: "default", email: "test@example.com" }],
          "default",
        )),
        Effect.provide(mockFs),
        Effect.provide(mockPath),
        Effect.provide(homeProvider),
      )
      const json = JSON.parse(captured.join(""))
      expect(json.events.length).toBe(1)
      expect(json.events[0].title).toBe("Standup")
    })
  )
})

describe("handleNext", () => {
  it.effect("shows next upcoming event", () =>
    Effect.gen(function* () {
      const captured: string[] = []
      const now = new Date()
      const start = new Date(now.getTime() + 3600000).toISOString()
      const end = new Date(now.getTime() + 7200000).toISOString()

      yield* handleNext("UTC")({
        json: false,
        account: Option.none(),
      }).pipe(
        Console.withConsole(makeCapturedConsole(captured)),
        Effect.provide(
          Layer.succeed(CalendarApi, {
            getEvents: () =>
              Effect.succeed({
                events: [
                  {
                    id: "1",
                    title: "Meeting",
                    start,
                    end,
                  },
                ],
                workingLocations: [],
              }),
          })
        ),
        Effect.provide(mockConfigStore),
        Effect.provide(mockTokenStore),
        Effect.provide(mockAuth),
        Effect.provide(mockAccountStore(
          [{ nickname: "default", email: "test@example.com" }],
          "default",
        )),
        Effect.provide(mockFs),
        Effect.provide(mockPath),
        Effect.provide(homeProvider),
      )
      expect(captured.join(" ")).toContain("Meeting")
      expect(captured.join(" ")).toContain("Next")
    })
  )

  it.effect("shows no upcoming events when none today", () =>
    Effect.gen(function* () {
      const captured: string[] = []
      yield* handleNext("UTC")({
        json: false,
        account: Option.none(),
      }).pipe(
        Console.withConsole(makeCapturedConsole(captured)),
        Effect.provide(
          Layer.succeed(CalendarApi, {
            getEvents: () =>
              Effect.succeed({
                events: [],
                workingLocations: [],
              }),
          })
        ),
        Effect.provide(mockConfigStore),
        Effect.provide(mockTokenStore),
        Effect.provide(mockAuth),
        Effect.provide(mockAccountStore(
          [{ nickname: "default", email: "test@example.com" }],
          "default",
        )),
        Effect.provide(mockFs),
        Effect.provide(mockPath),
        Effect.provide(homeProvider),
      )
      expect(captured.join(" ")).toContain("No upcoming events")
    })
  )
})

describe("handleAccountList", () => {
  it.effect("shows account list", () =>
    Effect.gen(function* () {
      const captured: string[] = []
      yield* handleAccountList({ json: false }).pipe(
        Console.withConsole(makeCapturedConsole(captured)),
        Effect.provide(
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
          })
        ),
        Effect.provide(mockFs),
        Effect.provide(mockPath),
      )
      expect(captured.join(" ")).toContain("work")
      expect(captured.join(" ")).toContain("work@example.com")
      expect(captured.join(" ")).toContain("default")
    })
  )

  it.effect("shows empty message", () =>
    Effect.gen(function* () {
      const captured: string[] = []
      yield* handleAccountList({ json: false }).pipe(
        Console.withConsole(makeCapturedConsole(captured)),
        Effect.provide(mockAccountStore()),
        Effect.provide(mockFs),
        Effect.provide(mockPath),
      )
      expect(captured.join(" ")).toContain("No accounts configured")
    })
  )
})

describe("handleAccountRemove", () => {
  it.effect("removes an account", () =>
    Effect.gen(function* () {
      const captured: string[] = []
      const calledRemove = { value: false }

      yield* handleAccountRemove({ nickname: "work" }).pipe(
        Console.withConsole(makeCapturedConsole(captured)),
        Effect.provide(
          Layer.succeed(AccountStore, {
            list: () => Effect.succeed([]),
            add: () => Effect.void,
            remove: (nick: string) => {
              calledRemove.value = nick === "work"
              return Effect.void
            },
            getDefault: () => Effect.succeed(Option.none()),
            setDefault: () => Effect.void,
          })
        ),
        Effect.provide(Layer.succeed(TokenStore, {
          read: () => Effect.succeed(Option.none()),
          write: () => Effect.void,
          deleteToken: () => Effect.void,
        })),
        Effect.provide(mockFs),
        Effect.provide(mockPath),
      )
      expect(calledRemove.value).toBe(true)
      expect(captured.join(" ")).toContain("removed")
    })
  )
})

describe("handleAccountSetDefault", () => {
  it.effect("sets default account", () =>
    Effect.gen(function* () {
      const captured: string[] = []
      const calledDefault = { value: false }

      yield* handleAccountSetDefault({ nickname: "work" }).pipe(
        Console.withConsole(makeCapturedConsole(captured)),
        Effect.provide(
          Layer.succeed(AccountStore, {
            list: () => Effect.succeed([]),
            add: () => Effect.void,
            remove: () => Effect.void,
            getDefault: () => Effect.succeed(Option.none()),
            setDefault: (nick: string) => {
              calledDefault.value = nick === "work"
              return Effect.void
            },
          })
        ),
        Effect.provide(mockFs),
        Effect.provide(mockPath),
      )
      expect(calledDefault.value).toBe(true)
      expect(captured.join(" ")).toContain("Default account set")
    })
  )
})
