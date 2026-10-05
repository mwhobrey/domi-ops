import { defineConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * The tests that need a real Postgres and run as the non-superuser app role (a superuser bypasses
 * RLS and would hide a missing policy). Picked up by name: any `*.integration.test.ts` under
 * packages/ or apps/ runs here, so a new one needs no registration. They skip themselves when
 * HOSTED_TEST_DATABASE_URL / DATABASE_URL is unset.
 *
 * `include` is replaced, not merged (merging concatenates arrays and would pull in every unit test).
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["packages/**/src/**/*.integration.test.ts", "apps/**/src/**/*.integration.test.ts"],
  },
});
