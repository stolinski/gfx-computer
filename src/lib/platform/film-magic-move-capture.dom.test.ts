// @vitest-environment jsdom
import { describe, expect, it } from 'vite-plus/test';

import twoSceneMagicMoveFilmJson from '../../../scripts/fixtures/film-magic-move/two-scene-magic-move.film.json';

import { parseFilm } from './film-ingress';
import {
	captureFilmMagicMoveOverlay,
	type FilmMagicMoveOverlayCaptureRequest
} from './film-magic-move-capture';
import { measureOverlayOrientedBoundsPx } from '../utils/overlay-bounds';
import { cloneJsonValue } from '../utils/json-clone';

import type { EngineState } from './engine-schema';
import type { DomFrameCaptureQueue } from './html-in-canvas';

const CANVAS_SIZE = { width: 3840, height: 2160 };
const TEXTURE = { label: 'element' } as GPUTexture;

/** The outgoing Scene of the fixture: its lower third is at scale 0.7, unrotated. */
function outgoingSceneState(): EngineState {
	return parseFilm(cloneJsonValue(twoSceneMagicMoveFilmJson)).scenes[0].state;
}

/**
 * A capture root shown at half size on screen (as a fitted canvas shows it),
 * holding one Overlay element whose client rect and layout size are given.
 */
function createRoot(overlay: {
	id: string;
	clientRect: DOMRect;
	layoutWidth: number;
	layoutHeight: number;
}): HTMLElement {
	const root = document.createElement('div');
	root.getBoundingClientRect = () => new DOMRect(100, 50, 1920, 1080);
	Object.defineProperty(root, 'offsetWidth', { value: 3840 });
	Object.defineProperty(root, 'offsetHeight', { value: 2160 });
	const element = document.createElement('div');
	element.dataset.overlayId = overlay.id;
	element.getBoundingClientRect = () => overlay.clientRect;
	Object.defineProperty(element, 'offsetWidth', { value: overlay.layoutWidth });
	Object.defineProperty(element, 'offsetHeight', { value: overlay.layoutHeight });
	root.append(element);
	return root;
}

function createCaptureRequest(overrides: Partial<FilmMagicMoveOverlayCaptureRequest> = {}): {
	request: FilmMagicMoveOverlayCaptureRequest;
	captured: string[];
} {
	const captured: string[] = [];
	const captureQueue: DomFrameCaptureQueue = {
		mode: 'canvas-draw-element',
		captureElementToTexture: (element, width, height, destination) => {
			captured.push(
				`${(element as HTMLElement).dataset.root} ${width}x${height} into ${destination.texture.label}`
			);
		}
	};
	// 840×140 layout pixels at scale 0.7 is 588×98 canvas pixels, shown at half size.
	const root = createRoot({
		id: 'lower-third',
		clientRect: new DOMRect(100 + 120, 50 + 900, 294, 49),
		layoutWidth: 840,
		layoutHeight: 140
	});
	root.dataset.root = 'solo-root';
	return {
		captured,
		request: {
			overlayId: 'lower-third',
			root,
			paintGeneration: 3,
			captureQueue,
			canvasSize: CANVAS_SIZE,
			texture: TEXTURE,
			state: outgoingSceneState(),
			overlayChannels: [],
			...overrides
		}
	};
}

describe('the measured box of an Overlay', () => {
	it('is its client rect centre and its layout size times its scale, in canvas pixels', () => {
		const root = createRoot({
			id: 'card',
			clientRect: new DOMRect(100 + 120, 50 + 900, 294, 49),
			layoutWidth: 840,
			layoutHeight: 140
		});

		expect(
			measureOverlayOrientedBoundsPx('card', root, CANVAS_SIZE, { scale: 0.7, rotationDegrees: 0 })
		).toEqual({
			centerX: (120 + 147) * 2,
			centerY: (900 + 24.5) * 2,
			width: 588,
			height: 98,
			rotationDegrees: 0
		});
	});

	it('keeps the unrotated size and the rotation of a turned Overlay', () => {
		// A 400×100 box turned a quarter: its client rect is 100×400 about the same centre.
		const root = createRoot({
			id: 'card',
			clientRect: new DOMRect(100 + 500 - 25, 50 + 300 - 100, 50, 200),
			layoutWidth: 400,
			layoutHeight: 100
		});

		expect(
			measureOverlayOrientedBoundsPx('card', root, CANVAS_SIZE, { scale: 1, rotationDegrees: 90 })
		).toEqual({ centerX: 1000, centerY: 600, width: 400, height: 100, rotationDegrees: 90 });
	});

	it('is null when the root does not hold the Overlay', () => {
		const root = createRoot({
			id: 'card',
			clientRect: new DOMRect(0, 0, 10, 10),
			layoutWidth: 10,
			layoutHeight: 10
		});

		expect(
			measureOverlayOrientedBoundsPx('other', root, CANVAS_SIZE, { scale: 1, rotationDegrees: 0 })
		).toBeNull();
	});
});

describe('the capture of one Overlay a magic move carries', () => {
	it('rasterizes its own root at the canvas size and measures it with the placement scale', () => {
		const { request, captured } = createCaptureRequest();

		const bounds = captureFilmMagicMoveOverlay(request);

		expect(captured).toEqual(['solo-root 3840x2160 into element']);
		expect(bounds).toEqual({
			centerX: (120 + 147) * 2,
			centerY: (900 + 24.5) * 2,
			width: 588,
			height: 98,
			rotationDegrees: 0
		});
	});

	it('measures with the composition-owned scale and rotation when a channel holds the pen', () => {
		const { request } = createCaptureRequest({
			overlayChannels: [{ opacity: 1, x: 0, y: 0, scale: 2, rotation: 15 }]
		});

		expect(captureFilmMagicMoveOverlay(request)).toMatchObject({
			width: 1680,
			height: 280,
			rotationDegrees: 15
		});
	});

	it('reads the placement of the orientation the Scene is in', () => {
		const state = outgoingSceneState();
		state.transport.orientation = 'vertical';
		const { request } = createCaptureRequest({ state });

		// The fixture's vertical placement is at scale 0.75.
		expect(captureFilmMagicMoveOverlay(request)).toMatchObject({ width: 630, height: 105 });
	});

	it('refuses an Overlay the Scene does not hold, one that is not mounted alone, and a root never painted', () => {
		expect(() =>
			captureFilmMagicMoveOverlay(createCaptureRequest({ overlayId: 'missing' }).request)
		).toThrow('has no Overlay "missing"');
		expect(() => captureFilmMagicMoveOverlay(createCaptureRequest({ root: null }).request)).toThrow(
			'not mounted alone'
		);
		const unpainted = createCaptureRequest({ paintGeneration: 0 });
		expect(() => captureFilmMagicMoveOverlay(unpainted.request)).toThrow('not been painted');
		expect(unpainted.captured).toEqual([]);
	});
});
