const browserGlobals = [
  "document",
  "localStorage",
  "fetch",
  "location",
  "navigator",
  "EventSource",
  "setTimeout",
  "addEventListener",
];
const nodeGlobals = ["URL", "process", "console", "setTimeout", "clearTimeout"];
const globals = (names) =>
  Object.fromEntries(names.map((name) => [name, "readonly"]));
export default [
  { ignores: ["project/**", "dist/**", "node_modules/**"] },
  {
    files: ["viewer.js"],
    languageOptions: { globals: globals(browserGlobals) },
    rules: { "no-unused-vars": "error", "no-undef": "error" },
  },
  {
    files: ["scripts/*.mjs", "eslint.config.mjs"],
    languageOptions: { globals: globals(nodeGlobals) },
    rules: { "no-unused-vars": "error", "no-undef": "error" },
  },
];
