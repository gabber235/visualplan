---
name: visual-plan
description: >-
  Use when presenting a software design or structured plan for review, or when
  revising a plan from exported review feedback. Skip when the user asks for
  plain prose.
---

# Visual Plan

Use `PlanWorkspace` for software designs and stock components for other plans. Read [workspace authoring](references/plan-workspace.md) before writing a workspace. If a local planning skill is active, its investigation, publication, validation, and revision workflow takes precedence.

## Software designs

- Read the actual source first: behavior, callers, ownership, state, contracts, failure paths. Check relevant precedent against the implementation.
- Challenge nearby boundaries for reuse, consolidation, expansion, and deletion. Ask before adopting a meaningful expansion.
- Challenge expensive constraints, including user requirements, with a concrete simpler model. Keep the constraint unless the user agrees; a declined or ignored suggestion authorizes nothing.
- Store agreed intent as the workspace `vision`. Render a vision only workspace to confirm intent before designing, then add decisions to the same source. Changing the vision reopens approval, so change it only when intent changes.
- Split large plans into decisions ordered by dependency. Each shows current and proposed models in code first, then material tradeoffs, useful examples, and the change set. Make removals visible. End at the changes: no routes, evidence inventories, research diaries, or correction histories.
- Make the first draft dense in concrete code: types, owned state, operation bodies, affected callers, consequential branches, failure handling. Mark proposed sketches as such. Trace each material behavioral claim through the shown code; include any helper body the proposal depends on.
- Review before handoff is owned by the caller's planning workflow. Without one, check the proposal against the `AGENTS.md` instructions of every affected path. Keep unresolved decisions explicit.

## Author and deliver

- Write a retained `.mdx` file starting with one `# Title`; no imports or frontmatter. Reuse the same path for revisions. Never edit generated HTML.
- Run `vplan components` for exact syntax before writing, and `vplan check <file>.mdx` before handoff; fix every error and warning. `check` does not render, so only a successful render shows the plan is complete.
- Data components take Markdown children, not object props. Use a component only when it teaches something. Do not invent unsupported fields.
- MDX treats bare `<`, `>`, `{`, `}` as syntax; wrap literal code in backticks or fences. No raw HTML, Markdown images, emojis, or punctuation dashes.
- Resolve blocking questions in conversation before presenting dependent work as settled.
- Use the project's pinned renderer and publisher when provided. For HTML, live preview, or PDF and JPG, read [static exports](references/static-exports.md).
- `vplan <file>.mdx` starts a blocking review session; use it only when requested or established for the project. Give `--timeout` with units (`45m`). Approve, Deny, and Iterate are feedback, not permission to implement.
- Report clickable source and artifact paths and only the checks you actually ran.

## Feedback

Keep stable semantic IDs and the same artifact path for unchanged concepts; comments and review marks attach to them. Resolve each exported comment against the retained source, then update the affected models, rationale, and examples together. Never store review state in the source.
