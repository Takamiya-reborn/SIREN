package io.github.siren.viewer;

import android.os.Bundle;

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
    }
}
