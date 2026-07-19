import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// React correctness lint via eslint-plugin-react-hooks v7, whose recommended set
// bundles rules-of-hooks, exhaustive-deps, and the React Compiler diagnostics
// (globals/refs/set-state-in-render/…) that flag code the compiler can't optimize.
// tseslint.parser lets it read TS/TSX. Run: `npm run lint`.
export default [
  // Test files call hooks via renderHook (a callback), which trips rules-of-hooks;
  // they're behavior tests run by vitest, not app code, so lint doesn't apply.
  { ignores: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      // Off: this app deliberately loads data in effects (fetch-on-selection, the
      // SSE subscription), where a synchronous setState is intentional. It's a
      // hygiene opinion, not a compiler-bailout signal.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
