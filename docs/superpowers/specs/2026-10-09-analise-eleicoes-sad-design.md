# SAD Eleições — Design Spec (C Híbrido)

Data: 2026-10-09
Status: rascunho para revisão
Restrição dura: custo zero na v1, só dado oficial verificável e auditável.

## 1. Entendimento

- **O quê:** SAD completo e robusto para eleições brasileiras, preciso, funcional, informação clara.
- **Para quem:** estrategista de campanha, jornalista, pesquisador acadêmico, eleitor comum.
- **Decisões atendidas:** estratégia de campanha, apuração jornalística, estudo acadêmico, voto consciente.
- **Modos:** (1) web pública leve mobile + (2) módulo analista pesado. Mesmo código, dois modos.
- **Análises v1 (D):** mapa + ranking por candidato/município/ano; abstenção/nulos/brancos + evolução temporal; perfil candidatos + financiamento; tudo junto.
- **Sucesso:** todo número com fonte + data + hash; leigo entende a pública; analista reproduz e exporta.

## 2. Princípios

1. Só dado oficial. Nada estimado.
2. Verdade = cache versionado local (DuckDB + Parquet + manifest.json). Supabase/Vercel são espelhos opcionais fase 2.
3. Sem manifest válido, front avisa "dado não auditado" e não exibe número como oficial.
4. Custo zero v1: Python + DuckDB + Parquet + Next.js estático + GitHub Actions free. Nada pago.
5. Offline-first, mobile-first na pública.

## 3. Arquitetura (C Híbrido)

```
TSE dadosabertos.tse.jus.br (ZIP/CSV bulk, CKAN só lista arquivos)
  + IBGE (população, malha municipal TopoJSON simplificado)
  -> ETL Python (fetch, valida SHA, normaliza, quality gates)
  -> data/raw/ (imutável) + data/curated/ (parquet ano/cargo/UF) + analise-eleicoes.duckdb + manifest.json
  -> Front Next.js único: `/` pública + `/analisar` pesada + `/metodologia` + `/auditoria`
  -> Deploy: `npm run dev` local E Vercel free sem mudar código. Supabase fase 2 opcional.
```

Por que não direto sem salvar nada: TSE não tem API por linha, só bulk. Direto = baixar 100-500MB a cada filtro, lento e sem snapshot para auditoria. Decisão registrada: manter cache versionado.

## 4. Fontes v1

- TSE `resultados` (votação nominal por município/zona, detalhe apuração, totalização).
- TSE `candidaturas` + `bens`.
- TSE `prestação de contas` (receitas/despesas).
- TSE `eleitorado` (aptos, comparecimento).
- IBGE (código município 7 dígitos, população, malha).
- Cada ingestão: URL fonte, data coleta, SHA256 do ZIP, nº linhas, versão ETL no manifest.

Recorte v1 para caber em custo zero: presidentes + governadores 2014-2024 completo, prefeitos só capitais. Demais municípios/cargos entram em lotes fase 2 sem mudar schema.

## 5. Modelo de dados

- `fato_voto(ano, turno, cargo, UF, municipio_ibge, zona, candidato_id, votos, fonte_hash)`
- `dim_candidato(candidato_id, nome_urna, partido, coligacao, situacao, ano, cargo)`
- `fato_fin(candidato_id, receita_total, despesa_total, maior_doador_classe, fonte_hash)`
- `fato_eleitorado(ano, turno, UF, municipio_ibge, aptos, comparecimento, abstencao, nulos, brancos)`
- Join geográfico sempre por IBGE 7 dígitos. Sem checksum válido a linha não entra.

## 6. Telas e análises

### `/` pública (leiga, mobile)
- Busca: ano, cargo, UF, município, candidato.
- Cards-resumo (vencedor, % votos, participação) cada um com tooltip fonte+data.
- Mapa coroplético por município, ranking top N, evolução temporal, pizza/barra abstenção/nulos/brancos.
- Todo gráfico com tabela equivalente acessível.

### `/analisar` (analista)
- Filtros extras: turno, zona, partido/coligação, faixa financiamento.
- Pivô, comparador lado-a-lado (2 candidatos / 2 anos / 2 municípios), dispersão votos x financiamento, série histórica.
- Export CSV + URL compartilhável com `?manifest=<hash>` para reproduzir exatamente.

### `/metodologia` + `/auditoria`
- Metodologia em linguagem simples. Auditoria lista ingestões com link TSE, hash, linhas, data, botão baixar manifest.

## 7. Fluxo ETL + erros + auditoria

Fluxo: fetch TSE com retry 3x -> confere SHA -> normaliza encoding latin1/utf8 e código IBGE -> quality gates -> escreve Parquet + DuckDB + manifest.

Gates que reprovam ingestão (mantém versão anterior + banner):
- soma votos município != total UF oficial.
- candidatos em fato_voto sem dim_candidato acima de 0,1%.
- arquivo em quarentena se encoding/colunas mudarem.

Dado faltante exibe "sem dado oficial", nunca zero. Download parcial não sobrescreve versão boa.

## 8. Testes, performance, limites

- `pytest`: fixtures pequenas TSE, teste de soma, teste manifest inválido bloqueia.
- `vitest`: front com mock, teste de formatação e de link compartilhável.
- CI GitHub Actions free em todo push.
- Perf alvo: filtro município/ano <2s local; mapa TopoJSON simplificado; Parquet particionado para não carregar tudo.
- Limites conhecidos: bulk TSE grande, Brasil inteiro pré-2014 fica para fase 2; free-tier Vercel/Supabase nunca no caminho crítico v1.

## 9. Fora do escopo v1

- Tempo real apuração segundo a segundo, projeções/pesquisas não oficiais, login/multiusuário, IA preditiva. Entram só com nova spec.

## 10. Próximo passo

writing-plans gera plano de implementação a partir deste spec após aprovação do usuário.
