#!/usr/bin/env bash
# Web版(公式 hsp3dish.js)のビルドを、段階ごとに実行する。web.yml から呼ぶ。
#   build_web.sh config | openhsp | compile | patchsrc | buildjs | assemble
# 失敗したときは、GitHubの「注釈(::error::)」に末尾ログを出す。プッシャーの失敗表示で読める。
set -uo pipefail

ROOT="$(pwd)"
WORK="${WEB_WORK:-$ROOT/.webwork}"
OH_URL="https://github.com/onitama/OpenHSP.git"
# 動作を確認した公式OpenHSPのコミット(2026-04-21)。変えるときは patchsrc のパッチが当たるか要確認。
OH_REF="${OPENHSP_REF:-3dbb8729dad53ee876fc681696c8fe542698860b}"
mkdir -p "$WORK"

enc() { python3 -c 'import sys;s=sys.stdin.read();print(s.replace("%","%25").replace("\r","%0D").replace("\n","%0A"),end="")'; }
fail() {   # fail <title> [logfile]
  local title="$1" log="${2:-}" tail=""
  [ -n "$log" ] && [ -f "$log" ] && tail="$(tail -n 45 "$log" | cut -c1-300)"
  echo "::error title=${title}::$(printf '%s\n%s' "$title" "$tail" | enc)"
  echo "FAILED: $title"; [ -n "$tail" ] && echo "$tail"
  exit 1
}
cfgval() { python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$WORK/webconfig.json" "$1"; }

case "${1:-}" in

config)
  python3 - "$ROOT" "$WORK" <<'PY' || fail "設定ファイルの読み込みに失敗"
import json, os, re, sys
root, work = sys.argv[1], sys.argv[2]
def load(p):
    try:
        return json.load(open(os.path.join(root, p), encoding="utf-8"))
    except FileNotFoundError:
        return {}
app, web = load("config/app.json"), load("config/web.json")
pkg = app.get("packageName", "tv.hsp.hspproj")
title = app.get("appName", "hspproj")
save = web.get("saveDir") or ("hspsave_" + re.sub(r"[^A-Za-z0-9_]", "_", pkg))
if not re.fullmatch(r"[A-Za-z0-9_\-]{1,64}", save):
    sys.exit("saveDir は英数字・_・- のみ(64文字まで): " + save)
def num(k, d):
    v = web.get(k)
    try:
        return int(v) if v not in (None, "") else d
    except (TypeError, ValueError):
        return d
cfg = {"title": title, "saveDir": save, "ax": "main.ax",
       "wx": num("wx", 480), "wy": num("wy", 800), "autoscale": num("autoscale", 0),
       "fps": num("fps", 0), "limitStep": num("limitStep", 200000)}
adid = str(web.get("adsenseClientId") or "").strip()
if adid and not re.fullmatch(r"(ca-)?pub-[0-9]{6,32}", adid):
    sys.exit("adsenseClientId は ca-pub-数字 の形式で: " + adid)
if adid and not adid.startswith("ca-"): adid = "ca-" + adid
cfg["adsenseClientId"] = adid
cfg["adsenseTest"] = bool(web.get("adsenseTest", True))
json.dump(cfg, open(os.path.join(work, "webconfig.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
open(os.path.join(work, "mainscript"), "w").write(app.get("mainScript", "main.hsp"))
safe = re.sub(r"[^A-Za-z0-9_\-]", "_", title) or "app"
open(os.path.join(work, "zipname"), "w").write(safe + "-web.zip")
print(json.dumps(cfg, ensure_ascii=False))
PY
  ;;

openhsp)
  rm -rf "$WORK/openhsp"; mkdir -p "$WORK/openhsp"; cd "$WORK/openhsp" || exit 1
  { git init -q . && git remote add origin "$OH_URL" && git fetch -q --depth 1 origin "$OH_REF" && git checkout -q FETCH_HEAD; } >"$WORK/openhsp.log" 2>&1 \
    || fail "公式OpenHSPの取得に失敗" "$WORK/openhsp.log"
  echo "OpenHSP: $(git rev-parse HEAD)"
  make hspcmp -j"$(nproc)" >"$WORK/hspcmp_build.log" 2>&1 || fail "hspcmp(公式コンパイラ)のビルドに失敗" "$WORK/hspcmp_build.log"
  [ -x ./hspcmp ] || fail "hspcmp が見つかりません"
  echo "hspcmp OK"
  ;;

compile)
  MAIN="$(cat "$WORK/mainscript")"; SAVEDIR="$(cfgval saveDir)"
  cd "$ROOT/hsp" || fail "hsp フォルダがありません"
  [ -f "$MAIN" ] || fail "メインスクリプトがありません: hsp/$MAIN"
  [ "$MAIN" = "main.hsp" ] || cp "$MAIN" main.hsp
  bash "$ROOT/tools/web_patch.sh" . "$SAVEDIR" >"$WORK/patch.log" 2>&1 || fail "HSPスクリプトの自動調整(web_patch)に失敗" "$WORK/patch.log"
  cat "$WORK/patch.log"
  rm -f main.ax
  "$WORK/openhsp/hspcmp" -i -u -m --compath="$WORK/openhsp/common/" main.hsp >"$WORK/hspcmp.log" 2>&1; st=$?
  grep -v '^#Uninitalized variable' "$WORK/hspcmp.log" | tail -n 12
  { [ $st -eq 0 ] && [ -s main.ax ]; } || fail "HSPスクリプトのコンパイルに失敗(エラー行を確認)" "$WORK/hspcmp.log"
  echo "BUILD ${MAIN} blob=$(git hash-object main.hsp.orig) lines=$(wc -l < main.hsp.orig) ax=$(wc -c < main.ax)B commit=${GITHUB_SHA:-local}"
  ;;

patchsrc)
  cd "$WORK/openhsp" || fail "OpenHSP がありません(先に openhsp)"
  python3 - <<'PY' || fail "公式ソースへの最小パッチが当たりませんでした(公式側が変わった可能性)"
import re, sys
# (1) JS側から FS / ENV を使えるように、公式 makefile の EXPORTED_RUNTIME_METHODS に追加
p = "makefile.emscripten"; s = open(p, encoding="utf-8").read()
old = "'ccall', 'cwrap']"
if s.count(old) != 1: sys.exit("makefile.emscripten: 期待した箇所が見つかりません")
open(p, "w", encoding="utf-8").write(s.replace(old, "'ccall', 'cwrap', 'FS', 'ENV']"))
# (2) getreq の範囲外ID(1000番台=広告/戻るボタン等)で配列の外を読まないようにする
p = "src/hsp3dish/sysreq.cpp"; s = open(p, encoding="utf-8").read()
back = "\n#ifdef __EMSCRIPTEN__\n\tif ( reqid == 1004 ) return EM_ASM_INT({ return (typeof Module.hspBackRead === 'function') ? (Module.hspBackRead() | 0) : 0; });\n#endif"
s2, n = re.subn(r"(int\s+GetSysReq\s*\(\s*int\s+reqid\s*\)\s*\{)", lambda m: m.group(1) + back + "\n\tif ( reqid < 0 || reqid >= SYSREQ_MAX ) return 0;", s, count=1)
s2 = s2.replace('#include "sysreq.h"', '#include "sysreq.h"\n#ifdef __EMSCRIPTEN__\n#include <emscripten.h>\n#endif', 1)
if n != 1: sys.exit("sysreq.cpp: GetSysReq が見つかりません")
open(p, "w", encoding="utf-8").write(s2)
# (3) devcontrol の未知コマンドを JS側(Module.hspDevControl)へ転送する(MML・広告用の橋)。無ければ従来どおり -1
p = "src/hsp3dish/emscripten/hsp3dish.cpp"; s = open(p, encoding="utf-8").read()
m = re.search(r"static int hsp3dish_devcontrol\( char \*cmd, int p1, int p2, int p3 \)\s*\{.*?\n\treturn -1;\n\}", s, re.S)
if not m: sys.exit("hsp3dish.cpp: hsp3dish_devcontrol が見つかりません")
blk = m.group(0)
nb = blk[:blk.rindex("\treturn -1;")] + "\treturn EM_ASM_INT({\n\t\tif ( typeof Module.hspDevControl !== 'function' ) return -1;\n\t\ttry { var r = Module.hspDevControl(UTF8ToString($0), $1, $2, $3); return (r|0); } catch (e) { console.log('hspDevControl', e); return -1; }\n\t}, cmd, p1, p2, p3);\n}"
open(p, "w", encoding="utf-8").write(s.replace(blk, nb))
print("patched: makefile.emscripten(FS,ENV) / sysreq.cpp(範囲チェック) / hsp3dish.cpp(devcontrol転送)")
PY
  python3 "$ROOT/tools/web_patch_sound.py" . || fail "音まわりのパッチが当たりませんでした(公式側が変わった可能性)"
  git diff --stat | tail -3
  ;;

buildjs)
  cd "$WORK/openhsp" || fail "OpenHSP がありません"
  command -v emcc >/dev/null || fail "emcc が見つかりません(Emscripten未設定)"
  emcc --version | head -1
  make -f makefile.emscripten hsp3dish.js -j2 2>&1 | tee "$WORK/emmake.log" | tail -n 5
  [ "${PIPESTATUS[0]}" -eq 0 ] || fail "hsp3dish.js のビルドに失敗(公式 makefile.emscripten)" "$WORK/emmake.log"
  [ -s hsp3dish.js ] && [ -s hsp3dish.wasm ] || fail "hsp3dish.js / hsp3dish.wasm が出力されていません" "$WORK/emmake.log"
  ls -la hsp3dish.js hsp3dish.wasm
  ;;

assemble)
  DIST="$ROOT/dist/web"; OUT="$ROOT/out"; rm -rf "$DIST" "$OUT"; mkdir -p "$DIST" "$OUT"
  BUILD="${GITHUB_RUN_NUMBER:-0}-$(printf '%s' "${GITHUB_SHA:-local}" | cut -c1-7)"
  ASSETS="$ROOT/android/app/src/main/assets"
  python3 "$ROOT/tools/web_pack_assets.py" "$ASSETS" "$DIST" || fail "素材のパックに失敗(android/app/src/main/assets を確認)"
  cp "$WORK/openhsp/hsp3dish.js" "$WORK/openhsp/hsp3dish.wasm" "$DIST/"
  cp "$ROOT/hsp/main.ax" "$DIST/main.ax"
  cp "$ROOT/web/hsp-web-runtime.js" "$ROOT/web/mml-engine.js" "$ROOT/web/ad-engine.js" "$ROOT/web/htaccess_sample.txt" "$DIST/"
  if [ -f "$ASSETS/hsp-synth.js" ]; then cp "$ASSETS/hsp-synth.js" "$DIST/"; else echo "注意: hsp-synth.js が assets に無いので MML は無音になります"; fi
  cp "$WORK/openhsp/LICENSE" "$DIST/LICENSE_OpenHSP.txt"
  python3 - "$ROOT" "$WORK" "$DIST" "$BUILD" <<'PY' || fail "配布ファイルの生成に失敗"
import json, sys
root, work, dist, build = sys.argv[1:5]
cfg = json.load(open(work + "/webconfig.json", encoding="utf-8"))
cfg["build"] = build
import re
src = open(root + "/hsp/main.hsp", encoding="utf-8", errors="replace").read()
cfg["mml"] = sorted(set(re.findall(r"::mmlt::([^\"\r\n]+)\"", src)))
print("MML曲:", cfg["mml"])
json.dump(cfg, open(dist + "/webconfig.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
t = open(root + "/web/index.template.html", encoding="utf-8").read()
esc = lambda x: x.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
open(dist + "/index.html", "w", encoding="utf-8").write(t.replace("%TITLE%", esc(cfg["title"])).replace("%BUILD%", build))
PY
  {
    echo "build: $BUILD"
    echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "commit: ${GITHUB_SHA:-local}"
    echo "openhsp: $(git -C "$WORK/openhsp" rev-parse HEAD)"
    echo "emcc: $(emcc --version 2>/dev/null | head -1)"
    echo "script: blob=$(git hash-object "$ROOT/hsp/main.hsp.orig" 2>/dev/null || echo ?)"
  } > "$DIST/BUILD_INFO.txt"
  ZIPNAME="$(cat "$WORK/zipname")"
  python3 - "$DIST" "$OUT/$ZIPNAME" <<'PY' || fail "zipの作成に失敗"
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for r, _, fs in os.walk(src):
        for f in sorted(fs):
            full = os.path.join(r, f); z.write(full, os.path.relpath(full, src))
PY
  echo "== 配布物 =="; ls -la "$DIST"; ls -la "$OUT"
  { echo "### Web版ビルド完了"; echo "- build: \`$BUILD\`"; echo "- 保存先(IndexedDB): \`/$(cfgval saveDir)\`"; echo "- 成果物: \`$ZIPNAME\`"; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  ;;

*)
  echo "usage: $0 config|openhsp|compile|patchsrc|buildjs|assemble"; exit 2 ;;
esac
