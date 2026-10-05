import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Apostrophes and quotes in JSX text render fine; escaping them only makes copy harder to read.
      "react/no-unescaped-entities": "off",
      // React Compiler advisories (react-hooks v7). They flag long-standing patterns such as resetting
      // form state in an effect when a sheet opens. Visible as warnings, not blocking, until we adopt
      // the compiler and clean them up on purpose.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts", "public/**"]),
]);
