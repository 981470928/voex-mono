import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  prettierConfig,
  {
    plugins: {
      prettier,
    },
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      'prettier/prettier': 'warn',
      'vue/multi-word-component-names': 'off',
      'no-undef': 'off',
    },
  },
  {
    ignores: ['node_modules', 'dist'],
  },
];
