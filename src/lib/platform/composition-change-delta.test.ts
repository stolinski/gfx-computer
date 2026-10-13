import { describe, expect, it } from 'vite-plus/test';

import blankPresetJson from '$lib/presets/blank.json';

import { boundCompositionPointers, diffCompositionDocuments } from './composition-change-delta';
import { parsePresetIngress } from './preset-ingress';
import type { Overlay, Preset } from './engine-schema';

function loadBlankDocument(): Preset {
	return parsePresetIngress(blankPresetJson);
}

function overlay(id: string, title: string): Overlay {
	return {
		type: 'lower-third',
		id,
		content: { title },
		position: { anchor: 'bottom-left', offset: { x: 0.06, y: 0.08 } }
	};
}

function withOverlays(overlays: readonly Overlay[]): Preset {
	const document = loadBlankDocument();
	document.state.overlays = [...overlays];
	return document;
}

describe('composition document diff', () => {
	it('reports nothing for two loads of the same document', () => {
		expect(diffCompositionDocuments(loadBlankDocument(), loadBlankDocument())).toEqual([]);
	});

	it('names the exact pointer a scalar edit moved', () => {
		const next = loadBlankDocument();
		next.state.transport.orientation = 'vertical';
		expect(diffCompositionDocuments(loadBlankDocument(), next)).toEqual([
			'/state/transport/orientation'
		]);
	});

	it('names a top-level metadata edit', () => {
		const next = loadBlankDocument();
		next.name = 'Renamed';
		expect(diffCompositionDocuments(loadBlankDocument(), next)).toEqual(['/name']);
	});

	it('reports an added optional branch at its own pointer', () => {
		const next = loadBlankDocument();
		next.state.backgroundFill = '#101014';
		expect(diffCompositionDocuments(loadBlankDocument(), next)).toEqual(['/state/backgroundFill']);
	});

	it('reports adding an entry as one membership change', () => {
		const previous = withOverlays([overlay('first', 'First')]);
		const next = withOverlays([overlay('first', 'First'), overlay('second', 'Second')]);
		expect(diffCompositionDocuments(previous, next)).toEqual(['/state/overlays']);
	});

	it('reports reordering identified entries without reporting their contents', () => {
		const previous = withOverlays([overlay('first', 'First'), overlay('second', 'Second')]);
		const next = withOverlays([overlay('second', 'Second'), overlay('first', 'First')]);
		expect(diffCompositionDocuments(previous, next)).toEqual(['/state/overlays']);
	});

	it('follows an identified entry to the field that changed inside it', () => {
		const previous = withOverlays([overlay('first', 'First'), overlay('second', 'Second')]);
		const next = withOverlays([overlay('first', 'First'), overlay('second', 'Renamed')]);
		expect(diffCompositionDocuments(previous, next)).toEqual(['/state/overlays/1/content/title']);
	});

	it('compares entries without ids by position', () => {
		const previous = loadBlankDocument();
		previous.state.marks.timings = [{ start: 0.1, duration: 0.2, ease: 'smooth' }];
		const next = loadBlankDocument();
		next.state.marks.timings = [{ start: 0.4, duration: 0.2, ease: 'smooth' }];
		expect(diffCompositionDocuments(previous, next)).toEqual(['/state/marks/timings/0/start']);
	});

	it('reports splicing an entry out of an identity-less list as one membership change', () => {
		const previous = loadBlankDocument();
		previous.state.marks.timings = [
			{ start: 0.1, duration: 0.2, ease: 'smooth' },
			{ start: 0.4, duration: 0.2, ease: 'sharp' },
			{ start: 0.7, duration: 0.2, ease: 'bouncy' }
		];
		const next = loadBlankDocument();
		next.state.marks.timings = [
			{ start: 0.1, duration: 0.2, ease: 'smooth' },
			{ start: 0.7, duration: 0.2, ease: 'bouncy' }
		];
		expect(diffCompositionDocuments(previous, next)).toEqual(['/state/marks/timings']);
	});

	it('follows an identity-less list past a membership change to the entry that also moved', () => {
		const previous = loadBlankDocument();
		previous.state.marks.timings = [
			{ start: 0.1, duration: 0.2, ease: 'smooth' },
			{ start: 0.4, duration: 0.2, ease: 'sharp' }
		];
		const next = loadBlankDocument();
		next.state.marks.timings = [{ start: 0.9, duration: 0.2, ease: 'smooth' }];
		expect(diffCompositionDocuments(previous, next)).toEqual([
			'/state/marks/timings',
			'/state/marks/timings/0/start'
		]);
	});

	it('treats an engine-side undefined and an absent key as the same persisted value', () => {
		const next = loadBlankDocument();
		next.state.stage = undefined;
		next.state.captions = undefined;
		expect(diffCompositionDocuments(loadBlankDocument(), next)).toEqual([]);
	});
});

describe('bounded composition pointers', () => {
	it('keeps the true total when it trims the list', () => {
		expect(boundCompositionPointers(['/a', '/b', '/c'], 2)).toEqual({
			pointers: ['/a', '/b'],
			total: 3,
			truncated: true
		});
	});

	it('reports an untruncated list at its own length', () => {
		expect(boundCompositionPointers(['/a'], 4)).toEqual({
			pointers: ['/a'],
			total: 1,
			truncated: false
		});
	});

	it('rejects a limit that is not a non-negative integer', () => {
		expect(() => boundCompositionPointers([], -1)).toThrow(TypeError);
	});
});
