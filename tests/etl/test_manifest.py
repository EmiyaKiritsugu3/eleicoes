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

def test_write_recovers_non_list_ingestions(tmp_path):
    from etl.manifest import write_manifest, verify_manifest
    p = tmp_path / "manifest.json"
    p.write_text('{"ingestions": "x"}')
    entry = {"source_url": "https://x", "sha256": "abc"}
    assert write_manifest(str(p), entry) == {"ingestions": [entry]}
    assert verify_manifest(str(p)) is True

def test_write_recovers_non_utf8_file(tmp_path):
    from etl.manifest import write_manifest, verify_manifest
    p = tmp_path / "manifest.json"
    p.write_bytes(b"\xff\xfe\x00invalid")
    entry = {"source_url": "https://x", "sha256": "abc"}
    assert write_manifest(str(p), entry) == {"ingestions": [entry]}
    assert verify_manifest(str(p)) is True
