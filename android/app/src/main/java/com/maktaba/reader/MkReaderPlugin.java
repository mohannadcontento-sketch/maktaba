package com.maktaba.reader;

import android.view.View;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * بلجن مكتبة الأصلي — تحكم جوال على طريقة Moon+ Reader:
 * 1) أزرار الصوت تقلب الصفحات (تُعترض هنا وتُرسل للويب عبر __mkVolumeKey)
 * 2) إبقاء الشاشة مضاءة أثناء القراءة
 * 3) ملء الشاشة (إخفاء أشرطة النظام) في الوضع الصافي
 */
@CapacitorPlugin(name = "MkReader")
public class MkReaderPlugin extends Plugin {
    /** راية اعتراض أزرار الصوت — يقرأها MainActivity مباشرة (تزامن بسيط مقبول) */
    static volatile boolean volumeKeysEnabled = false;

    @PluginMethod
    public void setVolumeKeys(PluginCall call) {
        volumeKeysEnabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        call.resolve();
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                if (on) {
                    getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void setImmersive(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        if (getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                View decor = getActivity().getWindow().getDecorView();
                if (on) {
                    decor.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
                } else {
                    decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
                }
            });
        }
        call.resolve();
    }
}
