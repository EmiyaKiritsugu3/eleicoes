import React, { useEffect, useRef, useState } from "react";
import {
  EXTERIOR,
  UFS,
  resolverCliqueMapa,
  loadMalha,
  type MalhaFeature,
  type MapaSelecao,
} from "../lib/malha";

export type MapaNivel = "uf" | "municipio";

interface MapaBrasilProps {
  malhaUrl: string;
  nivel: MapaNivel;
  /** Recebe IBGE7 (canvas) | sigla UF (fallback em lista) | EXTERIOR. */
  onSelectIbge: (selecao: MapaSelecao) => void;
  /** Cor por município vencedor: Record<ibge7, css-color>. */
  cores?: Record<string, string>;
  /** UF em foco p/ zoom UF→município (bounding box). */
  ufSelecionada?: string;
}

const TSE_RESULTADOS_URL = "https://resultados.tse.jus.br/";

/** Largura/altura CSS do canvas; o backing store multiplica por DPR (teto 2). */
const CSS_W = 800;
const CSS_H = 600;

function hasCanvas(): boolean {
  return typeof Path2D === "function";
}

function devicePixelRatioSeguro(): number {
  if (typeof window === "undefined" || !window.devicePixelRatio) return 1;
  return Math.min(window.devicePixelRatio, 2);
}

/** Fallback (sem canvas/Path2D ou malha indisponível): lista de UFs + link TSE. */
export function MapaFallback({
  onSelectIbge,
  motivo,
}: {
  onSelectIbge: (selecao: MapaSelecao) => void;
  motivo?: string;
}) {
  return (
    <div>
      {motivo ? <p role="alert">{motivo}</p> : null}
      <p>Mapa indisponível neste navegador — escolha a UF na lista:</p>
      <ul>
        {UFS.map((uf) => (
          <li key={uf}>
            <button type="button" onClick={() => onSelectIbge(uf)}>
              {uf}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => onSelectIbge(EXTERIOR)}>
        Exterior
      </button>
      <p>
        <a href={TSE_RESULTADOS_URL} target="_blank" rel="noreferrer">
          Resultados oficiais no TSE
        </a>
      </p>
    </div>
  );
}

/** Decisão pura do ramo de fallback (sem canvas OU falha na malha). */
export function precisaFallback(canvasDisponivel: boolean, erroMalha: string | null): boolean {
  return !canvasDisponivel || erroMalha !== null;
}

/** Home = mapa do Brasil clicável (canvas Path2D); clique retorna IBGE7. */
export default function MapaBrasil({
  malhaUrl,
  nivel,
  onSelectIbge,
  cores,
  ufSelecionada,
}: MapaBrasilProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [features, setFeatures] = useState<MalhaFeature[]>([]);
  const [erroMalha, setErroMalha] = useState<string | null>(null);
  const featsRef = useRef<MalhaFeature[]>([]);
  featsRef.current = features;

  useEffect(() => {
    let vivo = true;
    loadMalha(malhaUrl).then(
      (f) => {
        if (vivo) setFeatures(f);
      },
      (e: Error) => {
        if (vivo) setErroMalha(e.message);
      },
    );
    return () => {
      vivo = false;
    };
  }, [malhaUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || features.length === 0) return;
    const dpr = devicePixelRatioSeguro();
    canvas.width = Math.round(CSS_W * dpr);
    canvas.height = Math.round(CSS_H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const visiveis =
      nivel === "municipio" && ufSelecionada
        ? features.filter((f) => f.uf === ufSelecionada)
        : features;
    if (visiveis.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const f of visiveis) {
      const b = f.bbox;
      minX = Math.min(minX, b[0]);
      minY = Math.min(minY, b[1]);
      maxX = Math.max(maxX, b[2]);
      maxY = Math.max(maxY, b[3]);
    }
    const sx = W / (maxX - minX || 1);
    const sy = H / (maxY - minY || 1);
    const s = Math.min(sx, sy);
    const ox = (W - (maxX - minX) * s) / 2 - minX * s;
    const oy = (H - (maxY - minY) * s) / 2 - minY * s;
    canvas.dataset.transform = JSON.stringify([s, ox, oy]);
    for (const f of visiveis) {
      const path = new Path2D();
      for (const poly of f.polygons) {
        for (const ring of poly) {
          ring.forEach(([x, y], i) => {
            const px = x * s + ox;
            const py = y * s + oy;
            if (i === 0) path.moveTo(px, py);
            else path.lineTo(px, py);
          });
          path.closePath();
        }
      }
      ctx.fillStyle = cores?.[f.ibge7] ?? "#cbd5e1";
      ctx.fill(path);
      ctx.strokeStyle = "#ffffff";
      ctx.stroke(path);
    }
  }, [features, nivel, ufSelecionada, cores]);

  if (precisaFallback(hasCanvas(), erroMalha)) {
    return <MapaFallback onSelectIbge={onSelectIbge} motivo={erroMalha ?? undefined} />;
  }

  const aoClicar = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const t = canvas.dataset.transform
      ? (JSON.parse(canvas.dataset.transform) as number[])
      : null;
    // Hit-test só no que foi desenhado (zoom UF filtra os vizinhos).
    const lista =
      nivel === "municipio" && ufSelecionada
        ? featsRef.current.filter((f) => f.uf === ufSelecionada)
        : featsRef.current;
    const ibge = resolverCliqueMapa({
      clientX: e.clientX,
      clientY: e.clientY,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      transform: t,
      features: lista,
    });
    if (ibge) onSelectIbge(ibge);
  };

  // Operação por teclado: os mesmos destinos do clique/fallback em <select>.
  const comZoom = nivel === "municipio" && !!ufSelecionada;
  const municipiosTeclado = comZoom ? features.filter((f) => f.uf === ufSelecionada) : null;

  const aoEscolherTeclado = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v) onSelectIbge(v);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={CSS_W}
        height={CSS_H}
        onClick={aoClicar}
        aria-label="Mapa do Brasil — clique num município"
        // Responde a taps sem o atraso de double-tap; scroll da página preservado.
        style={{ width: "100%", maxWidth: CSS_W, aspectRatio: "4 / 3", touchAction: "manipulation" }}
      />
      {municipiosTeclado ? (
        <label>
          Escolher município (teclado)
          <select aria-label="Escolher município (teclado)" defaultValue="" onChange={aoEscolherTeclado}>
            <option value="">Selecionar…</option>
            {municipiosTeclado.map((f) => (
              <option key={f.ibge7} value={f.ibge7}>
                {f.nome} ({f.uf})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Escolher UF (teclado)
          <select aria-label="Escolher UF (teclado)" defaultValue="" onChange={aoEscolherTeclado}>
            <option value="">Selecionar…</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" onClick={() => onSelectIbge(EXTERIOR)}>
        Exterior
      </button>
    </div>
  );
}
