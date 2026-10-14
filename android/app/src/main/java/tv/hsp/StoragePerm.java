package tv.hsp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

/**
 * 共有ストレージ版(apk専用)用: 「すべてのファイルへのアクセス」の許可をお願いする。
 * AndroidManifest.xml に MANAGE_EXTERNAL_STORAGE が入っているビルド(CIの allFilesAccess)でだけ動く。
 * 入っていないビルド(aab / 通常のapk)では何もしない。
 */
public class StoragePerm {
    private static final String TAG = "HSPSTORAGE";
    private static final String PERM = "android.permission.MANAGE_EXTERNAL_STORAGE";
    private static boolean asked = false;

    private static boolean declared(Activity act) {
        try {
            PackageInfo pi = act.getPackageManager().getPackageInfo(act.getPackageName(), PackageManager.GET_PERMISSIONS);
            if (pi.requestedPermissions != null) {
                for (String p : pi.requestedPermissions) if (PERM.equals(p)) return true;
            }
        } catch (Throwable t) { Log.w(TAG, "declared: " + t); }
        return false;
    }

    /** 起動時: 許可されていなければ、設定画面へ案内するダイアログを出す(起動ごとに1回) */
    public static void check(final Activity act) {
        if (Build.VERSION.SDK_INT < 30 || asked || !declared(act)) return;
        if (Environment.isExternalStorageManager()) return;
        asked = true;
        new AlertDialog.Builder(act)
            .setTitle("ストレージへのアクセス")
            .setMessage("共有ストレージのデータ(/storage/emulated/0/ 以下)を読み書きするため、「すべてのファイルへのアクセス」の許可が必要です。\n\n次の画面でこのアプリをオンにして、戻ったあと、アプリを開き直してください。")
            .setCancelable(false)
            .setPositiveButton("設定を開く", new DialogInterface.OnClickListener() {
                public void onClick(DialogInterface d, int w) { openSettings(act); }
            })
            .setNegativeButton("あとで", null)
            .show();
    }

    private static void openSettings(Activity act) {
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + act.getPackageName()));
            act.startActivity(i);
        } catch (Throwable t) {
            try { act.startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)); }
            catch (Throwable t2) { Toast.makeText(act, "設定画面を開けません: " + t2.getMessage(), Toast.LENGTH_LONG).show(); }
        }
    }

    /** 設定画面から戻ってきたとき: 許可されていれば知らせる */
    public static void onResume(Activity act) {
        if (!asked || Build.VERSION.SDK_INT < 30) return;
        if (Environment.isExternalStorageManager()) {
            asked = false;
            Toast.makeText(act, "許可されました。アプリを開き直してください", Toast.LENGTH_LONG).show();
        }
    }
}
