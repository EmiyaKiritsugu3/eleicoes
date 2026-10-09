"use client";

/** Biblioteca curada (Task 9, spec §3/§4): resposta completa pré-computada.
 *
 * Implementação ÚNICA consumida pela página estática
 * (`app/perguntas/[slug]/page.tsx`, via `generateStaticParams` no build)
 * e pelos testes sobre MunRow sintéticas (`__tests__/curada.test.ts`).
 * Pré-renderizada no build → números calculados via motor no build.
 *
 * Consome (sem reinventar): motor completo (`perfilOndeVenceu`,
 * `correlacao` Pearson + Spearman, `quintis` com supressão-`[]`,
 * `estratificar` por região e faixa de renda, `conclusaoLeiga`,
 * `shareCandidato`), `aplicarOnde` + `buildExplorarShareUrl` do
 * `/explorar`, `ECO_SEAL`/`NOTA_PESO_MISTO`/`SEM_DADO` do painel da
 * região, `SealSlot`/`SourceBadge` por seção (pixel-mentiroso).
 *
 * `quem` aceita `@vencedor`/`@vice` (resolvidos no fato do build:
 * JSON estático não conhece os ids dos candidatos) ou id literal.
 * `onde` além do vocabulário do explorar (`exterior`, `evolucao`) é
 * escopo conhecido fora do fato municipal → fail-closed com nota de
 * escopo, nunca número sem fonte.
 */

import React from "react";
import SealSlot from "../../components/SealSlot";
import SourceBadge from "../../components/SourceBadge";
import {
  ONDE_OPCOES,
  VER_OPCOES,
  aplicarOnde,
  buildExplorarShareUrl,
} from "../../components/Explorar";
import {
  ECO_SEAL,
  NOTA_PESO_MISTO,
  SEM_DADO,
  type FatoRegiao,
} from "../../components/PainelRegiao";
import type { SealState } from "../../lib/data";
import {
  VAR_DEMO,
  conclusaoLeiga,
  correlacao,
  estratificar,
  perfilOndeVenceu,
  quintis,
  shareCandidato,
  type MunRow,
  type VarDemo,
} from "../../lib/motor";

export interface PerguntaCurada {
  slug: string;
  titulo: string;
  blocos: { quem: string; onde: string; cruzar: string; ver: string[] };
  texto_metodo: string;
}

const VER_VALIDOS = new Set<string>(VER_OPCOES.map((o) => o.value));

/** Escopos conhecidos fora do fato municipal (fail-closed com nota). */
const NOTA_EXTERIOR =
  "votos do exterior fora do fato municipal — esta pergunta está fora do escopo auditado";
const NOTA_EVOLUCAO =
  "série temporal fora do escopo: o fato municipal cobre um pleito — evolução exige múltiplos pleitos auditados";

const VEREDITO_PT: Record<string, string> = {
  sustentado: "padrão sustentado entre os estratos",
  misto: "evidência mista entre os estratos",
  nao_sustentado: "padrão não sustentado pelos estratos",
};

const ALERTA_STYLE: React.CSSProperties = {
  background: "#fff3cd",
  border: "1px solid #b45309",
  fontWeight: "bold",
};

function finito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** r com 3 casas em pt-BR; null (suprimido) → sem dado oficial. */
function fmtR(r: number | null): string {
  return r === null || !finito(r) ? SEM_DADO : r.toFixed(3).replace(".", ",");
}

function notaEscopo(onde: string): string | null {
  if (onde === "exterior") return NOTA_EXTERIOR;
  if (onde === "evolucao") return NOTA_EVOLUCAO;
  return null;
}

/** Resolve `quem` a um candidato do fato (tokens ou id literal). */
export function resolverCandidato(
  fato: FatoRegiao | null,
  quem: string,
): { id: string; nome: string } | null {
  const ordem = fato?.candidatos ?? [];
  if (!Array.isArray(ordem) || ordem.length === 0) return null;
  const q = String(quem ?? "");
  if (q !== "@vencedor" && q !== "@vice") {
    const c = ordem.find((k) => k?.id === q);
    return c ? { id: String(c.id), nome: String(c.nome ?? c.id) } : null;
  }
  const somas = ordem.map((c, i) => {
    let s = 0;
    let algum = false;
    for (const r of fato!.municipios ?? []) {
      const v = r?.votos?.[i];
      if (finito(v)) {
        s += v as number;
        algum = true;
      }
    }
    void c;
    return algum ? s : -Infinity;
  });
  const rank = somas
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s - a.s);
  const alvo = q === "@vencedor" ? rank[0] : rank[1];
  if (!alvo || alvo.s === -Infinity) return null;
  const c = ordem[alvo.i];
  return { id: String(c.id), nome: String(c.nome ?? c.id) };
}

/** Núcleo puro/testável: computa tudo de forma síncrona sobre o fato. */
export function CuradaConteudo({
  pergunta,
  fato,
  seal,
  manifestChecked,
}: {
  pergunta: PerguntaCurada;
  fato: FatoRegiao | null;
  seal: SealState;
  manifestChecked?: boolean;
}) {
  const badge = <SealSlot seal={seal} />;
  const linhas: MunRow[] = fato?.municipios ?? [];
  const ordem = fato?.candidatos ?? [];

  const cand = resolverCandidato(fato, pergunta.blocos.quem);
  const onde = pergunta.blocos.onde;
  const ondeExplorador = (ONDE_OPCOES as readonly { value: string }[]).some(
    (o) => o.value === onde,
  );
  const escopo = notaEscopo(onde);
  const cruzarOk = (VAR_DEMO as readonly string[]).includes(pergunta.blocos.cruzar);
  const cruzar = (cruzarOk ? pergunta.blocos.cruzar : "esc_sup") as VarDemo;

  const filtradas =
    fato !== null && cand !== null ? aplicarOnde(linhas, ordem, cand.id, onde) : [];
  const idxQuem = cand ? ordem.findIndex((c) => c?.id === cand.id) : -1;

  // Perfil honra o recorte `onde`; baseline nacional usa o fato inteiro
  // (mesmo padrão do painel da UF — rótulo "Brasil" honesto).
  const perfil =
    fato !== null && cand !== null
      ? perfilOndeVenceu(filtradas, { candidatoId: cand.id, candidatos: ordem })
      : null;
  const base =
    fato !== null && cand !== null
      ? perfilOndeVenceu(linhas, { candidatoId: cand.id, candidatos: ordem })
      : null;

  const xs = filtradas.map(
    (r) => (r?.demo ? (r.demo[cruzar] as unknown as number) : null) as unknown as number,
  );
  const ys = filtradas.map((r) => shareCandidato(r, idxQuem) as unknown as number);
  const corrP = filtradas.length > 0 ? correlacao(xs, ys, "pearson") : null;
  const corrS = filtradas.length > 0 ? correlacao(xs, ys, "spearman") : null;
  const faixas = filtradas.length > 0 ? quintis(xs, ys) : [];

  const estratosRegiao =
    filtradas.length > 0
      ? estratificar(filtradas, cruzar, { candidatoId: cand!.id, candidatos: ordem }, "regiao")
      : [];
  const estratosRenda =
    filtradas.length > 0
      ? estratificar(filtradas, cruzar, { candidatoId: cand!.id, candidatos: ordem }, "faixa_renda")
      : [];
  const veredito = conclusaoLeiga(corrP ? corrP.r : null, [...estratosRegiao, ...estratosRenda]);

  const ranking =
    idxQuem >= 0
      ? filtradas
          .map((r) => ({ row: r, share: shareCandidato(r, idxQuem) }))
          .filter((e) => e.share !== null)
          .sort((a, b) => (b.share as number) - (a.share as number))
          .slice(0, 10)
      : [];

  const verSeguro = (Array.isArray(pergunta.blocos.ver) ? pergunta.blocos.ver : []).filter(
    (v) => VER_VALIDOS.has(v),
  );
  const shareUrl =
    cand !== null
      ? buildExplorarShareUrl(
          {
            quem: cand.id,
            onde: ondeExplorador ? onde : "venceu",
            cruzar: pergunta.blocos.cruzar,
            ver: verSeguro.length > 0 ? verSeguro : ["dispersao"],
            foco: "",
          },
          seal.official?.hash ?? "",
        )
      : "/explorar";
  const ondeLabel =
    (ONDE_OPCOES as readonly { value: string; label: string }[]).find((o) => o.value === onde)
      ?.label ?? onde;

  return (
    <>
      <h1>{pergunta.titulo}</h1>
      {seal.official && (
        <SourceBadge hash={seal.official.hash} url={seal.official.url} date={seal.official.date} />
      )}
      {manifestChecked && !seal.official && !seal.hasFixture && (
        <p role="alert" className="badge badge-warn" style={ALERTA_STYLE}>
          dado não auditado — manifest ausente ou inválido; números abaixo não são oficiais
        </p>
      )}
      {manifestChecked && !seal.official && seal.hasFixture && <SealSlot seal={seal} />}

      <section aria-label="Pergunta">
        <h2>Pergunta</h2>
        {badge}
        <p>
          quem: <strong>{cand ? cand.nome : pergunta.blocos.quem}</strong> · onde:{" "}
          {ondeLabel} · cruzar com: {pergunta.blocos.cruzar}
        </p>
        {escopo && <p role="note">{escopo}</p>}
        {!ondeExplorador && !escopo && (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO} — combinação sem cobertura nos blocos
          </p>
        )}
      </section>

      <section aria-label="Resultado">
        <h2>Resultado</h2>
        {badge}
        {!fato || !cand ? (
          <p role="alert" style={ALERTA_STYLE}>{SEM_DADO}</p>
        ) : filtradas.length === 0 ? (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO}
            {escopo ? ` — ${escopo}` : " — nenhum município neste recorte"}
          </p>
        ) : (
          <p>
            n = {filtradas.length} municípios · share médio de {cand.nome} ponderado pelo
            eleitorado
            {corrP ? (
              <>
                {" "}· r (Pearson) = {fmtR(corrP.r)} (n = {corrP.n})
              </>
            ) : (
              <> · r = {SEM_DADO} — municípios insuficientes (piso n ≥ 30)</>
            )}
          </p>
        )}
      </section>

      <section aria-label="Perfil de onde venceu">
        <h2>Perfil de onde {cand ? cand.nome : pergunta.blocos.quem} venceu</h2>
        {badge}
        <p role="note">{ECO_SEAL} — médias de municípios, nunca de pessoas.</p>
        {!perfil || !base || perfil.nMun === 0 ? (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO}
            {escopo ? ` — ${escopo}` : ""}
          </p>
        ) : (
          <>
            {perfil.pesoFonte === "misto" && <p role="note">{NOTA_PESO_MISTO}</p>}
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
                      {finito(perfil.medias[v as VarDemo])
                        ? (perfil.medias[v as VarDemo] as number).toFixed(2)
                        : SEM_DADO}
                    </td>
                    <td>
                      {finito(base.vsBrasil[v as VarDemo])
                        ? (base.vsBrasil[v as VarDemo] as number).toFixed(2)
                        : SEM_DADO}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section aria-label="Correlação">
        <h2>Correlação — {pergunta.blocos.cruzar} × share de {cand ? cand.nome : "—"}</h2>
        {badge}
        <p role="note">{ECO_SEAL} — cada ponto é um município, nunca uma pessoa.</p>
        {!fato || !cand ? (
          <p role="alert" style={ALERTA_STYLE}>{SEM_DADO}</p>
        ) : !cruzarOk ? (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO} — sem cobertura nos blocos
          </p>
        ) : !corrP || !corrS ? (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO} — correlação suprimida (piso n ≥ 30 municípios ou variância zero)
          </p>
        ) : faixas.length === 0 ? (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO} — municípios insuficientes (piso n ≥ 30)
          </p>
        ) : (
          <>
            <p>
              r (Pearson) = {fmtR(corrP.r)} · r (Spearman) = {fmtR(corrS.r)} (n = {corrP.n})
            </p>
            <table>
              <caption>Share médio por quintil de {pergunta.blocos.cruzar}</caption>
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

      <section aria-label="Por quê">
        <h2>Por quê? — estratificação</h2>
        {badge}
        <p role="note">
          {ECO_SEAL} — o padrão é testado dentro de cada região e faixa de renda; correlação
          não implica causa.
        </p>
        {!fato || !cand || filtradas.length === 0 ? (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO}
            {escopo ? ` — ${escopo}` : ""}
          </p>
        ) : (
          <>
            <p>
              Veredito em linguagem leiga: <strong>{VEREDITO_PT[veredito]}</strong>
            </p>
            <table>
              <caption>Correlação por região</caption>
              <thead>
                <tr>
                  <th scope="col">Região</th>
                  <th scope="col">r</th>
                  <th scope="col">n</th>
                </tr>
              </thead>
              <tbody>
                {estratosRegiao.map((e) => (
                  <tr key={e.estrato}>
                    <td>{e.estrato}</td>
                    <td>{e.r === null ? `${SEM_DADO} (piso n ≥ 30)` : fmtR(e.r)}</td>
                    <td>{e.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table>
              <caption>Correlação por faixa de renda</caption>
              <thead>
                <tr>
                  <th scope="col">Faixa</th>
                  <th scope="col">r</th>
                  <th scope="col">n</th>
                </tr>
              </thead>
              <tbody>
                {estratosRenda.map((e) => (
                  <tr key={e.estrato}>
                    <td>{e.estrato}</td>
                    <td>{e.r === null ? `${SEM_DADO} (piso n ≥ 30)` : fmtR(e.r)}</td>
                    <td>{e.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section aria-label="Ranking">
        <h2>Ranking — maior share de {cand ? cand.nome : "—"}</h2>
        {badge}
        {ranking.length === 0 ? (
          <p role="alert" style={ALERTA_STYLE}>
            {SEM_DADO}
            {escopo ? ` — ${escopo}` : " — sem cobertura neste recorte"}
          </p>
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

      <section aria-label="Método">
        <h2>Método</h2>
        {badge}
        <p>{pergunta.texto_metodo}</p>
        <p>
          Números desta resposta: n = {filtradas.length} municípios
          {corrP ? ` · r (Pearson) = ${fmtR(corrP.r)}` : ""}
          {corrS ? ` · r (Spearman) = ${fmtR(corrS.r)}` : ""} · veredito:{" "}
          {VEREDITO_PT[veredito]} · voto é secreto: perfis são sempre de municípios.
        </p>
      </section>

      <section aria-label="Fonte e reprodução">
        <h2>Fonte e reprodução</h2>
        {badge}
        <p>
          Para refazer esta análise: <code>{shareUrl}</code>
        </p>
      </section>
    </>
  );
}
