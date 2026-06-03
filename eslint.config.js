// Flat ESLint config (ESLint v9+). Lints the Node-RED runtime node modules.
// Node-RED nodes are CommonJS: `module.exports = function (RED) { ... }`.
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    files: ["nodes/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      // `_`-prefixed args/vars are intentional throwaways.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
