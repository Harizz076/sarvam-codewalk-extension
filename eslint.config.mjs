import parser from "@typescript-eslint/parser";
import plugin from "@typescript-eslint/eslint-plugin";

export default [{
  files: ["src/**/*.ts"],
  languageOptions: { parser },
  plugins: { "@typescript-eslint": plugin },
  rules: {
    "@typescript-eslint/no-explicit-any": "error"
  }
}];
