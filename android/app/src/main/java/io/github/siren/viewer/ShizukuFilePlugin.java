package io.github.siren.viewer;

import android.content.ComponentName;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.IBinder;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import rikka.shizuku.Shizuku;
import rikka.shizuku.Shizuku.UserServiceArgs;

/**
 * Shizuku 文件桥插件：JS 经 status/requestAccess/listBundles/readChunk/readText
 * 消费 shell uid 下的 FileBridgeService。桥未就绪的调用进 pending 队列，
 * 授权/绑定完成后统一放行；binder 死亡时清桥重绑，拒绝授权时整体回收。
 */
@CapacitorPlugin(name = "ShizukuFile")
public class ShizukuFilePlugin extends Plugin {

    private IFileBridge bridge;
    private final List<PendingOp> pending = new ArrayList<>();
    private final List<PluginCall> accessCalls = new ArrayList<>();
    private final AtomicInteger requestSeq = new AtomicInteger(7000);
    private boolean binding;

    private static final class PendingOp {
        final PluginCall call;
        final BridgeTask task;

        PendingOp(PluginCall call, BridgeTask task) {
            this.call = call;
            this.task = task;
        }
    }

    private interface BridgeTask {
        void run(IFileBridge bridge) throws Exception;
    }

    @Override
    public void load() {
        // 临时诊断：Capacitor 吞掉 load 抛出的异常，这里抓根因进日志
        try {
            loadShizukuListeners();
        } catch (Throwable t) {
            android.util.Log.e("SIREN-DBG", "插件 load 失败根因", t);
            throw t instanceof RuntimeException ? (RuntimeException) t : new RuntimeException(t);
        }
    }

    private void loadShizukuListeners() {
        // Shizuku binder 就绪（用户侧启动/重启 Shizuku）后补跑绑定；binder 死亡清桥重绑
        Shizuku.addBinderReceivedListenerSticky(this::ensureBridge);
        Shizuku.addBinderDeadListener(() -> {
            bridge = null;
            binding = false;
        });
        // 授权结果：放行重试绑定，拒绝则整体回收
        Shizuku.addRequestPermissionResultListener((requestCode, grantResult) -> {
            if (grantResult == PackageManager.PERMISSION_GRANTED) {
                ensureBridge();
            } else {
                drainAccess("permission-denied");
                drainPending("permission-denied");
            }
        });
    }

    // ---------------------------------------------------------------- JS 接口

    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        boolean installed = Shizuku.pingBinder();
        out.put("installed", installed);
        out.put("granted", installed && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED);
        out.put("version", installed ? Shizuku.getVersion() : -1);
        call.resolve(out);
    }

    /** JS 诊断日志直进 logcat（SIREN tag）：桥日志关闭（loggingBehavior none）后
     * console 不再转发，诊断走这条不依赖 Capacitor 日志链的通道 */
    @PluginMethod
    public void log(PluginCall call) {
        String level = call.getString("level", "info");
        String msg = call.getString("msg", "");
        if ("error".equals(level)) {
            android.util.Log.e("SIREN", msg);
        } else if ("warn".equals(level)) {
            android.util.Log.w("SIREN", msg);
        } else {
            android.util.Log.i("SIREN", msg);
        }
        call.resolve();
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (!Shizuku.pingBinder()) {
            call.reject("shizuku-unavailable");
            return;
        }
        if (Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) {
            ensureBridge();
            JSObject out = new JSObject();
            out.put("granted", true);
            call.resolve(out);
            return;
        }
        accessCalls.add(call);
        Shizuku.requestPermission(requestSeq.getAndIncrement());
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("missing-path");
            return;
        }
        withBridge(call, (bridge) -> {
            BridgeEntry[] entries = bridge.listFiles(path);
            JSArray arr = new JSArray();
            for (BridgeEntry e : entries) {
                JSObject o = new JSObject();
                o.put("name", e.name);
                o.put("size", e.size);
                o.put("isFile", e.isFile);
                arr.put(o);
            }
            JSObject out = new JSObject();
            out.put("entries", arr);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void sizeOf(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("missing-path");
            return;
        }
        withBridge(call, (bridge) -> {
            JSObject out = new JSObject();
            out.put("size", bridge.sizeOf(path));
            call.resolve(out);
        });
    }

    @PluginMethod
    public void readChunk(PluginCall call) {
        String path = call.getString("path");
        // JS number 经桥反序列化是 Double/Long 不定，getLong/getInt 拿不到，统一走 Number 收窄
        Object offObj = call.getData().opt("offset");
        Object lenObj = call.getData().opt("length");
        if (path == null || !(offObj instanceof Number) || !(lenObj instanceof Number)) {
            // 临时诊断：带上实际收到的参数表定位桥序列化问题
            call.reject("missing-args", String.valueOf(call.getData()));
            return;
        }
        long offset = ((Number) offObj).longValue();
        int length = ((Number) lenObj).intValue();
        withBridge(call, (bridge) -> {
            byte[] chunk = bridge.readChunk(path, offset, length);
            JSObject out = new JSObject();
            // Capacitor 桥对 byte[] 出参无 ArrayBuffer 直传保证，统一 base64（P3b 探针再评估直传）
            out.put("base64", Base64.encodeToString(chunk, Base64.NO_WRAP));
            out.put("bytesRead", chunk.length);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void readText(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("missing-path");
            return;
        }
        withBridge(call, (bridge) -> {
            JSObject out = new JSObject();
            out.put("text", bridge.readText(path));
            call.resolve(out);
        });
    }

    // ---------------------------------------------------------------- 桥生命周期

    /** 桥就绪即执行；未就绪则入队并触发授权/绑定链，拒绝授权时统一回收 */
    private synchronized void withBridge(PluginCall call, BridgeTask task) {
        if (bridge != null) {
            try {
                task.run(bridge);
            } catch (Exception e) {
                call.reject("bridge-error", e.getMessage(), e);
            }
            return;
        }
        if (!Shizuku.pingBinder()) {
            call.reject("shizuku-unavailable");
            return;
        }
        if (Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) {
            // 授权通过后 ensureBridge -> flushPending 执行本调用；拒绝则 drainPending 统一回收
            pending.add(new PendingOp(call, task));
            Shizuku.requestPermission(requestSeq.getAndIncrement());
            return;
        }
        pending.add(new PendingOp(call, task));
        ensureBridge();
    }

    private synchronized void ensureBridge() {
        if (bridge != null || binding || !Shizuku.pingBinder()
            || Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) return;
        binding = true;
        UserServiceArgs args = new UserServiceArgs(
            new ComponentName(getContext(), FileBridgeService.class))
            .processNameSuffix("shizuku")
            .version(FileBridgeService.VERSION)
            .debuggable(false);
        Shizuku.bindUserService(args, new ServiceConnection() {
            @Override
            public void onServiceConnected(ComponentName name, IBinder binder) {
                binding = false;
                bridge = IFileBridge.Stub.asInterface(binder);
                flushPending(null);
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                binding = false;
                bridge = null;
            }
        });
    }

    private synchronized void flushPending(String error) {
        List<PendingOp> now = new ArrayList<>(pending);
        pending.clear();
        for (PendingOp op : now) {
            if (error != null) {
                op.call.reject(error);
                continue;
            }
            try {
                op.task.run(bridge);
            } catch (Exception e) {
                op.call.reject("bridge-error", e.getMessage(), e);
            }
        }
    }

    private synchronized void drainAccess(String error) {
        List<PluginCall> now = new ArrayList<>(accessCalls);
        accessCalls.clear();
        for (PluginCall c : now) c.reject(error);
    }

    private synchronized void drainPending(String error) {
        flushPending(error);
    }

    @Override
    protected void handleOnDestroy() {
        // 授权/桥队列里的调用随页面销毁释放
        drainAccess("page-destroyed");
        drainPending("page-destroyed");
        super.handleOnDestroy();
    }
}
