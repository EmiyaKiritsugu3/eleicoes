"use client";

/** /explorar — montador em blocos (Task 8, spec §3/§8).
 *
 * Blocos: quem · onde · cruzar com · ver como. Qualquer combinação dos
 * blocos computa client-side sobre o fato municipal; combinação sem
 * cobertura → "sem dado oficial" (fail-closed, nunca tela branca); fora
 * dos blocos vira sugestão (input desabilitado, sem texto livre).
 *
 * Consome (sem reinventar): motor completo (`perfilOndeVenceu` +
 * `pesoFonte`, `correlacao` + `quintis` com supressão-`[]`, `VAR_DEMO`),
 * `MapaBrasil` (`onSelectIbge` → foco), `SealSlot`/`SourceBadge` por
 * seção, `ECO_SEAL`/`SEM_DADO`/`NOTA_PESO_MISTO` do painel da região,
 * `fatoDatasetDe` p/ descobrir o fato (na rota), e o padrão de share da casa
 * (`URLSearchParams` + `hash` do manifest, cf. `buildShareUrl` em
 * `lib/export` — prefixo próprio `/explorar`, estado em `?q=`).
 *
 * Limites (spec §8): no máx. 3 visões simultâneas; debounce de 250ms na
 * busca de candidato. O painel da região linka p/ cá via
 * `/explorar?foco=<ibge>` — o foco é honrado (destaque + detalhe).
 */

import React, { useEffect, useMemo, useState } from "react";
import MapaBrasil from "./MapaBrasil";
import SealSlot from "./SealSlot";
import SourceBadge from "./SourceBadge";
import {
  ECO_SEAL,
  NOTA_PESO_MISTO,
  SEM_DADO,
  type FatoRegiao,
} from "./PainelRegiao";
import type { SealState } from "../lib/data";
import {
  VAR_DEMO,
  correlacao,
  indiceVencedor,
  perfilOndeVenceu,
  quintis,
  shareCandidato,
  totalLinha,
  type MunRow,
  type VarDemo,
} from "../lib/motor";

export interface ExplorarSelecao {
  quem: string;
  onde: string;
  cruzar: string;
  ver: string[];
  foco?: string;
}

export const ONDE_OPCOES = [
  { value: "venceu", label: "onde venceu" },
  { value: "segundo", label: "onde foi 2º lugar" },
  { value: "margem_10", label: "onde venceu com margem > 10pp" },
  { value: "participacao_80", label: "onde venceu com participação > 80%" },
] as const;

export const VER_OPCOES = [
  { value: "mapa", label: "mapa" },
  { value: "dispersao", label: "dispersão" },
  { value: "ranking", label: "ranking" },
  { value: "tabela", label: "tabela" },
] as const;

export const MAX_VISOES = 3;
const DEBOUNCE_MS = 250;

/** Valores `ver` conhecidos; `?q=` adulterado com visões fora do set é
 *  descartado no parse (fail-closed) e na renderização (`verSeguro`). */
const VER_VALIDOS = new Set<string>(VER_OPCOES.map((o) => o.value));

const ALERTA_STYLE: React.CSSProperties = {
  background: "#fff3cd",
  border: "1px solid #b45309",
  fontWeight: "bold",
};

function finito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Filtro do bloco "onde" sobre as linhas do fato. Desconhecido → []. */
export function aplicarOnde(
  rows: MunRow[],
  candidatos: { id: string }[],
  quem: string,
  onde: string,
): MunRow[] {
  const lista = Array.isArray(rows) ? rows : [];
  const ordem = Array.isArray(candidatos) ? candidatos : [];
  const idx = ordem.findIndex((c) => c?.id === quem);
  if (idx < 0) return [];
  if (onde === "venceu") {
    return lista.filter((r) => indiceVencedor(r?.votos ?? []) === idx);
  }
  if (onde === "segundo") {
    return lista.filter((r) => {
      const comIndice = (r?.votos ?? [])
        .map((v, i) => ({ v, i }))
        .filter((e) => finito(e.v));
      if (comIndice.length < 2) return false;
      const estavel = comIndice.sort((a, b) => (b.v as number) - (a.v as number));
      return estavel[1].i === idx;
    });
  }
  if (onde === "margem_10") {
    return lista.filter((r) => {
      if (indiceVencedor(r?.votos ?? []) !== idx) return false;
      const vals = (r?.votos ?? []).filter(finito).sort((a, b) => b - a) as number[];
      const total = totalLinha(r);
      if (vals.length < 2 || total <= 0) return false;
      return (vals[0] - vals[1]) / total > 0.1;
    });
  }
  if (onde === "participacao_80") {
    return lista.filter((r) => {
      if (indiceVencedor(r?.votos ?? []) !== idx) return false;
      const eleitores = r?.demo?.eleitores;
      if (!finito(eleitores) || (eleitores as number) <= 0) return false;
      return totalLinha(r) / (eleitores as number) > 0.8;
    });
  }
  return [];
}

function b64urlEncode(s: string): string {
  const b =
    typeof Buffer !== "undefined"
      ? Buffer.from(s, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(s)));
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string | null {
  try {
    const b = s.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof Buffer !== "undefined") return Buffer.from(b, "base64").toString("utf8");
    return decodeURIComponent(escape(atob(b)));
  } catch {
    return null;
  }
}

/** Estado → `/explorar?q=<estado>&hash=<manifest>` (mesmo padrão de `buildShareUrl`). */
export function buildExplorarShareUrl(sel: ExplorarSelecao, manifestHash: string): string {
  const params = new URLSearchParams();
  const q = b64urlEncode(
    JSON.stringify({
      quem: sel.quem ?? "",
      onde: sel.onde ?? "",
      cruzar: sel.cruzar ?? "",
      ver: Array.isArray(sel.ver) ? sel.ver : [],
      foco: sel.foco ?? "",
    }),
  );
  if (q) params.set("q", q);
  if (typeof manifestHash === "string" && manifestHash.trim().length > 0) {
    params.set("hash", manifestHash.trim());
  }
  const qs = params.toString();
  return qs ? `/explorar?${qs}` : "/explorar";
}

const SEL_PADRAO: ExplorarSelecao = {
  quem: "",
  onde: "venceu",
  cruzar: "esc_sup",
  ver: ["dispersao"],
  foco: "",
};

/** Query → seleção: `?q=` vence; `?foco=` (link do painel da região) e
 *  `?hash=` valem mesmo sem `?q=`. `?q=` inválido → padrão (fail-closed). */
export function parseExplorarQuery(search: string): ExplorarSelecao & { hash: string } {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search ?? "");
  } catch {
    return { ...SEL_PADRAO, hash: "" };
  }
  let sel: ExplorarSelecao = { ...SEL_PADRAO };
  const q = params.get("q");
  if (q && q.trim() !== "") {
    const cru = b64urlDecode(q.trim());
    if (cru) {
      try {
        const obj = JSON.parse(cru) as Partial<ExplorarSelecao>;
        sel = {
          quem: typeof obj.quem === "string" ? obj.quem : "",
          onde: typeof obj.onde === "string" ? obj.onde : SEL_PADRAO.onde,
          cruzar: typeof obj.cruzar === "string" ? obj.cruzar : SEL_PADRAO.cruzar,
          ver: Array.isArray(obj.ver)
            ? obj.ver
                .filter((v) => typeof v === "string" && VER_VALIDOS.has(v))
                .slice(0, MAX_VISOES)
            : [...SEL_PADRAO.ver],
          foco: typeof obj.foco === "string" ? obj.foco : "",
        };
        if (sel.ver.length === 0) sel.ver = [...SEL_PADRAO.ver];
      } catch {
        sel = { ...SEL_PADRAO };
      }
    }
  }
  const foco = params.get("foco");
  if (foco !== null && foco.trim() !== "") sel.foco = foco;
  return { ...sel, hash: params.get("hash") ?? "" };
}

/** Núcleo puro/testável: computa tudo de forma síncrona sobre o fato. */
export function ExplorarConteudo({
  fato,
  seal,
  initial,
}: {
  fato: FatoRegiao | null;
  seal: SealState;
  initial: ExplorarSelecao;
}) {
  const [sel, setSel] = useState<ExplorarSelecao>({ ...SEL_PADRAO, ...initial });
  const [busca, setBusca] = useState("");
  const [buscaDeb, setBuscaDeb] = useState("");
  const [notaTeto, setNotaTeto] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [busca]);

  const ordem = useMemo(() => fato?.candidatos ?? [], [fato]);
  const linhas = useMemo(() => fato?.municipios ?? [], [fato]);

  const candidatosVisiveis = useMemo(() => {
    const q = buscaDeb.trim().toLowerCase();
    if (!q) return ordem;
    return ordem.filter(
      (c) =>
        String(c?.nome ?? "").toLowerCase().includes(q) ||
        String(c?.id ?? "").toLowerCase().includes(q) ||
        String(c?.partido ?? "").toLowerCase().includes(q),
    );
  }, [ordem, buscaDeb]);

  const quemOk = ordem.some((c) => c?.id === sel.quem);
  const ondeOk = ONDE_OPCOES.some((o) => o.value === sel.onde);
  const cruzarOk = (VAR_DEMO as readonly string[]).includes(sel.cruzar);
  const coberto = fato !== null && quemOk && ondeOk && cruzarOk;

  const filtradas = useMemo(
    () => (coberto ? aplicarOnde(linhas, ordem, sel.quem, sel.onde) : []),
    [coberto, linhas, ordem, sel.quem, sel.onde],
  );

  const idxQuem = ordem.findIndex((c) => c?.id === sel.quem);
  const xs = useMemo(
    () =>
      filtradas.map(
        (r) => (r?.demo ? (r.demo[sel.cruzar as VarDemo] as unknown as number) : null) as unknown as number,
      ),
    [filtradas, sel.cruzar],
  );
  const ys = useMemo(
    () => filtradas.map((r) => shareCandidato(r, idxQuem) as unknown as number),
    [filtradas, idxQuem],
  );
  const corr = useMemo(
    () => (coberto && filtradas.length > 0 ? correlacao(xs, ys, "pearson") : null),
    [coberto, filtradas.length, xs, ys],
  );
  const faixas = useMemo(
    () => (coberto && filtradas.length > 0 ? quintis(xs, ys) : []),
    [coberto, filtradas.length, xs, ys],
  );
  const perfil = useMemo(
    () =>
      quemOk
        ? perfilOndeVenceu(linhas, { candidatoId: sel.quem, candidatos: ordem })
        : null,
    [quemOk, linhas, sel.quem, ordem],
  );

  const ranking = useMemo(() => {
    if (!coberto || idxQuem < 0) return [];
    return filtradas
      .map((r) => ({ row: r, share: shareCandidato(r, idxQuem) }))
      .filter((e) => e.share !== null)
      .sort((a, b) => (b.share as number) - (a.share as number))
      .slice(0, 10);
  }, [coberto, filtradas, idxQuem]);

  const cores = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of linhas) {
      const w = indiceVencedor(r?.votos ?? []);
      if (w >= 0 && w < ordem.length) {
        out[String(r.ibge)] = w === idxQuem ? "#1d4ed8" : "#94a3b8";
      }
    }
    if (sel.foco && sel.foco.trim() !== "") out[sel.foco.trim()] = "#f59e0b";
    return out;
  }, [linhas, ordem.length, idxQuem, sel.foco]);

  const focoRow = useMemo(() => {
    const f = (sel.foco ?? "").trim();
    if (!f) return undefined;
    return linhas.find((r) => String(r?.ibge ?? "") === f);
  }, [linhas, sel.foco]);

  const toggleVer = (v: string) => {
    setSel((prev) => {
      if (prev.ver.includes(v)) {
        setNotaTeto(false);
        return { ...prev, ver: prev.ver.filter((x) => x !== v) };
      }
      if (prev.ver.length >= MAX_VISOES) {
        setNotaTeto(true);
        return prev;
      }
      setNotaTeto(false);
      return { ...prev, ver: [...prev.ver, v] };
    });
  };

  // Defesa em profundidade: `initial` pode chegar sem passar pelo parse
  // (uso programático); só visões conhecidas renderizam, teto mantido.
  const verSeguro = useMemo(
    () => (Array.isArray(sel.ver) ? sel.ver : []).filter((v) => VER_VALIDOS.has(v)).slice(0, MAX_VISOES),
    [sel.ver],
  );

  const shareUrl = buildExplorarShareUrl({ ...sel, ver: verSeguro }, seal.official?.hash ?? "");
  const badge = <SealSlot seal={seal} />;
  const ondeLabel = ONDE_OPCOES.find((o) => o.value === sel.onde)?.label ?? sel.onde;
  const quemNome = ordem.find((c) => c?.id === sel.quem)?.nome ?? sel.quem;

  return (
    <>
      <h1>Motor Verdade — explorar em blocos</h1>
      {seal.official && (
        <SourceBadge hash={seal.official.hash} url={seal.official.url} date={seal.official.date} />
      )}

      <section aria-label="Blocos">
        <h2>Blocos — quem · onde · cruzar com · ver como</h2>
        {badge}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <label>
            quem{" "}
            <select
              aria-label="quem"
              value={sel.quem}
              onChange={(e) => setSel((p) => ({ ...p, quem: e.target.value }))}
            >
              <option value="">— escolher —</option>
              {candidatosVisiveis.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome} ({c.partido})
                </option>
              ))}
            </select>
          </label>
          <label>
            buscar candidato{" "}
            <input
              aria-label="buscar candidato"
              placeholder="buscar candidato"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </label>
          <label>
            onde{" "}
            <select
              aria-label="onde"
              value={sel.onde}
              onChange={(e) => setSel((p) => ({ ...p, onde: e.target.value }))}
            >
              {ONDE_OPCOES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            cruzar com{" "}
            <select
              aria-label="cruzar com"
              value={sel.cruzar}
              onChange={(e) => setSel((p) => ({ ...p, cruzar: e.target.value }))}
            >
              {(VAR_DEMO as readonly string[]).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>ver como (máx. {MAX_VISOES})</legend>
            {VER_OPCOES.map((o) => (
              <label key={o.value} style={{ marginRight: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={verSeguro.includes(o.value)}
                  onChange={() => toggleVer(o.value)}
                  aria-label={`ver ${o.label}`}
                />{" "}
                {o.label}
              </label>
            ))}
          </fieldset>
        </div>
        {notaTeto && <p role="note">máximo {MAX_VISOES} visões simultâneas</p>}
        <p>
          <label>
            pergunta livre{" "}
            <input
              aria-label="pergunta livre"
              placeholder="fora dos blocos vira sugestão"
              disabled
              readOnly
              value=""
            />
          </label>{" "}
          <small>
            fora dos blocos vira sugestão: combine quem · onde · cruzar com · ver como acima —
            sem texto livre
          </small>
        </p>
      </section>

      <section aria-label="Resultado">
        <h2>
          Resultado — {quemNome} · {ondeLabel} · {sel.cruzar}
        </h2>
        {badge}
        {!fato ? (
          <p role="alert" style={ALERTA_STYLE}>{SEM_DADO}</p>
        ) : !coberto ? (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO} — combinação sem cobertura nos blocos; ajuste quem · onde · cruzar com
            acima
          </p>
        ) : filtradas.length === 0 ? (
          <p role="alert" style={ALERTA_STYLE}>{SEM_DADO} — nenhum município neste recorte</p>
        ) : (
          <p>
            n = {filtradas.length} municípios
            {corr ? (
              <>
                {" "}· r = {corr.r.toFixed(3)} (n = {corr.n})
              </>
            ) : (
              <> · r = {SEM_DADO} — municípios insuficientes (piso n ≥ 30)</>
            )}
          </p>
        )}
      </section>

      {(sel.foco ?? "").trim() !== "" && (
        <section aria-label="Foco da região">
          <h2>Foco da região</h2>
          {badge}
          {!focoRow ? (
            <p role="alert" style={ALERTA_STYLE}>{SEM_DADO} — foco {(sel.foco ?? "").trim()} fora do fato municipal</p>
          ) : (
            <p>
              {String(focoRow.nome ?? focoRow.ibge)} ({String(focoRow.ibge)}) — UF{" "}
              {String(focoRow.uf ?? "")}
              {idxQuem >= 0 && shareCandidato(focoRow, idxQuem) !== null
                ? ` · share de ${quemNome}: ${((shareCandidato(focoRow, idxQuem) as number) * 100).toFixed(1).replace(".", ",")}%`
                : ""}
            </p>
          )}
        </section>
      )}

      {verSeguro.includes("dispersao") && (
        <section aria-label="Dispersão">
          <h2>Dispersão — {sel.cruzar} × share de {quemNome}</h2>
          {badge}
          <p role="note">{ECO_SEAL} — cada ponto é um município, nunca uma pessoa.</p>
          {!coberto ? (
            <p role="alert" style={ALERTA_STYLE}>
              {SEM_DADO} — sem cobertura nos blocos; ajuste quem · onde · cruzar com acima
            </p>
          ) : !corr ? (
            <p role="alert" style={ALERTA_STYLE}>
              {SEM_DADO} — correlação suprimida (piso n ≥ 30 municípios ou variância zero)
            </p>
          ) : faixas.length === 0 ? (
            <p role="alert" style={ALERTA_STYLE}>
              {SEM_DADO} — sem cobertura neste recorte
            </p>
          ) : (
            <>
              <p>
                r = {corr.r.toFixed(3)} (n = {corr.n})
              </p>
              <table>
                <caption>Share médio por quintil de {sel.cruzar}</caption>
                <thead>
                  <tr>
                    <th scope="col">Faixa</th>
                    <th scope="col">Share médio</th>
                    <th scope="col">n</th>
                  </tr>
                </thead>
                <tbody>
                  {faixas.map((f) => (
                    <tr key={f.faixa}>
                      <td>{f.faixa}</td>
                      <td>{f.mediaY.toFixed(3)}</td>
                      <td>{f.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {verSeguro.includes("ranking") && (
        <section aria-label="Ranking">
          <h2>Ranking — maior share de {quemNome}</h2>
          {badge}
          {!coberto || ranking.length === 0 ? (
            <p role="alert" style={ALERTA_STYLE}>{SEM_DADO} — sem cobertura neste recorte</p>
          ) : (
            <table>
              <caption>Top municípios por share</caption>
              <thead>
                <tr>
                  <th scope="col">Município</th>
                  <th scope="col">IBGE</th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((e) => (
                  <tr key={String(e.row.ibge)}>
                    <td>{String(e.row.nome ?? "")}</td>
                    <td>{String(e.row.ibge)}</td>
                    <td>{((e.share as number) * 100).toFixed(1).replace(".", ",")}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {verSeguro.includes("tabela") && (
        <section aria-label="Perfil de onde venceu">
          <h2>Perfil de onde {quemNome} venceu</h2>
          {badge}
          <p role="note">{ECO_SEAL} — médias de municípios, nunca de pessoas.</p>
          {!perfil || perfil.nMun === 0 ? (
            <p role="alert" style={ALERTA_STYLE}>{SEM_DADO}</p>
          ) : (
            <>
              {(perfil.pesoFonte === "misto") && <p role="note">{NOTA_PESO_MISTO}</p>}
              <p>
                n = {perfil.nMun} municípios · {perfil.nEleitores} eleitores (peso:{" "}
                {perfil.pesoFonte})
              </p>
              <table>
                <caption>Médias ponderadas vs Brasil</caption>
                <thead>
                  <tr>
                    <th scope="col">Variável</th>
                    <th scope="col">Onde venceu</th>
                    <th scope="col">Brasil</th>
                  </tr>
                </thead>
                <tbody>
                  {(VAR_DEMO as readonly string[]).map((v) => (
                    <tr key={v}>
                      <td>{v}</td>
                      <td>
                        {Number.isFinite(perfil.medias[v as VarDemo])
                          ? (perfil.medias[v as VarDemo] as number).toFixed(2)
                          : SEM_DADO}
                      </td>
                      <td>
                        {Number.isFinite(perfil.vsBrasil[v as VarDemo])
                          ? (perfil.vsBrasil[v as VarDemo] as number).toFixed(2)
                          : SEM_DADO}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {verSeguro.includes("mapa") && (
        <section aria-label="Mapa">
          <h2>Mapa — vencedor por município</h2>
          {badge}
          {!fato ? (
            <p role="alert" style={ALERTA_STYLE}>{SEM_DADO}</p>
          ) : (
            <MapaBrasil
              malhaUrl="/data/malha.json"
              nivel="municipio"
              onSelectIbge={(s) => setSel((p) => ({ ...p, foco: String(s) }))}
              cores={cores}
            />
          )}
        </section>
      )}

      <section aria-label="Export reproduzível">
        <h2>Export reproduzível</h2>
        {badge}
        <p>
          URL compartilhável: <code>{shareUrl}</code>
        </p>
      </section>
    </>
  );
}
