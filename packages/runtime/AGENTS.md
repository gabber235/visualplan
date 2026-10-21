# packages/runtime (@visualplan/runtime)

The browser-side React code that renders a compiled MDX plan. Private package, shipped as
**source** by vendoring it into the published `vplan` CLI tarball (see the root AGENTS.md
"Publishing" section), and compiled at render time by the CLI's Vite build, not prebuilt. See
the root AGENTS.md for why Vite is configured without `@vitejs/plugin-react`.

## How it fits together

- `main.tsx` is the build entry. It imports the user's plan via the `virtual:plan` alias
  (`Plan` default export) and calls `mount`. Plans use no frontmatter; the title is the plan's
  own first `# Heading`, rendered as normal markdown.
- `index.tsx` defines `mount` and the `components` map auto-injected into MDX via `MDXProvider`.
  No plan ever writes an `import` — every component resolves through this map.
- `Layout.tsx` is a single centered content column — no header and no sidebar. It mounts the
  `ThemeToggle` cog and the `ShareButton` (both fixed to the top-right corner). The cog is omitted
  when `isThemeLocked()` (the API's `renderPlan({ theme })` injects `lockTheme`), and the share
  button self-hides when no `__VP_SHARE__` was injected (the API's `enableSharing: false` default).
  It also mounts `<ReviewLayer />`, which self-hides unless `__VP_REVIEW__` was injected.
- `components/review/` is the interactive review UI (`vplan render --review`), gated on the injected
  `__VP_REVIEW__` global (mirroring how `ShareButton` reads `__VP_SHARE__`), so the heavy review
  chrome adds nothing to a normal render (`Questions` does import the tiny `isReviewMode` +
  `ReviewAnswers` leaf modules, which are negligible). `ReviewLayer` owns the session state and
  overlays the plan with fixed-position chrome only (the plan DOM is never mutated):
  `SectionComments` tracks the hovered section and floats one comment button beside it. A section
  starts at any `.vp-phase`, heading (`h1`-`h3`), or standalone block (`.vp-callout`, `.vp-mermaid`,
  `.vp-chart`, `.vp-filetree`, `.vp-matrix-wrap`, `.vp-compare`, `.vp-checklist`, `.vp-stat`,
  `.vp-questions`) that is a **direct** child of `.vp-main`, so loose top-level intro content does not
  collapse into one oversized section while blocks nested inside a `<Phase>` stay part of it.
  `CommentModal` is the bottom composer (with an optional must-fix/suggestion severity toggle,
  default untagged; the tag rides `comments[].severity` and is dropped from JSON when unset, so old
  daemons never see it); `DecisionBar` submits Approve/Deny/Iterate. After any decision the session
  goes read-only rather than unmounting: quote marks and section badges stay visible (delete hidden),
  composer and bar are suppressed, and a queue-mode iterate shows a spinner notice ("Waiting for the
  revised plan") until the shell swaps in the next revision. Known limit: navigating away and back
  while iterating remounts the iframe and loses the in-page marks (the daemon reinjects only
  decision + answers). In review mode
  `Questions` is **directly answerable**: each row renders an answer field whose value flows up via
  the `ReviewAnswers` context (provided in `Layout`, shared by `Questions` and `ReviewSession`) into
  the feedback's distinct `answers` channel. `feedback.ts` POSTs an explicit decision
  `{decision, comments, answers, note}` (shape = `@visualplan/core` `feedbackSchema`)
  to `/__vp_feedback`. **Tab-close handling is server-detected, not beacon-based:** `ReviewLayer` holds
  a `/__vp_alive` connection open and POSTs `/__vp_draft` whenever comments/note change; when the tab
  closes the connection drops and the CLI resolves Deny with that draft. This replaced an unload
  `sendBeacon`, which is dropped on a real close (it only survived navigation). A `beforeunload` prompt
  while undecided is now just a courtesy, the actual Deny no longer depends on the page sending
  anything during unload. **Demo mode** (`isReviewDemo()`, gated on an injected `__VP_REVIEW_DEMO__`,
  used by the docs site's Review-mode page) keeps a session fully in-page: `decide` records the verdict
  and stops instead of POSTing or calling `window.close()`, and the keepalive, draft, and `beforeunload`
  effects are all skipped, so the embedded preview is safe to click through and reset. It is never set
  by the CLI.
- `components/queue/` is the **Review Queue shell**: a second runtime entry (`queue.html` +
  `queue-main.tsx`, mirroring `index.html`/`main.tsx`) the daemon serves at `/`. It renders NO plan
  content: just `QueueShell` (chrome) hosting each active plan in a same-origin `<iframe src="/plan/<id>">`.
  `QueueShell` opens `new EventSource('/__vp_events')` and holds it open for the page lifetime (it is
  the daemon's liveness signal: closing the tab tears the daemon down, so the stream is closed only on
  unmount). It also sends a `navigator.sendBeacon('/__vp_shell_closed')` on `pagehide` (evidence that
  lets the daemon pick the short close grace over the long suspension grace; the socket close remains
  the actual signal) and arms a `beforeunload` confirm only while a `pending`/`active` entry exists
  (an `iterating` entry is already resolved to its caller, so closing loses nothing undecided).
  The daemon emits `event: queue` with a JSON `QueueEntry[]`; the shell defaults the active
  iframe to the first pending plan. Selection is prev-aware (`nextActiveId(prev, next, activeId)`):
  the active plan is kept unless it transitioned to `done` THIS frame, so an iterate keeps the plan
  on screen in its waiting state, the `iterating -> pending` rev bump swaps the revision in place,
  and a user parked on a decided plan is never yanked away by an unrelated frame. The iframe is keyed
  `id:rev` with a `?rev=` cache-buster (ids are stable across revisions now; the daemon also serves
  `/plan/<id>` as `no-store`). The **sidebar always renders**, even for a single plan (deliberate:
  the queue is the product surface, and history stays visible); rows keep stable insertion order
  (never reorder under the cursor), show a spinning refresh icon + "awaiting revision" for
  `iterating`, a relative `updatedAt` timestamp, an unseen-revision dot for background rev bumps
  (per-plan, distinct from the whole-tab favicon dot), and the `vN` iteration chip. j/k or
  arrow keys navigate. `components/queue/logic.ts` holds the **pure**, unit-tested navigation helpers
  (`firstPendingId`, `nextActiveId`, `moveSelection`, `reviewedCount`, `relativeTime`, `unseenRevs`,
  `revisingCount`); `QueueSidebar.tsx` is the rail; `queue.css` is the
  colocated chrome (the entry imports `theme.css` for the shared `--vp-*` tokens). Built by the CLI's
  `buildQueueShell()` (`packages/cli/src/build/queue-shell.ts`), a Vite single-file build of `queue.html`
  with NO plan plugins (no `virtual:plan`/share/diff/review), so the shell ships self-contained.
  **Queue mode inside a plan iframe** is gated on `__VP_REVIEW_PLAN_ID__` (`isQueueMode()` in
  `feedback.ts`): its PRESENCE means the plan is one of several in the queue. In queue mode
  `postFeedback`/`postDraft` tag the POST body with `planId` so the daemon routes the verdict, and
  `ReviewLayer` does NOT open the `/__vp_alive` keepalive, arm the `beforeunload` prompt, or call
  `window.close()` on submit (the SHELL owns daemon lifecycle; swapping the iframe must not deny the
  plan). Draft posting stays ON so a real tab close can still deny-with-draft. An empty id is treated
  as absent (matches `feedbackSchema`'s `planId.min(1)`).
- `components/DiffCues.tsx` renders iteration diff cues when the CLI injected `__VP_DIFF__` (any
  render/watch/review with a baseline, NOT review-gated). Always on: a change bar **flush to the left
  edge of the viewport** (`left: 0`, a dedicated lane clear of the content gutter so it never piles up
  with the phase timeline or review comment badges) for each added (`--vp-done`) / edited
  (`--vp-modify`) section, plus a bottom-left summary chip. The **"Show changes"** toggle reveals the
  inline word diff and scrims unchanged sections. The inline diff (`applyInlineWordDiff` for the
  body prose, `applyTitleDiff` for a renamed title) word-diffs each edited section against its injected
  baseline (`prev` = body prose, `prevLabel` = old title) and re-renders it as `<del class="vp-diff-del">`
  (red strikethrough) / `<ins class="vp-diff-ins">` (green-tinted), keeping the text its normal color so
  it stays readable. `prevLabel` is what surfaces a rename whose body is unchanged (else the section is
  "marked changed but nothing differs"). This **mutates the plan DOM** (a deletion is not otherwise in
  the page) but only the prose/title, reversibly (the effect cleanup restores it). It scopes to authored
  prose (`<p>` not inside a data component), so file paths / table cells never produce false diffs, and
  scans a section's full owned sibling span (a heading plus its intro paragraph). `wordDiffOps` compares
  on a punctuation-stripped, lowercased word core, so a trailing-comma or capitalization change is not
  noise. `components/review/diff.ts` holds the **pure**, jsdom-tested helpers (`diffOverlays`,
  `wordDiffOps`, `applyInlineWordDiff`, `applyTitleDiff`, `sectionOwnedElements`). Known limit: inline
  formatting (bold/links) in an edited paragraph is flattened to text while the diff is shown. **Parity contract:** the injected `__VP_DIFF__.sections` is one entry
  per current section in document order, mapped onto `collectSections()` output BY INDEX, so the
  counts must agree; `diffOverlays` returns nothing on a mismatch (degrade, never mislabel). This DOM
  split and `@visualplan/compile`'s mdast `splitSections` are kept aligned by paired parity goldens
  (`tests/section-comments.test.ts` here + `packages/compile/tests/sections.test.ts`); update both
  when the section-start vocabulary changes.
- `components/ThemeToggle.tsx` is the fixed top-right cog, just left of the share button. Its menu
  picks `system` / `light` / `dark`; choosing one recolors the page live (all colors are CSS vars,
  so flipping `<html data-theme>` repaints with no React re-render) and persists the choice in
  `localStorage` under `vp-theme`. It NEVER writes the CLI's `~/.vplan/config.json` (a static
  `file://` plan cannot reach the disk); the disk config is only the render-time default. The
  preference logic lives in `theme.ts` (`getThemePreference`/`setThemePreference`/
  `applyThemePreference`/`watchSystemScheme`); the cog is a thin view over it. The menu opens on
  hover/focus-within AND an explicit click-toggle (`data-open`), because macOS Safari and touch
  devices neither hover nor focus a button on tap.
- `theme.ts` resolves the color scheme. Precedence: the `localStorage` override, then the injected
  `globalThis.__VP_CONFIG__.theme` default (the CLI seeds it from `~/.vplan/config.json`), then
  `system` (the OS via `matchMedia`). When `__VP_CONFIG__.lockTheme` is set (the API fixed the
  theme), `isThemeLocked()` is true and the localStorage override is ignored (the injected theme is
  used verbatim). `system` is resolved to a concrete `light`/`dark` and written
  to `<html data-theme>`. This MUST stay in sync with the CLI's inline `themeBootstrap`
  (`compile.ts`), which does the same resolution in a tiny `<head>` script before first paint (so a
  configured dark plan has no light flash). `mount` also calls `applyThemePreference` for paths
  without that bootstrap (e.g. `/view`).
- `components/ShareButton.tsx` is the fixed top-right "Share" button. It reads the plan's encoded
  MDX off `globalThis.__VP_SHARE__` (`{ data, dev }`, injected by the CLI build's `planSharePlugin`)
  and copies a `https://visualplan.dev/view?data=...` link. It renders nothing when that global is
  absent (a unit test, or the runtime mounted without the build). `copyText` tries
  `navigator.clipboard` then falls back to a hidden-textarea `execCommand` (the clipboard API is
  blocked on `file://`, where rendered plans usually open); if both fail it reveals the link to copy
  by hand. On the `--watch` dev server (`dev: true`) it refetches `/__vp_share` at click time so the
  link reflects the current file, and shows a note that the link is a point-in-time snapshot.
- `Phase` renders as a numbered vertical timeline. The step number comes from a CSS counter
  (`counter-reset: vp-phase` on `.vp-main`, `counter-increment` on `.vp-phase`, number drawn by
  `.vp-phase__node::before`), so phases self-number in document order with no index prop. The
  connector line is a `.vp-phase__rail::after` pseudo-element omitted on the last step.
- `components/` holds the components (Phase, FileTree, Chart, Stat, Compare, Matrix, Callout,
  Questions, Checklist, Svg, Mermaid, Math). `Svg` frames a file-inlined diagram (the CLI's
  `svg-include.ts` puts the sanitized markup on its `svg` prop; it renders `error` in place otherwise). `Math` (exported as `MathBlock` to avoid shadowing the global `Math`,
  registered under the `Math` scope key) just injects MathML the CLI's `remark-math` produced from
  a ` ```math ` fence at build time; no math library runs in the browser. `FileTree` builds a nested directory tree from flat `{path}` entries
  (collapsing single-child dir chains); `Checklist` renders done/todo acceptance criteria. Each
  validates its props through `validate.ts`
  against the matching zod schema in `@visualplan/core`, throwing a readable, component-named
  error on invalid input (this surfaces in the page and is the render-time half of validation).
- `components/workspace/` renders each decision as optional custom `Visual` explanations, code model comparisons, optional reasoning, examples, and remaining code changes. `Visual` children of `PlanWorkspace` keep their MDX; the compiler records each one's exact source on its decision (`visuals`), so it joins the decision snapshot and feedback targets. `RevisionChanges` compares the model with the revision this browser opened before the current one (IndexedDB `vp-revision:<path>` stores the current and previous snapshots, so agent renders the reader never opened cannot hide changes and a reload keeps the highlights). Without an earlier opened revision, `review-baseline.ts` rebuilds what the reader last reviewed from the saved review snapshots, so plans reviewed before revisions were kept still highlight; unmarked content counts as unchanged. Reasoning cards without ids pair by content first, because review snapshots store them sorted. `revision-diff.ts` diffs field by field using authored ids; changed text is tinted and shows a word diff on hover, changed code lines are tinted per hunk and show the lines they replaced, removed children are listed per decision, and decision and change tiles carry change markers. A summary line can hide the highlights (`localStorage` `vp-revision-highlights`). `DiffCues` leaves the workspace section to this. Status badges appear only for accepted, denied, or changed items; unreviewed is the silent default. Review buttons sit in the label row of each block. `role: "model"` reuses code contracts, highlighting slots, and review identities. Model entries do not repeat in the final change set. No implementation route renders. Optional explanatory fields produce no empty panels or redundant captions.
- `WorkspaceReview` owns portable review marks, comments, and drafts in IndexedDB scoped by artifact path. Loading finishes before review interaction is enabled. Saves resolve after transaction commit; queued reads follow earlier writes across revision remounts. Existing local storage records are read only when no database record exists. Storage failures remain visible with retry and a complete review backup, and pending or failed saves guard against closing the page. Review snapshots invalidate changed approvals while preserving unchanged ones. Nested denials propagate and block acceptance; decision actions fill only unreviewed descendants. `feedback-targets.ts` reconciles comments against their complete semantic target content, including targets outside the visible decision. Changed or deleted targets lose saved comments permanently; unrelated edits and presentation reordering preserve them. Stale unsaved drafts remain recoverable and cannot silently be saved against new content. Export carries source and revision once, semantic targets, compact selected text, and verbatim comments. Comments carry no kind; older stored kinds are read and ignored. Copying the packet stamps comments with the exported revision, and loading a different revision drops them. `__VP_SOURCE__` supplies the original MDX file for file renders. Local snapshots and fingerprints stay out of export. Browser marks never authorize implementation. The server based `ReviewLayer` remains separate.

## Gotchas

- **Mermaid is rendered by `beautiful-mermaid`**, not the `mermaid` package: `renderMermaidSVG`
  is synchronous and DOM-free, so `Mermaid.tsx` renders the SVG inline during React render (no
  effect, no async) and the diagram appears in the static HTML and SSR output. It is themed via
  our CSS vars, so one SVG adapts to light and dark with no theme detection. Supported diagram
  types: flowchart, sequence, state, class, ER, XY chart. gantt/pie are not supported and throw,
  which the component catches and shows as an inline error. The injected SVG has no `<title>`, so
  the container gets `role="img"` plus an `aria-label` derived from the diagram's first keyword
  (`diagramLabel`) for an accessible name. **beautiful-mermaid injects an
  `@import url('https://fonts.googleapis.com/...')` into the SVG `<style>` per themed font**, which
  would make the self-contained page fetch Google Fonts at view time; `Mermaid.tsx`
  (`stripExternalImports`) removes any external-URL `@import` after rendering (host-agnostic, so a
  dependency CDN change cannot reintroduce one), leaving the system-font fallback. Do not
  reintroduce them; the single-file invariant has no external requests.
- **Fenced code is handled at build time, not in a `pre` override.** Two plugins in
  `src/build/compile.ts` cooperate, and ORDER matters: `remarkMermaid` (remark, mdast stage)
  rewrites ` ```mermaid ` fences into `<Mermaid>` JSX FIRST, then `rehype-expressive-code` (rehype
  stage) highlights every remaining code block. Because mermaid is extracted before the
  highlighter runs, the two never collide. Do NOT reorder them, and do NOT route code through a
  React `pre` override again. Expressive Code gives file-title frames (` ```ts title="src/x.ts" `)
  and dual light/dark via `useDarkModeMediaQuery` (github-dark / github-light). Its copy button is
  off (the injected script would not execute in our client-rendered SPA).
- **Icons are Tabler (`@tabler/icons-react`), one family, stroke ~2.** Components render icon
  elements (FileTree change markers + folder, Compare check/x/star, Callout type icon, Questions
  help icon); never hand-roll SVG paths or text glyphs. Icons inherit `currentColor`, so the
  semantic color CSS still drives them. The one sanctioned exception is the colored Material Icon
  Theme file-type icon in code-block title bars: that comes from the CLI's own build-time file-icons
  plugin (`packages/cli/src/build/expressive-code-file-icons.ts`), not from a runtime component, and
  is intentionally colored. theme.css sizes it via the `.vp-file-icon` class.
- **Fullscreen applies to diagrams and charts only (not code).** React surfaces (Mermaid, Chart)
  render `<ExpandButton>` and get the `.vp-expandable` class; `Layout`'s `useEffect` calls
  `initFullscreenControls()`. Code blocks deliberately have no fullscreen.
  `initFullscreenControls` adds a `fullscreenchange` listener that builds a `PanZoom` viewer + the
  toolbar (zoom out / level / zoom in / close). The viewer fits-to-fill and centers the content on
  open, and supports drag-pan, two-finger touch pinch, and trackpad pinch (ctrl + wheel). It uses an
  absolutely-positioned `.vp-fs-content` layer with a `translate() scale()` transform (origin 0,0),
  so zoom-to-cursor math is exact; the zoom % is shown relative to the fit scale (fit = 100%).
- **Expressive Code header is flattened** to a plain filename bar via `.vp-main .expressive-code
  .frame.has-title .header` overrides (the `.vp-main` prefix is required because EC injects its
  `<style>` in the body, after our head styles). Do not remove the prefix. The `.title` is an
  `inline-flex` row so the file-icons plugin's prepended `<svg class="vp-file-icon">` sits inline
  with the filename; `.vp-file-icon` sizes it. Color chips (`ec-css-color-chip`) are styled by the
  plugin itself (border defaults to `theme.fg`), so they need no CSS here.
- **Recharts `Cell` is deprecation-flagged** in recharts 3 but still functional; it is how
  per-bar/slice colors are set. The hint does not fail typecheck.
- **`@visualplan/core` must stay isomorphic** (no React/recharts/mermaid) — the Node CLI
  imports it too. It lives in `packages/core`.
- A side-effect CSS import needs the `*.css` ambient declaration in `css.d.ts`; `virtual:plan`
  needs the ambient module in `virtual-plan.d.ts`.

## Design language (do not regress)

The plan page is a product-register reading surface (Linear/Stripe-clean), not a marketing
page. The rules below are deliberate; changing them needs a reason.

- **Near-monochrome ink accent.** `--vp-accent` is ink (near-black light / near-white dark), not
  a colored brand hue. Chroma is reserved for *semantic* meaning only: done/add green, risk/delete
  red, modify amber, move cyan, and the Matrix recommended-pick star gold (`--vp-gold`). The one
  chromatic UI affordance is links (`--vp-link`, blue), which follow the universal convention. Do
  not make `--vp-accent` itself a colored hue.
- **No side-stripe accents.** Callouts use a flat tint plus a full 1px border and a colored label,
  never a `border-left` color stripe (a hard ban).
- **Off-white / off-black only**, never pure `#fff` / `#000`. All colors are CSS vars. The dark
  palette is applied two ways that MUST change together: `:root[data-theme="dark"]` (forced dark,
  set by the cog or the configured default) and `@media (prefers-color-scheme: dark)` on
  `:root:not([data-theme="light"])` (the system default; also the pre-script no-flash fallback).
  Plain CSS cannot share one declaration block across a selector and a media query, so the two var
  lists are duplicated on purpose. Both schemes must stay legible. (Mermaid still reads the CSS vars
  with no scheme detection of its own, so toggling `data-theme` recolors a diagram for free.)
- **Mermaid colors come from our CSS vars** (passed to `beautiful-mermaid` as `bg`/`fg`/`line`/
  `accent`/`surface`/`border`), so the diagram tracks the theme automatically. Do not hard-code
  diagram colors or reintroduce scheme detection.
- **Charts are colored** from a shared `COLORS` palette in `Chart.tsx` (vibrant mid-tones that read
  on both surfaces). The pie renders its labels as a custom HTML legend below the chart, not as
  recharts outside labels (those clip against the container). Axis ticks and tooltips are driven by
  CSS vars so dark mode is correct.
- **Callout colors are semantic and distinct:** note (blue), tip (green), decision (purple), risk
  (red), warn (yellow). Each must stay visually different. `tip` green is its own `--vp-tip*` token
  set, not the done/add status green, so the two can diverge. `Questions` is **deliberately not
  neutral**: it is a blue-tinted card with an always-on humming glow (`vp-questions-hum`, paused
  under `prefers-reduced-motion`) so it reads as the panel to act on (and is directly answerable in
  review mode). This is an intentional exception to the otherwise-monochrome chrome; it sits close to
  the blue `note` callout on purpose. Earlier it was a neutral card kept distinct from `note`; that
  was changed by request.
- **Visual verification:** `playwright-core` (devDep) drives the system Chrome to screenshot a
  rendered `.plan.html` in light and dark. Re-check both schemes after any theme change.
  Screenshot pages that contain a `<Chart>` at a **fixed tall viewport, not `fullPage`**:
  `fullPage` resizes the viewport mid-capture, which fires recharts' ResizeObserver and
  re-renders every ResponsiveContainer, leaving ghost/bleed artifacts in the stitched image
  that real users never see. Non-chart content is unaffected by `fullPage`.

## Adding a component

Workspace review snapshots distinguish decision meaning and membership from child code content. Child edits invalidate their own marks and propagate a changed indicator. Decision meaning or membership changes need a new decision mark; accepting the last open child of a changed decision supplies it. Each example is one review item covering usage and result. Automatic acceptance saves an unmarked comparison baseline so later decision changes remain detectable. Optional reasoning serializes as an empty string, and the reader repairs older reasoning fields missing that string.

Workspace ownership comparisons use optional decision `ownership` rows, with stable row and cell feedback anchors. Code removals use `change: "delete"` plus current code without a replacement, or a complete file deletion diff. The removal disclosure keeps review controls visible. Mixed edits keep their full comparison. Both remain inside the existing decision and review system.

1. Add its zod schema, enum constants, and a `CATALOG` entry (with `staticEnums` and an
   example) to `@visualplan/core` (`packages/core/src/index.ts`).
2. Create `components/<Name>.tsx` validating props via `validateProps`.
3. Register it in the `components` map in `index.tsx`.
4. Add it to `packages/cli/templates/example.mdx` and cover it in `tests/components.test.tsx`.

If the component takes list/tabular data, author it as markdown children instead of an
object-array prop: add a parser branch + `BLOCK_DATA_ATTR` entry in the CLI's `plan-blocks.ts`
(this also gives `check` validation for free), and `decodeJson` the data prop in the component.
