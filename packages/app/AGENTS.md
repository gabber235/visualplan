# packages/app

The visualplan.dev Astro docs site. It also hosts `/view`, which renders untrusted shared plans.

## Shared plan security

- **All untrusted compilation happens inside the `/plan-frame` iframe**, sandboxed with `allow-scripts` and never `allow-same-origin`. The safety gate runs before `evaluate`.
- The opaque origin frame loads its module bundle only because GitHub Pages sends `Access-Control-Allow-Origin: *`. `astro preview` does not, so test `/view` against `astro build` output from a static server that sends that header. Do not "fix" loading with `allow-same-origin`.
- `/plan-frame` CSP uses only origin independent directives; `'self'` resolves to the opaque origin and blocks its own assets.

## Bundle size

- `/view` loads the compiler and FileTree icons lazily, one chunk per icon. Never reference the icon manifest's `iconDefinitions` in `file-icons-browser.ts`; it adds 71 KB once referenced.
- The browser uses Shiki's JavaScript engine, set only in `compile-browser.ts`, so the CLI keeps oniguruma and byte stable output.

## Constraints

- Keep `vite.resolve.dedupe: ['react', 'react-dom']`; without it the dev server loads two Reacts and the review demo fails with an invalid hook call.
- No `!important` for the Shiki theme swap; colors come from the `--shiki-*` variables.
- Only `<Chart>` demos need `client:only="react"`; everything else renders statically.
- Build the CLI first (`pnpm --filter vplan build`); the app build renders `examples/` with it.
