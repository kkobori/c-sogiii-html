package tv.hsp;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.RequestConfiguration;
import com.google.android.gms.ads.rewarded.RewardItem;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.gms.ads.OnUserEarnedRewardListener;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * リワード広告(AdMob)。ミニインタプリタの devcontrol "AdMob" と同じ状態機械。
 *   status: 0=IDLE / -1=読込中 / 1=READY / 2=表示中 / -2=失敗
 *   callAdMob(18)=準備確認(IDLE/FAILEDなら読込開始) 1=表示可 0=読込中 -2=失敗/クールダウン
 *   callAdMob(16)=表示開始 0=開始 -1=未準備 -2=クールダウン
 *   callAdMob(19)=表示の結果ポーリング 2=表示中 1=報酬獲得 -1=失敗/報酬なし
 *   callAdMob(17)=再リクエスト(読込開始) 0 / -2=クールダウン
 * 設定は assets/admob.json (pusherが生成)。無ければGoogleのテストIDで動く。
 */
public class AdBridge {
    private static final String TAG = "HSPAD";
    private static final String TEST_REWARD = "ca-app-pub-3940256099942544/5224354917";

    private static Activity act;
    private static final Handler ui = new Handler(Looper.getMainLooper());

    private static volatile int status = 0;
    private static volatile boolean resultReady = false;
    private static volatile int lastResult = 0;
    private static volatile String lastError = "";
    private static volatile int canRequest = -1;
    private static volatile boolean initDone = false;
    private static volatile boolean pendingLoad = false;
    private static RewardedAd rewarded = null;

    private static String rewardUnit = TEST_REWARD;
    private static boolean testing = true;
    private static int cooldownMin = 3;
    private static boolean debugToast = true;   // 失敗理由を画面に短く表示(原因調査用。admob.jsonで "debugToast":false にすると消える)
    private static final List<String> testDevices = new ArrayList<String>();

    private static void loadConfig(Context c) {
        try {
            InputStream in = c.getAssets().open("admob.json");
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] b = new byte[2048];
            int n;
            while ((n = in.read(b)) > 0) bo.write(b, 0, n);
            in.close();
            JSONObject o = new JSONObject(bo.toString("UTF-8"));
            String r = o.optString("reward", "");
            testing = o.optBoolean("testing", true);
            // testing=true なら常にGoogleのテスト広告。false のときだけ入力した本番IDを使う
            if (!testing && r.length() > 0) rewardUnit = r;
            cooldownMin = o.optInt("cooldownMinutes", 3);
            debugToast = o.optBoolean("debugToast", true);
            JSONArray a = o.optJSONArray("testDevices");
            if (a != null) for (int i = 0; i < a.length(); i++) testDevices.add(a.getString(i));
        } catch (Throwable t) {
            Log.i(TAG, "admob.json なし/読込失敗 -> テストIDで動作: " + t);
        }
    }

    /** onCreate(super後)に呼ぶ */
    public static void init(Activity a) {
        act = a;
        loadConfig(a);
        ui.post(new Runnable() { public void run() { startConsentAndInit(); } });
    }

    private static void startConsentAndInit() {
        try {
            final ConsentInformation ci = UserMessagingPlatform.getConsentInformation(act);
            ConsentRequestParameters params = new ConsentRequestParameters.Builder().build();
            ci.requestConsentInfoUpdate(act, params, new ConsentInformation.OnConsentInfoUpdateSuccessListener() {
                public void onConsentInfoUpdateSuccess() {
                    UserMessagingPlatform.loadAndShowConsentFormIfRequired(act, new com.google.android.ump.ConsentForm.OnConsentFormDismissedListener() {
                        public void onConsentFormDismissed(com.google.android.ump.FormError e) {
                            if (e != null) { lastError = "consent form: " + e.getMessage(); note(lastError); }
                            canRequest = ci.canRequestAds() ? 1 : 0;
                            if (canRequest == 0 && lastError.length() == 0) lastError = "consent not granted (canRequestAds=false)";
                            initSdk();
                        }
                    });
                }
            }, new ConsentInformation.OnConsentInfoUpdateFailureListener() {
                public void onConsentInfoUpdateFailure(com.google.android.ump.FormError e) {
                    // 同意情報が取れなくても従来通りリクエストを試みる
                    lastError = "consent info: " + e.getMessage();
                    note(lastError);
                    canRequest = -1;
                    initSdk();
                }
            });
        } catch (Throwable t) {
            lastError = "consent exception: " + t;
            initSdk();
        }
    }

    private static void initSdk() {
        try {
            RequestConfiguration.Builder rc = new RequestConfiguration.Builder();
            if (!testDevices.isEmpty()) rc.setTestDeviceIds(testDevices);
            MobileAds.setRequestConfiguration(rc.build());
            MobileAds.initialize(act, new com.google.android.gms.ads.initialization.OnInitializationCompleteListener() {
                public void onInitializationComplete(com.google.android.gms.ads.initialization.InitializationStatus s) {
                    initDone = true;
                    note("init ok (consent=" + canRequest + ", unit=" + rewardUnit + ")");
                    if (pendingLoad) { pendingLoad = false; startLoad(); }
                }
            });
        } catch (Throwable t) {
            fail("init: " + t);
        }
    }

    private static void appendDebug(String msg) {
        try {
            if (act == null) return;
            java.io.File f = new java.io.File(act.getFilesDir(), "ad_debug.txt");
            String old = "";
            if (f.exists()) {
                java.io.FileInputStream in = new java.io.FileInputStream(f);
                byte[] b = new byte[(int) Math.min(f.length(), 6000)];
                int n = in.read(b); in.close();
                old = new String(b, 0, Math.max(n, 0), "UTF-8");
            }
            String line = new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(new java.util.Date()) + " " + msg + "\n";
            String all = old + line;
            if (all.length() > 5000) all = all.substring(all.length() - 5000);
            java.io.FileOutputStream out = new java.io.FileOutputStream(f);
            out.write(all.getBytes("UTF-8")); out.close();
        } catch (Throwable t) { }
    }

    private static void note(final String msg) {
        Log.i(TAG, msg);
        if (debugToast) appendDebug(msg);   // 次回起動時に診断ダイアログで表示する
        if (!debugToast || act == null) return;
        ui.post(new Runnable() { public void run() {
            try { Toast.makeText(act, "AD: " + msg, Toast.LENGTH_LONG).show(); } catch (Throwable t) {}
        } });
    }

    public static void noteFromNative(String s) { note(s); }

    private static void fail(String why) {
        status = -2; lastError = why;
        Log.w(TAG, "FAIL " + why);
        note(why);
    }

    private static SharedPreferences prefs() { return act.getSharedPreferences("hsp_ad", Context.MODE_PRIVATE); }
    private static long lastShown() { return prefs().getLong("lastshown", 0); }

    private static long cooldownRemain() {
        if (cooldownMin <= 0) return 0;
        long l = lastShown();
        if (l <= 0) return 0;
        return Math.max(0, cooldownMin * 60000L - (System.currentTimeMillis() - l));
    }

    private static void startLoad() {
        status = -1; resultReady = false; rewarded = null;
        final long token = System.nanoTime();
        loadToken = token;
        // 初期化待ちでも、必ず45秒で失敗扱いにして原因を残す
        ui.postDelayed(new Runnable() { public void run() {
            if (loadToken == token && status == -1) {
                fail("ad load timeout(45s) initDone=" + initDone + " consent=" + canRequest + " last=" + lastError);
            }
        } }, 45000);
        if (!initDone) { pendingLoad = true; return; }
        if (canRequest == 0) { fail("consent not granted (canRequestAds=false)"); return; }
        ui.post(new Runnable() { public void run() {
            try {
                RewardedAd.load(act, rewardUnit, new AdRequest.Builder().build(), new RewardedAdLoadCallback() {
                    public void onAdLoaded(RewardedAd ad) {
                        if (loadToken != token) return;
                        rewarded = ad; status = 1; lastError = "";
                        Log.i(TAG, "reward ad loaded");
                    }
                    public void onAdFailedToLoad(LoadAdError e) {
                        if (loadToken != token) return;
                        fail("load failed: " + e.getCode() + " " + e.getMessage());
                    }
                });
            } catch (Throwable t) {
                fail("load exception: " + t);
            }
        } });
    }
    private static volatile long loadToken = 0;

    private static void startShow() {
        final RewardedAd ad = rewarded;
        status = 2; resultReady = false;
        final boolean[] earned = new boolean[1];
        ui.post(new Runnable() { public void run() {
            try {
                ad.setFullScreenContentCallback(new FullScreenContentCallback() {
                    public void onAdDismissedFullScreenContent() {
                        finish(earned[0], earned[0] ? "" : "closed without reward");
                    }
                    public void onAdFailedToShowFullScreenContent(AdError e) {
                        finish(false, "show failed: " + e.getCode() + " " + e.getMessage());
                    }
                });
                ad.show(act, new OnUserEarnedRewardListener() {
                    public void onUserEarnedReward(RewardItem item) { earned[0] = true; }
                });
            } catch (Throwable t) {
                finish(false, "show exception: " + t);
            }
        } });
    }

    private static void finish(boolean ok, String err) {
        if (status != 2) return;
        lastResult = ok ? 1 : -1;
        lastError = err == null ? "" : err;
        note("ad finished ok=" + ok + (ok ? "" : " " + lastError));
        rewarded = null;
        if (ok) prefs().edit().putLong("lastshown", System.currentTimeMillis()).apply();
        resultReady = true;
        status = 0;   // 表示後は17で再読込が必要
    }

    /** devcontrol "AdMob", p1 (HSPスレッドから呼ばれる) */
    public static int call(int p1) {
        if (act == null) return -1;
        switch (p1) {
            case 18: {
                if (cooldownRemain() > 0) return -2;
                int prev = status;
                if (prev == 0 || prev == -2) startLoad();
                return prev == 1 ? 1 : (prev == -2 ? -2 : 0);
            }
            case 17: {
                if (cooldownRemain() > 0) return -2;
                startLoad();
                return 0;
            }
            case 16: {
                if (cooldownRemain() > 0) { lastError = "cooldown"; return -2; }
                if (status != 1 || rewarded == null) { lastError = "ad not ready (status=" + status + ")"; return -1; }
                startShow();
                return 0;
            }
            case 19: {
                if (status == 2) return 2;
                if (resultReady) { resultReady = false; return lastResult; }
                return -1;
            }
            default:
                return 0;
        }
    }

    /** getreq SYSREQ_AD_* (1000..1003) */
    public static volatile boolean backEnabled = false;   // スクリプトが SYSREQ_BACKBUTTON を読んだら true
    public static volatile boolean backPending = false;

    public static int getInt(int id) {
        if (id == 1004) {   // SYSREQ_BACKBUTTON: 1回読んだら消費
            backEnabled = true;
            boolean v = backPending; backPending = false;
            return v ? 1 : 0;
        }
        if (act == null) return 0;
        switch (id) {
            case 1000: return status;
            case 1001: { long l = lastShown(); return l > 0 ? (int) Math.min(Integer.MAX_VALUE, System.currentTimeMillis() - l) : -1; }
            case 1003: return canRequest;
            default: return 0;
        }
    }

    public static String getStr(int id) {
        return id == 1002 ? lastError : "";
    }
}
