#!/usr/bin/env bash
# main.hsp を「公式Web版(hsp3dish.js)」向けに自動調整する(元は main.hsp.orig に残る)
# 使い方: web_patch.sh <hspフォルダ> <保存フォルダ名(先頭の/なし)>
# Android版の native_patch.sh と同じ考え方: 公式に無い所だけ、最小の置換で補う。
set -euo pipefail
cd "$1"
SAVEDIR="${2:?保存フォルダ名が必要です}"
cp main.hsp main.hsp.orig

# 1) 製品モード
sed -i -E 's/^([[:space:]]*debugonoff[[:space:]]*=[[:space:]]*)1([[:space:]]*(;.*)?)$/\10\2/' main.hsp

# 1b) "::sound::" 接頭辞(ミニインタプリタ用: 音声ファイル指定)は、公式HSPには無いので取り除く。
#     mmload "::sound::gdata/bgm/a.mp3",... → mmload "gdata/bgm/a.mp3",...  ("::sound::"+変数 も ""+変数 になって有効)
sed -i -E 's/"::sound::/"/Ig' main.hsp

# 2) mmload/mmplay/mmstop/mmvol -> webmm の包み(mmloadx 等)。
#    ::mmlt:: の曲は JS側のMMLエンジンへ、それ以外(mp3/wav)は公式の命令へ回る。行頭と ":" の直後だけを置き換える。
# 引数なしの mmstop(=全チャンネル停止)は mmstopall に。これを先に置き換える(MMLも止めるため)
sed -i -E 's/^([[:space:]]*)mmstop([[:space:]]*(;.*)?)$/\1mmstopall\2/' main.hsp
sed -i -E ':b;s/(:[[:space:]]*)mmstop([[:space:]]*)(:|;|$)/\1mmstopall\2\3/;tb' main.hsp
sed -i -E 's/^([[:space:]]*)(mmload|mmplay|mmstop|mmvol)([[:space:]])/\1\2x\3/' main.hsp
sed -i -E ':a;s/(:[[:space:]]*)(mmload|mmplay|mmstop|mmvol)([[:space:]])/\1\2x\3/;ta' main.hsp

# 3) 画面外バッファ(gsel 1以上)の高速化キャッシュは無効化して通常描画にする (Android版と同じ処置)
sed -i -E 's/^([[:space:]]*pdcEligible=)1([[:space:]]*(;.*)?)$/\10\2/' main.hsp
sed -i -E 's/:pmqOk=1([[:space:]]*(;.*)?)$/:pmqOk=0\1/' main.hsp

# 4) d3setcam は d3wincy を上書きするので、本家の仕様どおり「d3setcam の後に d3wincy」の順にする (Android版と同じ処置)
sed -i -E '/^[[:space:]]*d3wincy=[0-9]+[[:space:]]*$/{N;s/^([[:space:]]*d3wincy=[0-9]+[[:space:]]*)\n([[:space:]]*d3setcam[^\n]*)$/\2\n\1/}' main.hsp

# 4b) 広告(16)は待機つきの admobshow16 に置き換える。公式Webには AdMob が無く -1(失敗) が返るので、広告なしで先へ進む。
#     (広告は第3弾でつなぐ)
sed -i -E 's/devcontrol[[:space:]]+"AdMob"[[:space:]]*,[[:space:]]*16([^0-9]|$)/admobshow16web\1/' main.hsp

# 5) Web用の分岐(case PLATFORM_wwwWEBGL)の最後に、公式Web向けの保存先を上書きで入れる
#    - 素材は仮想FSの gdata/ (assets.pack から展開)
#    - セーブは /<保存フォルダ>/ (IDBFSがIndexedDBと同期する場所)
awk -v sd="/${SAVEDIR}/" '
/^[[:space:]]*case[[:space:]]+PLATFORM_wwwWEBGL([[:space:]]|$)/ { inweb=1 }
inweb && /^[[:space:]]*swbreak[[:space:]]*$/ {
  print "        ;[web_patch] 公式Web版の保存先"
  print "        folder=\"gdata/\""
  print "        slfolder=\"" sd "\""
  print "        testslfolder=\"" sd "\""
  inweb=0; done=1
}
{ print }
END { if (!done) { print "web_patch: case PLATFORM_wwwWEBGL の swbreak が見つかりません" > "/dev/stderr"; exit 3 } }
' main.hsp > main.hsp.tmp
mv main.hsp.tmp main.hsp

# 6) 互換モジュールを hsp3dish.as の直後に挿入 (native_compat: mmloadsafe/admobshow16, web_compat: PLATFORM定数)
grep -q 'native_compat.hsp' main.hsp || sed -i '0,/#include "hsp3dish.as"/s//#include "hsp3dish.as"\n#include "native_compat.hsp"/' main.hsp
grep -q 'web_compat.hsp' main.hsp || sed -i '0,/#include "native_compat.hsp"/s//#include "native_compat.hsp"\n#include "web_compat.hsp"/' main.hsp
grep -q '#include "web_compat.hsp"' main.hsp || { echo "web_patch: web_compat.hsp を差し込めませんでした" >&2; exit 4; }

echo "web_patch: saveDir=/${SAVEDIR}/ mmloadx=$(grep -cE '(^|:)[[:space:]]*mmloadx' main.hsp) mmstopall=$(grep -cE '(^|:)[[:space:]]*mmstopall' main.hsp) mmplayx=$(grep -cE '(^|:)[[:space:]]*mmplayx' main.hsp) admobshow16=$(grep -c 'admobshow16' main.hsp)"
LEFT=$(grep -nE '(^|[^A-Za-z0-9_"])(mmload|mmplay|mmstop|mmvol)[[:space:]]' main.hsp | grep -v '^[0-9]*:[[:space:]]*;' || true)
[ -z "$LEFT" ] || { echo "web_patch: 置き換えできなかった mm 命令があります(未確認の書き方):"; echo "$LEFT" | head -10; }
