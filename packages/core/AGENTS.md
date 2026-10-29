# packages/core

The component vocabulary (zod schemas and `CATALOG`) and contracts shared by the browser runtime and the Node CLI.

## Invariants

- **`index.ts` depends only on `zod`.** `share.ts` (with `fflate`) is a separate subpath that imports from `index.ts`, never the reverse; `index.ts` is what gets vendored into the runtime.
- **Keep the share codec isomorphic**: no Node `Buffer`, no DOM `btoa`.
- **Untrusted decodes pass a size cap** to `decodePlan`, which then aborts on a decompression bomb.
