import { describe, expect, it } from 'vite-plus/test';

import type { DiagramCode } from '$lib/platform/engine-schema';
import { CODE_DIMMED_OPACITY, codeFrameAt, layoutCodeWalkthrough } from './code-tokens';

const PROMISE_CODE = 'fetch(url)\n  .then((res) => res.json())';
const AWAIT_CODE = 'const res = await fetch(url)\nconst data = await res.json()';

function codeBlock(steps: DiagramCode['steps']): DiagramCode {
	return {
		type: 'code',
		id: 'code-test',
		position: { x: 0.5, y: 0.5 },
		language: 'javascript',
		steps
	};
}

const walkthrough = codeBlock([
	{ code: PROMISE_CODE },
	{ code: AWAIT_CODE, move: { start: 0.4, duration: 0.2, ease: 'smooth' } },
	{ highlight: [{ lines: [2, 2] }], move: { start: 0.7, duration: 0.1, ease: 'smooth' } }
]);

describe('layoutCodeWalkthrough', () => {
	it('places tokens on the monospace grid and reads their syntax role', () => {
		const layout = layoutCodeWalkthrough(codeBlock([{ code: PROMISE_CODE }]));
		const fetchToken = layout.steps[0].tokens.find((token) => token.content === 'fetch');
		const thenToken = layout.steps[0].tokens.find((token) => token.content === 'then');
		expect(fetchToken).toMatchObject({ line: 0, column: 0, role: 'function' });
		expect(thenToken).toMatchObject({ line: 1, column: 3 });
		expect(layout.columns).toBe(28);
		expect(layout.lines).toBe(2);
	});

	it('sizes the grid to the widest and tallest step', () => {
		const layout = layoutCodeWalkthrough(walkthrough);
		expect(layout.columns).toBe('const data = await res.json()'.length);
		expect(layout.lines).toBe(2);
	});

	it('keeps the previous code on a step that states none', () => {
		const layout = layoutCodeWalkthrough(walkthrough);
		expect(layout.steps[2].tokens.map((token) => token.content)).toEqual(
			layout.steps[1].tokens.map((token) => token.content)
		);
	});
});

describe('codeFrameAt', () => {
	const layout = layoutCodeWalkthrough(walkthrough);

	it('shows the first step before any move', () => {
		const frame = codeFrameAt(walkthrough, layout, 0.1);
		expect(frame.map((token) => token.content).join('')).toBe(PROMISE_CODE.replace(/\s/g, ''));
	});

	it('glides a shared token between its two places mid-move', () => {
		const before = codeFrameAt(walkthrough, layout, 0.1).find((t) => t.content === 'fetch');
		const during = codeFrameAt(walkthrough, layout, 0.5).find((t) => t.content === 'fetch');
		const after = codeFrameAt(walkthrough, layout, 0.65).find((t) => t.content === 'fetch');
		expect(before?.column).toBe(0);
		expect(after?.column).toBe('const res = await '.length);
		expect(during?.column).toBeGreaterThan(0);
		expect(during?.column).toBeLessThan(after?.column ?? 0);
		expect(during?.key).toBe(before?.key);
	});

	it('fades leaving tokens out in the first half and arriving tokens in the second', () => {
		const early = codeFrameAt(walkthrough, layout, 0.45);
		const late = codeFrameAt(walkthrough, layout, 0.55);
		expect(early.find((t) => t.content === 'then')?.opacity).toBeGreaterThan(0);
		expect(early.find((t) => t.content === 'await')?.opacity).toBe(0);
		expect(late.find((t) => t.content === 'then')?.opacity ?? 0).toBe(0);
		expect(late.find((t) => t.content === 'await')?.opacity).toBeGreaterThan(0);
	});

	it('dims every token outside the highlight once it lands', () => {
		const frame = codeFrameAt(walkthrough, layout, 0.9);
		for (const token of frame) {
			expect(token.opacity).toBe(token.line === 1 ? 1 : CODE_DIMMED_OPACITY);
		}
	});

	it('gives every token on a frame its own key', () => {
		for (const progress of [0, 0.45, 0.5, 0.55, 0.75, 1]) {
			const keys = codeFrameAt(walkthrough, layout, progress).map((token) => token.key);
			expect(new Set(keys).size).toBe(keys.length);
		}
	});

	it('answers the same frame for the same progress', () => {
		expect(codeFrameAt(walkthrough, layout, 0.47)).toEqual(
			codeFrameAt(walkthrough, layoutCodeWalkthrough(walkthrough), 0.47)
		);
	});
});
