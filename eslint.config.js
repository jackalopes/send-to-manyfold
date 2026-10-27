import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'dist/**', '.superpowers/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
