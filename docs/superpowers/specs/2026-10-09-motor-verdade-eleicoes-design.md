# Motor Verdade Eleitoral — Design Spec (Híbrido C + Mapa Clicável)

Data: 2026-10-09
Status: rascunho para revisão
Origem: evolução do SAD Eleições (spec `2026-10-09-analise-eleicoes-sad-design.md`, reaproveitado, não substituído).
Restrições duras: custo zero; só dado oficial verificável e auditável; voto é secreto (sem perfil individual).

## 1. Entendimento

- **O quê:** site onde qualquer pessoa analisa dados eleitorais facilmente e descobre "a verdade" via ciência de dados — perfil de onde cada candidato venceu, correlações honestas (estudo×direita, pobreza×esquerda), desmonte de confounders ("por quê?") e verificação de afirmações (verdade vs. mentira).
- **Para quem:** eleitor curioso, jornalista, pesquisador, estrategista — do leigo ao analista.
- **Modelo mental:** clareza instantânea do reference (seuimposto.com Apuração 2026: mapa clicável, número grande, mobile-first) aplicada à análise, não à apuração ao vivo.
- **Sucesso:** usuário clica numa região e entende o voto dali em 30s; qualquer resposta exibe fonte + método + hash; nenhuma tela permite leitura causal ou individual indevida.

## 2. Princípios

1. Só dado oficial (TSE + IBGE). Nada estimado, nada sem fonte.
2. Voto secreto: perfis são SEMPRE ecológicos (município), com aviso anti-falácia embutido no layout.
3. Correlação nunca é apresentada como causa; "por quê?" = camadas de evidência (estratificação, correlação parcial), veredito em linguagem leiga (sustentado/não sustentado/misto).
4. Verdade do SAD herdada: manifest + gates + fail-closed ("sem dado oficial", nunca zero silencioso/número sem hash).
5. Custo zero v1; offline-first local; mesmo front roda local e Vercel free.

## 3. Interação (Seção 1 aprovada)

- Home = mapa do Brasil clicável (zoom UF → município). Clique abre painel da região: vencedores (presidente/governador/senador por ano/turno), margem, participação/abstenção, perfil do lugar (escolaridade, renda, idade, população) + ações Comparar / Por quê? / Verificar.
- `/explorar` = montador em blocos (quem · onde · cruzar com · ver como).
- Biblioteca curada = cards na home (30 casos no lançamento).
- Mobile-first; número + gráfico simples primeiro, tabela + método depois.

## 4. Motor de respostas (Seção 2 aprovada)

- Perfil de onde X venceu: filtro de municípios + médias ponderadas por eleitorado + comparador vs média nacional, sempre com n (municípios + eleitores).
- Correlações Pearson (+ Spearman se monotônica não-linear), piso n ≥ 30 municípios; dispersão com reta + pontos por UF + tabela por quintis.
- Por quê: estratificação por região/faixa de renda + correlação parcial; conclusão leiga, nunca causal.
- Verificar: veredito tricolor (sustentado/enganoso/falso) + 3 números que decidem + método + fonte + hash. Toda resposta: query + hash do manifest.

## 5. Dados (Seção 3 aprovada)

- Herdado do SAD: resultados, candidaturas, financiamento, eleitorado + manifest/gates.
- Novo: Censo IBGE 2022 por município (escolaridade, renda, idade, urbanização, população) via mesmo pipeline (SHA, gates de soma vs total IBGE, manifest). Sem Censo auditado → seções de perfil em "sem dado oficial".
- Mapa: malha municipal IBGE TopoJSON simplificado + exterior como unidade separada.
- Fora: pesquisas de intenção de voto e redes sociais como dado (só como afirmações a verificar).

## 6. Arquitetura (Seção 4 aprovada)

- ETL estendido (`censo_ibge_2022` → `dim_municipio`), reaproveitando fetch/normalize/validate.
- Duas velocidades: pré-computado (curada + painel de região, JSON estático) e runtime local (`/explorar` sobre DuckDB, com teto e fallback "sem dado oficial").
- Mapa em canvas (Path2D) p/ milhares de municípios; SVG só em gráficos pequenos; fallback em lista + link TSE sem canvas (degradação do reference).
- Deploy Next.js estático (local + Vercel free); Supabase fase-2 opcional.

## 7. Guardrails (Seção 5 aprovada)

- Selo "dado de município, não de pessoa" + frase leiga em toda tela de perfil/correlação.
- Piso n ≥ 30; r com n + dispersão + outliers nomeados.
- Vereditos só com prova; proibida linguagem causal, ranking-identidade e estimativa sem fonte.

## 8. Testes, performance, limites (Seção 6 aprovada)

- pytest: fixtures Censo + soma vs total; motor com r=1/r=0 sintéticos; front mockado; teste "pixel mentiroso" (resposta sem fonte+hash quebra).
- Perf: painel de região < 2s; TopoJSON ~1-3MB; explorar com teto + debounce; sem servidor.
- "Qualquer pergunta" = qualquer combinação dos blocos; fora dos blocos vira sugestão. Fora de escopo: tempo real, projeções, login, moderação de afirmações de usuários.

## 9. Próximo passo

writing-plans gera o plano de implementação após aprovação do usuário. Conflito de precedência: este spec orienta o novo módulo; o spec do SAD v1 continua valendo para ETL/gates/manifest.
