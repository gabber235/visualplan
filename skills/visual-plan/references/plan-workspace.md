# PlanWorkspace

Author one fenced `json` block inside `<PlanWorkspace>`, then optional `<Visual>` elements. Follow `packages/cli/templates/workspace-example.mdx` for a complete workspace. Fields marked `?` are optional; `vplan check` reports unknown keys and missing required fields.

## Fields

Workspace

- `vision?`: the confirmed intent.
- `decisions`: at least one design choice, ordered by dependency.

`vision`

- `problem`, `outcome`: one sentence each.
- `principles?`: strings.
- `scope?`: `{ id, text, status: "in" | "out" }`. When an item crosses the boundary, change only its `status`.
- `facts?`: `{ id, claim, source }`. `source` names the inspected file and symbol, document, command, or observed behavior.

Decision

- `title`: readable alone as an exported comment location.
- `goal?`: only context the title and code cannot carry.
- `code`: entries below. Always include a `role: "model"` entry; validation does not enforce one.
- `reasoning?`: `{ benefits?, costs? }`, each a list of cards `{ id?, title, detail? }`, for material tradeoffs only.
- `ownership?`: rows `{ id, area, current, proposed, removed?: string[] }` for areas that change owner or converge.
- `examples?`: entries below, only when they help assessment.

Code entry

- `language?`: a real syntax name.
- `role?`: `edit` (default) joins the change set; `model` shows first and is not repeated in it.
- `change?`: `modify` (default), `add`, `delete`, `move`.
- `current?`, `proposed?`, `diff?` (exact unified diff). A model needs `current` and `proposed`, no `diff`.
- `summary?`: says when code is condensed or illustrative.
- `invariants?`, `callers?`: strings, when they help assessment.

Example

- `description?`: usage context. `outcome?`: nonobvious behavior.
- `result?`: `{ label, value, language? }` (`language` defaults to `json`).

Visual: `<Visual decision="<decision id>" id="<id>" title="...">` with an MDX body (mermaid fence, `Matrix`, `Compare`, `Chart`, `Stat`, `Svg`, table, short prose). It supplements the code model; never use it in place of one.

Never author the legacy keys `thesis`, `system`, or decision `status`, `summary`, `rationale`, `alternatives`, `consequences`, `risks`, `assumptions`, `contracts`, `scenarios`, `route`, `systemNodeIds`. They parse only for old plans.

## Authoring rules

- When a plan is large, split it into decisions ordered by dependency.
- Make the first draft dense in concrete code: types, owned state, operation bodies, affected callers, consequential branches, failure handling.
- Ground `current` in inspected source. When code is a sketch, condensed, or illustrative, say so in `summary`; never present it as an exact excerpt.
- Make edits complete the mechanism the model introduces: operation bodies, helpers, integration, callers, consequential deletions. Never let a signature stand in for an implementation.
- Trace each material behavioral claim through the shown code.
- When code is removed, author `change: "delete"` with the inspected `current` and no `proposed`. Never invent replacement code such as `// deleted`.
- Show each snippet once. Omit boilerplate and optional text that repeats a title or code.
- End at the change set: no implementation routes, evidence inventories, research diaries, or correction histories.
- When a concept is unchanged across revisions, keep its id; never reuse an id for a new concept.
- Never author approval, review state, review controls, or source metadata.
