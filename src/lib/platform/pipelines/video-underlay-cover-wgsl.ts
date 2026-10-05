/**
 * WGSL statements that map an output UV to a footage texture UV: centred
 * cover crop at the footage's display aspect, then its display rotation in
 * quarter turns (0..3). The final present (`effect-chain.ts`) and the Mosh
 * window resolve pass (`video-mosh-processor.ts`) both emit these exact
 * statements, so a moshed frame and a clean frame frame the footage
 * identically. Declares `rawUv` (unclamped) in the caller's scope.
 */
export function videoUnderlayCoverUvWgsl(input: {
	uv: string;
	displaySize: string;
	canvasSize: string;
	rotation: string;
}): string {
	return /* wgsl */ `
			let underlayDisplaySize = ${input.displaySize};
			let underlayAspect = underlayDisplaySize.x / max(1.0, underlayDisplaySize.y);
			let canvasSize = ${input.canvasSize};
			let canvasAspect = canvasSize.x / max(1.0, canvasSize.y);
			let cropWidth = min(1.0, canvasAspect / underlayAspect);
			let cropHeight = min(1.0, underlayAspect / canvasAspect);
			let underlayUv = vec2f(
				0.5 + (${input.uv}.x - 0.5) * cropWidth,
				0.5 + (${input.uv}.y - 0.5) * cropHeight
			);
			let rotation = ${input.rotation};
			let uv0 = underlayUv;
			let uv90 = vec2f(underlayUv.y, 1.0 - underlayUv.x);
			let uv180 = vec2f(1.0 - underlayUv.x, 1.0 - underlayUv.y);
			let uv270 = vec2f(1.0 - underlayUv.y, underlayUv.x);
			let is0 = select(0.0, 1.0, rotation < 0.5);
			let is90 = select(0.0, 1.0, rotation >= 0.5 && rotation < 1.5);
			let is180 = select(0.0, 1.0, rotation >= 1.5 && rotation < 2.5);
			let is270 = select(0.0, 1.0, rotation >= 2.5);
			let rawUv = uv0 * is0 + uv90 * is90 + uv180 * is180 + uv270 * is270;`;
}
