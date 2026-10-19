import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".next/**", "supabase/**", "node_modules/**"],
  },
);
