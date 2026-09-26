export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "refactor", "docs", "chore", "test", "ci", "build"],
    ],
    "header-max-length": [2, "always", 100],
    "subject-case": [0],
  },
};
