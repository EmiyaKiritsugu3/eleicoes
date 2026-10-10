import pathlib


def _ci():
    import yaml
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


def test_root_gitignore_covers_generated():
    g = pathlib.Path(".gitignore").read_text()
    for pat in ["__pycache__/", "*.duckdb", "data/manifest.json", "*.bak", "tsconfig.tsbuildinfo", "node_modules/"]:
        assert pat in g


def test_setuptools_packages_find_covers_etl_only():
    import tomllib
    with open("pyproject.toml", "rb") as f:
        find = tomllib.load(f)["tool"]["setuptools"]["packages"]["find"]
    assert find["include"] == ["etl*"]  # pip install . não tenta empacotar web/ ou data/
