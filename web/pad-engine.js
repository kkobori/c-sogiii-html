/* pad-engine.js: ゲームパッド(Gamepad API) → HSP の getkey 用キーイベント
 * 公式 hsp3dish.js の getkey はキーボード(SDL)の状態を読むので、パッドのボタンを
 * 「割り当てた HSP キーコードのキーボードイベント」に変換して流す。公式C++は無改造。
 * 割り当ては webconfig.json の "gamepad" ({keyMap, indexMap}。config/gamepad.json から CI が入れる)。
 *  - keyMap  : ボタン名 → HSPキーコード   - indexMap: ボタン名 → 物理ボタン番号(未指定は標準の並び)
 *  - スティックは使わない(ボタンのみ)。トリガーが値で来るパッドは 0.5 超えで押下。
 */
(function (root) {
  'use strict';
  var NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'BACK', 'START', 'L3', 'R3',
    'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'HOME'];
  // HSP(Windows仮想キー) → KeyboardEvent.code / key
  var VK = {
    8: ['Backspace', 'Backspace'], 9: ['Tab', 'Tab'], 13: ['Enter', 'Enter'], 19: ['Pause', 'Pause'], 20: ['CapsLock', 'CapsLock'],
    27: ['Escape', 'Escape'], 32: ['Space', ' '], 33: ['PageUp', 'PageUp'], 34: ['PageDown', 'PageDown'], 35: ['End', 'End'],
    36: ['Home', 'Home'], 37: ['ArrowLeft', 'ArrowLeft'], 38: ['ArrowUp', 'ArrowUp'], 39: ['ArrowRight', 'ArrowRight'],
    40: ['ArrowDown', 'ArrowDown'], 45: ['Insert', 'Insert'], 46: ['Delete', 'Delete'],
    16: ['ShiftLeft', 'Shift'], 17: ['ControlLeft', 'Control'], 18: ['AltLeft', 'Alt']
  };
  var i, c;
  for (i = 0; i <= 9; i++) VK[48 + i] = ['Digit' + i, String(i)];
  for (i = 0; i < 26; i++) { c = String.fromCharCode(65 + i); VK[65 + i] = ['Key' + c, c.toLowerCase()]; }
  for (i = 1; i <= 12; i++) VK[111 + i] = ['F' + i, 'F' + i];

  function pressedBtn(b) { return !!b && (!!b.pressed || Number(b.value || 0) > 0.5); }

  /* env: { getGamepads(), dispatch(type, vk, code, key), now(), log(fn), hidden() } */
  function create(env, cfg) {
    var keyMap = (cfg && cfg.keyMap) || {}, indexMap = (cfg && cfg.indexMap) || {};
    var log = env.log || function () {};
    var held = {};            // vk -> true (いま keydown を送っている)
    var guardUntil = 0;
    var mapped = [];
    NAMES.forEach(function (n, li) {
      var v = parseInt(keyMap[n], 10);
      if (v >= 1 && v <= 255 && VK[v]) mapped.push({ name: n, logical: li, vk: v, phys: Number.isInteger(indexMap[n]) && indexMap[n] >= 0 ? indexMap[n] : li });
    });
    function send(type, vk) { var t = VK[vk]; try { env.dispatch(type, vk, t[0], t[1]); } catch (e) { } }
    function releaseAll() { Object.keys(held).forEach(function (k) { send('keyup', +k); }); held = {}; }
    function poll() {
      var now = env.now ? env.now() : Date.now();
      if (env.hidden && env.hidden()) { releaseAll(); guardUntil = now + 500; return; }
      if (now < guardUntil) return;      // 復帰直後の古いスナップショット(押しっぱなし固着)を無視
      var pads = []; try { pads = Array.prototype.slice.call(env.getGamepads() || []); } catch (e) { pads = []; }
      var down = {};
      pads.forEach(function (p) {
        if (!p || !p.connected) return;
        mapped.forEach(function (m) {
          if (m.phys < p.buttons.length && pressedBtn(p.buttons[m.phys])) down[m.vk] = true;
        });
      });
      Object.keys(down).forEach(function (k) { if (!held[k]) { held[k] = true; send('keydown', +k); } });
      Object.keys(held).forEach(function (k) { if (!down[k]) { delete held[k]; send('keyup', +k); } });
    }
    return { poll: poll, releaseAll: releaseAll, mappedCount: function () { return mapped.length; }, held: function () { return Object.keys(held).map(Number).sort(function (a, b) { return a - b; }); } };
  }

  function start(cfg, win) {
    win = win || root;
    var doc = win.document;
    var eng = create({
      getGamepads: function () { return win.navigator && win.navigator.getGamepads ? win.navigator.getGamepads() : []; },
      hidden: function () { return doc.hidden; },
      dispatch: function (type, vk, code, key) {
        var ev = new win.KeyboardEvent(type, { bubbles: true, cancelable: true, code: code, key: key, keyCode: vk, which: vk });
        // keyCode が初期化できない環境のための保険
        try { if (ev.keyCode !== vk) { Object.defineProperty(ev, 'keyCode', { get: function () { return vk; } }); Object.defineProperty(ev, 'which', { get: function () { return vk; } }); } } catch (e) { }
        (doc.activeElement || doc.body || doc).dispatchEvent(ev);
      }
    }, cfg);
    if (!eng.mappedCount()) return null;
    (function loop() { try { eng.poll(); } catch (e) { } win.requestAnimationFrame(loop); })();
    win.addEventListener('blur', function () { eng.releaseAll(); });
    return eng;
  }

  var API = { create: create, start: start, NAMES: NAMES, VK: VK };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.HspPadEngine = API;

  // ブラウザ: webconfig.json の gamepad を読んで自動で開始
  if (typeof document !== 'undefined' && root.fetch) {
    var v = root.__HSP_BUILD || '';
    root.fetch('webconfig.json?v=' + v).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      if (c && c.gamepad) { root.__hspPad = start(c.gamepad, root); if (root.__hspPad) { try { console.log('[パッド] ' + root.__hspPad.mappedCount() + 'ボタンを割り当て'); } catch (e) { } } }
    }).catch(function () { });
  }
})(typeof window !== 'undefined' ? window : globalThis);
