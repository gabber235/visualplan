# PlanWorkspace

Author one fenced `json` block inside `<PlanWorkspace>`, then optional `<Visual>` elements. `packages/cli/templates/workspace-example.mdx` is a complete example. `vplan check` names unknown keys and missing required fields; this list adds the optional fields (marked `?`) and how to fill them.

## Fields

Workspace

- `vision?`: confirmed intent. Required when `decisions` is empty.
- `decisions?`: design choices, ordered by dependency.

`vision`

- `problem`, `outcome`: one sentence each.
- `principles?`: strings.
- `scope?`: `{ id, text, status: "in" | "out" }`. Move an item across the boundary by changing only `status`.
- `facts?`: `{ id, claim, source }`. `source` names the inspected file and symbol, document, command, or observed behavior.

Decision

- `goal?`: context the title and code cannot carry.
- `code`: entries below. Always include a `role: "model"` entry; validation does not require one.
- `reasoning?`: `{ benefits?, costs? }`, each a list of cards `{ id?, title, detail? }`.
- `ownership?`: rows `{ id, area, current, proposed, removed?: string[] }` for areas that change owner or converge.
- `examples?`: entries below.

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

Visual: `<Visual decision="<decision id>" id="<id>" title="...">` with an MDX body (mermaid fence, `Matrix`, `Compare`, `Chart`, `Stat`, `Svg`, table, short prose). It renders before the code model and supplements it.

Legacy keys (`thesis`, `system`, and decision `status`, `summary`, `rationale`, `alternatives`, `consequences`, `risks`, `assumptions`, `contracts`, `scenarios`, `route`, `systemNodeIds`) still parse for old plans. Do not author them.

## Authoring rules

- Ground `current` in inspected source. Never present illustrative code as an exact excerpt.
- Edits complete the mechanism the model introduces: operation bodies, helpers, integration, callers, consequential deletions. A signature does not stand in for an implementation.
- Pure removal: `change: "delete"` with the inspected `current` and no `proposed`. Never invent replacement code such as `// deleted`.
- Show each snippet once; omit boilerplate. Omit optional text that repeats a title or code.
- End at the change set: no implementation routes, evidence appendices, or correction histories.
- Keep ids stable for unchanged concepts and never reuse one for a new concept. Comments and review marks follow ids; a renamed id reads as a removal plus an addition.
- Titles should make an exported comment location understandable alone.
- The browser owns review marks, comments, and export. Never author approval, review state, controls, or source metadata.
