import assert from 'node:assert/strict';
import { describe, it } from 'vite-plus/test';

import {
	buildMarkerCustomData,
	buildReplacePlanAction,
	buildSyncedMarkerUpdates,
	buildSyncExportFilename,
	deriveMarkerSync,
	groupGfxMarkers,
	normalizeTimelineFps,
	parseBeatLabel,
	parseMarkerCustomData,
	type DeriveMarkerSyncOptions,
	type MarkerGroup,
	type ResolveMarker,
	type ResolveTimelineSnapshot
} from './marker-sync.ts';

// Grammar v2 is color-blind on read: fixtures deliberately mix colors so any
// accidental color dependence fails loudly.
function marker(overrides: Partial<ResolveMarker> & { frameId: number }): ResolveMarker {
	return {
		color: 'Purple',
		name: '',
		note: '',
		durationFrames: 1,
		customData: '',
		...overrides
	};
}

// The flagship shape: a 29.97 NDF timeline starting at 00:00:00:00, one head
// dragged to 300 frames (exactly 10.01 s) and five beats — the show-rundown's
// five item enters — in whatever colors the editor happened to use.
function rundownSnapshot(): ResolveTimelineSnapshot {
	return {
		fps: 29.97,
		startFrame: 0,
		markers: [
			{ ...marker({ frameId: 60 }), color: 'Blue', name: 'Chapter — intro' },
			marker({ frameId: 240, note: 'supers checklist-show-rundown', durationFrames: 300 }),
			marker({ frameId: 285, name: 'Cold open', color: 'Blue' }),
			marker({ frameId: 342, name: 'Main topic', color: 'Green' }),
			marker({ frameId: 401, name: 'Hot tip', color: 'Sand' }),
			marker({ frameId: 458, name: 'Sick picks', color: 'Purple' }),
			marker({ frameId: 510, name: 'Shameless plugs', color: 'Rose' })
		]
	};
}

// The preset's authored ABSOLUTE windows (6 s clip, enters 0.09 × 6 s = 0.54 s).
function rundownOptions(): DeriveMarkerSyncOptions {
	return {
		slug: 'checklist-show-rundown',
		items: [
			{ startSeconds: 0.48, durationSeconds: 0.54 },
			{ startSeconds: 1.32, durationSeconds: 0.54 },
			{ startSeconds: 2.16, durationSeconds: 0.54 },
			{ startSeconds: 3.0, durationSeconds: 0.54 },
			{ startSeconds: 3.84, durationSeconds: 0.54 }
		],
		cardEnterDurationSeconds: 0.3
	};
}

// The same group closed by an explicit END marker instead of a dragged head
// (the live-proof shape: undragged head, labeled beats, END, mixed colors).
function endClosedSnapshot(): ResolveTimelineSnapshot {
	const snapshot = rundownSnapshot();
	snapshot.markers[1].durationFrames = 1;
	snapshot.markers.push({
		...marker({ frameId: 540 }),
		name: 'SHOW RUNDOWN END',
		color: 'Blue'
	});
	return snapshot;
}

describe('normalizeTimelineFps', () => {
	it('maps Resolve rate strings and true NTSC rates to the schema literals', () => {
		assert.equal(normalizeTimelineFps('29.97'), 29.97);
		assert.equal(normalizeTimelineFps(30000 / 1001), 29.97);
		assert.equal(normalizeTimelineFps('23.976'), 23.976);
		assert.equal(normalizeTimelineFps(24000 / 1001), 23.976);
		assert.equal(normalizeTimelineFps('59.94'), 59.94);
		assert.equal(normalizeTimelineFps('24.0'), 24);
		assert.equal(normalizeTimelineFps(30), 30);
	});

	it('rejects rates with no exact rational form', () => {
		assert.throws(() => normalizeTimelineFps('29.5'), TypeError);
		assert.throws(() => normalizeTimelineFps('nope'), TypeError);
		assert.throws(() => normalizeTimelineFps(0), TypeError);
	});
});

describe('parseBeatLabel', () => {
	it('reads the item text and role from a beat name', () => {
		assert.deepEqual(parseBeatLabel('Cold open'), { text: 'Cold open', role: 'build-in' });
		assert.deepEqual(parseBeatLabel('Fix the flaky test - Checked'), {
			text: 'Fix the flaky test',
			role: 'checked'
		});
		assert.deepEqual(parseBeatLabel('Buy milk - Add to list'), {
			text: 'Buy milk',
			role: 'add-to-list'
		});
	});

	it('matches role suffixes case-insensitively and only on the last separator', () => {
		assert.deepEqual(parseBeatLabel('Ship it - CHECKED'), { text: 'Ship it', role: 'checked' });
		assert.deepEqual(parseBeatLabel('CI - deploy - Checked'), {
			text: 'CI - deploy',
			role: 'checked'
		});
		// An unknown suffix is item text, not a role.
		assert.deepEqual(parseBeatLabel('Alpha - Beta'), { text: 'Alpha - Beta', role: 'build-in' });
	});
});

describe('groupGfxMarkers', () => {
	it('groups by head note in any input color; unrelated markers stay untouched', () => {
		const { groups, warnings } = groupGfxMarkers(rundownSnapshot().markers);
		assert.equal(groups.length, 1);
		assert.equal(groups[0].slug, 'checklist-show-rundown');
		assert.equal(groups[0].head.frameId, 240);
		assert.equal(groups[0].end, null);
		assert.deepEqual(
			groups[0].beats.map((beat) => beat.frameId),
			[285, 342, 401, 458, 510]
		);
		assert.deepEqual(warnings, []);
	});

	it('splits groups at each head; strays without customData are not ours and stay silent', () => {
		const { groups, warnings } = groupGfxMarkers([
			marker({ frameId: 10, name: 'Chapter — cold open', color: 'Blue' }),
			marker({ frameId: 100, note: 'supers piece-a', durationFrames: 60 }),
			marker({ frameId: 120 }),
			marker({ frameId: 200, name: 'Chapter — topic', color: 'Blue' }),
			marker({ frameId: 300, note: 'supers piece-b', durationFrames: 60 }),
			marker({ frameId: 330 })
		]);
		assert.deepEqual(
			groups.map((group) => [group.slug, group.beats.length]),
			[
				['piece-a', 1],
				['piece-b', 1]
			]
		);
		// Frame 200 sits beyond piece-a's 160-frame span end and carries no
		// customData — a chapter marker, not an orphan.
		assert.deepEqual(warnings, []);
	});

	it('warns when previously synced markers sit outside every group', () => {
		const { groups, warnings } = groupGfxMarkers([
			marker({
				frameId: 10,
				customData: buildMarkerCustomData('piece-gone', 2, 1)
			}),
			marker({ frameId: 100, note: 'supers piece-a', durationFrames: 60 }),
			marker({ frameId: 120 })
		]);
		assert.equal(groups.length, 1);
		assert.equal(warnings.length, 1);
		assert.equal(warnings[0].code, 'orphan-beats');
	});

	it('closes the span at the first END-named marker; later markers are not beats', () => {
		const snapshot = endClosedSnapshot();
		snapshot.markers.push({
			...marker({ frameId: 800 }),
			name: 'Chapter — outro',
			color: 'Blue'
		});
		const { groups, warnings } = groupGfxMarkers(snapshot.markers);
		assert.equal(groups.length, 1);
		assert.equal(groups[0].end?.frameId, 540);
		assert.deepEqual(
			groups[0].beats.map((beat) => beat.frameId),
			[285, 342, 401, 458, 510]
		);
		assert.deepEqual(warnings, []);
	});

	it('finds a previously synced END through customData even when renamed', () => {
		const snapshot = endClosedSnapshot();
		const end = snapshot.markers.at(-1);
		assert.ok(end);
		end.name = 'wrap here';
		end.customData = buildMarkerCustomData('checklist-show-rundown', -1, 1);
		const { groups } = groupGfxMarkers(snapshot.markers);
		assert.equal(groups[0].end?.frameId, 540);
	});

	it('finds previously synced (Mint) groups through customData, without re-parsing notes', () => {
		const { groups } = groupGfxMarkers([
			marker({
				frameId: 240,
				color: 'Mint',
				durationFrames: 300,
				customData: buildMarkerCustomData('checklist-show-rundown', 0, 1)
			}),
			marker({
				frameId: 285,
				color: 'Mint',
				customData: buildMarkerCustomData('checklist-show-rundown', 1, 1)
			})
		]);
		assert.equal(groups.length, 1);
		assert.equal(groups[0].slug, 'checklist-show-rundown');
		assert.equal(groups[0].beats.length, 1);
	});
});

describe('deriveMarkerSync', () => {
	it('derives frame-exact timings from the flagship rundown group', () => {
		const derivation = deriveMarkerSync(rundownSnapshot(), rundownOptions());

		assert.equal(derivation.fps, 29.97);
		assert.equal(derivation.spanFrames, 300);
		assert.equal(derivation.spanSource, 'head-duration');
		// 300 frames at 30000/1001 is exactly 10.01 s.
		assert.equal(derivation.durationSeconds, 10.01);
		assert.equal(derivation.headRecordFrame, 240);
		assert.equal(derivation.startTimecode, '00:00:08:00');
		assert.equal(derivation.version, 1);
		assert.deepEqual(
			derivation.syncedBeats.map((beat) => beat.recordFrame),
			[285, 342, 401, 458, 510]
		);
		// Beat labels carry the item text.
		assert.deepEqual(
			derivation.syncedBeats.map((beat) => beat.name),
			['Cold open', 'Main topic', 'Hot tip', 'Sick picks', 'Shameless plugs']
		);
		assert.deepEqual(derivation.warnings, []);

		// Item starts pin to beat frames; lengths keep the authored 0.54 s
		// (16 frames at 29.97), as clip fractions of the 300-frame span.
		const beatOffsets = [45, 102, 161, 218, 270];
		derivation.itemWindows.forEach((window, index) => {
			assert.equal(window.start, beatOffsets[index] / 300, `item ${index + 1} start`);
			assert.equal(window.duration, 16 / 300, `item ${index + 1} duration`);
			// The frame-exactness invariant the placement probe relies on:
			// fraction × span rounds back to the beat's exact frame offset.
			assert.equal(Math.round(window.start * derivation.spanFrames), beatOffsets[index]);
		});
	});

	it('lets an explicit END marker author the span (undragged head)', () => {
		const derivation = deriveMarkerSync(endClosedSnapshot(), rundownOptions());
		assert.equal(derivation.spanFrames, 300);
		assert.equal(derivation.spanSource, 'end-marker');
		assert.deepEqual(derivation.warnings, []);
		assert.equal(derivation.itemWindows[0].start, 45 / 300);
	});

	it('prefers the END marker over a disagreeing dragged head duration, with a warning', () => {
		const snapshot = endClosedSnapshot();
		snapshot.markers[1].durationFrames = 280;
		const derivation = deriveMarkerSync(snapshot, rundownOptions());
		assert.equal(derivation.spanFrames, 300);
		assert.equal(derivation.spanSource, 'end-marker');
		assert.ok(derivation.warnings.some((warning) => warning.code === 'end-vs-head-duration'));
	});

	it('derives from a conversationally selected free-label group (no head note anywhere)', () => {
		const head = marker({ frameId: 4491, name: 'Objective Checklist Start', color: 'Purple' });
		const beats = [
			marker({ frameId: 4551, name: 'Wave hello - Checked', color: 'Blue' }),
			marker({ frameId: 4611, name: 'Track the ball - Add to list', color: 'Purple' })
		];
		const end = marker({ frameId: 5701, name: 'Objective END', color: 'Blue' });
		const group: MarkerGroup = { slug: 'reachy-objective', head, beats, end };
		const snapshot: ResolveTimelineSnapshot = {
			fps: 29.97,
			startFrame: 86400,
			markers: [head, ...beats, end]
		};

		const derivation = deriveMarkerSync(snapshot, {
			slug: 'reachy-objective',
			items: [
				{ startSeconds: 0.5, durationSeconds: 0.5 },
				{ startSeconds: 1.5, durationSeconds: 0.5 }
			],
			cardEnterDurationSeconds: 0.3,
			group
		});

		assert.equal(derivation.spanFrames, 1210);
		assert.equal(derivation.spanSource, 'end-marker');
		assert.equal(derivation.headRecordFrame, 86400 + 4491);
		assert.equal(derivation.version, 1);
		assert.deepEqual(
			derivation.itemWindows.map((window) => Math.round(window.start * 1210)),
			[60, 120]
		);
		assert.deepEqual(
			derivation.syncedBeats.map((beat) => parseBeatLabel(beat.name)),
			[
				{ text: 'Wave hello', role: 'checked' },
				{ text: 'Track the ball', role: 'add-to-list' }
			]
		);
	});

	it('normalizes a non-zero timeline start frame once (record frames absolute, marker keys relative)', () => {
		const snapshot = rundownSnapshot();
		snapshot.startFrame = 108000; // 01:00:00:00 at NDF-30 labels
		const derivation = deriveMarkerSync(snapshot, rundownOptions());
		assert.equal(derivation.headRecordFrame, 108240);
		assert.equal(derivation.startTimecode, '01:00:08:00');
		assert.deepEqual(
			derivation.syncedBeats.slice(0, 2).map((beat) => beat.recordFrame),
			[108285, 108342]
		);
	});

	it('emits drop-frame start timecode when the timeline start TC declares DF', () => {
		// The ReachyMini shape: a DF timeline starting 01:00:00;00 — one DF hour
		// is 107892 real frames, so GetStartFrame is 107892, not 108000.
		const snapshot = rundownSnapshot();
		snapshot.startFrame = 107892;
		snapshot.startTimecode = '01:00:00;00';
		const derivation = deriveMarkerSync(snapshot, rundownOptions());
		assert.equal(derivation.headRecordFrame, 107892 + 240);
		assert.equal(derivation.startTimecode, '01:00:08;00');
	});

	it('keeps NDF labels when the start TC uses colon separators', () => {
		const snapshot = rundownSnapshot();
		snapshot.startFrame = 108000;
		snapshot.startTimecode = '01:00:00:00';
		const derivation = deriveMarkerSync(snapshot, rundownOptions());
		assert.equal(derivation.startTimecode, '01:00:08:00');
	});

	it('falls back to last beat + tail when the head is undragged and unclosed, with a warning', () => {
		const snapshot = rundownSnapshot();
		snapshot.markers[1].durationFrames = 1;
		const derivation = deriveMarkerSync(snapshot, rundownOptions());
		// Last beat offset 270 + 2.5 s (75 frames at 29.97) = 345 frames.
		assert.equal(derivation.spanFrames, 345);
		assert.equal(derivation.spanSource, 'last-beat-fallback');
		assert.ok(derivation.warnings.some((warning) => warning.code === 'undragged-head-duration'));
	});

	it('ignores extra beats with a warning', () => {
		const snapshot = rundownSnapshot();
		snapshot.markers.push(marker({ frameId: 540 }));
		const derivation = deriveMarkerSync(snapshot, rundownOptions());
		assert.equal(derivation.itemWindows.length, 5);
		assert.equal(derivation.syncedBeats.length, 5);
		assert.ok(derivation.warnings.some((warning) => warning.code === 'beat-count-mismatch'));
	});

	it('keeps missing-beat items on their authored spacing after the last synced beat', () => {
		const snapshot = rundownSnapshot();
		snapshot.markers = snapshot.markers.slice(0, 4); // head + beats 285, 342 only
		const derivation = deriveMarkerSync(snapshot, rundownOptions());

		assert.ok(derivation.warnings.some((warning) => warning.code === 'beat-count-mismatch'));
		assert.equal(derivation.itemWindows[0].start, 45 / 300);
		assert.equal(derivation.itemWindows[1].start, 102 / 300);
		// Item 3 keeps its authored 0.84 s gap after item 2 (25 frames at 29.97).
		assert.equal(derivation.itemWindows[2].start, (102 + 25) / 300);
		assert.equal(derivation.itemWindows[3].start, (102 + 50) / 300);
		assert.equal(derivation.itemWindows[4].start, (102 + 76) / 300);
	});

	it('warns when beat 1 lands before the card enter completes', () => {
		const snapshot = rundownSnapshot();
		snapshot.markers[2].frameId = 245; // 5 frames after the head ≈ 0.167 s < 0.3 s
		const derivation = deriveMarkerSync(snapshot, rundownOptions());
		assert.ok(
			derivation.warnings.some((warning) => warning.code === 'beat-before-enter-complete')
		);
	});

	it('warns when previously synced beats sit out of item order', () => {
		const snapshot = rundownSnapshot();
		snapshot.markers[2].customData = buildMarkerCustomData('checklist-show-rundown', 2, 1);
		snapshot.markers[3].customData = buildMarkerCustomData('checklist-show-rundown', 1, 1);
		const derivation = deriveMarkerSync(snapshot, rundownOptions());
		assert.ok(derivation.warnings.some((warning) => warning.code === 'beats-out-of-order'));
	});

	it('pulls a window back inside the span with a warning when a beat leaves it', () => {
		const snapshot = rundownSnapshot();
		snapshot.markers[6].frameId = 240 + 295; // 16-frame window would end at 311 > 300
		const derivation = deriveMarkerSync(snapshot, rundownOptions());
		assert.ok(derivation.warnings.some((warning) => warning.code === 'beat-beyond-span'));
		const last = derivation.itemWindows[4];
		assert.equal(Math.round((last.start + last.duration) * derivation.spanFrames), 300);
	});

	it('increments the sync version past the highest already on the group', () => {
		const snapshot = rundownSnapshot();
		snapshot.markers[1].customData = buildMarkerCustomData('checklist-show-rundown', 0, 3);
		const derivation = deriveMarkerSync(snapshot, rundownOptions());
		assert.equal(derivation.version, 4);
	});

	it('fails fast when the slug has no group on the timeline', () => {
		assert.throws(
			() => deriveMarkerSync(rundownSnapshot(), { ...rundownOptions(), slug: 'not-there' }),
			/No marker group for "not-there"/
		);
	});
});

describe('sync round-trip artifacts', () => {
	it('round-trips marker customData', () => {
		const raw = buildMarkerCustomData('checklist-show-rundown', 2, 1);
		assert.match(raw, /"schema":"gfx-sync@1"/);
		assert.deepEqual(parseMarkerCustomData(raw), {
			schema: 'gfx-sync@1',
			slug: 'checklist-show-rundown',
			beat: 2,
			version: 1
		});
		assert.equal(parseMarkerCustomData(''), null);
		assert.equal(parseMarkerCustomData('{"schema":"other@1"}'), null);
	});

	it('reads a receipt written under either namespace as the same payload', () => {
		const legacy = parseMarkerCustomData(
			'{"schema":"supers-sync@1","slug":"checklist-show-rundown","beat":2,"version":1}'
		);
		const current = parseMarkerCustomData(
			'{"schema":"gfx-sync@1","slug":"checklist-show-rundown","beat":2,"version":1}'
		);
		assert.deepEqual(current, legacy);
		assert.deepEqual(
			legacy,
			parseMarkerCustomData(buildMarkerCustomData('checklist-show-rundown', 2, 1))
		);
	});

	it('finds a group whose head was synced under the other namespace', () => {
		const snapshot = rundownSnapshot();
		snapshot.markers[1] = {
			...snapshot.markers[1],
			note: '',
			customData: '{"schema":"gfx-sync@1","slug":"checklist-show-rundown","beat":0,"version":2}'
		};
		const { groups } = groupGfxMarkers(snapshot.markers);
		assert.deepEqual(
			groups.map((group) => group.slug),
			['checklist-show-rundown']
		);
		// A re-sync must continue that group's version series, not restart it.
		assert.equal(deriveMarkerSync(snapshot, rundownOptions()).version, 3);
	});

	it('opens a group from either head-note prefix a human may have typed', () => {
		const snapshot = rundownSnapshot();
		snapshot.markers[1] = { ...snapshot.markers[1], note: 'gfx checklist-show-rundown' };
		const { groups } = groupGfxMarkers(snapshot.markers);
		assert.deepEqual(
			groups.map((group) => group.slug),
			['checklist-show-rundown']
		);
		assert.equal(groups[0].beats.length, 5);
	});

	it('builds the Mint updates for the head plus synced beats only', () => {
		const snapshot = rundownSnapshot();
		snapshot.markers.push(marker({ frameId: 540 })); // extra beat — keeps its input color
		const updates = buildSyncedMarkerUpdates(snapshot, 'checklist-show-rundown', 1, 5);
		assert.deepEqual(
			updates.map((update) => update.frameId),
			[240, 285, 342, 401, 458, 510]
		);
		assert.ok(updates.every((update) => update.color === 'Mint'));
		assert.deepEqual(parseMarkerCustomData(updates[0].customData)?.beat, 0);
		assert.deepEqual(parseMarkerCustomData(updates[5].customData)?.beat, 5);
	});

	it('includes the END marker in the receipt as beat -1', () => {
		const updates = buildSyncedMarkerUpdates(endClosedSnapshot(), 'checklist-show-rundown', 1, 5);
		const end = updates.at(-1);
		assert.ok(end);
		assert.equal(end.frameId, 540);
		assert.equal(end.color, 'Mint');
		assert.equal(parseMarkerCustomData(end.customData)?.beat, -1);
	});

	it('accepts a conversationally selected group for the receipt', () => {
		const head = marker({ frameId: 100, name: 'Objective Checklist Start' });
		const beat = marker({ frameId: 160, name: 'Wave hello - Checked' });
		const end = marker({ frameId: 400, name: 'Objective END' });
		const group: MarkerGroup = { slug: 'reachy-objective', head, beats: [beat], end };
		const snapshot: ResolveTimelineSnapshot = {
			fps: 29.97,
			startFrame: 0,
			markers: [head, beat, end]
		};
		const updates = buildSyncedMarkerUpdates(snapshot, 'reachy-objective', 1, 1, group);
		assert.deepEqual(
			updates.map((update) => [update.frameId, parseMarkerCustomData(update.customData)?.beat]),
			[
				[100, 0],
				[160, 1],
				[400, -1]
			]
		);
	});

	it('names the export from slug, start TC, frame count, and version', () => {
		assert.equal(
			buildSyncExportFilename('checklist-show-rundown', '00:00:08:00', 300, 1),
			'checklist-show-rundown__00-00-08-00__300f__v1.mov'
		);
		// A drop-frame TC's semicolon flattens to '-' too — no ';' in filenames.
		assert.equal(
			buildSyncExportFilename('reachy-objective', '01:00:08;00', 300, 2),
			'reachy-objective__01-00-08-00__300f__v2.mov'
		);
	});

	it('builds the replace action pinning the prior version by source-file name', () => {
		assert.deepEqual(buildReplacePlanAction('reachy-objective', 3), {
			fileNamePrefix: 'reachy-objective__',
			fileNameSuffix: '__v2.mov'
		});
		// A first sync has nothing to replace.
		assert.equal(buildReplacePlanAction('reachy-objective', 1), null);
		assert.throws(() => buildReplacePlanAction('reachy-objective', 0), TypeError);
		assert.throws(() => buildReplacePlanAction('reachy-objective', 1.5), TypeError);
	});

	it('replace match halves fit the prior export filename even when TC and length changed', () => {
		// v2 moved and got longer since v1 — the open middle absorbs both.
		const priorFilename = buildSyncExportFilename('reachy-objective', '01:00:08;00', 300, 1);
		const replace = buildReplacePlanAction('reachy-objective', 2);
		assert.ok(replace !== null);
		assert.ok(priorFilename.startsWith(replace.fileNamePrefix));
		assert.ok(priorFilename.endsWith(replace.fileNameSuffix));
		// A sibling slug sharing the prefix text must NOT match.
		const sibling = buildSyncExportFilename('reachy-objective-2', '01:00:08;00', 300, 1);
		assert.ok(!sibling.startsWith(replace.fileNamePrefix));
	});
});
