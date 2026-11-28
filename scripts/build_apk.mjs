// APK 一键构建：vite build -> cap sync -> gradle assembleDebug -> 产物复制到 android/SIREN.apk。
//
// 用法:
//     node scripts/build_apk.mjs [--release] [--skip-web]
//
// 选项:
//     --release    构建未签名 release 包（默认 debug，可直接 adb install）
//     --skip-web   跳过 vite build / cap sync，只跑 gradle（web 产物未变时省时）
//
// 环境要点（详见 android/README.md「构建链路」一节）:
//     JAVA_HOME        缺省时自动探测 JDK 21 安装目录（D:/Android/openjdk/jdk-21/*，
//                      Capacitor 8 的 AGP 工具链要求 languageVersion 21）
//     sdk.dir          优先读 android/local.properties；properties 格式反斜杠是转义符，
//                      sdk.dir 必须写正斜杠
//     GRADLE_USER_HOME 缺省 <repo>/.tmp/gradle-home（构建会话缓存区，gitignore）
//     依赖下载代理     自行设 JAVA_TOOL_OPTIONS（-Dhttps.proxyHost/-Dhttps.proxyPort，
//                      端口按本机实际探测，会漂移）；gradle 卡下载时可 ./gradlew --stop
//                      后清 GRADLE_USER_HOME/caches 整目录重建

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidDir = path.join(root, "android");
const args = process.argv.slice(2);
const release = args.includes("--release");
const skipWeb = args.includes("--skip-web");
const task = release ? "assembleRelease" : "assembleDebug";

const die = (msg) => {
  console.error(`[apk] ${msg}`);
  process.exit(1);
};
const run = (cmd, cmdArgs, opts = {}) => {
  console.log(`[apk] > ${cmd} ${cmdArgs.join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0)
    die(
      `${cmd} 退出码 ${r.status}——环境排障对照 android/README.md「构建链路」`,
    );
};

// JAVA_HOME：env 优先，缺省探测本机 JDK 21（README 记录的安装目录）
let javaHome = process.env.JAVA_HOME;
if (!javaHome) {
  const base = "D:/Android/openjdk/jdk-21";
  try {
    const hit = fs
      .readdirSync(base)
      .map((n) => path.join(base, n))
      .find(
        (p) =>
          fs.existsSync(path.join(p, "bin", "java.exe")) ||
          fs.existsSync(path.join(p, "bin", "java")),
      );
    javaHome = hit;
  } catch {
    // 目录不存在，交给下方校验报错
  }
}
if (!javaHome || !fs.existsSync(javaHome))
  die(
    "未找到 JDK 21：设 JAVA_HOME 指向 JDK 21 根目录（Capacitor 8 工具链要求 languageVersion 21）",
  );
process.env.JAVA_HOME = javaHome;
console.log(`[apk] JAVA_HOME=${javaHome}`);

// sdk.dir：android/local.properties 必须存在且用正斜杠（properties 反斜杠是转义符）
const localProps = path.join(androidDir, "local.properties");
if (!fs.existsSync(localProps))
  die(
    `缺 ${localProps}：写入 sdk.dir=<Android SDK 根目录>（路径必须正斜杠，如 D:/Android/android-sdk）`,
  );
const sdkDir = fs
  .readFileSync(localProps, "utf8")
  .match(/^sdk\.dir=(.+)$/m)?.[1]
  ?.trim();
if (!sdkDir) die(`${localProps} 缺 sdk.dir= 行（路径必须正斜杠）`);
console.log(`[apk] sdk.dir=${sdkDir}`);

// 构建会话缓存：GRADLE_USER_HOME 缺省落 .tmp/gradle-home（README 约定）
process.env.GRADLE_USER_HOME ??=
  process.env.SIREN_GRADLE_HOME ?? path.join(root, ".tmp", "gradle-home");

// lua 随包基线（public/lua/，gitignore，不入库）：社区明文脚本（AzurLaneLuaScripts），
// 运行时 l2d.json 烘焙的零网络数据源。优先复制本地 .tmp/lua/CN 快照（主仓库检出），
// 缺失时 curl 拉社区仓库（HTTPS_PROXY 环境变量生效）。拉不到仅告警不阻断（运行时降级）
const LUA_FILES = [
  ["sharecfg/ship_l2d.lua", "ship_l2d.lua"],
  ["sharecfgdata/ship_skin_template.lua", "ship_skin_template.lua"],
  ["sharecfg/ship_skin_newmainui_shift.lua", "ship_skin_newmainui_shift.lua"],
];
const provisionLua = () => {
  const outDir = path.join(root, "public", "lua");
  fs.mkdirSync(outDir, { recursive: true });
  const snapshotRoots = [
    path.join(root, ".tmp", "lua", "CN"),
    "D:/Github/SIREN/.tmp/lua/CN", // 主分支检出（mobile 工作树常无 .tmp/lua）
  ];
  const repoUrl = (rel) =>
    `https://cdn.jsdelivr.net/gh/AzurLaneTools/AzurLaneLuaScripts@main/${rel}`;
  for (const [rel, name] of LUA_FILES) {
    const dest = path.join(outDir, name);
    if (fs.existsSync(dest)) continue;
    const localHit = snapshotRoots.map((r) => path.join(r, rel)).find((p) => fs.existsSync(p));
    if (localHit) {
      fs.copyFileSync(localHit, dest);
      console.log(`[apk] lua 随包: ${name} <- ${localHit}`);
    } else {
      const r = spawnSync("curl", ["-fsSL", "-o", dest, repoUrl(rel)], {
        shell: process.platform === "win32",
        stdio: "pipe",
      });
      if (r.status !== 0 || !fs.existsSync(dest)) {
        fs.rmSync(dest, { force: true });
        console.warn(`[apk] lua 随包失败: ${name}（本地快照与社区仓库均不可达，运行时降级）`);
      } else {
        console.log(`[apk] lua 随包: ${name} <- AzurLaneLuaScripts`);
      }
    }
  }
};

// 1) web 产物：vite build -> dist/；2) 拷进原生壳
if (!skipWeb) {
  provisionLua();
  run("npx", ["vite", "build"], { cwd: root });
  run("npx", ["cap", "sync", "android"], { cwd: root });
} else {
  console.log("[apk] --skip-web：跳过 vite build / cap sync");
}

// 3) gradle 打包（Windows 绝对路径调用：cmd /c 不把 cwd 计入 PATH，相对名找不到 gradlew.bat）
run(
  process.platform === "win32"
    ? path.join(androidDir, "gradlew.bat")
    : path.join(androidDir, "gradlew"),
  [task],
  { cwd: androidDir },
);

// 4) 产物提升到 android/ 根（固定名 SIREN.apk，覆盖旧包）
const versionName = fs
  .readFileSync(path.join(androidDir, "app", "build.gradle"), "utf8")
  .match(/versionName\s+"([^"]+)"/)?.[1];
const built = release
  ? path.join(androidDir, "app/build/outputs/apk/release/app-release.apk")
  : path.join(androidDir, "app/build/outputs/apk/debug/app-debug.apk");
if (!fs.existsSync(built)) die(`gradle 未产出 ${built}`);
const target = path.join(androidDir, "SIREN.apk");
fs.copyFileSync(built, target);
const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
console.log(
  `[apk] 完成: android/SIREN.apk（v${versionName ?? "?"}，${release ? "release 未签名" : "debug"}，${mb}MB）\n` +
    `[apk] 安装: adb install -r android/SIREN.apk`,
);
