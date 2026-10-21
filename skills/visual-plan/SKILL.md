---
name: visual-plan
description: >-
  Render reviewable plans as interactive HTML with the Visual Plan CLI. Use when
  presenting a software design, revising plan feedback, or creating a structured
  visual plan. Honor requests for plain prose or an existing planning workflow.
---

# Visual Plan

Make the proposal easy to understand and judge. Use `PlanWorkspace` for software designs and stock components for other structured plans. Preserve separate decision navigation and the shared review system. Read [workspace authoring](references/plan-workspace.md) before writing a workspace. If the local planning skill is active, follow its investigation, publication, and revision workflow.

## Software designs

Read actual source before drafting. Trace behavior, callers, ownership, state, contracts, and failure paths. Research relevant precedent and check it against the implementation. Use a subagent to recursively challenge nearby boundaries for useful reuse, consolidation, expansion, and deletion. Ask through the available question tool before incorporating meaningful expansions. After an agreed expansion, investigate the revised model and repeat until no worthwhile gain remains or the user stops.

Challenge expensive constraints, including user requirements, with a concrete simpler model and its behavior effect. Preserve the constraint unless the user agrees to change it. A declined or ignored suggestion does not authorize a change.

Break large plans into separately reviewable decisions, ordered by their dependencies. Within each decision, show current and proposed models in code first, then material rationale and tradeoffs, independent useful examples of usage, behavior, or lifecycle, and the decisive change set. Make removed code and concepts visible. Diagrams can supplement the code model. Omit redundant captions, descriptions, and repeated snippets. Finish at the changes. Do not append routes, evidence inventories, research diaries, or correction histories. Update the current explanation as the design evolves.

Make the first draft dense in concrete code. Draft connected types, owned state, operation bodies, and affected callers before writing their explanation. Include substantial implementation wherever a signature or usage example leaves material behavior unexplained. Show consequential branches, transformations, failure handling, and lifecycle changes; preserve this code when condensing incidental plumbing. Ground current code in inspected source and identify proposed sketches honestly. Before handoff, trace each material behavioral claim through the shown code to its result. If a new helper's hidden body determines whether the proposal works, include it before presenting the draft. Use coverage of the mechanism to judge completeness, rather than a line count or code percentage.

After writing a software plan, validate the whole proposal against the coding principles skill and every applicable `AGENTS.md`. Derive affected paths from the proposed code and its consequences, including callers, tests, configuration, generated artifacts, additions, deletions, and both ends of moves. Read each path's ancestor instructions and recursively discover nested instructions in affected subtrees, respecting scope and precedence. New directories inherit existing ancestor instructions. Review the actual model, code, examples, and verification conditions; reading instruction files alone is insufficient.

Correct findings in the retained plan, rediscover affected paths and instructions when the design changes, and review the revised proposal again. Repeat until a complete pass finds no further actionable corrections and instruction coverage is resolved for every affected path. Keep unresolved decisions and evidence gaps explicit when they prevent assessment. Preserve user approvals and ask before material scope or constraint changes. Repeat this loop after feedback revisions and before the next handoff. Keep review bookkeeping out of the artifact; this process does not authorize implementation. When the local planning skill is active, its written plan validation loop owns this procedure.

## Author and deliver

Write a retained `.mdx` source beginning with one `# Title`, with no imports or frontmatter. Components are already in scope. Preserve unrelated edits and reuse the source path for revisions. Use the project's pinned renderer and guarded publisher when provided; do not replace them with a global installation or review server.

With the CLI, validate using `vplan check <file>.mdx` and resolve reported errors before handoff. Use `vplan components` for exact component signatures. For a portable HTML artifact, live preview, or PDF/JPG export, read [static exports](references/static-exports.md). Keep source alongside generated output. Do not edit generated HTML instead of source. Report only checks actually performed. Browser inspection is not required by this skill.

An explicit CLI review session is available through `vplan <file>.mdx`. It starts a foreground server and waits for feedback; use it only when this review mode is requested or established for the project. Supply timeout units such as `30s` or `45m`. Its Approve, Deny, and Iterate results express review feedback, not automatic permission to implement. Preserve existing authorization boundaries.

Keep output self contained. Use built in highlighting and local SVG inlining, without external assets or runtime libraries. Use `--no-open` when opening is inappropriate or another browser handoff is requested. Return clickable artifact and source paths with a concise verification result.

## Stock component syntax

Extend or reshape components and their model when that makes the actual proposal easier to understand. Update validation, rendering, feedback anchors, and authoring guidance together, reusing existing review and persistence. Remove automatic labels, captions, defaults, and repeated metadata that add no useful information. Do not invent unsupported fields in an artifact.

Use only components that teach something useful. Data components take Markdown children, not object props. Scalar settings remain attributes.

- `Phase`: `<Phase title="..." status="planned|active|done">` wraps one meaningful phase. There is no requirement to create phases.
- `FileTree`: list entries use `add path`, `modify path`, `delete path`, or `move old -> new`. Paths ending in `/` denote directories. Optional inline notes use ` -- note`; omit notes on move rows.
- `Compare`: each option is a `## Name` heading with `pro:` and `con:` bullets. Append `(pick)` to recommend an option.
- `Matrix`: a Markdown table with criteria in the first column. Append `(pick)` to a recommended column header. Keep cells short.
- `Chart`: `<Chart type="bar|line|area|scatter|radar|gauge|funnel|treemap|pie" title="...">`. A single series uses `Label: number` bullets. Multiple series use a table. Scatter needs exactly two value columns. Pie, gauge, funnel, and treemap require bullets. Gauge uses 0 to 100; funnel values descend. `stacked` applies to bar and area.
- `Stat`: `Label: value (intent) -- caption` bullets. Optional intent is `note`, `good`, `warn`, or `risk`. Use actual salient facts.
- `Questions`: one question per bullet, with nested option bullets when useful. In a CLI review, these become answer fields. Resolve decisions that block the design in conversation before presenting dependent work as settled.
- `Checklist`: Markdown task lists inside `<Checklist title="...">`. Use for a meaningful definition of done, rather than appending generic plan checklists.
- `Callout`: wraps Markdown with `type="note|tip|risk|decision|warn"`.
- `Svg`: `<Svg src="./diagram.svg" title="..." caption="..." />` inlines a local static SVG. External references, scripts, event handlers, and `foreignObject` are refused; maximum size is 2 MB.
- Mermaid code fences support flowcharts, sequence, state, class, entity relationship, and XY diagrams. Gantt and pie diagrams are unsupported. Prefer a vertical layout for larger graphs.
- Math fences contain LaTeX display formulas.
- Ordinary code fences use the real language for built in highlighting. Optional `title="src/file.ts"` adds a filename. Expressive Code markers support `ins`, `del`, and `mark`, with line selections, quoted text, or regular expressions.

Diagrams, charts, and SVG have an expand viewer. Avoid wide diagrams, long matrix cells, or charts whose scales obscure the meaningful differences. Put a necessary exact chart value in text when the chart has no value label.

MDX treats bare angle brackets and braces as syntax; wrap literal code in backticks or fences. Raw HTML tags and Markdown images fail validation. Do not add custom review buttons, storage, themes, or frameworks. No emojis or punctuation dashes in prose.

## Feedback

Keep stable semantic IDs and the same artifact path for unchanged concepts. Comments target particular content and revisions. Resolve exported source, revision, target, and quote against retained source, then update affected code models, rationale, and examples together. Ask before a material expansion or agreed constraint change. Do not maintain review states in source.

Unchanged targets retain comments and drafts. Changed or deleted targets retire saved comments. Unsaved drafts remain visible with a stale target warning and saving disabled so the user can recover their writing. Review marks invalidate when their content changes. Feedback export carries concise saved comments, target context, source, and revision. It omits plan inventories and reviewed snapshots. Comments stay local until exported. Browser acceptance is not implementation authorization.
