import type {
	DiagramCode,
	DiagramCodeGeometry,
	DiagramEdgeArrow,
	DiagramEdgeGeometry,
	DiagramEndpoint,
	DiagramLabel,
	DiagramLabelGeometry,
	DiagramNode,
	DiagramPositionGeometry,
	DiagramPrimitive,
	DiagramStatCallout,
	DiagramTimelineGeometry,
	DiagramTimelineSegment
} from '$lib/platform/engine-schema';

import type { VideoOrientation } from './video-frame';

type DiagramPositionedPrimitive = DiagramNode | DiagramLabel | DiagramStatCallout | DiagramCode;

export type DiagramPrimitiveGeometry =
	| DiagramPositionGeometry
	| DiagramLabelGeometry
	| DiagramCodeGeometry
	| DiagramEdgeGeometry
	| DiagramTimelineGeometry;

/** The code panel's own sizes, carried with its position (ADR-0070). */
const CODE_GEOMETRY_SIZE_FIELDS = [
	'fontSize',
	'paddingX',
	'paddingY',
	'minWidth',
	'minHeight'
] as const;

export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramNode | DiagramStatCallout,
	orientation: VideoOrientation
): DiagramPositionGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramCode,
	orientation: VideoOrientation
): DiagramCodeGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramLabel,
	orientation: VideoOrientation
): DiagramLabelGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramPositionedPrimitive,
	orientation: VideoOrientation
): DiagramPositionGeometry | DiagramLabelGeometry | DiagramCodeGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramEdgeArrow,
	orientation: VideoOrientation
): DiagramEdgeGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramTimelineSegment,
	orientation: VideoOrientation
): DiagramTimelineGeometry;
export function resolveDiagramPrimitiveGeometry(
	primitive: DiagramPrimitive,
	orientation: VideoOrientation
): DiagramPrimitiveGeometry {
	return primitive.orientationOverrides?.[orientation] ?? primitive;
}

function cloneDiagramEndpoint(endpoint: DiagramEndpoint): DiagramEndpoint {
	return 'node' in endpoint ? { node: endpoint.node } : { ...endpoint };
}

export function cloneDiagramPrimitiveGeometry(geometry: DiagramLabelGeometry): DiagramLabelGeometry;
export function cloneDiagramPrimitiveGeometry(geometry: DiagramCodeGeometry): DiagramCodeGeometry;
export function cloneDiagramPrimitiveGeometry(
	geometry: DiagramPositionGeometry
): DiagramPositionGeometry;
export function cloneDiagramPrimitiveGeometry(
	geometry: DiagramPositionGeometry | DiagramLabelGeometry | DiagramCodeGeometry
): DiagramPositionGeometry | DiagramLabelGeometry | DiagramCodeGeometry;
export function cloneDiagramPrimitiveGeometry(geometry: DiagramEdgeGeometry): DiagramEdgeGeometry;
export function cloneDiagramPrimitiveGeometry(
	geometry: DiagramTimelineGeometry
): DiagramTimelineGeometry;
export function cloneDiagramPrimitiveGeometry(
	geometry: DiagramPrimitiveGeometry
): DiagramPrimitiveGeometry {
	if ('position' in geometry) {
		const positionGeometry: DiagramPositionGeometry = {
			position: { ...geometry.position },
			scale: geometry.scale
		};
		if ('maxWidth' in geometry) return { ...positionGeometry, maxWidth: geometry.maxWidth };
		const sizes = CODE_GEOMETRY_SIZE_FIELDS.filter((field) => field in geometry);
		if (sizes.length === 0) return positionGeometry;
		const codeGeometry = geometry as DiagramCodeGeometry;
		return {
			...positionGeometry,
			...Object.fromEntries(sizes.map((field) => [field, codeGeometry[field]]))
		};
	}
	if ('route' in geometry) {
		return {
			from: cloneDiagramEndpoint(geometry.from),
			to: cloneDiagramEndpoint(geometry.to),
			route: geometry.route,
			control: geometry.control ? { ...geometry.control } : undefined
		};
	}
	return {
		from: { ...geometry.from },
		to: { ...geometry.to }
	};
}

export function resolveDiagramPrimitiveForRender(
	primitive: DiagramPrimitive,
	orientation: VideoOrientation
): DiagramPrimitive {
	switch (primitive.type) {
		case 'node': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				position: { ...geometry.position },
				scale: geometry.scale
			};
		}
		case 'label': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				position: { ...geometry.position },
				scale: geometry.scale,
				maxWidth: geometry.maxWidth
			};
		}
		case 'stat-callout': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				position: { ...geometry.position },
				scale: geometry.scale
			};
		}
		case 'code': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				position: { ...geometry.position },
				scale: geometry.scale,
				fontSize: geometry.fontSize,
				paddingX: geometry.paddingX,
				paddingY: geometry.paddingY,
				minWidth: geometry.minWidth,
				minHeight: geometry.minHeight
			};
		}
		case 'edge-arrow': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				from: cloneDiagramEndpoint(geometry.from),
				to: cloneDiagramEndpoint(geometry.to),
				route: geometry.route,
				control: geometry.control ? { ...geometry.control } : undefined
			};
		}
		case 'timeline-segment': {
			const geometry = resolveDiagramPrimitiveGeometry(primitive, orientation);
			return {
				...primitive,
				from: { ...geometry.from },
				to: { ...geometry.to }
			};
		}
	}
}
