/* 広告(第3弾): AdSense の Ad Placement API(adBreak, リワード)を、HSPの devcontrol "AdMob",N につなぐ。
 * ミニインタプリタ(v76)と同じ状態機械・同じ呼び出し順:
 *   17=読込を始める / 18=準備確認(1=準備OK, 0=読込中, -2=失敗。IDLE/失敗なら自動で読込開始)
 *   16=表示を始める(0=開始) / 19=表示中の確認(2=表示中, 1=報酬あり完了, -1=失敗・報酬なし)
 *   (HSP側は web_patch が 16 を admobshow16 に置き換え、19 を使って結果を待つ)
 * 状態 status: 0=IDLE -1=LOADING 1=READY 2=SHOWING -2=FAILED
 * 広告が出ない環境(IDなし・H5未承認・ブロック等)では -2 / -1 を返すだけで、ゲームは先へ進む。
 */
(function (root) {
  'use strict';
  function create(env) {
    env = env || {};
    var log = env.log || function () {};
    var clientId = String(env.clientId || '').trim();
    var testing = env.testing !== false;
    var timeoutMs = env.loadTimeoutMs || 10000;
    var onStart = env.onShowStart || function () {}, onEnd = env.onShowEnd || function () {};
    var showing = false;
    function endShow() { if (showing) { showing = false; try { onEnd(); } catch (e) {} } }
    var win = env.window || root;
    var doc = env.document || (typeof document !== 'undefined' ? document : null);
    var AD = { status: 0, lastError: null, pendingShowFn: null, resultReady: false, lastResultStat: 0, loads: 0, shown: 0 };
    var scriptState = 0;      // 0=未 1=読込中 2=完了 -1=失敗

    function ensureScript() {
      if (scriptState !== 0) return;
      if (!clientId) return;
      scriptState = 1;
      win.adsbygoogle = win.adsbygoogle || [];
      win.adBreak = win.adConfig = function (o) { win.adsbygoogle.push(o); };
      if (!doc) { scriptState = 2; return; }
      var s = doc.createElement('script');
      s.async = true;
      if (testing) s.setAttribute('data-adbreak-test', 'on');
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(clientId);
      s.crossOrigin = 'anonymous';
      s.onload = function () {
        scriptState = 2; log('[広告] スクリプト読み込み完了 (テスト=' + (testing ? 'ON' : 'OFF') + ')');
        try {
          var o = { preloadAdBreaks: 'on', onReady: function () { log('[広告] Ad Placement API ready'); } };
          win.adBreak(o);
        } catch (e) { log('[広告] 初期化失敗: ' + e); }
      };
      s.onerror = function () { scriptState = -1; log('[広告] スクリプトを読み込めません(通信・ブロック等)'); };
      doc.head.appendChild(s);
    }

    function load() {
      AD.status = -1; AD.lastError = null; AD.pendingShowFn = null; AD.resultReady = false; AD.lastResultStat = 0; AD.loads++;
      if (!clientId) return fail('広告のIDが設定されていません');
      ensureScript();
      if (scriptState === -1) return fail('広告スクリプトを読み込めませんでした');
      if (typeof win.adBreak !== 'function') return fail('adBreak unavailable');
      var rewarded = false, loaded = false, showSettled = false, done = false;
      var timer = setTimeout(function () { if (!loaded) fail('timeout waiting for ad load'); }, timeoutMs);
      function fail(msg) {
        if (done) return; done = true;
        if (timer) clearTimeout(timer);
        AD.status = -2; AD.lastError = msg; log('[広告] 読込失敗: ' + msg);
      }
      function finish(ok, err) {
        if (showSettled) return; showSettled = true;
        AD.lastResultStat = ok ? 1 : -1; AD.resultReady = true; AD.status = 0;
        AD.pendingShowFn = null; AD.lastError = err || null;
        endShow();
        log('[広告] 結果確定: ' + (ok ? '報酬あり' : '報酬なし') + (err ? ' (' + err + ')' : ''));
      }
      try {
        win.adBreak({
          type: 'reward', name: 'hsp_reward',
          beforeReward: function (showAdFn) {
            loaded = true; done = true; if (timer) clearTimeout(timer);
            log('[広告] 読込完了(READY)');
            AD.status = 1; AD.pendingShowFn = showAdFn;
          },
          adViewed: function () { rewarded = true; },
          adDismissed: function () { finish(rewarded, rewarded ? null : 'dismissed without view'); },
          adBreakDone: function (info) {
            var st = info ? info.breakStatus : 'unknown';
            log('[広告] adBreakDone ' + st);
            if (!loaded && st !== 'viewed') fail(st);
            if (loaded && AD.status === 2 && !showSettled) finish(rewarded, rewarded ? null : 'adBreakDone: ' + st);
          }
        });
      } catch (e) { fail(String(e && e.message || e)); }
    }

    function reveal() {
      var fn = AD.pendingShowFn; AD.pendingShowFn = null;
      if (typeof fn !== 'function') { AD.resultReady = true; AD.lastResultStat = -1; AD.status = 0; return; }
      AD.shown++;
      showing = true; try { onStart(); } catch (e) {}
      try { fn(); } catch (e) { AD.resultReady = true; AD.lastResultStat = -1; AD.status = 0; AD.lastError = String(e); endShow(); }
    }

    function devcontrol(cmd, p1) {
      try {
        if (cmd !== 'AdMob') return -1;
        p1 = p1 | 0;
        if (p1 === 17) { load(); return 0; }
        if (p1 === 18) {
          var prev = AD.status;
          if (prev === 0 || prev === -2) load();
          return prev === 1 ? 1 : (prev === -2 ? -2 : 0);
        }
        if (p1 === 16) {
          if (AD.resultReady) { AD.resultReady = false; return AD.lastResultStat; }
          if (AD.status === 2) return 0;
          if (AD.status !== 1) return -1;
          AD.status = 2; reveal(); return 0;
        }
        if (p1 === 19) {
          if (AD.status === 2) return 2;
          if (AD.resultReady) { AD.resultReady = false; return AD.lastResultStat; }
          return -1;
        }
        return 0;
      } catch (e) { AD.lastError = String(e && e.message || e); log('[広告] エラー ' + AD.lastError); return -1; }
    }
    return { devcontrol: devcontrol, init: ensureScript, state: AD, _load: load };
  }
  root.AdEngine = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
