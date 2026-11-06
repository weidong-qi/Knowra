"""从固定版本的 ECDICT 生成离线查词分片；仅维护词库时运行，需要 Python 3。"""

import argparse
import csv
import gzip
import hashlib
import io
import json
import pathlib
import re
import urllib.request

COMMIT = "39cfb9672c0906b63569e0453c2e6abfb9ab182a"
SOURCE_SHA256 = "d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc"
BASE_URL = f"https://raw.githubusercontent.com/skywind3000/ECDICT/{COMMIT}"
ROOT = pathlib.Path(__file__).resolve().parents[2]
VERSION = f"ecdict-{COMMIT[:8]}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=pathlib.Path, help="可复用已下载的 ecdict.csv")
    args = parser.parse_args()
    data = args.source.read_bytes() if args.source else urllib.request.urlopen(f"{BASE_URL}/ecdict.csv").read()
    if hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        raise ValueError("ECDICT 原始文件哈希不符，拒绝生成")
    shards = {}
    for row in csv.DictReader(io.StringIO(data.decode("utf-8-sig"))):
        word = row["word"].lower().strip()
        if not re.fullmatch(r"[a-z][a-z' -]{0,79}", word):
            continue
        if not row["translation"].strip() and not row["definition"].strip():
            continue
        prefix = "".join(re.findall("[a-z]", word)[:2])
        lemma = next((value[2:] for value in row["exchange"].split("/") if value.startswith("0:")), "")
        value = [row["phonetic"], row["translation"].replace("\\n", "\n"), row["definition"].replace("\\n", "\n"), lemma]
        # 大小写重复词优先保留包含中文释义的条目。
        existing = shards.setdefault(prefix, {}).get(word)
        if existing is None or (not existing[1] and value[1]):
            shards[prefix][word] = value
    destination = ROOT / "apps/web/public/dictionaries" / VERSION
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": VERSION,
        "source": "https://github.com/skywind3000/ECDICT",
        "commit": COMMIT,
        "sourceSha256": SOURCE_SHA256,
        "license": "MIT",
        "entryCount": sum(len(values) for values in shards.values()),
        "shards": {},
    }
    for prefix, values in sorted(shards.items()):
        raw = json.dumps(values, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
        compressed = gzip.compress(raw, compresslevel=9, mtime=0)
        (destination / f"{prefix}.json.gz").write_bytes(compressed)
        manifest["shards"][prefix] = {"entries": len(values), "sha256": hashlib.sha256(compressed).hexdigest()}
    license_data = urllib.request.urlopen(f"{BASE_URL}/LICENSE").read()
    (destination / "LICENSE.txt").write_bytes(license_data)
    metadata = ROOT / "apps/web/src/features/dictionary/ecdictManifest.ts"
    metadata.parent.mkdir(parents=True, exist_ok=True)
    metadata.write_text("// 自动生成；来源、哈希与生成命令见 docs/PDF阅读与标注/离线查词.md。\nexport default " + json.dumps(manifest, ensure_ascii=False, indent=2) + ";\n")
    print(json.dumps({"entries": manifest["entryCount"], "shards": len(shards), "compressedBytes": sum(p.stat().st_size for p in destination.glob("*.gz"))}))


if __name__ == "__main__":
    main()
