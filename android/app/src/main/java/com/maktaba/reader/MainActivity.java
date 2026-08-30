package com.maktaba.reader;

import android.view.KeyEvent;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(MkReaderPlugin.class);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // أزرار الصوت تقلب الصفحات أثناء القراءة فقط (راية يضبطها البلجن من الويب)
        if (MkReaderPlugin.volumeKeysEnabled && event.getAction() == KeyEvent.ACTION_DOWN) {
            int code = event.getKeyCode();
            if (code == KeyEvent.KEYCODE_VOLUME_UP || code == KeyEvent.KEYCODE_VOLUME_DOWN) {
                WebView wv = bridge != null ? bridge.getWebView() : null;
                if (wv != null) {
                    String dir = code == KeyEvent.KEYCODE_VOLUME_UP ? "up" : "down";
                    wv.evaluateJavascript(
                        "window.__mkVolumeKey&&window.__mkVolumeKey('" + dir + "')", null);
                    return true;
                }
            }
        }
        return super.dispatchKeyEvent(event);
    }
}
