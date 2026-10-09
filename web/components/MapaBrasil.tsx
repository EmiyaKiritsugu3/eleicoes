import React, { useEffect, useRef, useState } from "react";
import {
  EXTERIOR_IBGE,
  UFS,
  hitTest,
  loadMalha,
  type MalhaFeature,
} from "../lib/malha";

export type MapaNivel = "uf" | "municipio";

interface MapaBrasilProps {
  malhaUrl: string;
  nivel: MapaNivel;
  onSelectIbge: (ibge7: string) => void;
  /** Cor por município vencedor: Record<ibge7, css-color>. */
  cores?: Record<string, string>;
  /** UF em foco p/ zoom UF→município (bounding box). */
  ufSelecionada?: string;
}

const TSE_RESULTADOS_URL = "https://resultados.tse.jus.br/";

function hasCanvas(): boolean {
  return typeof Path2D === "function";
}

/** Fallback sem canvas/Path2D (degradação do reference): lista de UFs + link TSE. */
function MapaFallback({ onSelectIbge }: { onSelectIbge: (ibge7: string) => void }) {
  return (
    <div>
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
      <button type="button" onClick={() => onSelectIbge(EXTERIOR_IBGE)}>
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
  const [erro, setErro] = useState<string>("");
  const featsRef = useRef<MalhaFeature[]>([]);
  featsRef.current = features;

  useEffect(() => {
    let vivo = true;
    loadMalha(malhaUrl).then(
      (f) => {
        if (vivo) setFeatures(f);
      },
      (e: Error) => {
        if (vivo) setErro(e.message);
      },
    );
    return () => {
      vivo = false;
    };
  }, [malhaUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || features.length === 0) return;
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
    canvas.dataset.transform = JSON.stringify([s, ox, oy, minX, minY]);
    for (const f of visiveis) {
      const path = new Path2D();
      for (const ring of f.polygons) {
        ring.forEach(([x, y], i) => {
          const px = x * s + ox;
          const py = y * s + oy;
          if (i === 0) path.moveTo(px, py);
          else path.lineTo(px, py);
        });
        path.closePath();
      }
      ctx.fillStyle = cores?.[f.ibge7] ?? "#cbd5e1";
      ctx.fill(path);
      ctx.strokeStyle = "#ffffff";
      ctx.stroke(path);
    }
  }, [features, nivel, ufSelecionada, cores]);

  if (!hasCanvas()) {
    return <MapaFallback onSelectIbge={onSelectIbge} />;
  }

  const aoClicar = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // Inverte a projeção p/ coordenadas da malha antes do hit-test.
    const t = canvas.dataset.transform
      ? (JSON.parse(canvas.dataset.transform) as number[])
      : null;
    const [s, ox, oy] = t ?? [1, 0, 0];
    const ibge = hitTest(featsRef.current, (px - ox) / s, (py - oy) / s);
    if (ibge) onSelectIbge(ibge);
  };

  return (
    <div>
      {erro ? <p role="alert">{erro}</p> : null}
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        onClick={aoClicar}
        aria-label="Mapa do Brasil — clique num município"
      />
      <button type="button" onClick={() => onSelectIbge(EXTERIOR_IBGE)}>
        Exterior
      </button>
    </div>
  );
}

