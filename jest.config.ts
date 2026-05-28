import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
  moduleNameMapper: {
    // pixelmatch v7 is pure ESM; Jest runs in CJS mode — redirect to CJS shim
    "^pixelmatch$": "<rootDir>/tests/__mocks__/pixelmatch.js",
  },
};

export default config;
