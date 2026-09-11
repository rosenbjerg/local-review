# React Compiler

The build runs the [React Compiler](https://react.dev/learn/react-compiler), which
auto-memoizes components and values — so unchanged components skip re-rendering
without manual `useMemo`/`useCallback`/`React.memo`. It's unconditional (part of the
normal `bun run build` / `dev`).

## Setup
- `react-compiler-runtime` (**dependency**) polyfills `useMemoCache`, which is built
  into React 19 but not our React 18.
- `babel-plugin-react-compiler` (devDep) runs in `web/vite.config.ts` — infer mode
  (compile everything it can), `target: '18'`. It's wired in as its **own Vite
  plugin**, `@rolldown/plugin-babel` carrying `@vitejs/plugin-react`'s
  `reactCompilerPreset({ target: '18' })`: since plugin-react v6 the plugin itself
  transforms with Oxc and no longer has a `babel` option to hang the compiler off.
  The preset is a preconfigured filter around the same `babel-plugin-react-compiler`,
  so the memoization it emits is unchanged.
- plugin-react also ships an **experimental native (Rust) React Compiler** behind
  `react({ compiler: true })` (via `oxc-transform-react`), which would drop Babel from
  the build entirely. Deliberately not used: `DiffView`'s hand-written
  `samePropsExceptComments` comparator exists because this compiler can't cache
  per-iteration inside `App`'s file map, so switching implementations is a behavior
  change to evaluate on its own, not a build tweak.

## What to know
- **Coexists with existing code.** The remaining hand-written `useMemo`s still work
  (the `preserve-manual-memoization` lint rule validates them); the compiler just
  makes them unnecessary going forward. New code needn't add `useMemo`/`useCallback`.
- **It memoizes the tree**, so unchanged children skip re-rendering when a parent
  re-renders for unrelated state. That's why the scroll-spy can keep the active file
  in plain `useState` (in `App`) without re-rendering the diff cards — no external
  store needed.
- **Cost:** main bundle +~24 kB (+~10 kB gzip) for the memo scaffolding + runtime.
  Babel is now the only non-native step in an otherwise Rolldown/Oxc build, so it's
  most of the bundling time: ~1.6s total, against ~0.4s with the compiler plugin
  removed. No runtime cost beyond the bundle.

## Bailouts

A function the compiler can't lower is **skipped silently**: the build succeeds, the app
works, and nothing says so. That costs the file its auto-memoization, which is
load-bearing wherever a `memo` boundary compares props by identity — `DiffView` is the
only one, and a handler rebuilt each render disables it for every mounted card.

`bun scripts/compilercheck.ts --check` (CI, beside the fontfeatures check) is the guard:
it runs the compiler over every non-test file under `web/src` and fails on any bailout
not in `scripts/compiler-baseline.txt`, which is empty and should stay that way. Run it
without `--check` to regenerate. **Lint does not cover this** — see below.

The shapes that bailed here, all of them mechanical to avoid:

| Bails | Write instead |
| --- | --- |
| `ref.current = x` during render | assign it in an effect |
| `try { … } finally { … }` | run the finally body on the straight-line path after a catch-all `try`/`catch` |
| a conditional, `&&`, `??` or `?.` **inside** a `try` block | compute it before the `try`, which then holds only the `await` |
| `x++` on a local captured by a lambda | `x = x + 1` |
| `?.` inside a logical test | read the fields off locals first |
| `for (;;)` | `while (true)` |
| a call to a function declared further down the component | move the declaration above the call |

## Linting
`bun run --cwd web lint` runs ESLint (`web/eslint.config.js`) over `src` using
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
  the whole file). Five warnings is the expected count.
- **A green lint is not evidence the compiler ran.** The compiler stops at the first
  error per function, so only that one is reported — and it may map to no enabled rule
  at all, in which case the file bails out in total silence. `react-hooks/refs` is an
  *error* here and still said nothing about `DiffView`'s ref-write-during-render,
  because a different bailout came first. `scripts/compilercheck.ts` is what actually
  checks, and it's the only thing that does.

## Verifying the runtime win
In `dev`, React DevTools marks compiled components with a **"Memo ✨"** badge; use the
Profiler to confirm unchanged `DiffView` cards no longer re-render on e.g. a
reviewed-toggle or comment add.

`vitest` runs **without** the compiler (see `web/vitest.config.ts`), so no test can tell
a compiled file from a bailed-out one. Identity that comes from an explicit `useMemo` is
testable there (`diffViewMemo.test.tsx` pins `useCommentActions`); identity that comes
from the compiler is not, and is covered by `compilercheck` instead.

## Notes
- `bun audit` flags transitive advisories from the compiler/ESLint build-time
  dependency trees — review before releasing.
