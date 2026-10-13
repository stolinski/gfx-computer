import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import type { PosterFrameCapture } from '$lib/utils/canvas-capture';

import { PosterCaptureController, type PosterCaptureServices } from './poster-capture-controller';

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let resolvePromise!: (value: T) => void;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

async function flushPromises(): Promise<void> {
	for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function posterFrame(overrides: Partial<PosterFrameCapture> = {}): PosterFrameCapture {
	return {
		blob: new Blob(['poster']),
		width: 640,
		height: 360,
		contentFraction: 0.2,
		isBlank: false,
		...overrides
	};
}

describe('PosterCaptureController', () => {
	it('cancels delayed work when the canvas/composition identity changes', async () => {
		const firstDelay = deferred<void>();
		const captures: HTMLCanvasElement[] = [];
		let delayIndex = 0;
		const services: PosterCaptureServices = {
			waitForFonts: async () => undefined,
			delay: () => (delayIndex++ === 0 ? firstDelay.promise : Promise.resolve()),
			nextFrame: async () => undefined,
			settlePaint: async () => undefined,
			exists: async () => false,
			capture: async (canvas) => {
				captures.push(canvas);
				return posterFrame();
			},
			store: async () => undefined,
			reportError: () => undefined
		};
		const controller = new PosterCaptureController(services);
		const firstCanvas = {} as HTMLCanvasElement;
		const secondCanvas = {} as HTMLCanvasElement;

		controller.update({ key: 'same-key', canvas: firstCanvas, compositionIdentity: {} });
		await flushPromises();
		controller.update({ key: 'same-key', canvas: secondCanvas, compositionIdentity: {} });
		firstDelay.resolve();
		await flushPromises();

		assert.deepEqual(captures, [secondCanvas]);
	});

	it('captures only after a composition paint settles, never merely after a frame', async () => {
		const steps: string[] = [];
		const settled = deferred<void>();
		const services: PosterCaptureServices = {
			waitForFonts: async () => undefined,
			delay: async () => undefined,
			nextFrame: async () => {
				steps.push('next-frame');
			},
			settlePaint: () => {
				steps.push('settle-paint');
				return settled.promise;
			},
			exists: async () => false,
			capture: async () => {
				steps.push('capture');
				return posterFrame();
			},
			store: async () => {
				steps.push('store');
			},
			reportError: () => undefined
		};
		const controller = new PosterCaptureController(services);

		controller.update({
			key: 'settle-key',
			canvas: {} as HTMLCanvasElement,
			compositionIdentity: {}
		});
		await flushPromises();

		assert.deepEqual(steps, ['settle-paint']);

		settled.resolve();
		await flushPromises();

		assert.deepEqual(steps, ['settle-paint', 'next-frame', 'next-frame', 'capture', 'store']);
	});

	it('marks a key complete only after storage succeeds and permits a failed retry', async () => {
		let storeAttempts = 0;
		let captures = 0;
		const errors: unknown[] = [];
		const services: PosterCaptureServices = {
			waitForFonts: async () => undefined,
			delay: async () => undefined,
			nextFrame: async () => undefined,
			settlePaint: async () => undefined,
			exists: async () => false,
			capture: async () => {
				captures += 1;
				return posterFrame();
			},
			store: async () => {
				storeAttempts += 1;
				if (storeAttempts === 1) throw new Error('storage failed');
			},
			reportError: (error) => errors.push(error)
		};
		const controller = new PosterCaptureController(services);
		const request = { key: 'retry-key', canvas: {} as HTMLCanvasElement, compositionIdentity: {} };

		controller.update(request);
		await flushPromises();
		controller.update(request);
		await flushPromises();
		controller.update(request);
		await flushPromises();

		assert.equal(errors.length, 1);
		assert.equal(storeAttempts, 2);
		assert.equal(captures, 2);
	});

	it('never stores a frame that shows nothing, and leaves the key open for the next view', async () => {
		const stored: string[] = [];
		const errors: unknown[] = [];
		let captures = 0;
		const services: PosterCaptureServices = {
			waitForFonts: async () => undefined,
			delay: async () => undefined,
			nextFrame: async () => undefined,
			settlePaint: async () => undefined,
			exists: async () => false,
			capture: async () => {
				captures += 1;
				return captures === 1 ? posterFrame({ contentFraction: 0, isBlank: true }) : posterFrame();
			},
			store: async (key) => {
				stored.push(key);
			},
			reportError: (error) => errors.push(error)
		};
		const controller = new PosterCaptureController(services);
		const request = { key: 'blank-key', canvas: {} as HTMLCanvasElement, compositionIdentity: {} };

		controller.update(request);
		await flushPromises();
		assert.deepEqual(stored, []);
		assert.deepEqual(errors, []);

		controller.update(request);
		await flushPromises();
		assert.deepEqual(stored, ['blank-key']);
		assert.equal(captures, 2);
	});
});
