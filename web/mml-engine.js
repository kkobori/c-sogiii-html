/* MML再生エンジン(第2弾)。公式 hsp3dish.js には MML(::mmlt::) が無いので、ここで補う。
 *  - 曲データ(.txt)を hsp-synth.js(HspSynth) で PCM に合成し、WebAudio で再生する
 *  - HSP側からは  devcontrol "mml_xxx", p1, p2  で呼ばれる(公式C++の devcontrol 末尾から Module.hspDevControl へ転送)
 *  - 動作はミニインタプリタに合わせる: mmstop=一時停止(位置を保存) / mmplay=続きから / mmload=先頭に戻す・音量リセット
 *    mmvol -1000..0 → 音量 (v+1000)/1000
 * 戻り値: 0=この機能で処理した / -1=対象外(HSP側は公式の mmplay 等へ回す)
 */
(function (root) {
  'use strict';

  function parseTracks(text) {      // ミニインタプリタの parseMmlTracksFromText と同じ: 1行目は読み飛ばし、4トラックへ順番に配る
    var lines = String(text).split(/\r\n|\r|\n/);
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    var tracks = ['', '', '', ''];
    lines.slice(1).forEach(function (seg, i) { var k = i % 4; tracks[k] += (tracks[k] !== '' ? ' ' : '') + seg; });
    return tracks;
  }

  function create(env) {
    env = env || {};
    var log = env.log || function () {};
    var toast = env.toast || function () {};
    var AC = env.AudioContext || root.AudioContext || root.webkitAudioContext;
    var Synth = env.HspSynth || root.HspSynth;
    var readText = env.readText;             // path -> 文字列(仮想FSから読む)
    var now0 = env.now || function () { return Date.now(); };

    var synth = null, ctx = null, unlocked = false;
    var pcmCache = {};                       // path -> {pcm:Int16Array, loopStart:number, sr:number} / null(失敗)
    var bufCache = {};                       // path -> AudioBuffer
    var ch = {};                             // ch番号 -> 状態
    var st = { synthMs: 0, loaded: 0, failed: 0, played: 0, lastError: '' };

    function getSynth() {
      if (synth) return synth;
      if (!Synth) throw new Error('hsp-synth.js が読み込まれていません');
      synth = new Synth();
      return synth;
    }

    function synthesize(path) {
      if (Object.prototype.hasOwnProperty.call(pcmCache, path)) return pcmCache[path];
      var r = null, t = now0();
      try {
        var text = readText(path);
        if (text == null) throw new Error('曲ファイルがありません: ' + path);
        var s = getSynth();
        var pcm = s.generateAudioData(parseTracks(text));
        if (!pcm || !pcm.length) throw new Error('合成結果が空です');
        r = { pcm: pcm, loopStart: Math.max(0, s.loopStartSample | 0), sr: s.SAMPLE_RATE || 44100 };
        st.loaded++;
      } catch (e) {
        st.failed++; st.lastError = path + ': ' + (e && e.message || e);
        log('[MML] 合成失敗 ' + st.lastError);
      }
      st.synthMs += now0() - t;
      pcmCache[path] = r;
      return r;
    }

    // 起動時に先に合成しておく(再生中の引っかかりを避ける)。曲ごとに1回ずつ制御を返す。
    function prepare(paths, onProgress) {
      var i = 0;
      return new Promise(function (resolve) {
        (function next() {
          if (i >= paths.length) return resolve(st);
          var p = paths[i++];
          if (onProgress) onProgress(i, paths.length, p);
          setTimeout(function () { synthesize(p); next(); }, 0);
        })();
      });
    }

    function ensureCtx() {
      if (ctx) return ctx;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { st.lastError = 'AudioContext: ' + e; log('[MML] ' + st.lastError); ctx = null; }
      return ctx;
    }

    // タップ操作の中で呼ぶ(iOS等は、ユーザー操作の中でないと音が出せない)
    function unlock() {
      var c = ensureCtx();
      if (!c) return false;
      try {
        if (c.state !== 'running' && c.resume) c.resume();
        var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
        s.buffer = b; s.connect(c.destination); s.start(0);
        unlocked = true;
      } catch (e) { log('[MML] unlock: ' + e); }
      return unlocked;
    }

    function getBuf(path) {
      if (bufCache[path]) return bufCache[path];
      var r = synthesize(path);
      var c = ensureCtx();
      if (!r || !c) return null;
      var b = c.createBuffer(1, r.pcm.length, r.sr), d = b.getChannelData(0), p = r.pcm;
      for (var i = 0; i < p.length; i++) d[i] = p[i] / 32768;
      bufCache[path] = b;
      return b;
    }

    function pos(c) {                    // 再生中の現在位置(秒)
      if (!c.playing || !ctx) return c.offset;
      var b = c.buf, dur = b.duration, e = c.offset + (ctx.currentTime - c.startedAt);
      if (c.loop) {
        var ls = c.loopStart;
        if (e >= dur) e = ls + ((e - ls) % Math.max(0.001, dur - ls));
      } else if (e >= dur) e = dur;
      return e;
    }

    function killSource(c) {
      if (c.src) { try { c.src.onended = null; c.src.stop(); } catch (e) {} try { c.src.disconnect(); } catch (e) {} c.src = null; }
    }

    function applyVol(c) { if (c.gain && ctx) { try { c.gain.gain.value = c.vol; } catch (e) {} } }

    function startAt(c, off) {
      var cx = ensureCtx();
      if (!cx || !c.buf) return;
      killSource(c);
      var src = cx.createBufferSource(), g = c.gain || cx.createGain();
      c.gain = g; g.gain.value = c.vol;
      src.buffer = c.buf;
      if (c.loop) { src.loop = true; src.loopStart = c.loopStart; src.loopEnd = c.buf.duration; }
      src.connect(g); g.connect(cx.destination);
      src.onended = function () { if (c.src === src) { c.src = null; c.playing = false; c.offset = 0; } };
      c.src = src;
      if (off >= c.buf.duration) off = 0;
      src.start(0, off);
      c.startedAt = cx.currentTime; c.offset = off; c.playing = true;
    }

    // ---- HSPから呼ばれる ----
    function mmlLoad(path, n, loop) {
      var old = ch[n]; if (old) { killSource(old); }
      var c = { path: path, loop: !!loop, vol: 1, offset: 0, playing: false, src: null, gain: old && old.gain || null, buf: null, loopStart: 0 };
      ch[n] = c;                          // 失敗しても「MML用のチャンネル」として確保(以後の再生・停止は無音で受ける)
      var r = synthesize(path);
      if (r) { c.loopStart = r.loopStart / r.sr; c.pcm = r; }
      log('[MML] load ch' + n + ' ' + path + (r ? ' ok ' + (r.pcm.length / r.sr).toFixed(1) + 's' : ' (無音)') + ' loop=' + c.loop);
      return 0;
    }
    function mmlPlay(n) {
      var c = ch[n]; if (!c) return -1;
      if (!c.pcm) return 0;
      if (!c.buf) { c.buf = getBuf(c.path); if (!c.buf) return 0; }
      if (c.playing) return 0;
      if (ctx && ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) {} }
      startAt(c, c.offset); st.played++;
      return 0;
    }
    function mmlStop(n) {
      var c = ch[n]; if (!c) return -1;
      if (c.playing) { c.offset = pos(c); c.playing = false; killSource(c); }
      return 0;
    }
    function mmlVol(n, v) {
      var c = ch[n]; if (!c) return -1;
      v = +v; if (!isFinite(v)) v = 0;
      c.vol = Math.max(0, Math.min(1, (v + 1000) / 1000));
      applyVol(c);
      return 0;
    }
    function mmlDrop(n) {                 // 同じチャンネルへ通常の音源を読み込む前に呼ばれる
      var c = ch[n]; if (!c) return -1;
      killSource(c); delete ch[n];
      return 0;
    }

    var nlog = 0;
    function devcontrol(cmd, p1, p2, p3) {
      try {
        cmd = String(cmd);
        if (nlog < 40) { nlog++; log('[MML] devcontrol ' + cmd + ' ' + p1 + ',' + p2 + ',' + p3); }
        if (cmd.indexOf('mml_load:') === 0) {
          var f = cmd.slice(9);
          if (f.indexOf('::mmlt::') !== 0) return -1;      // MML以外(mp3/wav)は公式の命令へ
          return mmlLoad(f.slice(8), p1 | 0, (p2 | 0) !== 0);
        }
        switch (cmd) {
          case 'mml_play': return mmlPlay(p1 | 0);
          case 'mml_stop': return mmlStop(p1 | 0);
          case 'mml_stopall': Object.keys(ch).forEach(function (k) { mmlStop(k | 0); }); return 0;
          case 'mml_vol': return mmlVol(p1 | 0, p2);
          case 'mml_drop': return mmlDrop(p1 | 0);
          case 'mml_has': return ch[p1 | 0] ? 1 : 0;
        }
      } catch (e) { st.lastError = String(e && e.message || e); log('[MML] エラー ' + st.lastError); return 0; }
      return -1;
    }

    // 広告表示中: 再生中のMMLを一時停止し、広告が終わったら続きから再開する
    var adPaused = [];
    function pauseForAd() {
      adPaused = [];
      Object.keys(ch).forEach(function (k) { var c = ch[k]; if (c && c.playing) { adPaused.push(k | 0); mmlStop(k | 0); } });
      if (adPaused.length) log('[MML] 広告のため一時停止 ch=' + adPaused.join(','));
    }
    function resumeAfterAd() {
      var list = adPaused; adPaused = [];
      list.forEach(function (n) { if (ch[n] && !ch[n].playing) mmlPlay(n); });
      if (list.length) log('[MML] 広告終了 → 続きから再開 ch=' + list.join(','));
    }

    // 画面が隠れたら止め、戻ったら再開(バッテリー・バックグラウンド再生の対策)
    function onVis(hidden) {
      if (!ctx) return;
      try { if (hidden) { if (ctx.suspend) ctx.suspend(); } else if (unlocked && ctx.resume) ctx.resume(); } catch (e) {}
    }

    return {
      prepare: prepare, pauseForAd: pauseForAd, resumeAfterAd: resumeAfterAd, unlock: unlock, devcontrol: devcontrol, onVisibility: onVis,
      state: st, _ch: ch, _ctx: function () { return ctx; }, parseTracks: parseTracks
    };
  }

  root.MmlEngine = { create: create, parseTracks: parseTracks };
})(typeof window !== 'undefined' ? window : globalThis);
