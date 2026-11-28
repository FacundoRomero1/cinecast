package com.cinecast.app;

import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    private boolean isLandscapeLocked = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Interceptar botón físico / gesto Atrás de Android para navegar dentro de CineCast en vez de cerrar la app
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().evaluateJavascript(
                        "(function(){ return typeof window.__cinecastHandleBack === 'function' ? Boolean(window.__cinecastHandleBack()) : false; })()",
                        value -> {
                            if (!"true".equals(value)) {
                                moveTaskToBack(true);
                            }
                        }
                    );
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }

    @Override
    public void onStart() {
        super.onStart();
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView wv = this.bridge.getWebView();
            WebSettings settings = wv.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setDomStorageEnabled(true);
            settings.setSupportMultipleWindows(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            wv.addJavascriptInterface(new AndroidBridge(), "CineCastAndroid");

            // Bloquear popups, intent:// (Shein, Play Store, casinos) y redirecciones externas desde iframes
            wv.setWebViewClient(new BridgeWebViewClient(this.bridge) {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (request != null && request.getUrl() != null) {
                        String scheme = request.getUrl().getScheme();
                        String host = request.getUrl().getHost();
                        if (scheme != null && !scheme.equalsIgnoreCase("http") && !scheme.equalsIgnoreCase("https")) {
                            // Bloquear intent://, market://, shein://, etc.
                            return true;
                        }
                        if (request.isForMainFrame() && host != null && !host.equalsIgnoreCase("localhost") && !host.equalsIgnoreCase("127.0.0.1")) {
                            // Nunca permitir que un anuncio saque el frame principal de CineCast
                            return true;
                        }
                    }
                    return super.shouldOverrideUrlLoading(view, request);
                }
            });
            if (BuildConfig.IS_TV) {
                wv.evaluateJavascript("window.__cinecastTvMode = true;", null);
            }
        }
    }

    private void setImmersiveMode(boolean enable) {
        runOnUiThread(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = getWindow().getInsetsController();
                if (controller != null) {
                    if (enable) {
                        controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                        controller.setSystemBarsBehavior(
                            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                        );
                    } else {
                        controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    }
                }
            } else {
                View decor = getWindow().getDecorView();
                if (enable) {
                    decor.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    );
                } else {
                    decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
                }
            }
        });
    }

    private class AndroidBridge {
        @JavascriptInterface
        public void enterPlayerLandscape() {
            if (BuildConfig.IS_TV) return;
            runOnUiThread(() -> {
                isLandscapeLocked = true;
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                setImmersiveMode(true);
            });
        }

        @JavascriptInterface
        public void exitPlayerFullscreen() {
            if (BuildConfig.IS_TV) return;
            runOnUiThread(() -> {
                isLandscapeLocked = false;
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                setImmersiveMode(false);
            });
        }

        @JavascriptInterface
        public void toggleOrientation() {
            if (BuildConfig.IS_TV) return;
            runOnUiThread(() -> {
                if (isLandscapeLocked) {
                    isLandscapeLocked = false;
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
                } else {
                    isLandscapeLocked = true;
                    setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                }
            });
        }

        @JavascriptInterface
        public void minimizeApp() {
            runOnUiThread(() -> moveTaskToBack(true));
        }
    }
}
