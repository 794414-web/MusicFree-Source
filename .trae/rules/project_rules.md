# 项目规则

## 版本号管理（重要）
每次准备推送双仓（Gitee + GitHub）发布更新时，**必须先递增版本号**，否则用户端无法检测到更新、无法下载新包。

- 采用语义化版本 `主.次.修订`，普通修复递增修订号（如 2.1.0 → 2.1.1）。
- 版本号必须在以下 4 处保持一致，一处不落：
  1. `package.json` 的 `version`
  2. `package-lock.json` 顶层 `version` 与 `packages[""].version`
  3. `release/version.json` 的 `version`、`changeLog`、`download`（下载链接里的 tag 和文件名都要同步改）
  4. `changelog.md` 顶部新增一条对应版本记录
- Android 的 `versionName`/`versionCode` 由 `android/app/build.gradle` 从 `package.json` 自动读取并派生，无需手改。
- 完成版本号递增后再 commit、push 双仓、打包 APK。

## 构建与验证
- 打包 Debug APK：在 `android/` 目录运行 `.\gradlew assembleDebug`，产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。
- 插件相关改动后，需同步升级 `src/entry/bootstrap/bootstrap.ts` 的 `BUILTIN_PLUGINS_VERSION`，以触发用户端插件重装。
- 提交前跑：`npm run typecheck`、`npx jest plugins/__tests__/`。

## 推送
- 双仓远端：`origin`（GitHub 794414-web）、`gitee`（ken794414）。
- 两个仓库都要推，保持同步。
