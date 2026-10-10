import pathlib


def _ci():
    yaml = __import__("pytest").importorskip("yaml")
    return yaml.safe_load(pathlib.Path(".github/workflows/ci.yml").read_text())


def test_ci_installs_pytest_before_running_it():
    runs = [s.get("run", "") for s in _ci()["jobs"]["ci"]["steps"]]
    joined = "\n".join(runs)
    pre_use = joined.split("pytest tests")[0]
    # instalado antes de usado: extra test (ou pytest explícito) no pip install
    assert '".[test]"' in pre_use or "pytest" in pre_use
    import tomllib
    with open("pyproject.toml", "rb") as f:
        test_extra = tomllib.load(f)["project"]["optional-dependencies"]["test"]
    assert any(e.startswith("pytest") for e in test_extra)  # extra test provê pytest


def test_ci_caches_pip_and_pins_actions_by_sha():
    import re
    text = pathlib.Path(".github/workflows/ci.yml").read_text()
    assert "cache: pip" in text
    for ref in re.findall(r"uses:\s*actions/\S+", text):
        assert "@" in ref and len(ref.split("@")[1]) == 40  # SHA pin


def test_ci_node_meets_jsdom_floor():
    import re
    text = pathlib.Path(".github/workflows/ci.yml").read_text()
    m = re.search(r"node-version:\s*[\"']?(\d+)", text)
    assert m and int(m.group(1)) >= 22  # jsdom 30 exige Node 22+ (Node 20 EOL)


def test_root_gitignore_covers_generated():
    g = pathlib.Path(".gitignore").read_text()
    for pat in ["__pycache__/", "*.duckdb", "data/manifest.json", "*.bak", "tsconfig.tsbuildinfo", "node_modules/"]:
        assert pat in g


def test_setuptools_packages_find_covers_etl_only():
    import tomllib
    with open("pyproject.toml", "rb") as f:
        find = tomllib.load(f)["tool"]["setuptools"]["packages"]["find"]
    assert find["include"] == ["etl*"]  # pip install . não tenta empacotar web/ ou data/


def test_gitignore_covers_build_artifacts():
    g = pathlib.Path(".gitignore").read_text()
    assert "build/" in g and "*.egg-info" in g


def test_no_build_artifacts_tracked():
    import subprocess
    out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout
    assert not [l for l in out.splitlines() if l.startswith("build/") or ".egg-info" in l]


def test_web_gitignore_protects_budget():
    g = pathlib.Path("web/.gitignore").read_text()
    assert "public/data/*.json" in g
    assert "*.topojson" in g
    assert "!.gitkeep" in g or "!public/data/.gitkeep" in g


def test_budget_guards():
    data = pathlib.Path("web/public/data")
    total = sum(p.stat().st_size for p in data.rglob("*") if p.is_file())
    assert total < 15 * 1024 * 1024  # orçamento do repo: dir <15MB
    for t in data.glob("*.topojson"):
        assert t.stat().st_size < 3 * 1024 * 1024  # malha <3MB por arquivo


def test_ci_concurrency_and_docs_skip():
    ci = _ci()
    conc = ci.get("concurrency", {})
    assert conc.get("cancel-in-progress") is True  # cancela run obsoleto
    assert "group" in conc
    on = ci.get(True, ci.get("on", {}))  # PyYAML: `on:` vira chave True
    for trigger in ("push", "pull_request"):
        if trigger in on:  # cada trigger existente pula runs docs-only
            ignored = on[trigger].get("paths-ignore", [])
            assert "docs/**" in ignored and "*.md" in ignored, trigger
    assert "push" in on or "pull_request" in on
