# Visual Plan

`vplan` renders an MDX plan to a self-contained HTML page for an agent to present and a reader to review. Only `packages/cli` is published; `core`, `compile`, and `runtime` are private and bundled or vendored into it. `packages/app` is the visualplan.dev docs site.

## Before finishing

- Run `pnpm typecheck`, `pnpm test`, and `pnpm check` (biome, writes fixes).
- When a change alters how a plan is authored (a component, chart type, attribute, or syntax), update `skills/visual-plan/` to match. Skip this for internal refactors.

## Invariants

- **Single file, no external requests.** A rendered plan must work offline from `file://`. Inline everything at build time; never add a CDN, web font, remote image, or runtime fetch.
- **No `@vitejs/plugin-react`.** Render uses esbuild's automatic JSX. Plugin-react skips `node_modules`, so the installed CLI could no longer compile its vendored runtime.
- **`@visualplan/core` and the `@visualplan/compile` index stay isomorphic.** No React, DOM, or Node imports. Node only code goes behind a subpath such as `@visualplan/compile/file-icons`.
- **Never edit the generated `packages/cli/runtime` or `packages/cli/core`.** Edit the source packages; `pnpm build` or `pnpm --filter vplan vendor` refreshes them.
- **Every package `exports` map keeps `"./package.json": "./package.json"`.** Runtime resolution in the dev layout depends on it.
- **Paired code that must change together:**
  - section enumeration: compile `splitSections` and runtime `collectSections` (each has a parity golden; update both);
  - theme resolution: runtime `theme.ts` and the CLI `themeBootstrap` in `compile.ts`;
  - dark palette: `:root[data-theme="dark"]` and the `prefers-color-scheme` block in `theme.css`;
  - ink tokens: runtime `theme.css` and `packages/app/src/styles/global.css`.
- **Stored review data must survive upgrades.** Comment anchors, revision fingerprints, review snapshots, and IndexedDB or `localStorage` keys live in readers' browsers. A change that alters any of them for unchanged content silently drops comments and approvals. Keep old records readable and pin the legacy value in a test.
- **`vplan check` is a pre-render lint, not full validation.** It compiles MDX and checks component props and block data, but does not render. Never claim a passing `check` proves a plan renders; only render does.
- **Browser review never authorizes implementation**, and authored source never stores acceptance or review state.

## Conventions

- No emojis or punctuation dashes in code, output, or docs.
- Icons come only from `@tabler/icons-react`; never hand draw SVG paths or text glyphs. The colored Material file icons in code titles and FileTree are the one exception.
- Tests that use Node APIs declare `// @vitest-environment node`; the `cli`, `runtime`, and `app` projects default to jsdom, where `fileURLToPath(import.meta.url)` throws.
- To test single file output, assert inline `<script type="module">` and `<style>` content. Scanning for `<script src>` or `<link>` gives false hits from string literals in the bundle.

## Releasing

Creating a GitHub release publishes `vplan` to npm. Confirm the version with a maintainer before creating it.

- Tags are bare semver (`0.2.0`, never `v0.2.0`). Do not bump `package.json`; CI sets the version from the tag.
- Pick the bump from conventional commits since the last tag: `feat` minor, others patch, breaking major (minor while in `0.x`).
- Notes are grouped as Features, Fixes, Other, with prefixes stripped.
- Run `gh release create <X.Y.Z> --target main --title "<X.Y.Z>" --notes "..."`, then confirm with `gh run list --workflow=publish.yml --limit 1` and `npm view vplan version`.
