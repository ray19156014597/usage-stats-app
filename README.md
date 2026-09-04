# DeepSeek 用量 — 独立桌面版（Tauri）

参照 [Joyi-code/DeepSeekMonitorWindows](https://github.com/Joyi-code/DeepSeekMonitorWindows)
的**软件工程路线**（Tauri 2 + Rust + React/WebView2 + NSIS 小包 + 托盘常驻），
但 **UI 与数据完全沿用 dsh-usage-stats 插件的方案**：
- UI：插件的 `client.js` 面板（统计条带、热力图、日下钻、最近 14 天、按 API Key、毛玻璃）原封不动；
- 数据：插件的 `platform.js` / `balance.js` 取数与聚合逻辑原样（选项 C：在 WebView 内运行，
  网络经 tauri-plugin-http 由 Rust 代发，域名白名单限于 api.deepseek.com / platform.deepseek.com）；
- 凭据：Rust 侧持有 `%APPDATA%\dsh-usage-stats-app\config.json`（与早期版本同路径，已迁移值直接可用）。

## 致谢 / Credits

- **工程路线**：参考 [Joyi-code/DeepSeekMonitorWindows](https://github.com/Joyi-code/DeepSeekMonitorWindows)
  （MIT）的 Tauri 2 软件化方式（Rust 壳、NSIS 小包、托盘常驻、WebView2 登录同步、单实例）；
- **UI 与数据**：来自 [dsh-usage-stats](https://github.com/ray19156014597/dsh-usage-stats)
  插件（其基座为 [Ychris12138/dsh-usage-stats](https://github.com/Ychris12138/dsh-usage-stats)，MIT）；
- **概念源头**：功能设计启发自 [JayHome137/DeepSeekMonitor](https://github.com/JayHome137/DeepSeekMonitor)
  （macOS 原创版）；
- **开发工具**：[OpenCLI](https://github.com/opencode-ai/opencli) 用于辅助探测与优化平台接口细节。

> 本软件**非 DeepSeek 官方产品**，仅用于学习与研究；平台接口可能随官方调整而变化，不保证长期可用。
> API Key 与用量 Token 属敏感凭据，请勿外传 `config.json`。

## 功能
- 托盘常驻（点击打开面板），窗口关闭 → 隐藏到托盘；不占任务栏；单实例
- **托盘悬停显示实时数据**：「今日 Tokens / 本月 ¥」由面板数据刷新时推送到 Rust 更新
- **开机自启**：托盘菜单复选框，持久化（`config.json` 的 `autostart`）
- 无边框沉浸窗口：面板头部即标题栏（拖拽移动 + 最小化/最大化/关闭），边缘缩放把手
- 置顶按钮（图钉，激活态品牌蓝）
- 登录同步：Rust 打开 WebView2 登录窗到 platform.deepseek.com，捕获 `localStorage.userToken` 自动保存
- 亮/暗主题跟随系统（插件主题层，真实 dsh token 值）

## 结构
```
src/
  renderer/
    index.html      页面壳（React UMD + client.js + module boot；无边框缩放把手）
    client.js       插件 bundle（应用副本，含置顶/无边框窗口按钮等应用侧扩展）
    platform.js     平台取数/聚合（插件副本，纯函数）
    balance.js      余额解析（插件副本，纯函数）
    dataLayer.js    路由层：把面板的 /api/usage-stats/* 请求在页面内消化（缓存 5 分钟）
    boot.js         fetch 拦截器 + Tauri 桥 + 词典捕获 + 面板渲染
    primitives.js   图标/提示垫片
    app.css         主题垫层 + 无边框窗口布局
src-tauri/
  src/lib.rs        托盘/单实例/配置/登录窗口/关闭即隐藏
  src/config.rs     config.json 读写
  tauri.conf.json   无边框窗口、NSIS、隐藏任务栏
  capabilities/     plugin-http（api.deepseek.com / platform.deepseek.com）+ 窗口权限
```

## 开发
```bash
npm install            # @tauri-apps/cli
npm run build-vendor   # 拷贝 React 18 UMD（仅维护 vendor 时）
npm run make-icon      # 生成图标（需要本机 Edge）
npm test               # 数据层冒烟（假 invoke + 假上游）
npm run dev            # Tauri 开发运行
npm run build          # NSIS 安装包（src-tauri/target/release/bundle/nsis/）
```

## 环境要求
- Windows 10/11 + WebView2 Runtime（Win11 内置）
- Rust MSVC 工具链（本项目 `rust-toolchain.toml` 固定为 x86_64-pc-windows-msvc）
- VS 2022 Build Tools（C++ 桌面组件）

## 配置
`%APPDATA%\dsh-usage-stats-app\config.json`（明文凭据；不要外传）
