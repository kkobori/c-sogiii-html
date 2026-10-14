# HSP native CI（本家方式）
hsp/main.hsp (UTF-8) → hspcmp → .ax → hsp3cnv → hspsource.cpp → ndkBuild → apk/aab
- hsp/ に UTF-8 で main.hsp と #include 先を置く（SJISの場合は iconv -f CP932 -t UTF-8）
- 画像などは android/app/src/main/assets/ （ルートからの相対パスで読める）
- 署名: Secrets に KEYSTORE_BASE64 / RELEASE_PASSWORD（alias は hspapp）。未設定ならテスト用鍵
- リリース時は main.hsp の debugonoff=0 にすること（Androidの保存先が /storage/emulated/0/ から本家既定のアプリ内保存へ変わる）

## 落ちた原因の確認（課題1）
アプリを一度落として、もう一度起動すると「前回の終了ログ」ダイアログが出ます。「コピー」で内容をクリップボードへ。
- Java例外 / 終了理由(Android 11+: CRASH_NATIVE, ANR, LOW_MEMORY 等) / logcat末尾(HSPERR, Fatal signal 等)
- HSPのエラー(`#Error N in line L`)は従来のダイアログに加え logcat タグ HSPERR にも出力

## MML(::mmlt::) と hsp-synth
`mmload "::mmlt::gdata/bgm/xxx.txt"` は、実行時に assets/hsp-synth.js(無改変)をWebViewで動かして合成し、WAVにして再生します。
合成結果は cache に保存され、2回目以降は即再生。`$` の位置は OpenSL のループ開始位置に設定されます(非対応端末では先頭ループ)。
tools/mml_render.js は同じ合成をPC/CIで書き出すための補助ツールです(通常は不要)。

## mmstop / mmplay / mmload の挙動(自作インタプリタ準拠)
- `mmstop` = 一時停止(再生位置を保持)。番号省略は全バンク
- `mmplay` = 一時停止中なら続きから再生。それ以外は先頭から
- `mmload` = 読み込み直し(再生位置は先頭に戻る)
- アプリを裏に回して復帰したときは、一時停止していたバンクは停止のまま、再生中だったものだけ再開

## 広告(AdMob リワード) と 戻るボタン

- `devcontrol "AdMob",18/17/16` はミニインタプリタと同じ状態機械 (Java `AdBridge`)。16 は `native_patch.sh` が `admobshow16` に置換し、結果(1/-1/-2)が出るまで待つ。
- `getreq v, SYSREQ_AD_STATUS(1000) / SYSREQ_AD_LASTTIME(1001) / SYSREQ_AD_LASTERROR(1002, 文字列) / SYSREQ_AD_CANREQUEST(1003)`。
- 設定は `config/admob.json` (無ければGoogleのテストID。CIが取り込む):
  `{"appId":"ca-app-pub-…~…","reward":"ca-app-pub-…/…","testing":true,"testDevices":[],"cooldownMinutes":3}`
- `getreq v, SYSREQ_BACKBUTTON(1004)`: 1=戻るボタンが押された(読むと消費)。スクリプトが一度でもこれを読むと、戻るボタンでアプリが終了しなくなる(読まないスクリプトは従来どおり終了)。
- いずれも実機未確認。

## pusher (スマホから apk/aab を作る)

`tools/hsp_native_pusher.html` を端末で開く。GitHubのトークン・owner・repo、アプリ設定(パッケージ名/アプリ名/version/向き)、AdMob設定、hspファイル、素材ZIPを指定して「反映してビルド」。
差分だけをコミットし、ビルド完了を待って apk/aab をダウンロードする。設定は `config/app.json` / `config/admob.json` としてコミットされ、Gradle(build.gradle)とCIが読む。

## セーブデータのバックアップ (指3本長押し)
ゲーム画面を指3本で約1.5秒押し続けると、バックアップ画面が開く(`SaveTools.java`)。
- 全部まとめて書き出し / 読み込み (JSON。Web版 `?diag=1` の一括バックアップと同じ形式)
- 個別ファイルごとの 書き出し / 読み込み、ファイルを選んで追加(ファイル名のまま)
- 対象はアプリ内の保存フォルダ(`getFilesDir()` 直下。リリース版の bsave/bload の保存先)。`crash_java.txt` などの診断ファイルは出ない
- 上書きの前に確認が出て、元の内容は `<名前>.bak` に残る。読み込み後はアプリを開き直す
- ファイルの受け渡しは Android 標準のファイル選択/保存画面だけを使うので、**ストレージ権限は不要** (AndroidManifest.xml の変更なし)
- `debugonoff=1` のデバッグビルドは保存先が `/storage/emulated/0/sogiii/` になるため対象外
- AndroidManifest.xml からストレージ権限(WRITE_EXTERNAL_STORAGE)は削除済み。リリース版の保存先はアプリ内なので不要。デバッグビルド(`debugonoff=1`)の外部保存は使えなくなる(CIは常に製品モードに置換するので影響なし)

## 共有ストレージ版 (apk専用。sogmake のように /storage/emulated/0/ を直接読み書きするアプリ)
pusher の「共有ストレージ版」にチェックを入れてビルドする(`config/app.json` の `allFilesAccess: true`)。
- **apk にだけ** `MANAGE_EXTERNAL_STORAGE` を付ける(CIが apk のビルド中だけ AndroidManifest.xml に足し、aab のときは外す。`tools/manifest_perm.py`)。**このaabはPlayストアに出せない**
- `debugonoff` を 0 に書き換えない(スクリプトの `debugonoff=1` のまま、保存先は `/storage/emulated/0/...`)
- 初回起動時に「すべてのファイルへのアクセス」の許可画面へ案内するダイアログが出る(`StoragePerm.java`。Android 11以上)。許可したらアプリを開き直す
- チェックなし(既定)なら、従来どおり権限なし・製品モード(保存先はアプリ内)
