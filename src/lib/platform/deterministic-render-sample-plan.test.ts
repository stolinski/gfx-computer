import { describe, expect, it } from 'vitest';

import isolateFixture from '../presets/isolate-demo.json';
import lowerThirdPreset from '../presets/lower-third.json';
import kineticMotionFixture from '../presets/kinetic-type-field-motion-fixture.json';
import { parsePresetIngress } from './preset-ingress';
import { deriveDeterministicRenderSamplePlan } from './deterministic-render-sample-plan';

function checkpointFrames(plan: ReturnType<typeof deriveDeterministicRenderSamplePlan>): number[] {
	return plan.samples
		.filter((sample) => sample.kind === 'checkpoint')
		.map((sample) => sample.frameIndex);
}

describe('deriveDeterministicRenderSamplePlan', () => {
	it('derives the fixed five checkpoints at exact frame addresses', () => {
		const plan = deriveDeterministicRenderSamplePlan(parsePresetIngress(lowerThirdPreset));
		expect(plan.frameRate).toEqual({ num: 30, den: 1 });
		expect(plan.frameCount).toBe(201);
		expect(checkpointFrames(plan)).toEqual([0, 50, 100, 150, 200]);
		for (const sample of plan.samples) {
			expect(sample.timestampMicroseconds).toBe(
				Math.round((sample.frameIndex * plan.frameRate.den * 1_000_000) / plan.frameRate.num)
			);
		}
	});

	it('deduplicates checkpoint frames for short compositions', () => {
		const preset = parsePresetIngress(lowerThirdPreset);
		preset.state.transport.durationSeconds = 0.02;
		const plan = deriveDeterministicRenderSamplePlan(preset);
		expect(plan.frameCount).toBe(1);
		expect(checkpointFrames(plan)).toEqual([0]);
	});

	it('adds typed focal transition windows with ordered legal auxiliary frames', () => {
		const plan = deriveDeterministicRenderSamplePlan(parsePresetIngress(isolateFixture));
		const transition = plan.samples.find((sample) => sample.kind === 'transition-window');
		expect(transition?.transitionId).toContain('isolate');
		expect(transition?.auxiliaryFrameIndices.length).toBe(3);
		expect(transition?.auxiliaryFrameIndices).toEqual(
			[...(transition?.auxiliaryFrameIndices ?? [])].sort((left, right) => left - right)
		);
		expect(transition?.stableGeometryCandidateIds).toContain('composition-root');
	});

	it('samples Kinetic Type at every beat and across each word envelope', () => {
		const plan = deriveDeterministicRenderSamplePlan(parsePresetIngress(kineticMotionFixture));
		const beat = plan.samples.find((sample) => sample.sampleId === 'transition:beat:move');
		expect(beat?.frameIndex).toBe(36);
		expect(beat?.auxiliaryFrameIndices).toEqual([36]);
		const envelope = plan.samples.find(
			(sample) => sample.sampleId === 'transition:envelope:move:1'
		);
		expect(envelope?.auxiliaryFrameIndices).toEqual([23, 36, 48]);
		expect(envelope?.frameIndex).toBe(36);
	});
});
