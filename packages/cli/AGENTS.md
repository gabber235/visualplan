# packages/cli (vplan)

The published package: the `vplan` bin and the programmatic API.

## Invariants

- **Review output is for the calling agent.** Feedback goes to stdout; status and progress go to stderr. Exit codes are part of the contract.
- **The review daemon's HTTP and SSE contract is frozen.** The runtime shell and older CLI clients depend on exact endpoints, fields, and frames. An absent new field must mean the old behavior.
- **Daemon tab close:** the events socket closing is the signal; the shell's close beacon only chooses the grace period. Shutdown must end every held connection, or `close()` hangs on the SSE.
- **Unused renderer stubbing** (`stubUnusedRenderersPlugin`) stays biased toward inclusion: a false positive costs bytes, a miss breaks a plan. It runs only in `buildHtml`, never in the shared config or the `--watch` server, where a plan can add a diagram later.
- **Keep the plan plugin's `handleHotUpdate`.** The plan is a virtual module, so `addWatchFile` alone never reloads `--watch`.
- **The quality lint runs only in the `check` command**, never in `checkSource`; render, share, and the API must still render a weak plan. A lint warning fails `check`. Do not add an advisory or `--strict` mode. Rules are precision first, because a warning blocks.
- **Snapshots and config are best effort.** A snapshot or config read or write failure never breaks a render. `--stdout` never auto diffs.
- **`<Svg>` inlining refuses unsafe SVG rather than stripping it**, and never throws: it rewrites the tag with `error`, which `check` reports.
- **PDF export uses no `break-inside: avoid`**; Chromium clips an oversized unbreakable figure.
- **Export never bundles a browser.** `playwright-core` finds a system Chrome or Edge, then a Playwright install.
- **The API differs from the CLI on purpose:** a set `theme` locks the scheme, and `enableSharing` defaults to false.
- **`tsup.config.ts` has two configs.** Only the bin gets the shebang and `clean`. The library keeps `dts.resolve` for `@visualplan/*`, or published types import a private package.

## Tests

- Config and snapshot tests pass a temp `dir`; never touch the real home directory.
- Tests that need a real Chromium or a spawned daemon are gated (`skipIf`, `VP_DAEMON_E2E`); keep new ones gated the same way.
