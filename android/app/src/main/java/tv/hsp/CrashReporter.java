package tv.hsp;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.app.ApplicationExitInfo;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.os.Build;
import android.util.TypedValue;
import android.view.ViewGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 落ちた原因を端末だけで確認するための簡易レポーター。
 *  - Java例外: 例外発生時にファイルへ保存し、次回起動時に表示
 *  - ネイティブクラッシュ/強制終了: ApplicationExitInfo(Android 11+)の終了理由を表示
 *  - 自アプリのlogcat(HSPエラー、Fatal signal等)の末尾を表示
 * 次回起動時に画面へ出す。「コピー」を押すと内容がクリップボードに入る。
 */
public class CrashReporter {

    private static final String JAVA_CRASH_FILE = "crash_java.txt";
    private static final int MAX_CHARS = 14000;

    /** onCreateの最初で呼ぶ。Java例外をファイルに残す。 */
    public static void install(final Context ctx) {
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread t, Throwable e) {
                try {
                    StringWriter sw = new StringWriter();
                    PrintWriter pw = new PrintWriter(sw);
                    pw.println("[Java uncaught exception] thread=" + t.getName() + " time=" + now());
                    e.printStackTrace(pw);
                    pw.flush();
                    FileOutputStream fo = new FileOutputStream(new File(ctx.getFilesDir(), JAVA_CRASH_FILE));
                    fo.write(sw.toString().getBytes("UTF-8"));
                    fo.close();
                } catch (Throwable ignore) {
                }
                if (prev != null) prev.uncaughtException(t, e);
            }
        });
    }

    /** onCreateの最後で呼ぶ。前回の終了状況を組み立てて表示する。 */
    public static void showIfAny(final Activity act) {
        final String report;
        try {
            report = buildReport(act);
        } catch (Throwable t) {
            return;
        }
        if (report == null) return;
        act.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    show(act, report);
                } catch (Throwable ignore) {
                }
            }
        });
    }

    private static String buildReport(Context ctx) throws Exception {
        StringBuilder sb = new StringBuilder();
        boolean any = false;
        int lastPid = -1;

        sb.append("device=").append(Build.MANUFACTURER).append(' ').append(Build.MODEL)
          .append(" / Android ").append(Build.VERSION.RELEASE)
          .append(" (API ").append(Build.VERSION.SDK_INT).append(")")
          .append(" / ABI ").append(Build.SUPPORTED_ABIS[0]).append('\n');

        // 1) Java例外
        File jf = new File(ctx.getFilesDir(), JAVA_CRASH_FILE);
        if (jf.exists()) {
            any = true;
            sb.append("\n== Java例外 (前回) ==\n").append(readFile(jf)).append('\n');
            jf.delete();
        }

        // 2) 終了理由 (Android 11+)
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
                List<ApplicationExitInfo> list = am.getHistoricalProcessExitReasons(null, 0, 3);
                if (list != null && !list.isEmpty()) {
                    sb.append("\n== 前回までの終了理由 (新しい順) ==\n");
                    boolean first = true;
                    for (ApplicationExitInfo i : list) {
                        int r = i.getReason();
                        sb.append("- ").append(reasonName(r))
                          .append(" status=").append(i.getStatus())
                          .append(" time=").append(fmt(i.getTimestamp()))
                          .append(" pid=").append(i.getPid())
                          .append("\n  desc=").append(i.getDescription()).append('\n');
                        if (first) {
                            first = false;
                            // 異常終了だけを対象にする。EXIT_SELF(正常終了含む)は、
                            // その終了pidのHSPERR行がlogcatにある場合のみ(後段で判定)
                            if (r == ApplicationExitInfo.REASON_CRASH
                                    || r == ApplicationExitInfo.REASON_CRASH_NATIVE
                                    || r == ApplicationExitInfo.REASON_ANR
                                    || r == ApplicationExitInfo.REASON_LOW_MEMORY
                                    || r == ApplicationExitInfo.REASON_SIGNALED
                                    || r == ApplicationExitInfo.REASON_INITIALIZATION_FAILURE) {
                                any = true;
                            }
                            lastPid = i.getPid();
                            if (r == ApplicationExitInfo.REASON_CRASH_NATIVE
                                    || r == ApplicationExitInfo.REASON_ANR) {
                                String tr = traceStrings(i);
                                if (tr.length() > 0) {
                                    sb.append("  trace(文字列抽出):\n").append(tr).append('\n');
                                }
                            }
                        }
                    }
                }
            } catch (Throwable t) {
                sb.append("(exit info error: ").append(t).append(")\n");
            }
        } else {
            sb.append("\n(Android 10以前: 終了理由は取得不可。logcatのみ)\n");
        }

        // 広告/音の診断メモ(admob.json の debugToast が true の間だけ記録される)
        File adf = new File(ctx.getFilesDir(), "ad_debug.txt");
        if (adf.exists()) {
            any = true;
            sb.append("\n== 広告/音の診断メモ ==\n").append(readFile(adf)).append('\n');
            adf.delete();
        }

        String lc = logcatTail();
        // 前回プロセスがHSPERRを出して自己終了した場合のみ表示(HSPDIAGや古い行では出さない)
        if (!any && lastPid > 0) {
            for (String ln : lc.split("\n")) {
                if (ln.contains("HSPERR") && ln.contains("(" + lastPid + ")")) { any = true; break; }
                if (ln.contains("HSPERR") && ln.contains(" " + lastPid + ":")) { any = true; break; }
            }
        }
        if (!any) return null;

        // 3) logcat (自アプリ分)
        sb.append("\n== logcat 末尾 ==\n").append(lc);
        String s = sb.toString();
        if (s.length() > MAX_CHARS) s = s.substring(0, MAX_CHARS * 2 / 3) + "\n...(省略)...\n" + s.substring(s.length() - MAX_CHARS / 3);
        return s;
    }

    private static String traceStrings(ApplicationExitInfo i) {
        try {
            InputStream in = i.getTraceInputStream();
            if (in == null) return "";
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n, total = 0;
            while ((n = in.read(buf)) > 0 && total < 200000) {
                bo.write(buf, 0, n);
                total += n;
            }
            in.close();
            byte[] b = bo.toByteArray();
            StringBuilder out = new StringBuilder();
            StringBuilder cur = new StringBuilder();
            for (int k = 0; k < b.length; k++) {
                int c = b[k] & 0xff;
                if (c >= 0x20 && c < 0x7f) {
                    cur.append((char) c);
                } else {
                    if (cur.length() >= 5) out.append(cur).append('\n');
                    cur.setLength(0);
                }
            }
            if (cur.length() >= 5) out.append(cur).append('\n');
            String r = out.toString();
            if (r.length() > 5000) r = r.substring(0, 5000);
            return r;
        } catch (Throwable t) {
            return "";
        }
    }

    private static String logcatTail() {
        try {
            Process p = Runtime.getRuntime().exec(new String[]{"logcat", "-d", "-t", "400", "-v", "time"});
            BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) {
                // ノイズを減らす: 重要そうな行だけ残す
                if (line.contains("dataspace")) continue;   // 毎フレーム出るノイズ
                if (line.contains("HSPERR") || line.contains("HSPAD") || line.contains("AndroidRuntime") || line.contains("Fatal")
                        || line.contains("DEBUG") || line.contains("libc") || line.contains("signal")
                        || line.contains("Exception") || line.contains("ActivityManager")) {
                    sb.append(line).append('\n');
                }
            }
            br.close();
            if (sb.length() == 0) return "(該当行なし)\n";
            // 末尾60行だけ残す(診断メモなど前半の情報が切れないように)
            String all = sb.toString();
            String[] ls = all.split("\n");
            if (ls.length > 60) {
                StringBuilder t = new StringBuilder();
                for (int i = ls.length - 60; i < ls.length; i++) t.append(ls[i]).append('\n');
                return t.toString();
            }
            return all;
        } catch (Throwable t) {
            return "(logcat取得失敗: " + t + ")\n";
        }
    }

    private static void show(final Activity act, final String report) {
        TextView tv = new TextView(act);
        tv.setText(report);
        tv.setTextIsSelectable(true);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        tv.setPadding(24, 16, 24, 16);
        ScrollView sv = new ScrollView(act);
        sv.addView(tv, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        new AlertDialog.Builder(act)
                .setTitle("前回の終了ログ")
                .setView(sv)
                .setPositiveButton("コピー", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        ClipboardManager cm = (ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
                        cm.setPrimaryClip(ClipData.newPlainText("crashlog", report));
                        Toast.makeText(act, "コピーしました", Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("閉じる", null)
                .show();
    }

    private static String reasonName(int r) {
        switch (r) {
            case 1: return "EXIT_SELF(アプリ自身が終了)";
            case 2: return "SIGNALED(シグナルで終了)";
            case 3: return "LOW_MEMORY(メモリ不足で強制終了)";
            case 4: return "CRASH(Java例外)";
            case 5: return "CRASH_NATIVE(ネイティブクラッシュ)";
            case 6: return "ANR(応答なし)";
            case 7: return "INITIALIZATION_FAILURE";
            case 8: return "PERMISSION_CHANGE";
            case 9: return "EXCESSIVE_RESOURCE_USAGE";
            case 10: return "USER_REQUESTED";
            case 11: return "USER_STOPPED";
            case 12: return "DEPENDENCY_DIED";
            case 13: return "OTHER";
            case 14: return "FREEZER";
            case 15: return "PACKAGE_STATE_CHANGE";
            case 16: return "PACKAGE_UPDATED";
            default: return "UNKNOWN(" + r + ")";
        }
    }

    private static String readFile(File f) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(new java.io.FileInputStream(f), "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String l;
        while ((l = br.readLine()) != null) sb.append(l).append('\n');
        br.close();
        return sb.toString();
    }

    private static String now() { return fmt(System.currentTimeMillis()); }

    private static String fmt(long t) {
        return new SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(new Date(t));
    }
}
