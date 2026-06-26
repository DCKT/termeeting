# Effect-TS Guidelines

Derived from [mikearnaldi/accountability](https://github.com/mikearnaldi/accountability) best practices. These rules apply to all Effect code in this project.

## Critical Rules

### 1. Never use `any` or type casts (`x as Y`)

```typescript
// ❌ NEVER
const data = value as any
const account = data as Account

// ✅ Use proper types
const id = AccountId.make(rawId)
const account = yield* Schema.decodeUnknown(Account)(data)

// ✅ For generic identity
import { identity } from "effect/Function"
const verified = identity<Account>(x)  // Compile error if x isn't Account
```

**Exception:** `as any` is acceptable in test mocks for `Layer.succeed()` when stubbing large service interfaces.

### 2. Never use global `Error` — use `Schema.TaggedError`

```typescript
// ❌ global Error breaks typed error handling
Effect.fail(new Error("failed"))

// ✅ Schema.TaggedError
export class ValidationError extends Schema.TaggedError<ValidationError>()(
  "ValidationError",
  { message: Schema.String }
) {}

Effect.fail(new ValidationError({ message: "failed" }))

// ✅ Legacy: Data.TaggedError (used in this codebase, migrate to Schema.TaggedError over time)
export class AuthError extends Data.TaggedError("AuthError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
```

### 3. Never use `catchAllCause` — it hides bugs

`catchAllCause` catches BOTH errors AND defects. Use `mapError` or `catchAll` instead.

```typescript
// ❌ Hides defects (bugs)
Effect.catchAllCause(effect, (cause) => ...)

// ✅ Transform expected errors only
Effect.mapError(effect, (error) => new MyError({ cause: error }))

// ✅ Catch specific error tags
Effect.catchTag(effect, "NotFound", (error) => Effect.succeed(fallback))
```

### 4. Don't wrap safe operations in `Effect.try`

```typescript
// ❌ Effect.try is for operations that might throw
const mapped = Effect.try(() => array.map(fn))  // array.map doesn't throw

// ✅ For pure transformations, use normal functions
const mapAccounts = (rows: Row[]): Account[] => rows.map(toAccount)

// ✅ Effect.try ONLY for operations that might throw
const parsed = Effect.try(() => JSON.parse(jsonString))
```

### 5. Never silently swallow errors

Every failure must be visible in the Effect's error channel `E`.

```typescript
// ❌ Silently discarding errors
yield* someEffect.pipe(Effect.catchTag("AuditError", () => Effect.void))

// ✅ Let error propagate (caller decides)
yield* someEffect

// ✅ Transform error to different type (still visible)
yield* someEffect.pipe(Effect.mapError((e) => new MyError({ cause: e })))
```

### 6. Never use `*FromSelf` schemas or `disableValidation: true`

## Error Handling

### Prefer `mapError` over `catchAll`

`catchAll` catches defects too. Use `mapError` to transform ONLY expected errors.

```typescript
// ✅ Good — only transforms expected errors
const withContext = (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, MyError, R> =>
    Effect.mapError(effect, (error) => new MyError({ operation, cause: error }))
```

### Use `catchTag` for typed error matching

```typescript
// ✅ Typed, composable error handling
const program = fetchAccount(id).pipe(
  Effect.catchTag("NotFound", (error) => Effect.succeed(defaultValue)),
  Effect.catchTag("ValidationError", (error) => Effect.fail(new UserError({ cause: error })))
)
```

## Service Pattern

```typescript
// Service tag
export class MyService extends Context.Tag("MyService")<
  MyService,
  {
    readonly doThing: () => Effect.Effect<Result, MyError>
  }
>() {}

// Live layer
export const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    const dependency = yield* SomeDependency

    const doThing = (): Effect.Effect<Result, MyError> =>
      Effect.gen(function* () {
        // implementation
      })

    return { doThing } as const
  })
)

// Test layer
export const MyServiceTest = (results?: Partial<...>): Layer.Layer<MyService> =>
  Layer.succeed(MyService, {
    doThing: () => Effect.succeed(/* mock result */),
  })
```

## Layer Memoization

Layers are memoized by **object identity**, not type.

```typescript
// SAME reference = ONE instance
const layer = Layer.effect(MyTag, Effect.succeed("value"))
const composed = layer.pipe(Layer.merge(layer))  // Single instance

// DIFFERENT references = TWO instances
const layer1 = Layer.effect(MyTag, Effect.succeed("value"))
const layer2 = Layer.effect(MyTag, Effect.succeed("value"))
const composed2 = layer1.pipe(Layer.merge(layer2))  // Two instances

// Use Layer.fresh() to escape memoization
const twoInstances = layer.pipe(Layer.merge(Layer.fresh(layer)))
```

## Pipe Composition

Chain `.pipe()` calls rather than nesting:

```typescript
// ✅ Chained — easy to read and modify
const result = effect
  .pipe(Effect.map(transformA))
  .pipe(Effect.flatMap(fetchRelated))
  .pipe(Effect.catchTag("NotFound", handleNotFound))
  .pipe(Effect.withSpan("myOperation"))
```

## Branded Types for IDs

```typescript
export const EventId = Schema.String.pipe(Schema.brand("EventId"))
export type EventId = typeof EventId.Type

const id = EventId.make("evt_abc123")
```

## Use Chunk for Collections Needing Equality

Plain `Array` doesn't implement `Equal`/`Hash`. Use `Chunk` when collections need structural comparison.

## Entity Validation

Use `Schema.Class` or `Schema.Struct` with `Schema.decodeUnknown` to parse unknown data:

```typescript
const parseEvent = Schema.decodeUnknown(EventSchema)
const event = yield* parseEvent(rawData)
```

---

**Source:** Adapted from [accountability/specs/guides/effect-guide.md](https://github.com/mikearnaldi/accountability/blob/main/specs/guides/effect-guide.md)
