"""EVOLVE-6 Task 3 (e) — doc 1-liner: raw quarantine é pré-gate."""


def test_quarantine_docstring_diz_pre_gate():
    from etl.validate import quarantine_invalid_csvs

    doc = quarantine_invalid_csvs.__doc__ or ""
    assert "pré-gate" in doc
