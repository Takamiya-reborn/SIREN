package io.github.siren.viewer;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 临时诊断：手动复现 Capacitor 的反射实例化，把被吞的根因打进日志
        try {
            Object o = ShizukuFilePlugin.class.getDeclaredConstructor().newInstance();
            android.util.Log.i("SIREN-DBG", "插件实例化成功: " + o);
        } catch (Throwable t) {
            android.util.Log.e("SIREN-DBG", "插件实例化失败根因", t);
        }
        registerPlugin(ShizukuFilePlugin.class);
        super.onCreate(savedInstanceState);
        // 沉浸式全屏：隐藏状态栏/导航条（下拉/上滑短暂唤出，松手自动回落）——
        // 横版全屏体验，常驻系统条挡 UI 且下拉菜单不自动收起
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
            new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
