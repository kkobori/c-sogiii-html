#!/usr/bin/env python3
"""素材フォルダを assets.pack(連結バイナリ) + assets.json(目次) にまとめる。
使い方: web_pack_assets.py <素材フォルダ> <出力フォルダ>
ブラウザ側(hsp-web-runtime.js)が1回の取得で全素材を仮想ファイルシステムへ展開する。"""
import json, os, sys

EXCLUDE_NAMES = {"admob.json", ".DS_Store"}

def main():
    src, out = sys.argv[1], sys.argv[2]
    if not os.path.isdir(src):
        print("素材フォルダがありません: " + src, file=sys.stderr); sys.exit(1)
    os.makedirs(out, exist_ok=True)
    files, off = [], 0
    with open(os.path.join(out, "assets.pack"), "wb") as pk:
        for root, dirs, names in os.walk(src):
            dirs.sort()
            for n in sorted(names):
                if n in EXCLUDE_NAMES or n.startswith("."):
                    continue
                full = os.path.join(root, n)
                rel = os.path.relpath(full, src).replace(os.sep, "/")
                data = open(full, "rb").read()
                pk.write(data)
                files.append({"p": rel, "o": off, "s": len(data)})
                off += len(data)
    with open(os.path.join(out, "assets.json"), "w", encoding="utf-8") as f:
        json.dump({"size": off, "files": files}, f, ensure_ascii=False, separators=(",", ":"))
    print("assets: %d files, %d bytes" % (len(files), off))

if __name__ == "__main__":
    main()
