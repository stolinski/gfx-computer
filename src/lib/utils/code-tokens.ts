/**
 * Code Block token engine: tokenises each Code step with Shiki, keys tokens
 * across neighbouring steps with the magic-move differ, lays every token on a
 * monospace grid, and answers what each token looks like at a composition
 * progress. Pure and synchronous, so preview and export compute the same frame.
 *
 * Shiki supplies only token boundaries and their syntax role. Colour never
 * comes from a Shiki theme: the role theme below paints each role with a
 * sentinel colour that is read back as the role, and the Code Block derives the
 * real colours from the Pack's fill and ink.
 *
 * Position needs no measurement: the face is monospace, so a token's place is
 * its line and column, and a glide is a straight interpolation between grid
 * cells. `@shikijs/magic-move`'s own renderer is never used — it animates on
 * wall-clock time.
 */
import { syncTokenKeys, toKeyedTokens, type KeyedToken } from '@shikijs/magic-move/core';
import gsap from 'gsap';
import {
	createHighlighterCoreSync,
	type HighlighterCore,
	type ThemeRegistration
} from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import bash from 'shiki/langs/bash.mjs';
import css from 'shiki/langs/css.mjs';
import html from 'shiki/langs/html.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import json from 'shiki/langs/json.mjs';
import jsx from 'shiki/langs/jsx.mjs';
import svelte from 'shiki/langs/svelte.mjs';
import tsx from 'shiki/langs/tsx.mjs';
import typescript from 'shiki/langs/typescript.mjs';

import {
	getEaseGsap,
	type CodeHighlightRange,
	type CodeLanguage,
	type DiagramCode
} from '$lib/platform/engine-schema';

/** The syntax roles a Code Block colours. Each takes a derived colour. */
export type CodeTokenRole =
	| 'plain'
	| 'keyword'
	| 'string'
	| 'number'
	| 'function'
	| 'type'
	| 'property'
	| 'comment'
	| 'punctuation';

const CODE_ROLE_SENTINELS: Record<CodeTokenRole, string> = {
	plain: '#000000',
	keyword: '#000001',
	string: '#000002',
	number: '#000003',
	function: '#000004',
	type: '#000005',
	property: '#000006',
	comment: '#000007',
	punctuation: '#000008'
};

const CODE_ROLE_BY_SENTINEL = new Map(
	Object.entries(CODE_ROLE_SENTINELS).map(([role, sentinel]) => [sentinel, role as CodeTokenRole])
);

// TextMate scopes → role. Distinct sentinels also stop Shiki merging a
// punctuation mark into its neighbour, so `res.json()` moves as four tokens.
const CODE_ROLE_THEME: ThemeRegistration = {
	name: 'gfx-code-roles',
	type: 'dark',
	fg: CODE_ROLE_SENTINELS.plain,
	bg: '#ffffff',
	settings: [
		{
			scope: [
				'keyword',
				'storage',
				'keyword.operator.new',
				'variable.language',
				'constant.language'
			],
			settings: { foreground: CODE_ROLE_SENTINELS.keyword }
		},
		{
			scope: ['string', 'string.template', 'punctuation.definition.string'],
			settings: { foreground: CODE_ROLE_SENTINELS.string }
		},
		{
			scope: ['constant.numeric', 'constant.character'],
			settings: { foreground: CODE_ROLE_SENTINELS.number }
		},
		{
			scope: [
				'entity.name.function',
				'support.function',
				'meta.function-call entity.name.function'
			],
			settings: { foreground: CODE_ROLE_SENTINELS.function }
		},
		{
			scope: [
				'entity.name.type',
				'entity.name.class',
				'support.type',
				'support.class',
				'entity.name.tag',
				'support.type.property-name.json'
			],
			settings: { foreground: CODE_ROLE_SENTINELS.type }
		},
		{
			scope: [
				'variable.other.property',
				'variable.other.object.property',
				'meta.object-literal.key',
				'entity.other.attribute-name',
				'support.type.property-name'
			],
			settings: { foreground: CODE_ROLE_SENTINELS.property }
		},
		{
			scope: ['comment', 'punctuation.definition.comment'],
			settings: { foreground: CODE_ROLE_SENTINELS.comment }
		},
		{
			scope: ['punctuation', 'meta.brace', 'keyword.operator'],
			settings: { foreground: CODE_ROLE_SENTINELS.punctuation }
		}
	]
};

let codeHighlighter: HighlighterCore | null = null;

function getCodeHighlighter(): HighlighterCore {
	codeHighlighter ??= createHighlighterCoreSync({
		themes: [CODE_ROLE_THEME],
		langs: [javascript, typescript, jsx, tsx, svelte, css, html, json, bash],
		engine: createJavaScriptRegexEngine()
	});
	return codeHighlighter;
}

/** Tabs become two columns so every glyph sits on one grid cell. */
const CODE_TAB = '  ';

/** One visible token placed on the monospace grid (0-based line and column). */
export interface CodeGridToken {
	readonly key: string;
	readonly content: string;
	readonly role: CodeTokenRole;
	readonly line: number;
	readonly column: number;
}

/** A step's tokens and its highlight, ready to draw or to morph. */
export interface CodeStepLayout {
	readonly tokens: readonly CodeGridToken[];
	readonly highlight: readonly CodeHighlightRange[];
}

function placeKeyedTokens(tokens: readonly KeyedToken[]): CodeGridToken[] {
	const placed: CodeGridToken[] = [];
	let line = 0;
	let column = 0;
	for (const token of tokens) {
		if (token.content === '\n') {
			line += 1;
			column = 0;
			continue;
		}
		const content = token.content.replaceAll('\t', CODE_TAB);
		if (content.trim() !== '') {
			placed.push({
				key: token.key,
				content,
				role: CODE_ROLE_BY_SENTINEL.get(token.color?.toLowerCase() ?? '') ?? 'plain',
				line,
				column
			});
		}
		column += content.length;
	}
	return placed;
}

function keyCodeTokens(language: CodeLanguage, code: string, salt: string) {
	const result = getCodeHighlighter().codeToTokens(code, {
		lang: language,
		theme: CODE_ROLE_THEME.name ?? 'gfx-code-roles'
	});
	return toKeyedTokens(code, result.tokens, salt);
}

/** The code each step shows: a step without `code` keeps the previous step's. */
export function resolveCodeStepSources(primitive: DiagramCode): string[] {
	const sources: string[] = [];
	for (const step of primitive.steps) {
		const code = step.code ?? sources.at(-1);
		if (code === undefined) {
			throw new TypeError(`code "${primitive.id}": the first step must state its code.`);
		}
		sources.push(code);
	}
	return sources;
}

/**
 * Every step's layout, keyed so a token both neighbouring steps share carries
 * one key. A move runs from step `i - 1` into step `i`. Tokens match whole and
 * are never split at diff edges: a split word moves as stray letters.
 */
export interface CodeWalkthroughLayout {
	readonly steps: readonly CodeStepLayout[];
	/** The grid the panel is sized to: the widest and tallest step. */
	readonly columns: number;
	readonly lines: number;
}

export function layoutCodeWalkthrough(primitive: DiagramCode): CodeWalkthroughLayout {
	const sources = resolveCodeStepSources(primitive);
	const salt = `${primitive.id}:${primitive.language}`;
	const keyed = [keyCodeTokens(primitive.language, sources[0], salt)];
	for (let index = 1; index < sources.length; index += 1) {
		const next = keyCodeTokens(primitive.language, sources[index], salt);
		keyed.push(syncTokenKeys(keyed[index - 1], next).to);
	}
	const steps = keyed.map((info, index) => ({
		tokens: placeKeyedTokens(info.tokens),
		highlight: primitive.steps[index].highlight ?? []
	}));
	const grids = sources.map((code) =>
		code.split('\n').map((line) => line.replaceAll('\t', CODE_TAB))
	);
	return {
		steps,
		columns: Math.max(...grids.flat().map((line) => line.length)),
		lines: Math.max(...grids.map((lines) => lines.length))
	};
}

/** How strongly an unlit token shows while any range on its step is lit. */
export const CODE_DIMMED_OPACITY = 0.3;

function isCodeTokenLit(token: CodeGridToken, highlight: readonly CodeHighlightRange[]): boolean {
	if (highlight.length === 0) return true;
	const line = token.line + 1;
	const firstColumn = token.column + 1;
	const lastColumn = token.column + token.content.length;
	return highlight.some((range) => {
		if (line < range.lines[0] || line > range.lines[1]) return false;
		if (!range.columns) return true;
		return lastColumn >= range.columns[0] && firstColumn <= range.columns[1];
	});
}

/** One token as drawn on one frame. `role` is the colour it arrives with. */
export interface CodeFrameToken {
	readonly key: string;
	readonly content: string;
	readonly role: CodeTokenRole;
	readonly line: number;
	readonly column: number;
	readonly opacity: number;
}

function staticFrame(step: CodeStepLayout): CodeFrameToken[] {
	return step.tokens.map((token) => ({
		...token,
		opacity: isCodeTokenLit(token, step.highlight) ? 1 : CODE_DIMMED_OPACITY
	}));
}

function clampUnit(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, t: number): number {
	return from + (to - from) * t;
}

/**
 * A move reads like Keynote's: leaving tokens fade over the first half,
 * staying tokens glide across the whole window, arriving tokens fade in over
 * the second half. Dimming changes across the whole window.
 */
function moveFrame(
	from: CodeStepLayout,
	to: CodeStepLayout,
	progress: number,
	eased: number
): CodeFrameToken[] {
	const fromByKey = new Map(from.tokens.map((token) => [token.key, token]));
	const toKeys = new Set(to.tokens.map((token) => token.key));
	const frame: CodeFrameToken[] = [];
	for (const token of from.tokens) {
		if (toKeys.has(token.key)) continue;
		const strength = isCodeTokenLit(token, from.highlight) ? 1 : CODE_DIMMED_OPACITY;
		frame.push({ ...token, opacity: strength * clampUnit(1 - progress * 2) });
	}
	for (const token of to.tokens) {
		const toStrength = isCodeTokenLit(token, to.highlight) ? 1 : CODE_DIMMED_OPACITY;
		const origin = fromByKey.get(token.key);
		if (!origin) {
			frame.push({ ...token, opacity: toStrength * clampUnit(progress * 2 - 1) });
			continue;
		}
		const fromStrength = isCodeTokenLit(origin, from.highlight) ? 1 : CODE_DIMMED_OPACITY;
		frame.push({
			...token,
			line: lerp(origin.line, token.line, eased),
			column: lerp(origin.column, token.column, eased),
			opacity: lerp(fromStrength, toStrength, eased)
		});
	}
	return frame;
}

/** Every token of a Code Block at one composition progress (0–1). */
export function codeFrameAt(
	primitive: DiagramCode,
	layout: CodeWalkthroughLayout,
	globalProgress: number
): CodeFrameToken[] {
	let current = 0;
	for (let index = 1; index < primitive.steps.length; index += 1) {
		const move = primitive.steps[index].move;
		if (!move || globalProgress < move.start) break;
		if (move.duration > 0 && globalProgress < move.start + move.duration) {
			const progress = clampUnit((globalProgress - move.start) / move.duration);
			const eased = gsap.parseEase(getEaseGsap(move.ease))(progress);
			return moveFrame(layout.steps[index - 1], layout.steps[index], progress, eased);
		}
		current = index;
	}
	return staticFrame(layout.steps[current]);
}
