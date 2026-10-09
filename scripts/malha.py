#!/usr/bin/env python3
"""Gera a malha municipal simplificada p/ o mapa canvas.

Lê um GeoJSON de municípios IBGE (propriedades com código IBGE7, UF e nome)
e escreve `web/public/data/malha_municipios.topojson` quantizado + delta
codificado (estilo TopoJSON), com simplificação agressiva p/ caber em ~1-3MB
(spec §8).

Uso:
    python scripts/malha.py --input malha.geojson --output web/public/data/malha_municipios.topojson --quantize 2000

Sem o arquivo real, <MapaBrasil> recebe `malhaUrl` e falha fechado
(fallback lista + link TSE); o build NÃO exige o arquivo.
"""

from __future__ import annotations

import argparse
import json
import math


def _dist_ponto_segmento(px, py, ax, ay, bx, by):
    dx = bx - ax
    dy = by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplificar_anel(anel, tolerancia):
    """Douglas-Peucker simplificado (anel fechado preservado)."""
    if len(anel) <= 4 or tolerancia <= 0:
        return anel
    fechado = anel[0] == anel[-1]
    pts = anel[:-1] if fechado else list(anel)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    pilha = [(0, len(pts) - 1)]
    while pilha:
        a, b = pilha.pop()
        dmax, imax = 0.0, -1
        for i in range(a + 1, b):
            d = _dist_ponto_segmento(
                pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]
            )
            if d > dmax:
                dmax, imax = d, i
        if dmax > tolerancia:
            keep[imax] = True
            pilha.append((a, imax))
            pilha.append((imax, b))
    out = [p for p, k in zip(pts, keep) if k]
    if fechado:
        out.append(out[0])
    return out


def geojson_para_topojson(fc, quantize, tolerancia):
    geoms = []
    arcs = []
    minx = miny = math.inf
    maxx = maxy = -math.inf
    for feat in fc.get("features", []):
        geom = feat.get("geometry") or {}
        for poly in (
            [geom["coordinates"]]
            if geom.get("type") == "Polygon"
            else geom.get("coordinates", [])
            if geom.get("type") == "MultiPolygon"
            else []
        ):
            for anel in poly:
                for x, y in anel:
                    minx, miny = min(minx, x), min(miny, y)
                    maxx, maxy = max(maxx, x), max(maxy, y)
    if minx == math.inf:
        raise ValueError("GeoJSON sem coordenadas de polígonos")
    sx = (maxx - minx) / (quantize - 1) or 1.0
    sy = (maxy - miny) / (quantize - 1) or 1.0

    def quantizar(anel):
        return [
            (round((x - minx) / sx), round((y - miny) / sy)) for x, y in anel
        ]

    for feat in fc.get("features", []):
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        ibge7 = str(props.get("ibge7") or props.get("CD_MUN") or props.get("id") or "")
        if not ibge7 or geom.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        polys = (
            [geom["coordinates"]]
            if geom["type"] == "Polygon"
            else geom["coordinates"]
        )
        topo_polys = []
        for poly in polys:
            topo_aneis = []
            for anel in poly:
                simp = simplificar_anel(quantizar(anel), tolerancia)
                qx0 = qy0 = 0
                delta = []
                for qx, qy in simp:
                    delta.append([qx - qx0, qy - qy0])
                    qx0, qy0 = qx, qy
                arcs.append(delta)
                topo_aneis.append([len(arcs) - 1])
            topo_polys.append(topo_aneis)
        geoms.append(
            {
                "type": "MultiPolygon",
                "properties": {
                    "ibge7": ibge7,
                    "uf": str(props.get("uf") or props.get("SIGLA_UF") or ""),
                    "nome": str(props.get("nome") or props.get("NM_MUN") or ibge7),
                },
                "arcs": topo_polys,
            }
        )
    return {
        "type": "Topology",
        "transform": {"scale": [sx, sy], "translate": [minx, miny]},
        "objects": {
            "municipios": {"type": "GeometryCollection", "geometries": geoms}
        },
        "arcs": arcs,
    }


def main():
    ap = argparse.ArgumentParser(description="Gera malha TopoJSON simplificada.")
    ap.add_argument("--input", required=True, help="GeoJSON de municípios IBGE")
    ap.add_argument("--output", required=True, help="TopoJSON de saída")
    ap.add_argument("--quantize", type=int, default=2000)
    ap.add_argument("--tolerancia", type=float, default=1.0,
                    help="Tolerância Douglas-Peucker (unidades quantizadas)")
    args = ap.parse_args()
    with open(args.input, encoding="utf-8") as f:
        fc = json.load(f)
    topo = geojson_para_topojson(fc, args.quantize, args.tolerancia)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(topo, f, separators=(",", ":"))
    print(f"OK: {len(topo['objects']['municipios']['geometries'])} municípios, "
          f"{len(topo['arcs'])} arcos -> {args.output}")


if __name__ == "__main__":
    main()
