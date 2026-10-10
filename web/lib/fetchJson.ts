/** fetchJson compartilhado (EVOLVE-8 Task 2): FONTE ÚNICA da leitura JSON
 *  cliente — os 6 call sites (HomeContent, analisar, explorar, verificar,
 *  auditoria, regiao/[ibge]) importam daqui; nenhum fork local restante.
 *
 *  União dos comportamentos dos 6 forks (idênticos byte a byte): `fetch`
 *  com `cache: "no-store"`; qualquer falha vira `data: null` no chamador
 *  (fail-closed — SEM_DADO onde já era, sem mudança de política de
 *  supressão; guards vivos seguem nos call sites).
 *
 *  Contrato: resultado discriminado por `status` — distingue
 *  404 (`nao-encontrado`) / !ok (`erro-servidor`, ex. 500) / throw do
 *  `fetch` (`offline`, ex. TypeError de rede) / `res.json()` inválido
 *  (`resposta-invalida`) vs `ok` (blip vs rotação real). Em todo erro,
 *  `data` é null, então `(await fetchJson(...)).data` reproduz
 *  exatamente o `T | null` legado.
 */
export type FetchJsonStatus =
  | "ok"
  | "nao-encontrado"
  | "erro-servidor"
  | "offline"
  | "resposta-invalida";

export type FetchJsonResult<T> =
  | { status: "ok"; data: T }
  | {
      status: "nao-encontrado" | "erro-servidor" | "offline" | "resposta-invalida";
      data: null;
    };

export async function fetchJson<T = unknown>(path: string): Promise<FetchJsonResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store" });
  } catch {
    return { status: "offline", data: null };
  }
  if (!res || typeof res.json !== "function")
    return { status: "resposta-invalida", data: null };
  if (res.status === 404) return { status: "nao-encontrado", data: null };
  if (!res.ok) return { status: "erro-servidor", data: null };
  try {
    return { status: "ok", data: (await res.json()) as T };
  } catch {
    return { status: "resposta-invalida", data: null };
  }
}
