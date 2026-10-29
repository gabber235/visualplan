# packages/runtime

Browser React code, shipped as source and compiled by the CLI at render time.

## Invariants

- **Review chrome overlays the plan; it never mutates plan DOM.** Only `DiffCues` edits plan prose, and its effect cleanup must restore it.
- **A closed review tab is detected by the server**, through the held `/__vp_alive` connection plus `/__vp_draft`. Do not rely on `sendBeacon` or unload handlers to deliver a verdict; they are dropped on a real close.
- **Review side effects respect both modes.** In queue mode (`isQueueMode()`) the shell owns lifecycle: no keepalive, no `beforeunload`, no `window.close()`, but drafts still post. Demo mode (`isReviewDemo()`, docs site only) never POSTs or closes.
- **The queue shell's `/__vp_events` stream is the daemon's liveness signal.** Close it only on unmount, or the daemon shuts down. The sidebar always renders, even for one plan, and rows never reorder.
- **Diff cues map onto sections by index.** On a count mismatch, show nothing rather than mislabel.
- **The theme cog never writes the CLI config.** It persists to `localStorage` only. Keep its click toggle; Safari and touch never hover or focus on tap.
- **Keep the `execCommand` copy fallback** in `ShareButton`; the clipboard API is blocked on `file://`.

## Design language

The page is a calm reading surface. Changing these needs a reason from a maintainer.

- Accent is near monochrome ink. Color carries meaning only: add green, delete red, modify amber, move cyan, pick gold, links blue. `Questions` is deliberately blue with a glow because the reader acts on it.
- Callout types keep distinct colors; `tip` has its own tokens, separate from the done green.
- No colored `border-left` stripes. No pure `#fff` or `#000`. Every color is a CSS variable, including Mermaid and Chart colors.
- Status badges show only accepted, denied, or changed; unreviewed is silent. Optional fields render nothing when empty: no empty panels, default captions, or repeated metadata. A workspace ends at the changes; no routes or appended reports.
- Fullscreen is for diagrams, charts, and SVG, never code.
- Expressive Code overrides need the `.vp-main` prefix, because EC injects its styles after ours.
- Recharts `Cell` is deprecation flagged but required for per item colors; leave it.

## Visual checks

After a theme or layout change, screenshot a rendered plan in light and dark with `playwright-core`. For pages with a `Chart`, use a fixed tall viewport, not `fullPage`; resizing mid capture leaves recharts artifacts real readers never see.

## Adding a component

A component needs all of: a schema and `CATALOG` entry in `@visualplan/core`, `components/<Name>.tsx` validating through `validateProps`, registration in `index.tsx`, a use in `packages/cli/templates/example.mdx`, and a test in `tests/components.test.tsx`. List or table data is authored as Markdown children, parsed in `@visualplan/compile` `plan-blocks.ts`, never as object array props.
