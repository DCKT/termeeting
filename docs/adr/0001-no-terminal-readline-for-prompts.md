# ADR-0001: No `Terminal.readLine` for prompt input

## Status

Accepted (2026-06-26)

## Context

`PlatformService.prompt` needs to read a line of user input (e.g., OAuth Client ID and Secret during setup). The natural implementation would delegate to `@effect/platform`'s `Terminal.readLine`. However, the `Terminal` layer from `@effect/platform-node-shared` puts stdin into **raw mode** (`stdin.setRawMode(true)`) on acquisition — enabling individual keypress reading for its `readInput` method.

Raw mode causes two problems for prompt-style input:

1. **Ctrl+C broken** — Raw mode disables the terminal's `ISIG` flag, so Ctrl+C sends byte `0x03` to stdin instead of generating SIGINT. `Terminal.readLine` only listens for the Node.js readline `"line"` event, so the byte is silently consumed and the fiber blocks indefinitely.

2. **Paste broken** — Raw mode combined with `emitKeypressEvents` and `escapeCodeTimeout: 50` interferes with bracketed-paste escape sequences, mangling or dropping pasted text.

The program never uses `Terminal.readInput` — it only needs `display` (stdout write) and `readLine`. The raw-mode tradeoffs serve no purpose for this application.

## Decision

`PlatformService.prompt` does **not** call `Terminal.readLine`. Instead it:

1. Temporarily restores cooked mode on stdin (`stdin.setRawMode(false)`)
2. Creates a fresh `readline.createInterface` for the duration of the prompt
3. Reads the line and restores raw mode afterward (if it was active)

This keeps raw mode active for the `Terminal` layer (in case `readInput` is ever used elsewhere) while giving prompt input normal terminal semantics.

In addition, `main.ts` uses `BunRuntime.runMain` instead of `Effect.runPromise` so that SIGINT (which now works correctly during prompts) interrupts the fiber cleanly, running all scoped finalizers before exit.

## Consequences

- Ctrl+C terminates the program reliably during prompts
- Paste works during prompts
- `PlatformService` no longer depends on `Terminal.Terminal` (simpler dependency graph)
- The `Terminal` layer's raw mode is toggled off/on inside each prompt call; this is safe since no concurrent `readInput` calls occur in this application
