import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vite-plus/test';

import { probeStoredUserVideo } from './user-video-asset-store.server';

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function runFfmpeg(args: readonly string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', args);
		const stderr: Buffer[] = [];
		child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
		child.once('error', reject);
		child.once('close', (code) => {
			if (code === 0) resolve();
			else reject(new Error(Buffer.concat(stderr).toString('utf8').trim()));
		});
	});
}

describe('user video asset store', () => {
	it('probes real video and audio stream metadata with ffprobe', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'gfx-video-probe-'));
		directories.push(directory);
		const filePath = join(directory, 'fixture.mp4');
		await runFfmpeg([
			'-y',
			'-hide_banner',
			'-loglevel',
			'error',
			'-f',
			'lavfi',
			'-i',
			'color=c=red:s=320x180:r=30:d=1',
			'-f',
			'lavfi',
			'-i',
			'sine=frequency=1000:sample_rate=48000:duration=1',
			'-c:v',
			'mpeg4',
			'-c:a',
			'aac',
			'-shortest',
			filePath
		]);

		const metadata = await probeStoredUserVideo(filePath);

		assert.equal(metadata.displayWidth, 320);
		assert.equal(metadata.displayHeight, 180);
		assert.equal(metadata.averageFrameRate, 30);
		assert.equal(metadata.videoCodec, 'mpeg4');
		assert.equal(metadata.hasAudio, true);
		assert.equal(metadata.audioChannels, 1);
		assert.equal(metadata.audioSampleRate, 48000);
		assert.ok(metadata.durationSeconds >= 1);
	}, 15_000);
});
