import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	{
		ignores: ['docs-site/**']
	},
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			'no-empty': ['error', { allowEmptyCatch: true }],
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		},
		rules: {
			// This rule reads type information and reports nothing without it. Lint
			// runs untyped on purpose: `projectService` built a second TypeScript
			// program that cost about 70-110 s and 1.75 GB on every run
			// (docs/project-control-plane.md § Type-check memory and time).
			'svelte/no-unused-props': 'off',
			// Anything read through `$state` is a Proxy, and `structuredClone` throws
			// DataCloneError on a Proxy (Sentry GFX-COMPUTER-X). `$state.snapshot`
			// copies proxies and plain values alike.
			'no-restricted-globals': [
				'error',
				{
					name: 'structuredClone',
					message:
						'structuredClone throws on Svelte $state proxies; use $state.snapshot(value) in Svelte files.'
				}
			]
		}
	},
	{
		// Override or add rule settings here, such as:
		// 'svelte/button-has-type': 'error'
		rules: {}
	}
);
