import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import path from 'node:path';
import ts from 'typescript-eslint';

import svelteConfig from './svelte.config.js';

// Oxlint has no Svelte template AST. Keep the existing component rules here;
// ordinary JS/TS and rune modules are checked by Oxlint, without overlapping runs.
export default defineConfig(
	includeIgnoreFile(path.resolve(import.meta.dirname, '.gitignore')),
	{ ignores: ['docs-site/**'] },
	{
		files: ['**/*.svelte'],
		extends: [
			js.configs.recommended,
			ts.configs.recommended,
			svelte.configs.recommended,
			prettier,
			svelte.configs.prettier
		],
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			parserOptions: { extraFileExtensions: ['.svelte'], parser: ts.parser, svelteConfig }
		},
		rules: {
			'no-empty': ['error', { allowEmptyCatch: true }],
			'no-undef': 'off',
			// Remain untyped: svelte-check is the only whole-project type checker.
			'svelte/no-unused-props': 'off',
			'no-restricted-globals': [
				'error',
				{
					name: 'structuredClone',
					message:
						'structuredClone throws on Svelte $state proxies; use $state.snapshot(value) in Svelte files.'
				}
			]
		}
	}
);
