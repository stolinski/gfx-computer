import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import type { GpuHost } from './gpu-host';
import type { DecodedVideoAssetFrame } from './video-asset-decoder';
import { VideoUnderlayFrameTexture } from './video-underlay-frame-texture';

interface TextureRecord {
	descriptor: GPUTextureDescriptor;
	destroyed: boolean;
}

function createFixture(): {
	host: GpuHost;
	textures: TextureRecord[];
	copies: unknown[];
} {
	const textures: TextureRecord[] = [];
	const copies: unknown[] = [];
	const device = {
		createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
			const record = { descriptor, destroyed: false };
			textures.push(record);
			return { destroy: () => (record.destroyed = true) } as unknown as GPUTexture;
		},
		queue: {
			copyExternalImageToTexture(source: unknown): void {
				copies.push(source);
			}
		}
	};
	return { host: { device } as unknown as GpuHost, textures, copies };
}

function videoAssetFrame(width = 1280, height = 720): DecodedVideoAssetFrame {
	const imageSource = { displayWidth: width, displayHeight: height } as VideoFrame;
	return {
		sourceTimeSeconds: 0,
		requestedSourceTimestamp: 0,
		presentationTimestamp: 0,
		duration: 1 / 30,
		codedWidth: width,
		codedHeight: height,
		displayWidth: height,
		displayHeight: width,
		rotation: 90,
		pixelAspectRatio: { num: 1, den: 1 },
		visibleRect: { left: 8, top: 4, width, height },
		sample: { toCanvasImageSource: () => imageSource } as DecodedVideoAssetFrame['sample'],
		close: () => undefined
	};
}

describe('VideoUnderlayFrameTexture', () => {
	it('uploads the visible frame into a sampleable external-image destination', () => {
		const { host, textures, copies } = createFixture();
		const frameTexture = new VideoUnderlayFrameTexture(host);

		const prepared = frameTexture.upload(videoAssetFrame());

		assert.equal(prepared.width, 1280);
		assert.equal(prepared.height, 720);
		assert.equal(prepared.displayWidth, 720);
		assert.equal(prepared.displayHeight, 1280);
		assert.equal(prepared.rotation, 90);
		assert.equal(textures.length, 1);
		assert.equal(Number(textures[0].descriptor.usage) & 0x10, 0x10);
		assert.equal(copies.length, 1);
	});

	it('reuses equal-sized textures and destroys replaced and disposed textures', () => {
		const { host, textures } = createFixture();
		const frameTexture = new VideoUnderlayFrameTexture(host);

		frameTexture.upload(videoAssetFrame());
		frameTexture.upload(videoAssetFrame());
		assert.equal(textures.length, 1);

		frameTexture.upload(videoAssetFrame(640, 360));
		assert.equal(textures.length, 2);
		assert.equal(textures[0].destroyed, true);

		frameTexture.dispose();
		assert.equal(textures[1].destroyed, true);
	});
});
