package tv.hsp;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 自作シンセ hsp-synth.js (assets/hsp-synth.js, 無改変) を端末上のWebViewで動かし、
 * MMLを PCM に合成して WAV として cache に保存する。
 * mmload "::mmlt::パス" から C++ (MMMan::Load) 経由で呼ばれる。ネイティブ側のスレッドから呼ぶこと(UIスレッド不可)。
 * 同じMML+同じシンセの組み合わせは cache の WAV を再利用する。
 */
public class MmlSynth {
    private static final String TAG = "MmlSynth";
    private static final Object LOCK = new Object();
    private static final int MIN_FILE_SEC = 60;   // 先頭ループにフォールバックしても自然に聴こえるよう、ループ部を繰り返して作る

    private static final String GLUE =
        ";(function(){var synth=null;window.__mmlRun=function(text){try{" +
        "if(!synth)synth=new HspSynth();" +
        "var tracks=text.split(/\\r?\\n/).map(function(s){return s.trim();}).filter(function(s){return s&&s.charAt(0)!==';';});" +
        "var pcm=synth.generateAudioData(tracks);" +
        "HspBridge.meta(synth.loopStartSample|0,pcm.length,synth.SAMPLE_RATE);" +
        "var CH=32768;for(var i=0;i<pcm.length;i+=CH){var n=Math.min(CH,pcm.length-i);" +
        "var u8=new Uint8Array(pcm.buffer,pcm.byteOffset+i*2,n*2);var s='';" +
        "for(var k=0;k<u8.length;k+=8192){s+=String.fromCharCode.apply(null,u8.subarray(k,k+8192));}" +
        "HspBridge.chunk(btoa(s));}" +
        "HspBridge.done('');}catch(e){HspBridge.done(String(e));}};})();";

    public static String render(final Activity act, String assetPath) {
        synchronized (LOCK) {
            try {
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    Log.e(TAG, "UIスレッドからは呼べません");
                    return "";
                }
                String mml = readAsset(act, assetPath);
                String js = readAsset(act, "hsp-synth.js");
                String key = sha1(mml + "\u0000" + js.length() + ":" + js.hashCode());
                File wav = new File(act.getCacheDir(), "mml_" + key + ".wav");
                File meta = new File(act.getCacheDir(), "mml_" + key + ".loop");
                if (wav.exists() && meta.exists()) {
                    return wav.getAbsolutePath() + "\t" + readText(meta).trim();
                }
                long t0 = System.currentTimeMillis();
                Result r = synth(act, js, mml);
                if (r == null) return "";
                int sr = r.sampleRate;
                int ls = (r.loopStart >= 0 && r.loopStart < r.pcm.length) ? r.loopStart : 0;
                int loopLen = r.pcm.length - ls;
                int reps = Math.max(1, (int) Math.ceil((MIN_FILE_SEC * (double) sr - ls) / Math.max(1, loopLen)));
                writeWav(wav, r.pcm, ls, reps, sr);
                int loopMs = (int) (ls * 1000L / sr);
                FileOutputStream fo = new FileOutputStream(meta);
                fo.write(String.valueOf(loopMs).getBytes("UTF-8"));
                fo.close();
                Log.i("HSPDIAG", "MML synth " + assetPath + " samples=" + r.pcm.length + " loopStart=" + loopMs
                        + "ms reps=" + reps + " time=" + (System.currentTimeMillis() - t0) + "ms");
                return wav.getAbsolutePath() + "\t" + loopMs;
            } catch (Throwable t) {
                Log.e(TAG, "render failed", t);
                return "";
            }
        }
    }

    /** 起動直後にバックグラウンドで assets/gdata/bgm 内のMMLを合成してキャッシュを作る(初回再生時の待ちを無くす) */
    public static void prewarm(final Activity act) {
        Thread t = new Thread(new Runnable() {
            @Override public void run() {
                try {
                    String[] list = act.getAssets().list("gdata/bgm");
                    if (list == null) return;
                    java.util.Arrays.sort(list);
                    for (String f : list) {
                        if (f.endsWith(".txt")) render(act, "gdata/bgm/" + f);
                    }
                } catch (Throwable ignore) {
                }
            }
        }, "MmlPrewarm");
        t.setPriority(Thread.MIN_PRIORITY);
        t.start();
    }

    private static class Result {
        short[] pcm; int loopStart; int sampleRate;
    }

    private static class Bridge {
        final ByteArrayOutputStream bo = new ByteArrayOutputStream();
        final CountDownLatch latch = new CountDownLatch(1);
        volatile int ls = -1, len = 0, sr = 44100;
        volatile String err = null;

        @JavascriptInterface public void meta(int loopStart, int length, int sampleRate) { ls = loopStart; len = length; sr = sampleRate; }
        @JavascriptInterface public void chunk(String b64) {
            byte[] b = Base64.decode(b64, Base64.DEFAULT);
            bo.write(b, 0, b.length);
        }
        @JavascriptInterface public void done(String e) { err = (e == null || e.length() == 0) ? null : e; latch.countDown(); }
    }

    private static Result synth(final Activity act, final String js, final String mml) throws Exception {
        final Bridge br = new Bridge();
        final WebView[] holder = new WebView[1];
        final Handler h = new Handler(Looper.getMainLooper());
        final String script = js + "\n" + GLUE + "\n__mmlRun(" + org.json.JSONObject.quote(mml) + ");";
        h.post(new Runnable() {
            @Override public void run() {
                try {
                    WebView wv = new WebView(act);
                    holder[0] = wv;
                    wv.getSettings().setJavaScriptEnabled(true);
                    wv.addJavascriptInterface(br, "HspBridge");
                    final boolean[] started = {false};
                    wv.setWebViewClient(new WebViewClient() {
                        @Override public void onPageFinished(WebView v, String url) {
                            if (started[0]) return;
                            started[0] = true;
                            v.evaluateJavascript(script, null);
                        }
                    });
                    wv.loadDataWithBaseURL("https://hsp.invalid/", "<html><body></body></html>", "text/html", "utf-8", null);
                } catch (Throwable t) {
                    br.err = String.valueOf(t);
                    br.latch.countDown();
                }
            }
        });
        boolean ok = br.latch.await(120, TimeUnit.SECONDS);
        h.post(new Runnable() {
            @Override public void run() {
                try { if (holder[0] != null) holder[0].destroy(); } catch (Throwable ignore) { }
            }
        });
        if (!ok || br.err != null) {
            Log.e(TAG, "synth error: " + (ok ? br.err : "timeout"));
            return null;
        }
        byte[] raw = br.bo.toByteArray();
        int n = raw.length / 2;
        if (n != br.len) Log.w(TAG, "length mismatch " + n + " vs " + br.len);
        Result r = new Result();
        r.pcm = new short[n];
        for (int i = 0; i < n; i++) r.pcm[i] = (short) ((raw[2 * i] & 0xff) | (raw[2 * i + 1] << 8));
        r.loopStart = br.ls;
        r.sampleRate = br.sr;
        return r;
    }

    private static void writeWav(File f, short[] pcm, int ls, int reps, int sr) throws Exception {
        int loopLen = pcm.length - ls;
        long total = (long) ls + (long) reps * loopLen;
        FileOutputStream fo = new FileOutputStream(f);
        java.io.DataOutputStream d = new java.io.DataOutputStream(new java.io.BufferedOutputStream(fo, 1 << 16));
        d.writeBytes("RIFF"); d.writeInt(Integer.reverseBytes((int) (36 + total * 2))); d.writeBytes("WAVEfmt ");
        d.writeInt(Integer.reverseBytes(16)); d.writeShort(Short.reverseBytes((short) 1)); d.writeShort(Short.reverseBytes((short) 1));
        d.writeInt(Integer.reverseBytes(sr)); d.writeInt(Integer.reverseBytes(sr * 2));
        d.writeShort(Short.reverseBytes((short) 2)); d.writeShort(Short.reverseBytes((short) 16));
        d.writeBytes("data"); d.writeInt(Integer.reverseBytes((int) (total * 2)));
        byte[] tmp = new byte[2];
        for (int i = 0; i < ls; i++) { tmp[0] = (byte) pcm[i]; tmp[1] = (byte) (pcm[i] >> 8); d.write(tmp); }
        for (int k = 0; k < reps; k++)
            for (int i = ls; i < pcm.length; i++) { tmp[0] = (byte) pcm[i]; tmp[1] = (byte) (pcm[i] >> 8); d.write(tmp); }
        d.flush();
        d.close();
    }

    private static String readAsset(Activity act, String path) throws Exception {
        InputStream in = act.getAssets().open(path);
        return readAll(in).replaceFirst("^﻿", "");
    }

    private static String readText(File f) throws Exception {
        return readAll(new java.io.FileInputStream(f));
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return new String(bo.toByteArray(), "UTF-8");
    }

    private static String sha1(String s) throws Exception {
        byte[] h = MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (byte b : h) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
