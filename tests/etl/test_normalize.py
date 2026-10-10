def test_normalize_resultados_columns():
    from etl.normalize import normalize_resultados
    import pandas as pd
    df = pd.DataFrame([{"ANO_ELEICAO": 2022, "DS_CARGO": "PRESIDENTE", "SG_UF": "SP", "CD_MUNICIPIO": "3550308", "NM_URNA": "X", "QT_VOTOS": 10}])
    out = normalize_resultados(df)
    assert list(out.columns) == ["ano", "turno", "cargo", "uf", "municipio_ibge", "candidato_id", "nome_urna", "partido", "votos"]
    assert out.iloc[0]["municipio_ibge"] == "3550308"


def test_build_all_creates_duckdb(tmp_path):
    from etl.build_marts import build_all
    # web_data_dir redirecionado: o build nunca muta web/public/data do repo
    # (o CI semeia esses JSONs via scripts/seed_fixture_data.py; sem o
    # redirect este teste os sobrescreveria com dados vazios).
    build_all(str(tmp_path), str(tmp_path / "t.duckdb"), str(tmp_path / "m.json"),
              web_data_dir=tmp_path / "webdata")
    import os
    assert os.path.exists(tmp_path / "t.duckdb")


def test_normalize_latin1_and_missing_ibge():
    from etl.normalize import normalize_resultados
    import pandas as pd
    # município sem IBGE correspondente deve ser mantido com flag para exibir "sem dado oficial" no mapa
    df = pd.DataFrame([{"ANO_ELEICAO": 2022, "DS_CARGO": "PRESIDENTE", "SG_UF": "SP", "CD_MUNICIPIO": "9999999", "NM_URNA": "Y", "QT_VOTOS": 5}])
    with __import__("pytest").warns(UserWarning, match="IBGE"):
        out = normalize_resultados(df)
    # "9999999" é fictício (DV mod-10 6≠9): a LINHA é mantida, mas o código
    # é branqueado p/ "" — o join downstream erra p/ "sem dado oficial"
    # (intenção original preservada) e os votos seguem intactos.
    assert len(out) == 1
    assert out.iloc[0]["municipio_ibge"] == ""
    assert int(out.iloc[0]["votos"]) == 5
    assert "sem_ibge" not in out.columns


def test_missing_votos_column_raises(tmp_path=None):
    import pandas as pd
    from etl.normalize import normalize_resultados
    df = pd.DataFrame([{"ANO_ELEICAO": 2022, "DS_CARGO": "PRESIDENTE", "SG_UF": "SP"}])
    with __import__("pytest").raises(ValueError):
        normalize_resultados(df)


def test_nonnumeric_votes_stay_null_not_zero():
    import pandas as pd
    from etl.normalize import normalize_resultados
    df = pd.DataFrame([{"ANO_ELEICAO": 2022, "QT_VOTOS": "abc", "SG_UF": "SP"}])
    out = normalize_resultados(df)
    assert str(out["votos"].dtype) == "Int64" and out["votos"].isna().all()


def test_fix_mojibake_sao_joao():
    from etl.normalize import _fix_text
    # Literais de mojibake construídos por re-decode real, nunca chutados.
    assert _fix_text("SÃO".encode("utf-8").decode("latin1")) == "SÃO"
    assert _fix_text("SÃO PAULO".encode("utf-8").decode("latin1")) == "SÃO PAULO"
    assert _fix_text("SÃO PAULO") == "SÃO PAULO"  # correto intacto
    assert _fix_text("JOÃO".encode("utf-8").decode("latin1")) == "JOÃO"
    assert _fix_text("JOSÉ".encode("utf-8").decode("latin1")) == "JOSÉ"
