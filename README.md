# DeepSeek 用量 — 独立桌面版（Tauri）

参照 [Joyi-code/DeepSeekMonitorWindows](https://github.com/Joyi-code/DeepSeekMonitorWindows)
的**软件工程路线**（Tauri 2 + Rust + React/WebView2 + NSIS 小包 + 托盘常驻），
但 **UI 与数据完全沿用 dsh-usage-stats 插件的方案**：
- UI：插件的 `client.js` 面板（统计条带、热力图、日下钻、最近 14 天、按 API Key、毛玻璃）**与插件同代**——
  玻璃材质阶梯、一屏分层折叠、语义化配色、日历键盘导航、无障碍播报、面板预热等改动全部继承；
- 数据：插件的 `platform.js` / `balance.js` 取数与聚合逻辑原样（选项 C：在 WebView 内运行，
  网络经 tauri-plugin-http 由 Rust 代发，域名白名单限于 api.deepseek.com / platform.deepseek.com）；
- 凭据：Rust 侧持有 `%APPDATA%\dsh-usage-stats-app\config.json`（与早期版本同路径，已迁移值直接可用）。

## 与插件版的差异（独立版专属）

`src/renderer/client.js` 是插件 `lib/client.js` 的副本，只在独立版需要的地方不同（代码内均以「独立版」注释标出）：

1. **标题栏控制**：置顶（图钉）/ 刷新 / 设置 / 最小化 / 最大化 / 关闭 —— 关闭 = 隐藏窗口到托盘；
2. **Esc 语义**：逐级返回后按 Esc 同样"隐藏窗口"，不会留下空白窗口；
3. **玻璃背后的"页面内容"**：插件浮在会话内容上、`blur(6px)` 糊的是页面；独立版背后没有页面，
   于是把**窗口后方的真实屏幕**抓进页面当内容层（见下节），面板配方完全不变；
4. **设置页「实时玻璃背景」开关**（滑块）+ 快捷键 `Ctrl+Alt+L` / 帧率诊断 `Ctrl+Alt+F`；
5. **最小化动效**：页面朝**左下角**收拢 180ms 后再最小化（系统原生最小化动画方向不可配）。

## 玻璃背景：抓屏 → 页面内容

插件里的读法是"面板浮在**会话内容**上，`backdrop-filter: blur(6px) saturate(1.9)` 糊它"。
独立版没有页面内容，就把**窗口后方的屏幕画面**抓进来当那层内容：

- Rust 侧（`src-tauri/src/lib.rs`）：GDI `BitBlt`/`StretchBlt` 抓取窗口所在屏幕区域（半分辨率后由页面拉伸），
  抓屏前用 `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` 把自己排除两帧、抓完立刻恢复；
  `capture_backdrop` 以 `[u32 宽][u32 高][BGRA…]` 二进制回传，窗口显示前预抓一帧。
- 渲染侧（`src/renderer/backdrop.js` + `app.css`）：画面铺成最底层的 `<canvas>`（12px 圆角与窗口一致），
  面板用插件原配方去糊它 —— 两边连模糊半径都是同一个 6px。
- **实时模式**（默认）：窗口持续对屏幕捕获隐身，逐帧抓取（目标 ~30fps，实测 29–30fps，CPU ≈9% 单核）。
- **跟手模式**（暂停实时后）：移动/缩放节流 150ms、点击/聚焦刷新、聚焦时每 4s 一帧；截图/录屏正常。
- 说明：实时模式下本窗口对所有屏幕捕获不可见（截图、录屏、会议共享都拍不到），这是抓屏排除自身的必然代价；
  面板设置页的开关或 `Ctrl+Alt+L` 可随时暂停。
- 窗口**不挂任何系统材质**（mica/acrylic）：系统材质是一整窗大小的 DWM 背板、不跟随页面动画，
  最小化时会和页面动画叠成两层；玻璃质感完全由抓屏画布 + 插件配方提供。

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
- 无边框沉浸窗口：面板头部即标题栏（**按住头部任意空白处即可拖动**，最小化/最大化/关闭在右侧），边缘缩放把手
- **默认出现在主屏右下角**（主显示器工作区、留 24px 边距，不再出现在屏幕正中；窗口大小超出工作区时退回左上角）
- 默认窗口 337×602（最小 320×520，客户区逻辑像素；实测外框 700×1219 @200% 缩放），WebView 整体缩放 0.94 —— 配合缩放后横向刚好落在面板 440px 的设计宽度上，不再显得偏宽；字号比早期版本小一档
- 置顶按钮（图钉，激活态品牌蓝；经 `plugin:window|set_always_on_top` 生效）
- 登录同步：Rust 打开 WebView2 登录窗到 platform.deepseek.com，捕获 `localStorage.userToken` 自动保存
- 亮/暗主题跟随系统（插件主题层，真实 dsh token 值）
- 界面与插件同代：毛玻璃材质阶梯、首屏一屏分层（最近 14 天/平台模型/按 API Key 折叠）、
  消费/Token/缓存语义色、日历方向键导航（整块日历只占 1 个 Tab 停靠点）、读屏播报与加载骨架
- **玻璃材质 = 插件原配方**：面板就是窗口本身（`inset: 0`，全窗只有一层边），渐变描边环沿窗口边、
  定向内阴影给出受光方向（左上亮 / 右下弱反射）、顶边柔光整体存在感；玻璃背后是被抓进页面的
  **真实屏幕画面**，`backdrop-filter: blur(6px) saturate(1.9)` 糊的就是它（与插件同一套配方）。
  窗口透明 + DWM 8px 圆角（`DWMWA_WINDOW_CORNER_PREFERENCE = ROUND`），无系统材质、无自造背景层
- **实时玻璃背景（~30fps）**：设置页开关（滑块）、托盘菜单「实时玻璃背景」、快捷键 `Ctrl+Alt+L` 三处同步；
  暂停后回落到低频跟手模式，截图/录屏恢复正常
- **最小化动效**：页面朝左下角收拢（180ms）后再最小化，替代系统默认的"缩向屏幕中央"
- 系统「减少透明度」或 WebView 不支持 `backdrop-filter` 时，按插件同一套兜底退回接近不透明的表面
- 与插件 v0.8.1 同代的数据口径：累计为有界窗口（未覆盖到起点时标签写「近 24 个月」并给出统计范围）、
  平台缓存按凭据身份隔离（换/清 Token 立即失效）、费用结构缺失时金额位显示「—」、
  日详情随刷新一起更新、切月与键盘共用同一条边界

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
    backdrop.js     抓屏背景泵：取帧 → BGRA→RGBA → 画到最底层画布（实时/跟手两种策略）
    primitives.js   图标/提示垫片
    app.css         主题垫层 + 无边框窗口布局 + 抓屏背景层/设置页开关/最小化动效
src-tauri/
  src/lib.rs        托盘/单实例/配置/登录窗口/关闭即隐藏 + 抓屏（GDI/WDA）+ DWM 圆角 + 背景帧缓存
  src/config.rs     config.json 读写
  tauri.conf.json   无边框透明窗口、NSIS、隐藏任务栏（不挂系统材质）
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
