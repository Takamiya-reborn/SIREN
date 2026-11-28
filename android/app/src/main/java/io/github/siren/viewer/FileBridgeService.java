package io.github.siren.viewer;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/**
 * Shizuku UserService 实现：实例以 shell uid 运行（Shizuku 管理），与 adb 同权，
 * 可读游戏私有目录。经 IFileBridge AIDL 暴露给主进程。
 */
public class FileBridgeService extends IFileBridge.Stub {
    /** 接口版本：APK 更新后 Shizuku 按版本号重启服务（UserServiceArgs.version 对齐） */
    public static final int VERSION = 1;

    private final Context context;

    // Shizuku 反射实例化的标准构造（带 shell 上下文）；无参构造兜底
    public FileBridgeService(Context context) {
        this.context = context;
    }

    public FileBridgeService() {
        this.context = null;
    }

    @Override
    public BridgeEntry[] listFiles(String path) {
        File dir = new File(path);
        File[] files = dir.listFiles();
        if (files == null)
            throw new IllegalStateException("listFiles 失败: " + path);
        ArrayList<BridgeEntry> out = new ArrayList<>();
        for (File f : files)
            out.add(new BridgeEntry(f.getName(), f.length(), f.isFile()));
        return out.toArray(new BridgeEntry[0]);
    }

    @Override
    public long sizeOf(String path) {
        return new File(path).length();
    }

    @Override
    public byte[] readChunk(String path, long offset, int length) {
        RandomAccessFile raf;
        try {
            raf = new RandomAccessFile(path, "r");
        } catch (IOException e) {
            throw new IllegalStateException("打开失败: " + path, e);
        }
        try {
            raf.seek(offset);
            byte[] buf = new byte[length];
            int read = raf.read(buf);
            if (read < 0) return new byte[0];
            if (read == buf.length) return buf;
            byte[] out = new byte[read];
            System.arraycopy(buf, 0, out, 0, read);
            return out;
        } catch (IOException e) {
            throw new IllegalStateException("读取失败: " + path, e);
        } finally {
            try {
                raf.close();
            } catch (IOException ignored) {
                // 关闭失败不影响读取结果
            }
        }
    }

    @Override
    public String readText(String path) {
        RandomAccessFile raf;
        try {
            raf = new RandomAccessFile(path, "r");
        } catch (IOException e) {
            throw new IllegalStateException("打开失败: " + path, e);
        }
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            for (int read; (read = raf.read(buf)) > 0; ) {
                out.write(buf, 0, read);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("读取失败: " + path, e);
        } finally {
            try {
                raf.close();
            } catch (IOException ignored) {
                // 关闭失败不影响读取结果
            }
        }
    }

    @Override
    public void exit() {
        System.exit(0);
    }
}
