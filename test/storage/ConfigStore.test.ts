import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import { ConfigStore, ConfigStoreError, make, makeTest } from "../../src/storage/ConfigStore.js"
import { PlatformService, makeTest as platformMakeTest } from "../../src/platform/PlatformService.js"

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

const baseLayer = make.pipe(
  Layer.provideMerge(mockPath),
  Layer.provideMerge(platformMakeTest())
)

const makeFsLayer = (overrides: Partial<FileSystem>): Layer.Layer<FileSystem> =>
  Layer.succeed(FileSystem, {
    exists: () => Effect.succeed(true),
    readFileString: () => Effect.succeed(""),
    writeFileString: () => Effect.void,
    makeDirectory: () => Effect.void,
    access: () => Effect.void,
    copy: () => Effect.void,
    copyFile: () => Effect.void,
    chmod: () => Effect.void,
    chown: () => Effect.void,
    link: () => Effect.void,
    makeTempDirectory: () => Effect.fail(new Error("unused") as any),
    makeTempDirectoryScoped: () =>
      Effect.fail(new Error("unused") as any),
    makeTempFile: () => Effect.fail(new Error("unused") as any),
    makeTempFileScoped: () =>
      Effect.fail(new Error("unused") as any),
    open: () => Effect.fail(new Error("unused") as any),
    readDirectory: () => Effect.fail(new Error("unused") as any),
    readFile: () => Effect.fail(new Error("unused") as any),
    readLink: () => Effect.fail(new Error("unused") as any),
    realPath: () => Effect.fail(new Error("unused") as any),
    remove: () => Effect.fail(new Error("unused") as any),
    rename: () => Effect.fail(new Error("unused") as any),
    symlink: () => Effect.fail(new Error("unused") as any),
    truncate: () => Effect.fail(new Error("unused") as any),
    utimes: () => Effect.fail(new Error("unused") as any),
    writeFile: () => Effect.fail(new Error("unused") as any),
    watch: () => Effect.fail(new Error("unused") as any),
    ...overrides,
  } as any)

describe("ConfigStore", () => {
  it.effect("reads config from file system", () =>
    Effect.gen(function* () {
      const store = yield* ConfigStore
      const result = yield* store.read()
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.clientId).toBe("my-client-id")
        expect(result.value.clientSecret).toBe("my-client-secret")
      }
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeFsLayer({
              exists: () => Effect.succeed(true),
              readFileString: () =>
                Effect.succeed(
                  JSON.stringify({
                    clientId: "my-client-id",
                    clientSecret: "my-client-secret",
                  })
                ),
            })
          )
        )
      )
    )
  )

  it.effect("returns none when config file does not exist", () =>
    Effect.gen(function* () {
      const store = yield* ConfigStore
      const result = yield* store.read()
      expect(result).toEqual(Option.none())
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeFsLayer({ exists: () => Effect.succeed(false) })
          )
        )
      )
    )
  )

  it.effect("writes config to disk", () =>
    Effect.gen(function* () {
      const store = yield* ConfigStore
      const config = {
        clientId: "new-client-id",
        clientSecret: "new-client-secret",
      }
      yield* store.write(config)
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeFsLayer({ exists: () => Effect.succeed(true) })
          )
        )
      )
    )
  )

  it.effect("read fails when file system errors", () =>
    Effect.gen(function* () {
      const store = yield* ConfigStore
      const error = yield* store.read().pipe(Effect.flip)
      expect(error).toBeInstanceOf(ConfigStoreError)
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeFsLayer({
              exists: () => Effect.fail(new Error("disk error")),
            })
          )
        )
      )
    )
  )

  it.effect("makeTest returns mock config", () =>
    Effect.gen(function* () {
      const store = yield* ConfigStore
      const result = yield* store.read()
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.clientId).toBe("test-id")
      }
    }).pipe(
      Effect.provide(
        makeTest({ clientId: "test-id", clientSecret: "test-secret" })
      )
    )
  )
})
