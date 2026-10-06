// The bundled mesh format of the Dimensional Stage (ADR-0051 phase 2, the
// compiled-model lane). A registered model ships as one `.stagemesh` file the
// compile script writes from an authored part and the stage decodes at load:
// a fixed header, then the interleaved vertex stream, then 32-bit indices.
// Nothing here depends on the GPU or on the app, so the compile script under
// Node and the browser loader share one encoder and decoder.
//
// Vertex stream: position (3), normal (3), material region (1) — seven
// floats, tightly packed. Regions index the model's material table; every
// vertex of a triangle carries that triangle's region, so a vertex shared by
// two regions is duplicated at compile time and the value never interpolates.

export const STAGE_MESH_MAGIC = 'GFXM';
export const STAGE_MESH_FORMAT_VERSION = 1;
/** Floats per vertex: position xyz, normal xyz, region. */
export const STAGE_MESH_VERTEX_FLOATS = 7;
export const STAGE_MESH_VERTEX_BYTES = STAGE_MESH_VERTEX_FLOATS * 4;
const HEADER_BYTES = 24;

export type StageMeshVector = [number, number, number];

export interface StageMeshData {
	/** `STAGE_MESH_VERTEX_FLOATS` floats per vertex. */
	vertices: Float32Array;
	indices: Uint32Array;
	vertexCount: number;
	indexCount: number;
	/** How many material regions the vertices reference (1..). */
	regionCount: number;
	/** Bounds of the vertex positions, in the mesh's own units. */
	min: StageMeshVector;
	max: StageMeshVector;
}

/** The decoded fields a caller supplies to encode; bounds are derived. */
export interface StageMeshSource {
	vertices: Float32Array;
	indices: Uint32Array;
	regionCount: number;
}

function meshBounds(vertices: Float32Array): { min: StageMeshVector; max: StageMeshVector } {
	const min: StageMeshVector = [Infinity, Infinity, Infinity];
	const max: StageMeshVector = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < vertices.length; i += STAGE_MESH_VERTEX_FLOATS) {
		for (let axis = 0; axis < 3; axis += 1) {
			const value = vertices[i + axis];
			if (value < min[axis]) min[axis] = value;
			if (value > max[axis]) max[axis] = value;
		}
	}
	return { min, max };
}

function assertFiniteStream(values: ArrayLike<number>, label: string): void {
	for (let i = 0; i < values.length; i += 1) {
		if (!Number.isFinite(values[i])) {
			throw new TypeError(`Stage mesh ${label} contains a non-finite value at ${i}.`);
		}
	}
}

/** Encode a mesh into the bundled byte layout. */
export function encodeStageMesh(source: StageMeshSource): Uint8Array {
	if (source.vertices.length % STAGE_MESH_VERTEX_FLOATS !== 0) {
		throw new TypeError(
			`Stage mesh vertices must be a multiple of ${STAGE_MESH_VERTEX_FLOATS} floats.`
		);
	}
	if (source.indices.length % 3 !== 0) {
		throw new TypeError('Stage mesh indices must form whole triangles.');
	}
	assertFiniteStream(source.vertices, 'vertex stream');
	const vertexCount = source.vertices.length / STAGE_MESH_VERTEX_FLOATS;
	for (const index of source.indices) {
		if (index >= vertexCount) throw new TypeError(`Stage mesh index ${index} is out of range.`);
	}
	const bytes = new Uint8Array(
		HEADER_BYTES + source.vertices.byteLength + source.indices.byteLength
	);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < 4; i += 1) bytes[i] = STAGE_MESH_MAGIC.charCodeAt(i);
	view.setUint32(4, STAGE_MESH_FORMAT_VERSION, true);
	view.setUint32(8, vertexCount, true);
	view.setUint32(12, source.indices.length, true);
	view.setUint32(16, STAGE_MESH_VERTEX_FLOATS, true);
	view.setUint32(20, Math.max(1, source.regionCount), true);
	bytes.set(new Uint8Array(source.vertices.buffer, source.vertices.byteOffset, source.vertices.byteLength), HEADER_BYTES);
	bytes.set(
		new Uint8Array(source.indices.buffer, source.indices.byteOffset, source.indices.byteLength),
		HEADER_BYTES + source.vertices.byteLength
	);
	return bytes;
}

/** Decode bundled bytes, failing fast on a header that is not this format. */
export function decodeStageMesh(buffer: ArrayBuffer): StageMeshData {
	if (buffer.byteLength < HEADER_BYTES) throw new TypeError('Stage mesh file is truncated.');
	const view = new DataView(buffer);
	const magic = String.fromCharCode(
		view.getUint8(0),
		view.getUint8(1),
		view.getUint8(2),
		view.getUint8(3)
	);
	if (magic !== STAGE_MESH_MAGIC) throw new TypeError('Stage mesh file has the wrong magic.');
	const version = view.getUint32(4, true);
	if (version !== STAGE_MESH_FORMAT_VERSION) {
		throw new TypeError(`Stage mesh format version ${version} is not supported.`);
	}
	const vertexCount = view.getUint32(8, true);
	const indexCount = view.getUint32(12, true);
	const floatsPerVertex = view.getUint32(16, true);
	const regionCount = view.getUint32(20, true);
	if (floatsPerVertex !== STAGE_MESH_VERTEX_FLOATS) {
		throw new TypeError(`Stage mesh declares ${floatsPerVertex} floats per vertex.`);
	}
	const vertexBytes = vertexCount * STAGE_MESH_VERTEX_BYTES;
	const expected = HEADER_BYTES + vertexBytes + indexCount * 4;
	if (buffer.byteLength !== expected) {
		throw new TypeError(`Stage mesh file is ${buffer.byteLength} bytes; expected ${expected}.`);
	}
	// Copy out of the file buffer so the typed arrays are aligned and owned.
	const vertices = new Float32Array(vertexCount * STAGE_MESH_VERTEX_FLOATS);
	vertices.set(new Float32Array(buffer.slice(HEADER_BYTES, HEADER_BYTES + vertexBytes)));
	const indices = new Uint32Array(indexCount);
	indices.set(new Uint32Array(buffer.slice(HEADER_BYTES + vertexBytes, expected)));
	assertFiniteStream(vertices, 'vertex stream');
	for (const index of indices) {
		if (index >= vertexCount) throw new TypeError(`Stage mesh index ${index} is out of range.`);
	}
	const { min, max } = meshBounds(vertices);
	return { vertices, indices, vertexCount, indexCount, regionCount, min, max };
}
