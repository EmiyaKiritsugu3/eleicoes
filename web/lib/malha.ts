/** Loader TopoJSON → paths p/ o mapa canvas (<MapaBrasil>).
 *
 *  A malha real (`web/public/data/malha_municipios.topojson`, gerada por
 *  `scripts/malha.py --output web/public/data/malha_municipios.topojson`) é
 *  buscada em runtime via `loadMalha(MALHA_MUNICIPIOS_URL)`; se ausente, o
 *  componente falha fechado (fallback em lista + link TSE). Testes usam
 *  malha FIXTURE inline — nunca o arquivo real.
 *  (Artefato gerado, ignorado pelo git — cf. `web/.gitignore`.)
 */

/** URL canônica da malha municipal (fonte única: call sites usam esta
 *  constante p/ não divergir do gerador `scripts/malha.py` nem da doc acima). */
export const MALHA_MUNICIPIOS_URL = "/data/malha_municipios.topojson";

/** Sentinela da unidade Exterior (separada, spec §5). Contrato p/ Tasks 7–8. */
export const EXTERIOR = "EXTERIOR";

/** Alias de compatibilidade (mesmo valor de EXTERIOR). */
export const EXTERIOR_IBGE = EXTERIOR;

/** Seleção emitida por `onSelectIbge`: IBGE7 (7 dígitos) no canvas,
 *  sigla de UF na lista do fallback, ou EXTERIOR (botão separado). */
export type MapaSelecao = string;

/** UFs p/ o fallback em lista (sem canvas/Path2D). */
export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS",
  "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC",
  "SE", "SP", "TO",
];

export interface MalhaFeature {
  ibge7: string;
  uf: string;
  nome: string;
  /** Polígonos: lista de polígonos; cada polígono é lista de anéis
   *  ([0] = casca externa, [1..] = furos). */
  polygons: Array<Array<Array<[number, number]>>>;
  bbox: [number, number, number, number];
}

interface TopoGeometry {
  type: string;
  properties?: { ibge7?: string; uf?: string; nome?: string; id?: string };
  arcs?: unknown;
}

interface TopoJson {
  type: string;
  transform?: { scale: [number, number]; translate: [number, number] };
  objects: Record<string, { type: string; geometries: TopoGeometry[] }>;
  arcs: Array<Array<[number, number]>>;
}

export function bboxOf(polygons: MalhaFeature["polygons"]): MalhaFeature["bbox"] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polygons) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

function decodeArc(
  arc: Array<[number, number]>,
  transform?: TopoJson["transform"],
): Array<[number, number]> {
  // Sem transform os arcos já são pontos absolutos (TopoJSON não quantizado).
  if (!transform) {
    // Latitude cresce p/ norte, canvas cresce p/ baixo: nega Y p/ orientação de tela.
    return arc.map(([x, y]) => [x, -y] as [number, number]);
  }
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [
      x * transform.scale[0] + transform.translate[0],
      // Latitude cresce p/ norte, canvas cresce p/ baixo: nega Y p/ orientação de tela.
      -(y * transform.scale[1] + transform.translate[1]),
    ];
  });
}

function ringFromArcIndex(
  idx: number,
  arcs: TopoJson["arcs"],
  transform?: TopoJson["transform"],
): Array<[number, number]> {
  const forward = idx >= 0;
  const decoded = decodeArc(arcs[forward ? idx : ~idx], transform);
  return forward ? decoded : decoded.reverse();
}

/** Decodifica TopoJSON (Polygon/MultiPolygon, delta + transform) em features. */
export function decodeTopojson(topo: TopoJson): MalhaFeature[] {
  const out: MalhaFeature[] = [];
  const obj = topo.objects["municipios"] ?? Object.values(topo.objects)[0];
  if (!obj) return out;
  for (const g of obj.geometries) {
    const polygons: MalhaFeature["polygons"] = [];
    const pushPolygon = (ringsIdxs: number[][]) => {
      const rings: Array<Array<[number, number]>> = [];
      for (const arcIdxs of ringsIdxs) {
        const ring: Array<[number, number]> = [];
        for (const i of arcIdxs) ring.push(...ringFromArcIndex(i, topo.arcs, topo.transform));
        if (ring.length > 0) rings.push(ring);
      }
      // Preserva o aninhamento casca × furos ([0] = externa).
      if (rings.length > 0) polygons.push(rings);
    };
    if (g.type === "Polygon" && Array.isArray(g.arcs)) {
      pushPolygon(g.arcs as number[][]);
    } else if (g.type === "MultiPolygon" && Array.isArray(g.arcs)) {
      for (const poly of g.arcs as unknown as number[][][]) {
        pushPolygon(poly);
      }
    } else {
      continue;
    }
    const props = g.properties ?? {};
    const ibge7 = String(props.ibge7 ?? props.id ?? "");
    if (!ibge7 || polygons.length === 0) continue;
    out.push({
      ibge7,
      uf: String(props.uf ?? ""),
      nome: String(props.nome ?? ibge7),
      polygons,
      bbox: bboxOf(polygons),
    });
  }
  return out;
}

function pointInRing(ring: Array<[number, number]>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inBbox(bbox: MalhaFeature["bbox"], x: number, y: number): boolean {
  return x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3];
}

/** Ponto-em-polígono com furos: dentro da casca e fora de todo furo. */
function pontoEmPoligono(poly: Array<Array<[number, number]>>, x: number, y: number): boolean {
  if (poly.length === 0 || !pointInRing(poly[0], x, y)) return false;
  for (let k = 1; k < poly.length; k++) {
    if (pointInRing(poly[k], x, y)) return false;
  }
  return true;
}

/** Hit-test ponto-em-polígono com pré-checagem de bbox (índice espacial simples). */
export function hitTest(features: MalhaFeature[], x: number, y: number): string | null {
  for (const f of features) {
    if (!inBbox(f.bbox, x, y)) continue;
    if (f.polygons.some((poly) => pontoEmPoligono(poly, x, y))) return f.ibge7;
  }
  return null;
}

export interface RetanguloCss {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CliqueMapa {
  clientX: number;
  clientY: number;
  /** Retângulo CSS (getBoundingClientRect) — difere do backing store com DPR/escala. */
  rect: RetanguloCss;
  /** Dimensões reais do backing store (canvas.width/height). */
  backingWidth: number;
  backingHeight: number;
  /** Projeção [s, ox, oy] usada no desenho (ponto = m*s + o). */
  transform: number[] | null;
  features: MalhaFeature[];
}

/** Converte clique (CSS px) → coordenadas da malha e resolve o IBGE7.
 *  Multiplica pelo fator backing/CSS em cada eixo; ret nulo = null. */
export function resolverCliqueMapa(c: CliqueMapa): string | null {
  if (c.rect.width <= 0 || c.rect.height <= 0) return null;
  const px = (c.clientX - c.rect.left) * (c.backingWidth / c.rect.width);
  const py = (c.clientY - c.rect.top) * (c.backingHeight / c.rect.height);
  const [s, ox, oy] = c.transform ?? [1, 0, 0];
  if (!s) return null;
  return hitTest(c.features, (px - ox) / s, (py - oy) / s);
}

/** Busca a malha TopoJSON em runtime; rejeita se ausente (fail-closed). */
export async function loadMalha(malhaUrl: string): Promise<MalhaFeature[]> {
  const res = await fetch(malhaUrl);
  if (!res.ok) {
    throw new Error(`malha indisponível (${res.status}): sem dado oficial`);
  }
  const topo = (await res.json()) as TopoJson;
  const feats = decodeTopojson(topo);
  if (feats.length === 0) {
    throw new Error("malha vazia ou inválida: sem dado oficial");
  }
  return feats;
}
