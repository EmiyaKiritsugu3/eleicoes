import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SAD Eleições — metodologia",
  description:
    "Pipeline, regras de auditoria e passo de dados do SAD Eleições.",
};

export default function Metodologia() {
  return (
    <>
      <h1>SAD Eleições — metodologia</h1>

      <section aria-label="Pipeline">
        <h2>Pipeline (offline-first, custo zero)</h2>
        <ol>
          <li>
            <strong>Fetch:</strong> download dos zips no CDN oficial do TSE
            (catálogo em dadosabertos.tse.jus.br), com sha256 registrado por
            ingestão.
          </li>
          <li>
            <strong>Normalize:</strong> resultados no schema canônico
            (ano, turno, cargo, uf, município, candidato, votos).
          </li>
          <li>
            <strong>Marts:</strong> Parquet particionado + DuckDB
            (fato_voto, dim_candidato) + agregados JSON em{" "}
            <code>web/public/data/</code> + cópia idêntica do manifest.
          </li>
          <li>
            <strong>Gates:</strong> qualidade e quarentena; manifest inválido
            reprova fail-closed.
          </li>
          <li>
            <strong>Front:</strong> leitura em runtime de{" "}
            <code>/data/*.json</code> + <code>/data/manifest.json</code>,
            independente do build.
          </li>
        </ol>
      </section>

      <section aria-label="Regras de auditoria">
        <h2>Regras de auditoria</h2>
        <ul>
          <li>
            Um número só é apresentado como oficial quando há hash válido em
            ingestão não-sintética no manifest (<code>isOfficialDisplay</code>{" "}
            exige <code>sha256</code> não-vazio e ausência de{" "}
            <code>fixture:true</code>).
          </li>
          <li>
            Sem manifest ou manifest inválido, a página mostra o banner “dado
            não auditado” e nunca apresenta números como oficiais.
          </li>
          <li>Tabelas e JSONs vazios mostram “sem dado oficial”.</li>
          <li>
            Cada seção com número carrega seu <code>SourceBadge</code> (hash +
            link da fonte oficial + data).
          </li>
          <li>
            URLs compartilháveis carregam <code>?hash=</code>; se o hash da URL
            diverge do manifest atual, a página avisa para revalidar a fonte.
          </li>
          <li>
            Export CSV é bloqueado sem manifest válido, para que o arquivo seja
            auto-descritivo (header <code>fonte,url,hash,data</code>).
          </li>
        </ul>
        <p>
          Ingestões, hashes e downloads em <a href="/auditoria">/auditoria</a>.
        </p>
      </section>

      <section aria-label="Passo de dados">
        <h2>Passo de dados (CI, dev e deploy)</h2>
        <p>
          Os JSONs servidos (<code>resumo.json</code>, <code>por_uf.json</code>,{" "}
          <code>por_candidato.json</code>, <code>manifest.json</code>) são
          gerados pelo ETL e ignorados pelo git (
          <code>web/.gitignore</code> exclui <code>public/data/*.json</code>).
          Sem esse passo, qualquer ambiente (inclusive produção) mostra “dado
          não auditado” por design — nunca números como oficiais.
        </p>
        <ul>
          <li>
            <strong>CI / dev local (amostra sintética, via código real do ETL):</strong>{" "}
            <code>python scripts/seed_fixture_data.py</code> — gera 2 linhas / 15
            votos (2022) e manifest marcado com <code>fixture: true</code>
            (exibido como “amostra sintética — não oficial”, nunca selo oficial);
            recusa sobrescrever manifest com ingestões oficiais salvo{" "}
            <code>--force</code> (o CI usa <code>--force</code>); depois{" "}
            <code>cd web &amp;&amp; npm test -- --run &amp;&amp; npm run build</code>.
          </li>
          <li>
            <strong>Produção (dados oficiais):</strong> rode a ingestão real do
            TSE (<code>etl.build_marts.build_all</code> sobre os zips oficiais) e
            publique os JSONs junto ao deploy — ou removendo a linha do gitignore
            para versioná-los, ou enviando <code>web/public/data/</code> pelo
            mecanismo de deploy. Sem dados oficiais publicados, o site exibe o
            banner “dado não auditado”, que é o comportamento correto.
          </li>
        </ul>
      </section>

      <section aria-label="Escopo V1">
        <h2>Escopo V1</h2>
        <p>
          Votação nominal: presidentes + governadores (2014/2018/2022) e
          prefeitos das capitais (2016/2020/2024). Agregação por UF; município,
          turno/zona, eleitorado e financiamento exibem “sem dado oficial” com
          nota de cobertura. Exploração em <a href="/analisar">/analisar</a>.
        </p>
      </section>
    </>
  );
}
