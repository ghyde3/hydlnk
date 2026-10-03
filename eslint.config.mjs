import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Public pages draw images straight from Storage (M5-11, M5-12): the pipeline already made the
  // bytes the right size, so nothing may go through the /_next/image optimizer.
  {
    files: ["src/components/page/**", "src/app/(tenant)/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/image",
              message:
                "Public pages use a plain <img> on the stored WebP (M5-11, M5-12); next/image would add /_next/image requests.",
            },
          ],
        },
      ],
    },
  },
  // Must stay last: turns off stylistic rules that conflict with Prettier.
  prettier,
  globalIgnores([
    // Defaults from eslint-config-next
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Project
    "design/**",
    "supabase/.temp/**",
    "tmp/**",
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
