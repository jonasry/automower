import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const MAX_SVG_BYTES = 2 * 1024 * 1024;
export const SVG_LIMITS = Object.freeze({
  maxBytes: MAX_SVG_BYTES,
  maxElements: 256,
  maxPointsPerElement: 10000,
  maxTotalPoints: 50000
});

export class MowerMapError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'MowerMapError';
    this.code = code;
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  processEntities: false,
  trimValues: true
});

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parsePoints(value, id, limit) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MowerMapError('MAP_INVALID', `${id} has no points`);
  }

  const tokens = value.trim().split(/\s+/);
  if (tokens.length > limit) {
    throw new MowerMapError('MAP_INVALID', `${id} exceeds point limit`);
  }

  return tokens.map((token) => {
    const match = token.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?),(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)$/i);
    if (!match) {
      throw new MowerMapError('MAP_INVALID', `${id} has malformed points`);
    }

    const point = { x: Number(match[1]), y: Number(match[2]) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new MowerMapError('MAP_INVALID', `${id} has non-finite points`);
    }
    return point;
  });
}

function normalizeElement(element, minimumPoints, limits) {
  const id = typeof element?.id === 'string' ? element.id : '';
  const points = parsePoints(
    element?.points,
    id || 'unnamed geometry',
    limits.maxPointsPerElement
  );
  if (points.length < minimumPoints) {
    throw new MowerMapError('MAP_INVALID', `${id} has too few points`);
  }

  return {
    id,
    ...(typeof element.title === 'string' ? { title: element.title } : {}),
    points
  };
}

export function parseMowerMapSvg(svgText, { limits = SVG_LIMITS } = {}) {
  if (
    typeof svgText !== 'string' ||
    Buffer.byteLength(svgText) > limits.maxBytes
  ) {
    throw new MowerMapError('MAP_INVALID', 'SVG exceeds size limit');
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(svgText)) {
    throw new MowerMapError('MAP_INVALID', 'SVG declarations are not allowed');
  }
  if (XMLValidator.validate(svgText) !== true) {
    throw new MowerMapError('MAP_INVALID', 'SVG is not well-formed XML');
  }

  const root = parser.parse(svgText)?.svg;
  if (!root || typeof root !== 'object') {
    throw new MowerMapError('MAP_INVALID', 'SVG root element is missing');
  }

  const polygons = asArray(root.polygon).filter((element) =>
    typeof element?.id === 'string' && /^(?:main_area_|island_)/.test(element.id)
  );
  const polylines = asArray(root.polyline).filter((element) =>
    typeof element?.id === 'string' &&
    (element.id === 'lona_cs' || element.id.startsWith('guide_'))
  );
  if (polygons.length + polylines.length > limits.maxElements) {
    throw new MowerMapError('MAP_INVALID', 'SVG exceeds element limit');
  }

  const workingAreas = polygons
    .filter((item) => item.id.startsWith('main_area_'))
    .map((item) => normalizeElement(item, 3, limits));
  const islands = polygons
    .filter((item) => item.id.startsWith('island_'))
    .map((item) => normalizeElement(item, 3, limits));
  const guides = polylines
    .filter((item) => item.id.startsWith('guide_'))
    .map((item) => normalizeElement(item, 2, limits));
  const lonaSource = polylines.find((item) => item.id === 'lona_cs');
  const chargingStationLine = lonaSource
    ? normalizeElement(lonaSource, 2, limits)
    : null;

  if (workingAreas.length === 0 || !chargingStationLine) {
    throw new MowerMapError(
      'MAP_INVALID',
      'SVG lacks working area or charging-station geometry'
    );
  }

  const totalPoints = [
    ...workingAreas,
    ...islands,
    ...guides,
    chargingStationLine
  ].reduce((sum, item) => sum + item.points.length, 0);
  if (totalPoints > limits.maxTotalPoints) {
    throw new MowerMapError('MAP_INVALID', 'SVG exceeds total point limit');
  }

  return {
    metadata: {
      creationDateTime: root['map-creation-datetime'] ?? null,
      mapVersion: root['map-version'] ?? null,
      postProcessingCommit: root['post-processing-commit'] ?? null,
      postProcessingBranch: root['post-processing-branch'] ?? null
    },
    stationOrigin: { ...chargingStationLine.points[0] },
    geometry: {
      workingAreas,
      islands,
      guides,
      chargingStationLine
    }
  };
}
