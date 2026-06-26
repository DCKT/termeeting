import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { FileSystem } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import { TokenStore, TokenStoreError, make } from "../../src/storage/TokenStore.js"
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

describe("TokenStore", () => {
  it.effect("reads tokens from file system by nickname", () =>
    Effect.gen(function* () {
      const store = yield* TokenStore
      const result = yield* store.read("work")
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.accessToken).toBe("access-123")
        expect(result.value.refreshToken).toBe("refresh-456")
        expect(result.value.expiry).toBe("2026-06-25T12:00:00Z")
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
                    accessToken: "access-123",
                    refreshToken: "refresh-456",
                    expiry: "2026-06-25T12:00:00Z",
                  })
                ),
            })
          )
        )
      )
    )
  )

  it.effect("returns none when no token file for nickname", () =>
    Effect.gen(function* () {
      const store = yield* TokenStore
      const result = yield* store.read("work")
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

  it.effect("writes tokens to disk for nickname", () =>
    Effect.gen(function* () {
      const store = yield* TokenStore
      const tokens = {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiry: "2026-06-26T00:00:00Z",
      }
      yield* store.write("work", tokens)
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

  it.effect("deletes token file for nickname", () =>
    Effect.gen(function* () {
      const store = yield* TokenStore
      yield* store.deleteToken("work")
    }).pipe(
      Effect.provide(
        baseLayer.pipe(
          Layer.provideMerge(
            makeFsLayer({
              exists: () => Effect.succeed(true),
              remove: () => Effect.void,
            })
          )
        )
      )
    )
  )

  it.effect("read fails on file system error", () =>
    Effect.gen(function* () {
      const store = yield* TokenStore
      const error = yield* store.read("work").pipe(Effect.flip)
      expect(error).toBeInstanceOf(TokenStoreError)
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

  it.effect("makeTest returns mock tokens for nickname", () =>
    Effect.gen(function* () {
      const store = yield* TokenStore
      const result = yield* store.read("work")
      expect(Option.isSome(result)).toBe(true)
      if (Option.isSome(result)) {
        expect(result.value.accessToken).toBe("test-token")
      }
      const noneResult = yield* store.read("nonexistent")
      expect(noneResult).toEqual(Option.none())
    }).pipe(
      Effect.provide(
        Layer.succeed(TokenStore, {
          read: (nickname: string) =>
            Effect.succeed(
              nickname === "work"
                ? Option.some({
                    accessToken: "test-token",
                    refreshToken: "test-refresh",
                    expiry: new Date(Date.now() + 3600000).toISOString(),
                  })
                : Option.none()
            ),
          write: (_nickname: string, _tokens: any) => Effect.void,
          deleteToken: (_nickname: string) => Effect.void,
        })
      )
    )
  )
})
