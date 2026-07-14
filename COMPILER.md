# React Compiler

The build runs the [React Compiler](https://react.dev/learn/react-compiler), which
auto-memoizes components and values — so unchanged components skip re-rendering
without manual `useMemo`/`useCallback`/`React.memo`. It's unconditional (part of the
normal `npm run build` / `dev`).

## Setup
- `react-compiler-runtime` (**dependency**) polyfills `useMemoCache`, which is built
  into React 19 but not our React 18.
- `babel-plugin-react-compiler` (devDep) runs in `web/vite.config.ts` via
  `@vitejs/plugin-react`'s Babel hook — infer mode (compile everything it can),
  `target: '18'`.

## What to know
- **Coexists with existing code.** The remaining hand-written `useMemo`s still work
  (the `preserve-manual-memoization` lint rule validates them); the compiler just
  makes them unnecessary going forward. New code needn't add `useMemo`/`useCallback`.
- **It memoizes the tree**, so unchanged children skip re-rendering when a parent
  re-renders for unrelated state. That's why the scroll-spy can keep the active file
  in plain `useState` (in `App`) without re-rendering the diff cards — no external
  store needed.
- **Cost:** main bundle +~24 kB (+~10 kB gzip) for the memo scaffolding + runtime;
  build ~1s → ~1.5–1.9s. No runtime cost beyond the bundle.

## Linting
`npm --prefix web run lint` runs ESLint (`web/eslint.config.js`) over `src` using
**`eslint-plugin-react-hooks@7`**'s `recommended-latest` set: rules-of-hooks,
`exhaustive-deps` (warn), and the granular React Compiler diagnostics
(`globals`/`refs`/`purity`/`set-state-in-render`/…) that flag code the compiler
can't optimize. (`tseslint.parser` reads TS/TSX.) Notes:
- `react-hooks/set-state-in-effect` is turned **off**: this app deliberately loads
  data in effects (fetch-on-selection, the SSE subscription), where a synchronous
  setState is intentional — it's a hygiene opinion, not a compiler-bailout signal.
- The intentional partial-dep effects (SSE keyed on `review.id`, diff-refetch on
  `uncommitted`, repo-change reset, auto-start) show as `exhaustive-deps`
  **warnings**; leave them (an inline disable would make the compiler rules distrust
  the whole file).

## Verifying the runtime win
In `dev`, React DevTools marks compiled components with a **"Memo ✨"** badge; use the
Profiler to confirm unchanged `DiffView` cards no longer re-render on e.g. a
reviewed-toggle or comment add.

## Notes
- `npm audit` flags transitive advisories from the compiler/ESLint build-time
  dependency trees — review before releasing.
