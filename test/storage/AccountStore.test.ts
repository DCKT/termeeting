import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import { AccountStore, AccountStoreError, make } from "../../src/storage/AccountStore.js"
import { makeTest } from "../helpers/AccountStore.js"
import { PlatformService } from "../../src/platform/PlatformService.js"
import { makeTest as platformMakeTest } from "../helpers/PlatformService.js"

const mockPath = Layer.succeed(Path, {
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
} as any)

const emptyFs = {
  exists: () => Effect.succeed(false),
  readFileString: () => Effect.succeed(""),
  writeFileString: () => Effect.void,
  makeDirectory: () => Effect.void,
  remove: () => Effect.void,
} as const

const makeStaticFsLayer = (overrides: Partial<FileSystem>): Layer.Layer<FileSystem> =>
  Layer.succeed(FileSystem, {
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
    ...emptyFs,
    ...overrides,
  } as any)

const makeStatefulFsLayer = (initialContent?: string): Layer.Layer<FileSystem> => {
  let content = initialContent ?? ""
  let fileExists = initialContent !== undefined

  return Layer.succeed(FileSystem, {
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
    exists: () => Effect.succeed(fileExists),
    readFileString: () =>
      fileExists ? Effect.succeed(content) : Effect.fail(new Error("file not found")),
    writeFileString: (_path: string, data: string) => {
      content = data
      fileExists = true
      return Effect.void
    },
    makeDirectory: () => Effect.void,
    remove: () => {
      content = ""
      fileExists = false
      return Effect.void
    },
  } as any)
}

const baseLayer = make.pipe(
  Layer.provideMerge(mockPath),
  Layer.provideMerge(platformMakeTest())
)

describe("AccountStore", () => {
  it.effect("list returns accounts from registry", () =>
    Effect.gen(function* () {
      const store = yield* AccountStore
      const accounts = yield* store.list()
      expect(accounts.length).toBe(2)
      expect(accounts[0]?.nickname).toBe("work")
      expect(accounts[1]?.nickname).toBe("personal")
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeStaticFsLayer({
              exists: () => Effect.succeed(true),
              readFileString: () =>
                Effect.succeed(
                  JSON.stringify({
                    accounts: [
                      { nickname: "work", email: "work@example.com" },
                      { nickname: "personal", email: "personal@example.com" },
                    ],
                  })
                ),
            })
          )
        )
      )
    )
  )

  it.effect("list returns empty when no registry", () =>
    Effect.gen(function* () {
      const store = yield* AccountStore
      const accounts = yield* store.list()
      expect(accounts.length).toBe(0)
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(makeStaticFsLayer({ exists: () => Effect.succeed(false) }))
        )
      )
    )
  )

  it.effect("add inserts account and auto-sets default for first", () =>
    Effect.gen(function* () {
      const store = yield* AccountStore
      yield* store.add({ nickname: "work", email: "work@example.com" })
      const def = yield* store.getDefault()
      expect(Option.isSome(def)).toBe(true)
      if (Option.isSome(def)) {
        expect(def.value).toBe("work")
      }
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(makeStatefulFsLayer())
        )
      )
    )
  )

  it.effect("add rejects duplicate nickname", () =>
    Effect.gen(function* () {
      const store = yield* AccountStore
      const error = yield* store.add({ nickname: "work", email: "dup@example.com" }).pipe(Effect.flip)
      expect(error).toBeInstanceOf(AccountStoreError)
      expect(error.message).toContain("already exists")
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeStaticFsLayer({
              exists: () => Effect.succeed(true),
              readFileString: () =>
                Effect.succeed(
                  JSON.stringify({
                    accounts: [{ nickname: "work", email: "work@example.com" }],
                  })
                ),
            })
          )
        )
      )
    )
  )

  it.effect("remove deletes account and clears default if removed", () =>
    Effect.gen(function* () {
      const store = yield* AccountStore
      yield* store.remove("work")
      const def = yield* store.getDefault()
      expect(def).toEqual(Option.none())
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeStatefulFsLayer(
              JSON.stringify({
                accounts: [{ nickname: "work", email: "work@example.com" }],
                default: "work",
              })
            )
          )
        )
      )
    )
  )

  it.effect("remove errors on unknown nickname", () =>
    Effect.gen(function* () {
      const store = yield* AccountStore
      const error = yield* store.remove("nonexistent").pipe(Effect.flip)
      expect(error).toBeInstanceOf(AccountStoreError)
      expect(error.message).toContain("not found")
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeStaticFsLayer({
              exists: () => Effect.succeed(true),
              readFileString: () =>
                Effect.succeed(
                  JSON.stringify({
                    accounts: [{ nickname: "work", email: "work@example.com" }],
                  })
                ),
            })
          )
        )
      )
    )
  )

  it.effect("getDefault returns none when no default", () =>
    Effect.gen(function* () {
      const store = yield* AccountStore
      const def = yield* store.getDefault()
      expect(def).toEqual(Option.none())
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeStaticFsLayer({
              exists: () => Effect.succeed(true),
              readFileString: () =>
                Effect.succeed(
                  JSON.stringify({
                    accounts: [{ nickname: "work", email: "work@example.com" }],
                  })
                ),
            })
          )
        )
      )
    )
  )

  it.effect("setDefault updates default", () =>
    Effect.gen(function* () {
      const store = yield* AccountStore
      yield* store.setDefault("personal")
      const def = yield* store.getDefault()
      expect(Option.isSome(def)).toBe(true)
      if (Option.isSome(def)) {
        expect(def.value).toBe("personal")
      }
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeStatefulFsLayer(
              JSON.stringify({
                accounts: [
                  { nickname: "work", email: "work@example.com" },
                  { nickname: "personal", email: "personal@example.com" },
                ],
                default: "work",
              })
            )
          )
        )
      )
    )
  )

  it.effect("setDefault errors on unknown nickname", () =>
    Effect.gen(function* () {
      const store = yield* AccountStore
      const error = yield* store.setDefault("nonexistent").pipe(Effect.flip)
      expect(error).toBeInstanceOf(AccountStoreError)
      expect(error.message).toContain("not found")
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeStaticFsLayer({
              exists: () => Effect.succeed(true),
              readFileString: () =>
                Effect.succeed(
                  JSON.stringify({
                    accounts: [{ nickname: "work", email: "work@example.com" }],
                  })
                ),
            })
          )
        )
      )
    )
  )

  it.effect("makeTest returns mock accounts", () =>
    Effect.gen(function* () {
      const store = yield* AccountStore
      const accounts = yield* store.list()
      expect(accounts.length).toBe(1)
      expect(accounts[0]?.nickname).toBe("test")
      const def = yield* store.getDefault()
      expect(Option.isSome(def)).toBe(true)
      if (Option.isSome(def)) {
        expect(def.value).toBe("test")
      }
    }).pipe(
      Effect.provide(
        makeTest([{ nickname: "test", email: "test@example.com" }], "test")
      )
    )
  )
})
