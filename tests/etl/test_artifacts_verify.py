"""Task 1 (EVOLVE-2): verify_manifest valida a chave `artifacts`.

DECISÃO (documentada em `etl/manifest.py::verify_manifest`): manifest
legado SÓ-ingestions (sem chave `artifacts`) continua válido quando as
ingestões estão ok — o pipeline interno (registro do Censo, standalone
`build_fato`, gates `run_gates`) produz manifests de ingestão antes de
existirem bytes servidos (Task 2 cobre o standalone). Fail-closed vale
para o servido: chave `artifacts` presente exige lista não-vazia de
entries estruturalmente válidas cujos arquivos irmãos do manifest
existem com sha256+tamanho conferindo; qualquer divergência reprova.
Seed/CI sempre escrevem artifacts (build_all não-vazio + recalc do
seed), então manifests servidos sempre carregam a chave.
"""

import hashlib
import json

from etl.manifest import verify_manifest

_SHA = "ab" * 32


def _write(manifest_path, payload):
    manifest_path.write_text(json.dumps(payload), encoding="utf-8")
    return str(manifest_path)


def _served(tmp_path, name="resumo.json", raw=b'{"total_votos": 15}'):
    (tmp_path / name).write_bytes(raw)
    return raw


def _artifact(name, raw, **extra):
    entry = {
        "source_url": "https://cdn.tse.jus.br/x.zip",
        "sha256": hashlib.sha256(raw).hexdigest(),
        "arquivo": name,
        "size_bytes": len(raw),
    }
    entry.update(extra)
    return entry


def test_artifact_valido_aprova(tmp_path):
    raw = _served(tmp_path)
    payload = {
        "ingestions": [{"source_url": "https://cdn.tse.jus.br/x.zip",
                        "sha256": _SHA}],
        "artifacts": [_artifact("resumo.json", raw)],
    }
    assert verify_manifest(_write(tmp_path / "m.json", payload)) is True


def test_artifact_adulterado_reprova(tmp_path):
    raw = _served(tmp_path)
    payload = {
        "ingestions": [{"source_url": "https://cdn.tse.jus.br/x.zip",
                        "sha256": _SHA}],
        "artifacts": [_artifact("resumo.json", raw)],
    }
    manifest = _write(tmp_path / "m.json", payload)
    assert verify_manifest(manifest) is True
    # Adultera o byte servido DEPOIS do registro: hash diverge → reprova.
    (tmp_path / "resumo.json").write_bytes(b'{"total_votos": 9999}')
    assert verify_manifest(manifest) is False


def test_artifact_arquivo_ausente_reprova(tmp_path):
    raw = b'{"total_votos": 15}'
    payload = {
        "ingestions": [{"source_url": "https://cdn.tse.jus.br/x.zip",
                        "sha256": _SHA}],
        "artifacts": [_artifact("resumo.json", raw)],
    }
    # Arquivo irmão nunca escrito → sem prova de bytes → reprova.
    assert verify_manifest(_write(tmp_path / "m.json", payload)) is False


def test_artifact_tamanho_divergente_reprova(tmp_path):
    raw = _served(tmp_path)
    entry = _artifact("resumo.json", raw)
    entry["size_bytes"] = len(raw) + 1  # sha ok, tamanho errado
    payload = {
        "ingestions": [{"source_url": "https://cdn.tse.jus.br/x.zip",
                        "sha256": _SHA}],
        "artifacts": [entry],
    }
    assert verify_manifest(_write(tmp_path / "m.json", payload)) is False


def test_artifact_entry_malformada_reprova(tmp_path):
    _served(tmp_path)
    for bad in (
        {"source_url": "https://cdn.tse.jus.br/x.zip",
         "sha256": "nao-hex", "arquivo": "resumo.json", "size_bytes": 1},
        {"source_url": "https://cdn.tse.jus.br/x.zip",
         "sha256": _SHA, "size_bytes": 1},  # sem arquivo
        {"source_url": "https://cdn.tse.jus.br/x.zip", "sha256": _SHA,
         "arquivo": "../fora.json", "size_bytes": 1},  # traversal
        {"source_url": "https://cdn.tse.jus.br/x.zip", "sha256": _SHA,
         "arquivo": "resumo.json", "size_bytes": -1},
    ):
        payload = {
            "ingestions": [{"source_url": "https://cdn.tse.jus.br/x.zip",
                            "sha256": _SHA}],
            "artifacts": [bad],
        }
        assert verify_manifest(_write(tmp_path / "m.json", payload)) is False, bad


def test_artifacts_vazio_ou_nao_lista_reprova(tmp_path):
    base = {"ingestions": [{"source_url": "https://cdn.tse.jus.br/x.zip",
                            "sha256": _SHA}]}
    for artifacts in ([], "x", None, [{}]):
        payload = dict(base, artifacts=artifacts)
        assert verify_manifest(_write(tmp_path / "m.json", payload)) is False, artifacts


def test_legado_so_ingestions_continua_valido(tmp_path):
    """Pin da decisão: sem chave `artifacts`, ingestões ok → válido."""
    payload = {"ingestions": [{"source_url": "https://cdn.tse.jus.br/x.zip",
                               "sha256": _SHA}]}
    assert "artifacts" not in payload
    assert verify_manifest(_write(tmp_path / "m.json", payload)) is True


def test_legado_emite_aviso_sem_artifacts_mas_coberto_nao(tmp_path):
    """Hardening (review): o True legado avisa alto (UserWarning pt-BR);
    manifest com cobertura total de artifacts verifica em silêncio."""
    import warnings

    legado = {"ingestions": [{"source_url": "https://cdn.tse.jus.br/x.zip",
                              "sha256": _SHA}]}
    legado_path = _write(tmp_path / "legado.json", legado)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert verify_manifest(legado_path) is True
    assert any(issubclass(w.category, UserWarning) and "artifacts" in str(w.message)
               for w in caught), [str(w.message) for w in caught]

    raw = _served(tmp_path)
    coberto = {
        "ingestions": [{"source_url": "https://cdn.tse.jus.br/x.zip",
                        "sha256": _SHA}],
        "artifacts": [_artifact("resumo.json", raw)],
    }
    coberto_path = _write(tmp_path / "coberto.json", coberto)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert verify_manifest(coberto_path) is True
    assert [w for w in caught if "artifacts" in str(w.message)] == []
