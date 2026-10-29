# packages/compile

The MDX pipeline shared by the CLI render and the in-browser `/view` compiler.

## Invariants

- **`src/index.ts` is browser safe.** Node only plugins (`file-icons`, `filetree-icons`) are separate subpaths that only the CLI appends.
- **`src/safety-gate.ts` is the `/view` security boundary.** Every rejected construct has a test; never weaken it without adding one.
- **Plugin order is load bearing.** Plan blocks, mermaid, and math run after GFM; mermaid fences are extracted before Expressive Code. Do not route code through a React `pre` override.
- **CLI output stays byte stable.** After changing plugins or Expressive Code options, render `packages/cli/templates/example.mdx` before and after and diff, unless the change is intended.
- **Code themes key off `<html data-theme>`.** Both the CLI bootstrap and the runtime `mount` must keep setting it.
