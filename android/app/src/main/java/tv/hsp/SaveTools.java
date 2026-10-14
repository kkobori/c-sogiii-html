package tv.hsp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.DialogInterface;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

/**
 * セーブデータのバックアップ(書き出し/読み込み)。画面を指3本で約1.5秒押し続けると開く(検出は main.cpp、開くのは HspActivity.saveToolsOpen)。
 *
 * 対象: アプリ内の保存フォルダ(getFilesDir() 直下のファイル)。bsave/bload の相対パスの保存先。
 * ファイルの受け渡しは Storage Access Framework(Android標準のファイル選択/保存画面)だけを使う。
 * そのためストレージ関連の権限(READ/WRITE/MANAGE_EXTERNAL_STORAGE)は一切不要。
 *
 * 一括バックアップの形式は Web版(?diag=1)と同じ JSON(format=hsp-web-save)。
 * 読み込みで上書きするとき、元の内容は <名前>.bak に退避する。
 */
public class SaveTools {
    private static final String TAG = "HSPSAVE";
    private static final int RC_EXPORT_ONE = 0x5A11, RC_IMPORT_ONE = 0x5A12, RC_EXPORT_ALL = 0x5A13, RC_IMPORT_ALL = 0x5A14, RC_ADD = 0x5A15;
    private static final long MAX_BYTES = 32L * 1024 * 1024;
    private static final String NAME_RE = "[A-Za-z0-9_.\\-]+";

    private static final Handler ui = new Handler(Looper.getMainLooper());
    private static final Set<String> HIDDEN = new HashSet<String>(Arrays.asList("crash_java.txt", "ad_debug.txt"));
    private static AlertDialog panel = null;
    private static String pendingName = null;

    /* ------------------------------------------------------------ ファイル操作 */
    private static boolean okName(String n) {
        return n != null && n.matches(NAME_RE) && n.charAt(0) != '.' && !HIDDEN.contains(n) && !n.endsWith(".importing");
    }

    private static List<File> listFiles(Activity act) {
        List<File> out = new ArrayList<File>();
        File[] fs = act.getFilesDir().listFiles();
        if (fs == null) return out;
        for (File f : fs) if (f.isFile() && okName(f.getName())) out.add(f);
        java.util.Collections.sort(out, new Comparator<File>() {
            public int compare(File a, File b) { return a.getName().compareTo(b.getName()); }
        });
        return out;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[16384]; int n; long total = 0;
        try {
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) throw new IOException("ファイルが大きすぎます");
                bo.write(buf, 0, n);
            }
        } finally { in.close(); }
        return bo.toByteArray();
    }
    private static byte[] readFile(File f) throws IOException { return readAll(new FileInputStream(f)); }
    private static byte[] readUri(Activity act, Uri u) throws IOException {
        InputStream in = act.getContentResolver().openInputStream(u);
        if (in == null) throw new IOException("ファイルを開けません");
        return readAll(in);
    }
    private static void writeUri(Activity act, Uri u, byte[] data) throws IOException {
        OutputStream os = act.getContentResolver().openOutputStream(u, "wt");
        if (os == null) throw new IOException("書き込み先を開けません");
        try { os.write(data); os.flush(); } finally { os.close(); }
    }

    /** 保存フォルダへ書く。一度別名で書いてから差し替える。元の内容は .bak に退避。 */
    private static void importBytes(Activity act, String name, byte[] data) throws IOException {
        if (!okName(name)) throw new IOException("使えないファイル名: " + name);
        File dir = act.getFilesDir();
        File dst = new File(dir, name), tmp = new File(dir, name + ".importing");
        FileOutputStream fo = new FileOutputStream(tmp);
        try { fo.write(data); fo.getFD().sync(); } finally { fo.close(); }
        if (dst.exists() && !name.endsWith(".bak")) {
            byte[] old = readFile(dst);
            FileOutputStream bo = new FileOutputStream(new File(dir, name + ".bak"));
            try { bo.write(old); bo.getFD().sync(); } finally { bo.close(); }
        }
        if (!tmp.renameTo(dst)) {
            dst.delete();
            if (!tmp.renameTo(dst)) { tmp.delete(); throw new IOException("差し替えに失敗: " + name); }
        }
        Log.i(TAG, "import " + name + " " + data.length + "B");
    }

    private static String displayName(Activity act, Uri u) {
        Cursor c = null;
        try {
            c = act.getContentResolver().query(u, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null);
            if (c != null && c.moveToFirst()) { String s = c.getString(0); if (s != null) return s; }
        } catch (Throwable t) { /* 下のフォールバックへ */ }
        finally { if (c != null) c.close(); }
        String s = u.getLastPathSegment();
        if (s == null) return "";
        int i = s.lastIndexOf('/');
        return i >= 0 ? s.substring(i + 1) : s;
    }

    private static String mimeFor(String name) {
        String n = name.toLowerCase(Locale.US);
        if (n.endsWith(".txt")) return "text/plain";
        if (n.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private static String stamp(String pattern, boolean utc) {
        SimpleDateFormat f = new SimpleDateFormat(pattern, Locale.US);
        if (utc) f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    /* ------------------------------------------------------------ 画面 */
    private static void toast(Activity act, String s) { Toast.makeText(act, s, Toast.LENGTH_LONG).show(); }
    private static int dp(Activity act, int v) { return (int) (v * act.getResources().getDisplayMetrics().density + 0.5f); }

    private static TextView label(Activity act, String s, int sp, int color) {
        TextView t = new TextView(act); t.setText(s); t.setTextSize(sp); t.setTextColor(color); return t;
    }
    private static Button button(Activity act, String s, View.OnClickListener l) {
        Button b = new Button(act); b.setText(s); b.setAllCaps(false); b.setTextSize(13); b.setOnClickListener(l); return b;
    }

    public static void showPanel(final Activity act) {
        if (panel != null && panel.isShowing()) return;
        LinearLayout root = new LinearLayout(act);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(act, 14), dp(act, 12), dp(act, 14), dp(act, 6));
        root.setBackgroundColor(0xFF1A212B);

        root.addView(label(act, "セーブデータのバックアップ", 18, Color.WHITE));
        root.addView(label(act, "書き出し・読み込みのあとは、アプリを一度終了して開き直してください。", 12, 0xFF93A1B3));

        root.addView(button(act, "全部まとめて書き出し", new View.OnClickListener() { public void onClick(View v) { startExportAll(act); } }));
        root.addView(button(act, "全部まとめて読み込み", new View.OnClickListener() { public void onClick(View v) { startPick(act, RC_IMPORT_ALL, false); } }));
        root.addView(button(act, "ファイルを選んで追加(ファイル名のまま)", new View.OnClickListener() { public void onClick(View v) { startPick(act, RC_ADD, true); } }));

        TextView head = label(act, "個別ファイル", 13, 0xFF93A1B3);
        head.setPadding(0, dp(act, 12), 0, dp(act, 2));
        root.addView(head);

        List<File> files = listFiles(act);
        if (files.isEmpty()) root.addView(label(act, "ファイルはまだありません", 13, Color.WHITE));
        SimpleDateFormat df = new SimpleDateFormat("MM/dd HH:mm", Locale.US);
        for (final File f : files) {
            LinearLayout row = new LinearLayout(act);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            TextView t = label(act, f.getName() + "\n" + f.length() + "B  " + df.format(new Date(f.lastModified())), 12, Color.WHITE);
            row.addView(t, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            final String name = f.getName();
            row.addView(button(act, "書き出し", new View.OnClickListener() { public void onClick(View v) { startExportOne(act, name); } }));
            row.addView(button(act, "読み込み", new View.OnClickListener() { public void onClick(View v) { pendingName = name; startPick(act, RC_IMPORT_ONE, false); } }));
            root.addView(row);
        }

        ScrollView sv = new ScrollView(act);
        sv.addView(root);
        panel = new AlertDialog.Builder(act).setView(sv).setNegativeButton("閉じる", null).create();
        panel.show();
    }

    private static void closePanel() {
        try { if (panel != null) panel.dismiss(); } catch (Throwable t) { /* 無視 */ }
        panel = null;
    }

    /* ------------------------------------------------------------ SAF の呼び出し */
    private static void startExportOne(Activity act, String name) {
        try {
            if (!okName(name) || !new File(act.getFilesDir(), name).isFile()) { toast(act, name + " がありません"); return; }
            pendingName = name;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(mimeFor(name));
            i.putExtra(Intent.EXTRA_TITLE, name);
            closePanel();
            act.startActivityForResult(i, RC_EXPORT_ONE);
        } catch (Throwable t) { toast(act, "書き出しを開始できません: " + t.getMessage()); }
    }
    private static void startExportAll(Activity act) {
        try {
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, act.getPackageName() + "_backup_" + stamp("yyyyMMdd_HHmmss", false) + ".json");
            closePanel();
            act.startActivityForResult(i, RC_EXPORT_ALL);
        } catch (Throwable t) { toast(act, "書き出しを開始できません: " + t.getMessage()); }
    }
    private static void startPick(Activity act, int rc, boolean multiple) {
        try {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            if (multiple) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            closePanel();
            act.startActivityForResult(i, rc);
        } catch (Throwable t) { toast(act, "ファイル選択を開始できません: " + t.getMessage()); }
    }

    /* ------------------------------------------------------------ 結果の受け取り(HspActivity.onActivityResult から) */
    public static boolean onResult(final Activity act, int rc, int res, Intent data) {
        if (rc < RC_EXPORT_ONE || rc > RC_ADD) return false;
        if (res != Activity.RESULT_OK || data == null) { showPanel(act); return true; }
        try {
            if (rc == RC_EXPORT_ONE) {
                String name = pendingName; pendingName = null;
                if (name == null || !okName(name)) throw new IOException("対象ファイルが不明です");
                byte[] b = readFile(new File(act.getFilesDir(), name));
                writeUri(act, data.getData(), b);
                toast(act, name + " を書き出しました (" + b.length + "B)");
                showPanel(act);
            } else if (rc == RC_EXPORT_ALL) {
                JSONObject files = new JSONObject();
                int n = 0;
                for (File f : listFiles(act)) { files.put(f.getName(), Base64.encodeToString(readFile(f), Base64.NO_WRAP)); n++; }
                JSONObject o = new JSONObject();
                o.put("format", "hsp-web-save"); o.put("version", 1); o.put("saveDir", "android");
                o.put("created", stamp("yyyy-MM-dd'T'HH:mm:ss'Z'", true)); o.put("files", files);
                writeUri(act, data.getData(), o.toString().getBytes("UTF-8"));
                toast(act, n + "ファイルを書き出しました");
                showPanel(act);
            } else if (rc == RC_IMPORT_ONE) {
                final String name = pendingName; pendingName = null;
                final Uri u = data.getData();
                if (name == null || !okName(name)) throw new IOException("対象ファイルが不明です");
                final byte[] b = readUri(act, u);
                confirm(act, name + " を「" + displayName(act, u) + "」の内容で上書きします。\n今の内容は " + name + ".bak に残ります。", new Runnable() {
                    public void run() {
                        try { importBytes(act, name, b); toast(act, name + " を読み込みました。アプリを開き直してください"); }
                        catch (Throwable t) { toast(act, "読み込み失敗: " + t.getMessage()); }
                        showPanel(act);
                    }
                });
            } else if (rc == RC_IMPORT_ALL) {
                final byte[] raw = readUri(act, data.getData());
                final JSONObject o = new JSONObject(new String(raw, "UTF-8"));
                if (!"hsp-web-save".equals(o.optString("format")) || o.optJSONObject("files") == null) throw new IOException("バックアップファイルの形式が違います");
                final JSONObject files = o.getJSONObject("files");
                int total = 0;
                for (Iterator<String> it = files.keys(); it.hasNext(); ) if (okName(it.next())) total++;
                confirm(act, "バックアップの " + total + " ファイルを読み込みます。\n同じ名前のファイルは上書きされます(元の内容は .bak に残ります)。", new Runnable() {
                    public void run() {
                        int done = 0, fail = 0;
                        for (Iterator<String> it = files.keys(); it.hasNext(); ) {
                            String k = it.next();
                            if (!okName(k)) continue;
                            try { importBytes(act, k, Base64.decode(files.getString(k), Base64.DEFAULT)); done++; }
                            catch (Throwable t) { fail++; Log.w(TAG, "import fail " + k + ": " + t); }
                        }
                        toast(act, done + "ファイルを読み込みました" + (fail > 0 ? "(失敗 " + fail + ")" : "") + "。アプリを開き直してください");
                        showPanel(act);
                    }
                });
            } else if (rc == RC_ADD) {
                final List<Uri> uris = new ArrayList<Uri>();
                ClipData cd = data.getClipData();
                if (cd != null) { for (int i = 0; i < cd.getItemCount(); i++) uris.add(cd.getItemAt(i).getUri()); }
                else if (data.getData() != null) uris.add(data.getData());
                final List<Uri> okUris = new ArrayList<Uri>();
                final List<String> okNames = new ArrayList<String>(), over = new ArrayList<String>(), bad = new ArrayList<String>();
                for (Uri u : uris) {
                    String nm = displayName(act, u);
                    if (!okName(nm)) { bad.add(nm); continue; }
                    okUris.add(u); okNames.add(nm);
                    if (new File(act.getFilesDir(), nm).exists()) over.add(nm);
                }
                if (!bad.isEmpty()) toast(act, "名前が使えないので飛ばします(英数字・_・-・. のみ): " + join(bad));
                if (okUris.isEmpty()) { showPanel(act); return true; }
                Runnable go = new Runnable() {
                    public void run() {
                        int done = 0, fail = 0;
                        for (int i = 0; i < okUris.size(); i++) {
                            try { importBytes(act, okNames.get(i), readUri(act, okUris.get(i))); done++; }
                            catch (Throwable t) { fail++; Log.w(TAG, "add fail " + okNames.get(i) + ": " + t); }
                        }
                        toast(act, done + "ファイルを追加しました" + (fail > 0 ? "(失敗 " + fail + ")" : "") + "。アプリを開き直してください");
                        showPanel(act);
                    }
                };
                if (over.isEmpty()) go.run();
                else confirm(act, "同じ名前のファイルがあります。上書きします(元の内容は .bak に残ります):\n" + join(over), go);
            }
        } catch (Throwable t) {
            Log.w(TAG, "onResult " + rc + ": " + t);
            toast(act, "失敗: " + t.getMessage());
            showPanel(act);
        }
        return true;
    }

    private static String join(List<String> l) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < l.size(); i++) { if (i > 0) sb.append(", "); sb.append(l.get(i)); }
        return sb.toString();
    }

    private static void confirm(final Activity act, String msg, final Runnable yes) {
        new AlertDialog.Builder(act).setMessage(msg).setCancelable(false)
            .setPositiveButton("はい", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface d, int w) { yes.run(); }
            })
            .setNegativeButton("やめる", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface d, int w) { showPanel(act); }
            }).show();
    }
}
