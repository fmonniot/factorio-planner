import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'bridge/target']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // A native `title` shows after a delay and is not read as a description: tooltips use `data-tip` (see `tipProps`, `describedTip`).
    files: ['src/components/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name='title']",
        message: 'No native `title` on a DOM element: use `data-tip` (and `tipProps` / `describedTip` for the accessible name and description). See spec/ui.md, Chip tooltips.',
      }],
    },
  },
])
