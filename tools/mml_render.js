#!/usr/bin/env node
// MML(txt) -> wav。自作 hsp-synth.js をそのまま使って、ミニインタプリタと同じ音を書き出す。
// 使い方: node mml_render.js 入力.txt 出力.wav [最小秒数(既定180)]
// - 行 = トラック(';'で始まる行は無視)。'$' はループ開始位置(最後に現れた'$'が有効 = hsp-synth.js の仕様どおり)
// - HSPの mmload のループは「ファイル全体」なので、イントロ + ループ部×N にして最小秒数以上にする
const fs = require('fs');
globalThis.window = globalThis;               // hsp-synth.js が window.HspSynth に登録するため
require('../android/app/src/main/assets/hsp-synth.js');

const [src, dst, minArg] = process.argv.slice(2);
const minSec = minArg ? parseFloat(minArg) : 180;
const text = fs.readFileSync(src, 'utf8').replace(/^﻿/, '');
const tracks = text.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith(';'));

const synth = new window.HspSynth();
const pcm = synth.generateAudioData(tracks);
const SR = synth.SAMPLE_RATE;
let ls = synth.loopStartSample;
if (ls < 0 || ls >= pcm.length) ls = 0;
const loopLen = pcm.length - ls;

// 末尾の無音(リリース等)はそのまま含める。イントロ + ループ部 を繰り返す
const reps = Math.max(1, Math.ceil((minSec * SR - ls) / loopLen));
const total = ls + reps * loopLen;
const out = new Int16Array(total);
out.set(pcm.subarray(0, ls), 0);
for (let k = 0; k < reps; k++) out.set(pcm.subarray(ls), ls + k * loopLen);
console.log(`${src}: tracks=${tracks.length} intro=${(ls / SR).toFixed(2)}s loop=${(loopLen / SR).toFixed(2)}s x${reps} -> ${(total / SR).toFixed(1)}s`);

// WAV(16bit mono)
const buf = Buffer.alloc(44 + out.length * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + out.length * 2, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(out.length * 2, 40);
Buffer.from(out.buffer, out.byteOffset, out.byteLength).copy(buf, 44);
fs.writeFileSync(dst, buf);
