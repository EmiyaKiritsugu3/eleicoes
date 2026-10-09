def test_write_and_verify_manifest(tmp_path):
    from etl.manifest import write_manifest, verify_manifest
    p = tmp_path / "manifest.json"
    write_manifest(str(p), {"source_url": "https://x", "sha256": "abc", "rows": 1})
    assert verify_manifest(str(p)) is True

def test_corrupt_manifest_fails(tmp_path):
    from etl.manifest import write_manifest, verify_manifest
    p = tmp_path / "manifest.json"
    p.write_text("{invalid")
    assert verify_manifest(str(p)) is False
