package io.github.siren.viewer;

import io.github.siren.viewer.BridgeEntry;

/**
 * Shizuku UserService 文件桥：跑在 shell uid（=adb 同权）进程里，
 * 读游戏私有目录（/sdcard/Android/data/<游戏包>/files/）的目录树与文件字节。
 * 大文件经 readChunk 分块拉回，JS 侧拼装。
 */
interface IFileBridge {
    /** 列目录（name/size/isFile 一次拿全）；失败抛 IllegalStateException */
    BridgeEntry[] listFiles(String path);

    /** 文件大小（拉取进度与断点判断用） */
    long sizeOf(String path);

    /** 读 [offset, offset+length) 字节块；返回不足 length 表示到文件尾 */
    byte[] readChunk(String path, long offset, int length);

    /** 整读 UTF-8 文本（hashes.csv 等索引文件，单文件几 MB 内） */
    String readText(String path);

    /** 结束 UserService 进程（Shizuku 管理） */
    void exit();
}
