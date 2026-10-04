import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  // eslint-plugin-react's "detect" uses context.getFilename(), removed in ESLint 10
  { settings: { react: { version: "19.3" } } },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "models/**",
      "data/**",
      "public/**",
      "scripts/preprocess/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
