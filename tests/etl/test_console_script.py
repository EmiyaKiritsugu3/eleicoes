"""EVOLVE-6 Task 4 (RED-first): smoke do console-script `sad-etl`.

Decisão (documentada aqui, sem fragilidade nova no CI): NÃO rodar
`subprocess sad-etl --help` após `pip install` — lento/frágil no CI
(rede, venv, PATH do entry instalado). Em vez disso, este teste resolve
a declaração `[project.scripts] sad-etl = "etl.__main__:main"` direto do
`pyproject.toml` do repo e importa o alvo via `importlib`, afirmando que
é chamável — sem instalar nada. Se a distribuição estiver instalada, um
check best-effort via `importlib.metadata` confirma o entry-point
instalado; ausente, pula sem falhar (nunca falha offline/fresco).
"""

import sys  # noqa: F401 — reserva p/ subprocess (proibido neste módulo; ver guarda)
from importlib import import_module
from pathlib import Path

if sys.version_info >= (3, 11):
    import tomllib
else:  # Python 3.10: sem tomllib na stdlib — parse mínimo do bloco [project.scripts]
    tomllib = None  # type: ignore[assignment]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _console_scripts() -> dict:
    text = (_repo_root() / "pyproject.toml").read_text(encoding="utf-8")
    if tomllib is not None:
        doc = tomllib.loads(text)
        scripts = doc.get("project", {}).get("scripts", {})
    else:  # 3.10: extrai `nome = "mod:attr"` do bloco [project.scripts] via regex
        import re

        bloco = re.search(
            r"^\[project\.scripts\]\s*\n((?:^[^\[]*\n)*)", text, re.MULTILINE)
        assert bloco, "pyproject sem [project.scripts] (sem dado oficial)"
        scripts = dict(
            re.findall(r'^(\S+)\s*=\s*"([^"]+)"', bloco.group(1), re.MULTILINE))
    assert isinstance(scripts, dict), "pyproject sem [project.scripts] (sem dado oficial)"
    return scripts


def test_sad_etl_declarado_e_resolve_sem_instalar():
    scripts = _console_scripts()
    alvo = scripts.get("sad-etl")
    assert isinstance(alvo, str) and ":" in alvo, (
        f"console-script sad-etl ausente/não-mapeado em pyproject: {scripts}"
    )
    modulo, atributo = alvo.split(":", 1)
    objeto = getattr(import_module(modulo), atributo, None)
    assert callable(objeto), (
        f"sad-etl -> {alvo} não resolve p/ chamável (sem instalar nada)"
    )


def test_sad_etl_entry_instalado_confere_quando_presente():
    """Best-effort: com o pacote instalado, o entry instalado bate o toml."""
    from importlib.metadata import PackageNotFoundError, distribution, entry_points

    try:
        dist = distribution("sad-eleicoes")
    except PackageNotFoundError:
        import pytest

        pytest.skip("sad-eleicoes não instalado — smoke sem install (decisão T4)")
        return
    declarado = _console_scripts().get("sad-etl")
    try:
        eps = entry_points(group="console_scripts")  # 3.10+: Selectable
        achados = [e for e in eps if e.name == "sad-etl"]
    except Exception:
        achados = [e for e in getattr(dist, "entry_points", []) if e.name == "sad-etl"]
    assert achados, "sad-etl instalado sem entry console_scripts (instalação quebrada)"
    assert achados[0].value.replace(" ", "") == declarado.replace(" ", ""), (
        f"entry instalado ({achados[0].value}) diverge do pyproject ({declarado})"
    )


def test_sad_etl_sem_subprocess_nem_pip():
    """Guarda da decisão: este módulo nunca invoca subprocess/pip (anti-fragilidade)."""
    src = Path(__file__).read_text(encoding="utf-8")
    # (strings montadas p/ o guarda não casar com ele mesmo)
    assert "import " + "subprocess" not in src
    assert "subprocess." + "run" not in src and "subprocess." + "Popen" not in src
    assert "check_" + "call" not in src and "check_" + "output" not in src
