// @vitest-environment jsdom
// EVOLVE-9 Task 3: (a) PainelRegiao sem self-fetch — a página /regiao detém
// o mapa do Censo (prop `censo` sempre repassada, null inicial); o effect
// interno que buscava CENSO_URL + manifest quando `censo===undefined` era
// morto em prod (VERIFICADO: único call site produtivo sempre passa a prop)
// e fork de fetch cru — removido. Prop omitida → SEM_DADO sem nenhum fetch
// (fail-closed). (b) paridade de rotação: Explorar/Verificar/Analisar re-lêem
// o manifest em focus/visibilitychange (padrão Home/regiao: guard de geração,
// sem-duplicado, cleanup) e só refazem o fetch pesado com selo mudado.
// (R5) As 3 matrizes por página viraram UMA matriz table-driven (dedupe
// Sonar): um runner por cenário sobre `PAGINAS` — mesmas assertions,
// harness partilhado, zero mudança de comportamento.
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react-dom/test-utils";
import type { Root } from "react-dom/client";
import PainelRegiao from "../components/PainelRegiao";
import ExplorarPage from "../app/explorar/page";
import VerificarPage from "../app/verificar/page";
import AnalisarPage from "../app/analisar/page";
import {
  SEM_DADO,
  RESUMO,
  POR_UF,
  POR_CAND,
  instalarFetchRoteado,
  contaChamadas,
  focarRotacao,
  montarRotacao,
  voltarVisivelRotacao,
} from "./helpers";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const DS = "fato_2022_1_presidente";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const manifestComHash = (hash: string) => ({
  ingestions: [
    {
      tipo: "fato_municipal",
      dataset: DS,
      sha256: hash,
      source_url: "https://cdn.tse.jus.br/x.zip",
      date: "2026-01-01",
    },
  ],
});
const MANIFEST_A = manifestComHash(HASH_A);
const MANIFEST_B = manifestComHash(HASH_B);

function demo() {
  return {
    esc_sup: 12, esc_med: 30, esc_fund: 50, renda_media: 2200,
    pobres_pct: 18, idade_mediana: 34, urbanizacao: 85,
    pop: 12000, eleitores: 10000,
  };
}
const FATO = {
  candidatos: [
    { id: "A", nome: "Cand A", partido: "PA" },
    { id: "B", nome: "Cand B", partido: "PB" },
  ],
  municipios: [
    { ibge: "3550308", uf: "SP", nome: "Mun 0", votos: [600, 400], total: 1000, abst: 100, demo: demo() },
  ],
};
const CENSO = { "3550308": 12345 };

const SEAL_NULO = { official: null, hasFixture: false, fixtureHash: "" };

function perfil(html: string): string {
  return html.split("<h2>Perfil do lugar</h2>")[1] ?? "";
}

// Roteadores mutáveis: a rotação troca manifest/dados SEM remontar a página.
let manifestAtual: unknown = MANIFEST_A;
let fatoAtual: unknown = FATO;
let porUfAtual: unknown = POR_UF;
// Blip de rede: com true, o fetch do manifest REJEITA (offline) — a rotação
// deve manter o último selo validado, nunca suprimir dado válido.
let falharManifest = false;
// Buraco 200+null: fetch OK mas corpo JSON null — passa no `status==="ok"`
// e derivava selo vazio (wipe). Também deve manter o último válido.
let manifestNulo = false;
// Buraco R3: 200 `{}` passa no object-check e derivava selo vazio (wipe).
// `{ingestions:[]}` é estruturalmente válido → rotação prossegue e suprime
// (fail-closed: vazio atesta nada — pinado abaixo).
let corpoForjado: unknown = undefined;
let forjarCorpo = false;
const chamadas: string[] = [];

function instalarRotacao() {
  manifestAtual = MANIFEST_A;
  fatoAtual = FATO;
  porUfAtual = POR_UF;
  falharManifest = false;
  manifestNulo = false;
  corpoForjado = undefined;
  forjarCorpo = false;
  instalarFetchRoteado(chamadas, (u) => {
    if (u.endsWith("/data/manifest.json")) {
      if (falharManifest) throw new TypeError("fetch failed");
      if (manifestNulo) return { ok: true, json: async () => null };
      if (forjarCorpo) return { ok: true, json: async () => corpoForjado };
      return { ok: true, json: async () => manifestAtual };
    }
    if (u.endsWith("/data/resumo.json")) return { ok: true, json: async () => RESUMO };
    if (u.endsWith("/data/por_uf.json")) return { ok: true, json: async () => porUfAtual };
    if (u.endsWith("/data/por_candidato.json")) return { ok: true, json: async () => POR_CAND };
    if (u.includes("/data/fato_")) return { ok: true, json: async () => fatoAtual };
    return { ok: false, json: async () => null };
  });
}

const conta = (sufixo: string): number => contaChamadas(chamadas, sufixo);

const voltarVisivel = (): Promise<void> => voltarVisivelRotacao();

let el: HTMLDivElement | null = null;
let root: Root | null = null;

async function montar(nodo: React.ReactElement): Promise<HTMLDivElement> {
  ({ el, root } = await montarRotacao(nodo));
  return el!;
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  el?.remove();
  el = null;
  vi.unstubAllGlobals();
});

describe("PainelRegiao sem self-fetch (EVOLVE-9 Task 3a)", () => {
  it("prop omitida → SEM_DADO sem nenhum fetch (self-fetch morto removido)", async () => {
    instalarRotacao();
    const div = await montar(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_NULO} manifestChecked />,
    );
    const linha = (perfil(div.innerHTML).split("População (Censo 2022)")[1] ?? "").split("</li>")[0];
    expect(linha).toContain(SEM_DADO);
    // Zero fetch cru: nem manifest, nem Censo — a página detém o mapa.
    expect(chamadas).toEqual([]);
  });

  it("com prop censo → número sem nenhum fetch (seam determinístico intacto)", async () => {
    instalarRotacao();
    const div = await montar(
      <PainelRegiao ibge="3550308" fato={FATO} seal={SEAL_NULO} manifestChecked censo={CENSO} />,
    );
    expect(perfil(div.innerHTML)).toContain("12.345");
    expect(chamadas).toEqual([]);
  });
});

// Matriz table-driven da rotação (R5): UM runner por cenário sobre PAGINAS.
// Parâmetros por página — `pesados` (fetches estáveis em 1 sem rotação),
// `pesadoMantido` (fetch que não re-dispara nos casos manter),
// `manifestSomente` (rota sem pesado: tudo buscado é manifest), `numero`
// (marcador de números: presente nos manter, ausente só na supressão).
interface PaginaMatriz {
  rota: string;
  nodo: () => React.ReactElement;
  pesados: string[];
  pesadoMantido: string | null;
  manifestSomente: boolean;
  numero: string | null;
}

const PAGINAS: PaginaMatriz[] = [
  {
    rota: "/explorar",
    nodo: () => <ExplorarPage />,
    pesados: [`/data/${DS}.json`],
    pesadoMantido: `/data/${DS}.json`,
    manifestSomente: false,
    // Data de auditoria do selo: único marcador numérico dependente de
    // estado (seleção default não renderiza votos; curados estáticos como
    // "20%" valem nos dois estados e não servem).
    numero: "2026-01-01",
  },
  {
    rota: "/verificar",
    nodo: () => <VerificarPage />,
    pesados: [],
    pesadoMantido: null,
    manifestSomente: true,
    // Índice sem fato: só número dependente de estado é a data do selo
    // (títulos curados com "20%"/"10 pontos" são estáticos, presentes
    // suprimido — não servem como marcador de vazamento).
    numero: "2026-01-01",
  },
  {
    rota: "/analisar",
    nodo: () => <AnalisarPage />,
    pesados: ["/data/resumo.json", "/data/por_uf.json"],
    pesadoMantido: "/data/resumo.json",
    manifestSomente: false,
    numero: "Total de votos no filtro: 3.000",
  },
];

type Perturbacao = "blip" | "nulo" | "vazio";

function perturbar(tipo: Perturbacao): void {
  if (tipo === "blip") falharManifest = true;
  else if (tipo === "nulo") manifestNulo = true;
  else {
    corpoForjado = {};
    forjarCorpo = true;
  }
}

// Abertura comum: monta com MANIFEST_A e pin o selo válido antes de perturbar.
async function montarComSelo(p: PaginaMatriz): Promise<HTMLDivElement> {
  instalarRotacao();
  const div = await montar(p.nodo());
  expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
  return div;
}

// Marcador de números: só páginas com `numero` afirmam (presente/ausente).
function afirmaNumero(div: HTMLDivElement, p: PaginaMatriz, negado = false): void {
  if (p.numero === null) return;
  if (negado) expect(div.innerHTML).not.toContain(p.numero);
  else expect(div.innerHTML).toContain(p.numero);
}

async function matrizTroca(p: PaginaMatriz): Promise<void> {
  const div = await montarComSelo(p);
  manifestAtual = MANIFEST_B;
  await focarRotacao();
  expect(div.innerHTML).toContain(`sha256: ${HASH_B}`);
  expect(div.innerHTML).not.toContain(`sha256: ${HASH_A}`);
}

async function matrizSemRotacao(p: PaginaMatriz): Promise<void> {
  instalarRotacao();
  await montar(p.nodo());
  expect(conta("/data/manifest.json")).toBe(1);
  for (const s of p.pesados) expect(conta(s)).toBe(1);
  await focarRotacao();
  expect(conta("/data/manifest.json")).toBe(2);
  for (const s of p.pesados) expect(conta(s)).toBe(1);
  if (p.manifestSomente) {
    // Sem fetch pesado nesta rota: tudo o que foi buscado foi manifest.
    expect(chamadas.every((u) => u.endsWith("/data/manifest.json"))).toBe(true);
  }
}

async function matrizVisivel(p: PaginaMatriz): Promise<void> {
  const div = await montarComSelo(p);
  manifestAtual = MANIFEST_B;
  await voltarVisivel();
  expect(div.innerHTML).toContain(`sha256: ${HASH_B}`);
}

async function matrizMantido(p: PaginaMatriz, tipo: Perturbacao): Promise<void> {
  const div = await montarComSelo(p);
  afirmaNumero(div, p);
  perturbar(tipo);
  await focarRotacao();
  // Stale-while-revalidate: ilegível ≠ rotação — válido mantido, foco
  // retentou a leitura, sem pesado sobre dado válido.
  expect(conta("/data/manifest.json")).toBe(2);
  expect(div.innerHTML).toContain(`sha256: ${HASH_A}`);
  afirmaNumero(div, p);
  expect(div.innerHTML).not.toContain("dado não auditado");
  if (p.pesadoMantido !== null) expect(conta(p.pesadoMantido)).toBe(1);
}

async function matrizSuprimido(p: PaginaMatriz): Promise<void> {
  const div = await montarComSelo(p);
  afirmaNumero(div, p);
  corpoForjado = { ingestions: [] };
  forjarCorpo = true;
  await focarRotacao();
  // Estruturalmente válido: rotação prossegue e o selo vazio suprime.
  expect(div.innerHTML).not.toContain(`sha256: ${HASH_A}`);
  afirmaNumero(div, p, true);
  expect(div.innerHTML).toContain("dado não auditado");
}

for (const p of PAGINAS) {
  describe(`${p.rota}: rotação de manifest (matriz Task 3b/R2/R3)`, () => {
    it("manifest trocado + foco → selo novo (sem stale)", () => matrizTroca(p));
    it("foco sem rotação: só o manifest barato é relido (sem fetch duplicado)", () =>
      matrizSemRotacao(p));
    it("visibilitychange visível com manifest trocado → selo novo", () => matrizVisivel(p));
    it("blip no manifest (fetch rejeita) → válido mantido, sem supressão", () =>
      matrizMantido(p, "blip"));
    it("manifest 200 com corpo null → válido mantido, sem supressão", () =>
      matrizMantido(p, "nulo"));
    it("manifest 200 `{}` → válido mantido (sem ingestions não é manifest)", () =>
      matrizMantido(p, "vazio"));
    it("manifest 200 `{ingestions:[]}` → suprime (vazio atesta nada, fail-closed)", () =>
      matrizSuprimido(p));
  });
}
