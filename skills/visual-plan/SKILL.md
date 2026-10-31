---
name: visual-plan
description: >-
  Use when presenting a software design or structured plan for review, or when
  revising a plan from exported review feedback. Skip when the user asks for
  plain prose.
---

# Visual Plan

- When a local planning skill is active, follow its investigation, publication, validation, and revision workflow over this one.
- When the plan is a software design, author a `PlanWorkspace` plan folder and read [workspace authoring](references/plan-workspace.md) first. Otherwise use stock components.

## Software designs

- Before designing, read the actual source: behavior, callers, ownership, state, contracts, failure paths. When precedent is relevant, check it against the implementation.
- When a nearby boundary invites reuse, consolidation, expansion, or deletion, raise it. Ask before adopting a meaningful expansion.
- When a constraint, including a user requirement, is expensive, propose a concrete simpler model. Keep the constraint unless the user agrees; a declined or ignored suggestion authorizes nothing.
- When intent is agreed, store it as the workspace `vision`. Change the vision only when intent changes; a change reopens approval.
- When no planning workflow owns review before handoff, check the proposal against the `AGENTS.md` instructions of every affected path.
- When a decision is unresolved, keep it explicit. When a question blocks dependent work, resolve it in conversation before presenting that work as settled.

## Author and deliver

- Retain the plan at one path for every revision: a plan folder for a workspace, otherwise an `.mdx` file that starts with one `# Title`, with no imports or frontmatter. Edit a decision's YAML or MDX file directly. Never edit generated HTML.
- Before writing, run `vplan components` for exact syntax. Before handoff, run `vplan check <plan>` and fix every error and warning.
- Never claim a passing `check` proves the plan renders; only a successful render does.
- Give data components Markdown children, not object props. Use a component only when it teaches something. Never invent unsupported fields.
- When text contains a literal `<`, `>`, `{`, or `}`, wrap it in backticks or a fence. Never write raw HTML, Markdown images, emojis, or punctuation dashes.
- When the project provides a pinned renderer and publisher, use them. When HTML, live preview, PDF, or JPG output is needed, read [static exports](references/static-exports.md).
- Start a blocking review session (`vplan <plan>`) only when requested or established for the project, and give `--timeout` with units (`45m`).
- Treat Approve, Deny, and Iterate as feedback, never as permission to implement.
- When reporting, give clickable source and artifact paths and only the checks you actually ran.

## Feedback

- When revising from exported comments, resolve each against the retained source, then update the affected models, reasoning, and examples together.
