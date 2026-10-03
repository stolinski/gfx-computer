import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultEngineState } from './engine-schema';
import {
	deriveDeterministicReadableContract,
	deriveDeterministicTransitionReadableContracts
} from './deterministic-readable-contract';
import {
	composedElementScale,
	coveringDeterministicViewportRect,
	deterministicFontCheckDescriptor,
	hasDeterministicReadableCharacters,
	inkRectForTextRect,
	matchesDeterministicRenderedText,
	nativeRectForElement,
	parseDeterministicCssShadows,
	type DeterministicNativeRootGeometry
} from './runtime-audit';

afterEach(() => vi.unstubAllGlobals());

describe('deterministic readable fragment geometry', () => {
	it('covers painted line fragments without inheriting a stretched block box', () => {
		expect(
			coveringDeterministicViewportRect([
				{ left: 10, top: 20, right: 90, bottom: 40, width: 80, height: 20 },
				{ left: 10, top: 45, right: 60, bottom: 65, width: 50, height: 20 },
				{ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
			])
		).toEqual({ left: 10, top: 20, right: 90, bottom: 65 });
	});
});

describe('deterministic readable character discovery', () => {
	it('ignores punctuation-only separators while retaining semantic text', () => {
		expect(hasDeterministicReadableCharacters(' · ')).toBe(false);
		expect(hasDeterministicReadableCharacters('—')).toBe(false);
		expect(hasDeterministicReadableCharacters('Section 2')).toBe(true);
	});
});

describe('deterministic runtime font readiness', () => {
	it('builds a valid FontFaceSet descriptor without relying on an empty font shorthand', () => {
		expect(
			deterministicFontCheckDescriptor({ fontSize: '48px', fontFamily: '"Archivo", sans-serif' })
		).toBe('48px "Archivo", sans-serif');
		expect(deterministicFontCheckDescriptor({ fontSize: '', fontFamily: 'Archivo' })).toBeNull();
	});
});

describe('deterministic runtime native geometry', () => {
	it('converts DOM rectangles with independent root-to-backing-store axes', () => {
		const root = {
			contains: (candidate: unknown) => candidate === element
		} as unknown as HTMLElement;
		const element = {
			getBoundingClientRect: () => ({
				left: 125,
				top: 70,
				right: 325,
				bottom: 120,
				width: 200,
				height: 50
			})
		} as unknown as Element;
		const geometry: DeterministicNativeRootGeometry = {
			root,
			viewportRect: { left: 25, top: 20, width: 960, height: 1080 } as DOMRect,
			scaleX: 4,
			scaleY: 2
		};
		expect(nativeRectForElement(element, [geometry])).toEqual({
			x: 400,
			y: 100,
			width: 800,
			height: 100
		});
	});

	it('rounds outward to complete native pixel bounds', () => {
		const root = { contains: () => true } as unknown as HTMLElement;
		const element = {
			getBoundingClientRect: () => ({
				left: 25.2,
				top: 20.2,
				right: 26.2,
				bottom: 21.2,
				width: 1,
				height: 1
			})
		} as unknown as Element;
		const geometry: DeterministicNativeRootGeometry = {
			root,
			viewportRect: { left: 25, top: 20, width: 960, height: 1080 } as DOMRect,
			scaleX: 4,
			scaleY: 2
		};
		expect(nativeRectForElement(element, [geometry])).toEqual({
			x: 0,
			y: 0,
			width: 5,
			height: 3
		});
	});

	it('stops cap-height transform accumulation before preview-root transforms', () => {
		class Matrix {
			a = 1;
			b = 0;
			c = 0;
			d = 1;
			constructor(value?: string) {
				const match = value?.match(/matrix\(([^,]+),[^,]+,[^,]+,([^,]+)/);
				if (match) {
					this.a = Number(match[1]);
					this.d = Number(match[2]);
				}
			}
			multiply(other: Matrix): Matrix {
				const result = new Matrix();
				result.a = this.a * other.a;
				result.d = this.d * other.d;
				return result;
			}
		}
		vi.stubGlobal('DOMMatrixReadOnly', Matrix);
		const root = { parentElement: null, scaleValue: 10 } as unknown as HTMLElement;
		const parent = { parentElement: root, scaleValue: 3 } as unknown as HTMLElement;
		const element = { parentElement: parent, scaleValue: 2 } as unknown as HTMLElement;
		vi.stubGlobal('getComputedStyle', (node: HTMLElement) => ({
			transform: `matrix(${(node as unknown as { scaleValue: number }).scaleValue},0,0,${(node as unknown as { scaleValue: number }).scaleValue},0,0)`,
			scale: 'none'
		}));
		expect(composedElementScale(element, root)).toBe(6);
	});

	it('parses and binds every CSS shadow independently', () => {
		expect(
			parseDeterministicCssShadows(
				'rgba(0, 0, 0, 0.4) 2px 4px 8px 1px, rgb(0, 0, 0) -3px 5px 6px 0px',
				'box-shadow'
			)
		).toEqual([
			{
				property: 'box-shadow',
				shadowIndex: 0,
				offsetX: 2,
				offsetY: 4,
				blurRadius: 8,
				spreadRadius: 1
			},
			{
				property: 'box-shadow',
				shadowIndex: 1,
				offsetX: -3,
				offsetY: 5,
				blurRadius: 6,
				spreadRadius: 0
			}
		]);
	});
});

describe('typed readable identity authority', () => {
	it('requires canonical rendered text and supports caption-owned spacing text', () => {
		expect(
			matchesDeterministicRenderedText(
				{ textContent: 'Wrong title', dataset: {} } as Pick<HTMLElement, 'textContent' | 'dataset'>,
				'Expected title'
			)
		).toBe(false);
		expect(
			matchesDeterministicRenderedText(
				{
					textContent: 'CSSspaces',
					dataset: { gfxReadableText: 'CSS spaces' }
				} as Pick<HTMLElement, 'textContent' | 'dataset'>,
				'CSS spaces'
			)
		).toBe(true);
	});

	it('derives both transition endpoint Presets at their settled snapshot times', () => {
		const from = createDefaultEngineState();
		from.surface.type = 'plain';
		from.surface.content.title = undefined;
		from.surface.content.body = [
			{ type: 'paragraph', segments: [{ text: 'From endpoint', markStyles: [] }] }
		];
		const to = createDefaultEngineState();
		to.surface.type = 'plain';
		to.surface.content.title = undefined;
		to.surface.content.body = [
			{ type: 'paragraph', segments: [{ text: 'To endpoint', markStyles: [] }] }
		];
		const contracts = deriveDeterministicTransitionReadableContracts({
			from: {
				schema: 'gfx@1',
				name: 'From',
				pack: 'syntax',
				kind: 'fixture',
				state: from
			},
			to: {
				schema: 'gfx@1',
				name: 'To',
				pack: 'syntax',
				kind: 'fixture',
				state: to
			}
		});
		expect(contracts.map((entry) => entry.endpoint)).toEqual(['from', 'to']);
		for (const entry of contracts) {
			expect(entry.contract.status).toBe('available');
			if (entry.contract.status === 'available') {
				expect(entry.contract.expected[0]?.id).toBe('surface:plain:body:0');
			}
		}
	});

	it('derives canonical rendered Surface URL text and stable paragraph identities', () => {
		const state = createDefaultEngineState();
		state.surface.type = 'paper';
		state.surface.content.sourceUrl = 'https://www.example.com/story';
		state.surface.content.body = [
			{ type: 'paragraph', segments: [{ text: 'Canonical body', markStyles: [] }] }
		];
		const contract = deriveDeterministicReadableContract(state, 1_000_000);
		expect(contract.status).toBe('available');
		if (contract.status === 'available') {
			expect(contract.expected).toContainEqual({
				id: 'surface:paper:source-url',
				text: 'example.com',
				role: 'surface-label'
			});
			expect(contract.expected.map((entry) => entry.id)).toContain('surface:paper:body:0');
		}
	});

	it('omits Surface slots until their text-animation paint begins', () => {
		const state = createDefaultEngineState();
		state.surface.type = 'type-hero';
		state.surface.content.body = [];
		state.surface.content.title = 'Watch next';
		state.textAnimations = [
			{
				id: 'title-reveal',
				target: { kind: 'surface', slot: 'title' },
				effect: 'micro-scale-fade',
				enter: { start: 0.2, duration: 0.1, ease: 'smooth' }
			}
		];
		const hidden = deriveDeterministicReadableContract(state, 0);
		const visible = deriveDeterministicReadableContract(state, 2_000_000);
		expect(hidden.status).toBe('available');
		expect(visible.status).toBe('available');
		if (hidden.status === 'available' && visible.status === 'available') {
			expect(hidden.expected.map((entry) => entry.id)).not.toContain('surface:type-hero:title');
			expect(visible.expected.map((entry) => entry.id)).toContain('surface:type-hero:title');
		}
	});

	it('derives complete iMessage window chrome and message identities', () => {
		const state = createDefaultEngineState();
		state.surface.type = 'imessage';
		state.surface.chrome = 'window';
		state.surface.content.author = 'Wes';
		state.surface.content.body = [];
		state.surface.content.messages = [
			{
				from: 'them',
				text: [{ type: 'paragraph', segments: [{ text: 'Found it', markStyles: [] }] }],
				tapback: 'heart',
				enter: { start: 0.1, duration: 0.05 }
			},
			{
				from: 'me',
				text: [{ type: 'paragraph', segments: [{ text: 'Ship it', markStyles: [] }] }],
				status: 'read',
				enter: { start: 0.3, duration: 0.05 }
			}
		];
		const contract = deriveDeterministicReadableContract(state, 4_000_000);
		expect(contract.status).toBe('available');
		if (contract.status === 'available') {
			expect(contract.expected).toEqual(
				expect.arrayContaining([
					{
						id: 'surface:imessage:chrome:timestamp',
						text: 'Today 2:14 PM',
						role: 'found-document-metadata'
					},
					{
						id: 'surface:imessage:chrome:composer',
						text: 'iMessage',
						role: 'found-document-metadata'
					},
					{
						id: 'surface:imessage:message:0:tapback',
						text: '♥',
						role: 'found-document-metadata'
					},
					{
						id: 'surface:imessage:message:1:status',
						text: 'Read',
						role: 'found-document-metadata'
					}
				])
			);
		}
	});

	it.each([
		['reddit', ['score', 'posted-by', 'comments', 'share', 'save']],
		['hackernews', ['site-name', 'navigation', 'reply']],
		['github', ['issue-number', 'open-status', 'opened-issue', 'comment-author', 'owner-role']],
		['news', ['by']],
		['pubmed', ['ncbi', 'library-name', 'login', 'search-placeholder', 'display-options']],
		['youtube', ['likes', 'reply']]
	] as const)('derives complete %s fixed web-document chrome', (site, chromeIds) => {
		const state = createDefaultEngineState();
		state.surface.type = 'web-document';
		state.surface.site = site;
		state.surface.content.source = 'source';
		state.surface.content.author = 'author';
		state.surface.content.dateLabel = 'date';
		state.surface.content.sourceUrl = 'https://example.com/issues/142';
		state.surface.content.body = [];
		const contract = deriveDeterministicReadableContract(state, 1_000_000);
		expect(contract.status).toBe('available');
		if (contract.status === 'available') {
			const ids = new Set(contract.expected.map((entry) => entry.id));
			for (const chromeId of chromeIds) {
				expect(ids.has(`surface:web-document:chrome:${chromeId}`)).toBe(true);
			}
		}
	});

	it('derives the canonical Wikipedia subtitle when the authored source is absent', () => {
		const state = createDefaultEngineState();
		state.surface.type = 'web-document';
		state.surface.site = 'wikipedia';
		state.surface.content.source = undefined;
		state.surface.content.body = [];
		const contract = deriveDeterministicReadableContract(state, 1_000_000);
		expect(contract.status).toBe('available');
		if (contract.status === 'available') {
			expect(contract.expected).toContainEqual({
				id: 'surface:web-document:chrome:wikipedia-subtitle',
				text: 'From Wikipedia, the free encyclopedia',
				role: 'found-document-metadata'
			});
		}
	});

	it('derives overlay identities from parsed renderer content, not observed DOM', () => {
		const state = createDefaultEngineState();
		state.overlays = [
			{
				id: 'lower',
				type: 'lower-third',
				content: { variant: 'standard', kicker: 'NEWS', title: 'Typed title' },
				position: { anchor: 'bottom-left' }
			}
		];
		const contract = deriveDeterministicReadableContract(state, 1_000_000);
		expect(contract.status).toBe('available');
		if (contract.status === 'available') {
			expect(contract.expected.map((entry) => entry.id)).toContain('overlay:lower:title');
			expect(contract.expected.map((entry) => entry.id)).toContain('overlay:lower:kicker');
		}
	});

	it('keeps one stable readable identity for a changing counter value', () => {
		const state = createDefaultEngineState();
		state.overlays = [
			{
				id: 'counter',
				type: 'counter',
				content: { from: 0, to: 10, format: 'integer' },
				position: { anchor: 'center' }
			}
		];
		const contract = deriveDeterministicReadableContract(state, 1_000_000);
		expect(contract.status).toBe('available');
		if (contract.status === 'available') {
			expect(contract.expected.map((entry) => entry.id)).toContain('overlay:counter:value');
		}
	});
});

describe('inkRectForTextRect', () => {
	it('shrinks a text run box to its published ink insets', () => {
		// 200 px tall run whose face spans 1.25 em: one em is 160 px.
		expect(
			inkRectForTextRect({ left: 100, top: 0, right: 900, bottom: 200 }, '0.05 0.25 0.1 0.25 1.25')
		).toEqual({ left: 108, top: 40, right: 884, bottom: 160 });
	});

	it('keeps the box when the insets are missing or malformed', () => {
		const rect = { left: 0, top: 0, right: 10, bottom: 10 };
		expect(inkRectForTextRect(rect, '')).toBe(rect);
		expect(inkRectForTextRect(rect, '1 2 3')).toBe(rect);
		expect(inkRectForTextRect(rect, '0 0 0 0 0')).toBe(rect);
	});
});
