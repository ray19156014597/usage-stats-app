/**
 * usage-stats-app — renderer bundle（由 dsh-usage-stats 插件的 `lib/client.js` 同步而来）.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step). 与插件版保持同一代：
 * 玻璃材质阶梯、一屏分层、语义色、日历键盘导航、无障碍、面板预热等改动全部继承，
 * 只保留两处"独立版专属"差异（下方均以「独立版」注释标出）：
 *   1. 标题栏控制：置顶 / 最小化 / 最大化 / 关闭（关闭 = 隐藏到托盘，而非收起面板）
 *   2. Esc 同样走"隐藏窗口"，避免留下空白窗口
 * 数据来自 boot.js 注入的 /api/usage-stats/* 拦截层（与插件服务端语义一致）。
 */
window.__ModuleLoader__.load({
	id: "dsh-usage-stats",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region css
		const css = [
			// Design tokens (theme-aware glass) + base layout.
			// 材质 + 语义令牌挂在外层容器上：面板与 tooltip 都从这里继承（tooltip 要能挂到
			// 面板之外给徽标用），浅色整组在下面的 data-usg-scheme 规则里覆盖。
			//
			// 玻璃配方 = 底色 + 白色罩面（veil）+ 顶边镜面高光 + 细颗粒。
			// 只做「半透明 + 模糊」在纯色深背景上等于没有材质，必须让表面自身比页面更亮一档，
			// 再叠一层极细的颗粒，才会读成"磨砂玻璃"而不是"半透明色块"。
			// 阶梯原则：越靠里的表面越实、越亮（面板 < 卡片 < 内嵌块 < 浮层）。
			".usg_layer{flex:none;align-items:center;width:100%;height:49px;margin:8px 0 0;display:flex;position:relative;--usg-blue:#4D6BFE;--usg-cost:#F0A64B;--usg-token:#6E8BFF;--usg-cache:#35C46A;--usg-write:#A98BFF;--usg-mat-1:48%;--usg-mat-1-veil:rgb(255 255 255 / 7%);--usg-mat-2:64%;--usg-mat-2-veil:rgb(255 255 255 / 9%);--usg-mat-3:80%;--usg-mat-3-veil:rgb(255 255 255 / 11%);--usg-mat-4:92%;--usg-mat-4-veil:rgb(255 255 255 / 6%);--usg-mat-grain:url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='140' height='140' filter='url(%23g)' opacity='0.06'/></svg>\");--usg-mat-glow:radial-gradient(120% 78% at 0% 0%,rgb(255 255 255 / 8%),transparent 58%);--usg-mat-blur-1:36px;--usg-mat-sat-1:190%;--usg-mat-blur-4:14px;--usg-mat-sat-4:150%;--usg-mat-line:color-mix(in srgb,#fff 14%,transparent);--usg-mat-line-soft:color-mix(in srgb,#fff 8%,transparent);--usg-mat-top:color-mix(in srgb,#fff 24%,transparent);--usg-mat-shadow:0 28px 72px rgba(0,0,0,.55),0 8px 22px rgba(0,0,0,.32),inset 0 1px 0 color-mix(in srgb,#fff 16%,transparent);--usg-line:var(--usg-mat-line);--usg-card:color-mix(in srgb,var(--dsw-alias-bg-base) var(--usg-mat-3),transparent);--usg-cellEmpty:color-mix(in srgb,var(--dsw-alias-label-tertiary) 9%,transparent);--usg-heatBase:transparent}",
			".usg_footerButtons{align-items:center;width:100%;display:flex}",
			".usg_badge{width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}",
			".usg_badge:hover{background:color-mix(in srgb,var(--usg-blue) 12%,transparent)}",
			".usg_badge[data-active]{background:color-mix(in srgb,var(--usg-blue) 14%,transparent)}",
			".usg_badgeLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}",
			".usg_badgeCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;margin-left:auto;font-size:12px;line-height:16px}",
			".usg_layer.usg_rail{width:36px;height:36px;margin:0}",
			".usg_layer.usg_rail .usg_badge{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;padding:0}",
			".usg_layer.usg_rail .usg_footerButtons{flex-direction:column;gap:2px}",
			// 材质令牌由 .usg_layer 提供；这里只描述面板本身的外观。
			// backdrop-filter 只留给真正压在页面内容上的表面（面板、tooltip）——
			// 嵌在面板内部的卡片再模糊一次既看不见、又要多付一次 GPU 合成。
			// 固定显示比例：面板尺寸在各显示器上保持一致（用户在 27 寸上反馈动态放大后过大），
			// 只保留"窄窗口不溢出"这一条自适应。
			".usg_panel{z-index:30;box-sizing:border-box;width:440px;max-width:calc(100vw - 24px);max-height:74vh;border-radius:16px;flex-direction:column;display:flex;position:fixed;bottom:128px;left:12px;overflow:hidden;transform-origin:left bottom;animation:usg-panel-in 380ms cubic-bezier(.22,1.08,.36,1);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:1px solid var(--usg-mat-line);background-color:color-mix(in srgb,var(--dsw-alias-bg-base) var(--usg-mat-1),transparent);background-image:var(--usg-mat-grain),var(--usg-mat-glow),linear-gradient(158deg,var(--usg-mat-1-veil),transparent 52%);background-repeat:repeat,no-repeat,no-repeat;background-size:140px 140px,100% 100%,100% 100%;backdrop-filter:blur(var(--usg-mat-blur-1)) saturate(var(--usg-mat-sat-1));-webkit-backdrop-filter:blur(var(--usg-mat-blur-1)) saturate(var(--usg-mat-sat-1));box-shadow:var(--usg-mat-shadow)}",
			// 顶边一条渐隐的镜面高光：让玻璃有"厚度"，比整条 1px 实线更像真玻璃。
			".usg_panel::before{content:\"\";position:absolute;left:0;right:0;top:0;height:1px;z-index:1;pointer-events:none;background:linear-gradient(90deg,transparent,var(--usg-mat-top) 16%,var(--usg-mat-top) 84%,transparent)}",
			// 不支持 backdrop-filter，或用户要求"降低透明度"时：退回接近不透明的表面，先保证可读。
			"@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.usg_panel{background:color-mix(in srgb,var(--dsw-alias-bg-base) 96%,transparent)}.usg_tip{background:color-mix(in srgb,var(--dsw-alias-bg-base) 99%,transparent)}}",
			"@media (prefers-reduced-transparency:reduce){.usg_panel{background:color-mix(in srgb,var(--dsw-alias-bg-base) 97%,transparent);backdrop-filter:none;-webkit-backdrop-filter:none}.usg_tip{background:color-mix(in srgb,var(--dsw-alias-bg-base) 99%,transparent);backdrop-filter:none;-webkit-backdrop-filter:none}}",
			// 浅色主题：热力图层用「淡蓝底 + 品牌蓝加浓」的干净色阶（避免白底混紫的灰脏感）；空格用冷蓝灰。
			// 判据优先取 DSH 主题快照（面板上的 data-usg-scheme，见 apply 里的 theme 桥接）：
			// GUI 的主题偏好与系统偏好可以不一致，媒体查询只作为拿不到主题服务时的回退。
			// 材质整组换成浅色版：底色更实（浅色下过透会发灰）、描边改冷灰、高光更强。
			"@media (prefers-color-scheme:light){.usg_layer:not([data-usg-scheme=dark]){--usg-heatBase:#dfe6ff;--usg-cellEmpty:#e9edf7;--usg-cost:#B4650F;--usg-token:#3A5BD9;--usg-cache:#0E7C43;--usg-write:#6D46D9;--usg-mat-1:62%;--usg-mat-1-veil:rgb(255 255 255 / 50%);--usg-mat-2:76%;--usg-mat-2-veil:rgb(255 255 255 / 55%);--usg-mat-3:90%;--usg-mat-3-veil:rgb(255 255 255 / 62%);--usg-mat-4:97%;--usg-mat-4-veil:rgb(255 255 255 / 70%);--usg-mat-glow:radial-gradient(120% 78% at 0% 0%,rgb(255 255 255 / 62%),transparent 58%);--usg-mat-blur-1:32px;--usg-mat-sat-1:175%;--usg-mat-blur-4:12px;--usg-mat-sat-4:145%;--usg-mat-line:color-mix(in srgb,#0f1115 10%,transparent);--usg-mat-line-soft:color-mix(in srgb,#0f1115 6%,transparent);--usg-mat-top:color-mix(in srgb,#fff 92%,transparent);--usg-mat-shadow:0 26px 60px rgba(23,32,51,.20),0 6px 16px rgba(23,32,51,.10),inset 0 1px 0 rgba(255,255,255,.9)}.usg_layer:not([data-usg-scheme=dark]) .usg_cell{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--usg-blue) 14%,transparent)}}",
			".usg_layer[data-usg-scheme=light]{--usg-heatBase:#dfe6ff;--usg-cellEmpty:#e9edf7;--usg-cost:#B4650F;--usg-token:#3A5BD9;--usg-cache:#0E7C43;--usg-write:#6D46D9;--usg-mat-1:62%;--usg-mat-1-veil:rgb(255 255 255 / 50%);--usg-mat-2:76%;--usg-mat-2-veil:rgb(255 255 255 / 55%);--usg-mat-3:90%;--usg-mat-3-veil:rgb(255 255 255 / 62%);--usg-mat-4:97%;--usg-mat-4-veil:rgb(255 255 255 / 70%);--usg-mat-glow:radial-gradient(120% 78% at 0% 0%,rgb(255 255 255 / 62%),transparent 58%);--usg-mat-blur-1:32px;--usg-mat-sat-1:175%;--usg-mat-blur-4:12px;--usg-mat-sat-4:145%;--usg-mat-line:color-mix(in srgb,#0f1115 10%,transparent);--usg-mat-line-soft:color-mix(in srgb,#0f1115 6%,transparent);--usg-mat-top:color-mix(in srgb,#fff 92%,transparent);--usg-mat-shadow:0 26px 60px rgba(23,32,51,.20),0 6px 16px rgba(23,32,51,.10),inset 0 1px 0 rgba(255,255,255,.9)}",
			".usg_layer[data-usg-scheme=light] .usg_cell{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--usg-blue) 14%,transparent)}",
			".usg_panel button:focus-visible,.usg_panel select:focus-visible,.usg_panel input:focus-visible{outline:2px solid color-mix(in srgb,var(--usg-blue) 62%,transparent);outline-offset:1px}",
			// 面板动效：从徽标所在的左下角「长出来」（位移 + 轻微缩放），380ms 带一点过冲；
			// 退场更快（250ms + ease-in，与 JS 的 PANEL_EXIT_MS 对齐）并 forwards 停在末帧。
			"@keyframes usg-panel-in{from{opacity:0;transform:translateY(18px) scale(.94)}55%{opacity:1}to{opacity:1;transform:none}}",
			"@keyframes usg-panel-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(10px) scale(.972)}}",
			"@keyframes usg-body-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
			".usg_panel[data-closing]{animation:usg-panel-out 250ms cubic-bezier(.4,0,1,1) forwards;pointer-events:none}",
			"@media (prefers-reduced-motion:reduce){.usg_panel,.usg_panel[data-closing]{animation-duration:1ms}.usg_body{animation:none}.usg_skelBlock::after{animation:none}}",
			".usg_header{box-sizing:border-box;border-bottom:1px solid var(--usg-mat-line-soft);background-color:color-mix(in srgb,var(--dsw-alias-bg-base) var(--usg-mat-2),transparent);background-image:linear-gradient(180deg,var(--usg-mat-2-veil),transparent);flex:none;justify-content:space-between;align-items:center;min-height:48px;padding:9px 12px;display:flex}",
			".usg_headerLeft{align-items:center;gap:9px;flex:1;min-width:0;display:flex}",
			".usg_headerLeft::before{content:\"\";width:3px;height:14px;border-radius:2px;flex:none;background:linear-gradient(180deg,var(--usg-blue),color-mix(in srgb,var(--usg-blue) 40%,transparent))}",
			".usg_title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;line-height:20px;letter-spacing:.01em}",
			".usg_headerActions{align-items:center;gap:5px;flex:none;display:flex}",
			".usg_iconButton{cursor:pointer;width:32px;height:32px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:8px;justify-content:center;align-items:center;padding:0;display:inline-flex;transition:background .12s ease,color .12s ease}",
			".usg_iconButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--usg-blue) 12%,transparent)}",
			".usg_iconButton:disabled{cursor:default;color:var(--dsw-alias-label-caption)}",
			".usg_iconButton[data-busy] svg{animation:usg-spin .9s linear infinite}",
			// 关闭键 hover 变红：三个图标挨在一起时先看清再点，降低误关概率。
			".usg_iconButton[data-kind=close]:hover{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}",
			"@keyframes usg-spin{to{transform:rotate(360deg)}}",
			// 头部数据新鲜度：紧跟标题、贴着右侧按钮，不必滚到底部才看得到。
			".usg_headerHint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-left:auto;padding-left:10px;white-space:nowrap;font-variant-numeric:tabular-nums}",
			".usg_body{flex:1;min-height:0;padding:8px 18px 20px;overflow-y:auto;overflow-x:hidden;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;animation:usg-body-in 420ms cubic-bezier(.22,1,.36,1) 80ms both}",
			".usg_section{margin-top:14px}",
			".usg_sectionTitle{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin:0 0 8px;letter-spacing:.04em;display:flex;align-items:center;gap:6px}",
			".usg_sectionTitle::before{content:\"\";width:3px;height:11px;border-radius:2px;flex:none;background:linear-gradient(180deg,var(--usg-blue),color-mix(in srgb,var(--usg-blue) 40%,transparent));opacity:.9}",
			".usg_note{color:var(--dsw-alias-label-tertiary);margin:4px 0;font-size:12px;line-height:18px}",
			".usg_error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,transparent);border-radius:12px;justify-content:space-between;align-items:center;gap:9px;margin:4px 0;padding:8px 10px;font-size:12px;line-height:18px;display:flex}",
			// 长文案（如余额被安全策略拦截的整句说明）最多两行，完整内容留给 title。
			".usg_errorText{min-width:0;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}",
			".usg_retry{color:inherit;font:inherit;cursor:pointer;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);border-radius:8px;flex:none;padding:3px 10px;font-size:11px;line-height:16px;font-weight:600;transition:background .12s ease}",
			".usg_retry:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,transparent)}",
			".usg_balanceMain{align-items:baseline;gap:9px;display:flex}",
			".usg_balanceAmount{color:var(--dsw-alias-label-primary);font-size:25px;font-weight:700;line-height:33px;font-variant-numeric:tabular-nums;font-feature-settings:\"tnum\";letter-spacing:.01em}",
			".usg_balanceStatus{align-items:center;gap:5px;font-size:12px;line-height:18px;display:inline-flex}",
			".usg_balanceOk{color:var(--dsw-alias-state-success-primary)}",
			".usg_balanceBad{color:var(--dsw-alias-state-error-primary)}",
			".usg_balanceRows{color:var(--dsw-alias-label-secondary);flex-direction:column;gap:3px;font-size:12px;line-height:18px;display:flex}",
			".usg_balanceRowsCompact{color:var(--dsw-alias-label-caption);flex-wrap:wrap;gap:2px 12px;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;display:flex}",
			".usg_balanceRow{justify-content:space-between;display:flex}",
			// Cards — 比面板实一档的玻璃卡：保留品牌色淡染，靠 1px 内高光成形，不再二次模糊。
			".usg_accountCard{--usg-providerAccent:#4D6BFE;box-sizing:border-box;border:1px solid var(--usg-mat-line);background-color:color-mix(in srgb,var(--dsw-alias-bg-base) var(--usg-mat-2),transparent);background-image:linear-gradient(150deg,color-mix(in srgb,var(--usg-providerAccent) 10%,transparent),transparent 52%),linear-gradient(160deg,var(--usg-mat-2-veil),transparent 62%);border-radius:12px;padding:12px 13px;display:flex;flex-direction:column;gap:10px;box-shadow:inset 0 1px 0 var(--usg-mat-top)}",
			".usg_accountCard[data-provider=deepseek],.usg_accountCard[data-provider=deepseek-official]{--usg-providerAccent:#4D6BFE}",
			".usg_accountHead{align-items:center;gap:9px;display:flex}",
			".usg_accountMark{width:25px;height:25px;color:#fff;background:linear-gradient(135deg,var(--usg-providerAccent),color-mix(in srgb,var(--usg-providerAccent) 62%,#000));border-radius:9px;justify-content:center;align-items:center;font-size:10px;font-weight:700;display:flex;box-shadow:0 4px 14px color-mix(in srgb,var(--usg-providerAccent) 35%,transparent),inset 0 1px 0 rgba(255,255,255,.28)}",
			".usg_accountMark svg{width:18px;height:18px}",
			".usg_accountIdentity{min-width:0;flex:1;display:flex;flex-direction:column}",
			".usg_accountName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px}",
			".usg_accountPlan{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}",
			".usg_accountStatus{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-fill-l2);border-radius:999px;padding:2px 8px;font-size:10px;line-height:16px;white-space:nowrap}",
			".usg_accountStatus[data-status=ok]{color:var(--usg-providerAccent);background:color-mix(in srgb,var(--usg-providerAccent) 12%,transparent)}",
			".usg_balanceNote{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:17px}",
			".usg_statsRow{display:flex;gap:9px}",
			".usg_statsRow.usg_statsBand{flex-wrap:wrap}",
			".usg_statsRow.usg_bandCompact{gap:5px}",
			".usg_statsRow.usg_bandCompact .usg_stat{padding:6px 9px;border-radius:12px}",
			".usg_statsRow.usg_bandCompact .usg_statValue{font-size:13px;line-height:20px}",
			".usg_statsRow.usg_bandCompact .usg_statLabel{font-size:10px;white-space:nowrap}",
			".usg_stat{box-sizing:border-box;border:1px solid var(--usg-mat-line-soft);border-radius:12px;flex:1;flex-direction:column;gap:2px;padding:10px 12px;display:flex;background-color:color-mix(in srgb,var(--dsw-alias-bg-base) var(--usg-mat-3),transparent);background-image:linear-gradient(160deg,var(--usg-mat-3-veil),transparent 70%);box-shadow:inset 0 1px 0 var(--usg-mat-top)}",
			".usg_statValue{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:600;line-height:24px;font-variant-numeric:tabular-nums;font-feature-settings:\"tnum\";letter-spacing:.01em;white-space:nowrap}",
			".usg_statLabel{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}",
			// 语义色：钱走琥珀、Token 走蓝、请求数保持中性灰 —— 一行 6 格里三类信息一眼分得开。
			".usg_stat[data-kind=cost] .usg_statValue{color:var(--usg-cost)}",
			".usg_stat[data-kind=token] .usg_statValue{color:var(--usg-token)}",
			".usg_platformModelCost{color:var(--usg-cost)}",
			".usg_hitCaption{color:var(--dsw-alias-label-tertiary);margin-top:7px;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}",
			".usg_hitCaption b{color:var(--usg-cache);font-weight:700}",
			".usg_heat{overflow-x:hidden;min-width:0;margin:0 -5px;padding:0 5px}",
			".usg_heatHeader{justify-content:space-between;align-items:center;margin-bottom:8px;display:flex;gap:8px}",
			".usg_heatHeader .usg_sectionTitle{flex:none;margin:0}",
			".usg_monthNav{align-items:center;gap:2px;display:flex}",
			".usg_navButton{cursor:pointer;width:24px;height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:8px;justify-content:center;align-items:center;padding:0;display:inline-flex;transition:background .12s ease,color .12s ease}",
			".usg_navButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--usg-blue) 12%,transparent)}",
			".usg_navButton:disabled{color:var(--dsw-alias-label-caption);cursor:default}",
			".usg_monthTitle{color:var(--dsw-alias-label-primary);min-width:88px;font-size:12px;font-weight:600;line-height:24px;text-align:center;font-variant-numeric:tabular-nums}",
			".usg_todayButton{cursor:pointer;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:8px;padding:0 7px;font-size:11px;line-height:24px}",
			".usg_todayButton:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--usg-blue) 12%,transparent)}",
			".usg_monthGrid{flex-direction:column;gap:4px;width:100%;min-width:0;display:flex}",
			".usg_weekHeader{color:var(--dsw-alias-label-tertiary);grid-template-columns:repeat(7,1fr);gap:4px;min-width:0;display:grid}",
			".usg_weekLabel{font-size:10px;line-height:16px;text-align:center}",
			".usg_heatRow{grid-template-columns:repeat(7,1fr);gap:4px;min-width:0;display:grid}",
			// Heatmap cells — rounded glass tiles; levels come from cellColor.
			".usg_cell{aspect-ratio:1/1;min-width:0;width:100%;border-radius:8px;border:0;padding:0;cursor:pointer;justify-content:center;align-items:center;font-family:inherit;display:flex;box-shadow:inset 0 0 0 1px rgba(255,255,255,.03),inset 0 1px 0 rgba(255,255,255,.05);transition:box-shadow .12s ease;position:relative}",
			// 只做描边+光晕，不做 transform 缩放：缩放的格子会撑出可滚动溢出区，
			// 在 .usg_heat(overflow-x:auto) 的最后一列产生横向滚条。
			".usg_cell:hover{box-shadow:inset 0 0 0 1px var(--dsw-alias-label-secondary),0 5px 14px color-mix(in srgb,var(--usg-blue) 32%,transparent);z-index:1}",
			".usg_cellToday{box-shadow:inset 0 0 0 1.5px var(--usg-blue)}",
			".usg_cellToday:hover{box-shadow:inset 0 0 0 1.5px var(--usg-blue)}",
			".usg_cellSelected{box-shadow:inset 0 0 0 2px var(--dsw-alias-label-primary)}",
			".usg_cellSelected:hover{box-shadow:inset 0 0 0 2px var(--dsw-alias-label-primary)}",
			".usg_cellDay{font-size:12px;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;pointer-events:none}",
			".usg_emptyCell{aspect-ratio:1/1;min-width:0;width:100%}",
			".usg_legend{align-items:center;gap:5px;margin-top:8px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary);display:flex}",
			".usg_legendSwatch{width:10px;height:10px;border-radius:3px;background:linear-gradient(135deg,var(--usg-blue),color-mix(in srgb,var(--usg-blue) 55%,transparent));box-shadow:0 0 4px color-mix(in srgb,var(--usg-blue) 40%,transparent)}",
			".usg_days{flex-direction:column;display:flex}",
			".usg_day{width:100%;min-height:32px;align-items:center;gap:9px;border:0;background:0 0;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary) 17%,transparent);padding:6px 0;font:inherit;text-align:left;cursor:pointer;display:flex}",
			".usg_day:last-child{border-bottom:0}",
			".usg_day:hover{background:color-mix(in srgb,var(--usg-blue) 9%,transparent)}",
			".usg_dayDate{color:var(--dsw-alias-label-secondary);flex:none;width:104px;font-size:12px;line-height:20px;font-variant-numeric:tabular-nums}",
			".usg_dayTokens{color:var(--dsw-alias-label-primary);flex:none;font-size:12px;line-height:20px;font-variant-numeric:tabular-nums;font-weight:600}",
			".usg_dayHit{color:var(--dsw-alias-label-tertiary);flex:none;width:52px;font-size:11px;line-height:20px;font-variant-numeric:tabular-nums;text-align:right}",
			".usg_dayBar{background:linear-gradient(90deg,color-mix(in srgb,var(--usg-blue) 72%,transparent),var(--usg-blue));border-radius:999px;height:7px;flex:1;min-width:4px;box-shadow:0 0 8px color-mix(in srgb,var(--usg-blue) 38%,transparent)}",
			".usg_detailHeader{align-items:center;gap:8px;display:flex}",
			".usg_back{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:8px;justify-content:center;align-items:center;padding:0;display:inline-flex;flex:none;transition:background .12s ease,color .12s ease}",
			".usg_back:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--usg-blue) 12%,transparent)}",
			".usg_detailDate{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}",
			".usg_detailHit{color:var(--dsw-alias-label-tertiary);margin-left:auto;font-size:11px;line-height:20px;font-variant-numeric:tabular-nums}",
			".usg_detailSummary{color:var(--dsw-alias-label-secondary);margin:6px 0 9px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}",
			".usg_modelRow{box-sizing:border-box;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary) 17%,transparent);padding:8px 0;display:flex;flex-direction:column;gap:5px}",
			".usg_modelRow:last-child{border-bottom:0}",
			".usg_modelHead{align-items:center;gap:8px;display:flex}",
			".usg_modelName{color:var(--dsw-alias-label-primary);min-width:0;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:12px;font-weight:600;line-height:18px;overflow:hidden}",
			".usg_modelTokens{color:var(--dsw-alias-label-primary);flex:none;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}",
			".usg_modelHit{color:var(--dsw-alias-label-tertiary);flex:none;width:56px;font-size:11px;line-height:18px;font-variant-numeric:tabular-nums;text-align:right}",
			".usg_modelBarTrack{background:var(--dsw-alias-fill-l2);border-radius:999px;height:6px;overflow:hidden}",
			".usg_modelBar{background:linear-gradient(90deg,color-mix(in srgb,var(--usg-blue) 70%,transparent),var(--usg-blue));border-radius:999px;height:6px;box-shadow:0 0 7px color-mix(in srgb,var(--usg-blue) 38%,transparent)}",
			".usg_modelMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}",
			".usg_modelCompTrack{display:flex;height:100%;min-width:2px;gap:1px}",
			// 日详情头部：左文字 + 右环形图（构成）。
			".usg_dayHeroWrap{align-items:flex-start;justify-content:space-between;gap:14px;padding:2px 0 10px;display:flex}",
			".usg_dayLeft{min-width:0;flex:1;flex-direction:column;gap:7px;display:flex}",
			".usg_dayTitleRow{align-items:baseline;gap:7px;flex-wrap:wrap;display:flex}",
			".usg_dayTitle{color:var(--dsw-alias-label-tertiary);flex:none;font-size:11px;line-height:16px}",
			".usg_dayHero{color:var(--dsw-alias-label-primary);font-size:21px;font-weight:700;line-height:27px;letter-spacing:-.015em;font-variant-numeric:tabular-nums;font-feature-settings:'tnum'}",
			".usg_daySide{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;align-items:baseline;flex-wrap:wrap;column-gap:12px;row-gap:4px;display:inline-flex}",
			".usg_daySideItem{align-items:baseline;gap:5px;display:inline-flex}",
			".usg_daySideItem b{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}",
			".usg_dayRing{position:relative;width:108px;height:108px;flex:none;margin-top:-4px}",
			".usg_dayRingSvg{position:absolute;inset:0;width:100%;height:100%;display:block}",
			".usg_dayRingTrack{fill:none;stroke:color-mix(in srgb,var(--dsw-alias-label-tertiary) 14%,transparent);stroke-width:12}",
			".usg_dayRingArc{fill:none;stroke-linecap:butt;stroke-width:12}",
			".usg_dayRingCenter{position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;gap:2px;display:flex}",
			".usg_dayRingCenter b{color:var(--dsw-alias-label-primary);font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}",
			".usg_dayRingCenter span{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px}",
			".usg_dayDivider{height:1px;flex:none;background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 14%,transparent);margin:10px 0;width:100%}",
			".usg_hourBlock{margin:12px 0 4px}",
			".usg_hourChart{display:flex;align-items:flex-end;gap:2px;height:64px}",
			".usg_hourCol{position:relative;height:100%;min-width:0;flex:1;flex-direction:column;justify-content:flex-end;display:flex}",
			".usg_hourFill{background:linear-gradient(180deg,color-mix(in srgb,var(--usg-blue) 88%,#fff),color-mix(in srgb,var(--usg-blue) 58%,transparent));border-radius:2px 2px 0 0;min-height:2px;transition:filter .12s ease}",
			".usg_hourCol:hover .usg_hourFill{filter:brightness(1.18)}",
			".usg_hourCol[data-peak] .usg_hourFill{background:linear-gradient(180deg,color-mix(in srgb,var(--usg-blue) 72%,#fff),var(--usg-blue));box-shadow:0 0 9px color-mix(in srgb,var(--usg-blue) 48%,transparent)}",
			".usg_hourPeak{position:absolute;top:0;left:50%;transform:translateX(-50%);color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--usg-blue) 18%,transparent);border:1px solid color-mix(in srgb,var(--usg-blue) 38%,transparent);border-radius:6px;padding:1px 5px;font-size:9px;line-height:14px;white-space:nowrap;font-variant-numeric:tabular-nums}",
			".usg_hourAxis{position:relative;height:22px;margin-top:6px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary) 22%,transparent);color:var(--dsw-alias-label-secondary);font-size:9px;line-height:16px;font-variant-numeric:tabular-nums}",
			".usg_hourAxis span{position:absolute;top:0;transform:translateX(-50%);padding:0 6px;background:var(--dsw-alias-bg-base)}",
			".usg_dayKeys{flex-direction:column;margin:12px 0 4px;display:flex}",
			".usg_dayKeysCaption{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;margin-bottom:2px}",
			".usg_dayKeyRow{align-items:baseline;gap:8px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary) 17%,transparent);padding:7px 0;font-size:11px;line-height:18px;display:flex}",
			".usg_dayKeyRow:last-child{border-bottom:0}",
			".usg_dayKeyName{min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;flex:1;color:var(--dsw-alias-label-primary);font-weight:600}",
			".usg_dayKeyTokens{color:var(--dsw-alias-label-primary);flex:none;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}",
			".usg_dayKeyMeta{color:var(--dsw-alias-label-tertiary);flex:none;font-size:10px;font-variant-numeric:tabular-nums}",
			".usg_compTrack{box-sizing:border-box;display:flex;width:100%;height:8px;gap:1px;border-radius:999px;overflow:hidden;background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 14%,transparent)}",
			".usg_compTrack.usg_compSmall{height:5px}",
			".usg_compSeg{flex:0 1 0;min-width:0;height:100%}",
			".usg_compLegend{align-items:center;flex-wrap:wrap;gap:4px 10px;margin-top:5px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary);display:flex}",
			".usg_compLegendItem{align-items:center;gap:4px;display:inline-flex}",
			".usg_compLegendItem i{width:8px;height:8px;border-radius:3px;flex:none;box-shadow:0 0 4px color-mix(in srgb,var(--usg-blue) 30%,transparent)}",
			".usg_compLegendItem b{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}",
			".usg_platformCard{box-sizing:border-box;border:1px solid var(--usg-mat-line);background-color:color-mix(in srgb,var(--dsw-alias-bg-base) var(--usg-mat-2),transparent);background-image:linear-gradient(160deg,color-mix(in srgb,var(--usg-blue) 7%,transparent),transparent 46%),linear-gradient(160deg,var(--usg-mat-2-veil),transparent 62%);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;box-shadow:inset 0 1px 0 var(--usg-mat-top)}",
			".usg_platformHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:17px}",
			".usg_platformModel{box-sizing:border-box;border:1px solid var(--usg-mat-line-soft);border-radius:12px;padding:6px 10px;display:flex;flex-direction:column;gap:4px;background-color:color-mix(in srgb,var(--dsw-alias-bg-base) var(--usg-mat-3),transparent);background-image:linear-gradient(160deg,var(--usg-mat-3-veil),transparent 70%);box-shadow:inset 0 1px 0 var(--usg-mat-top)}",
			".usg_platformModelHead{align-items:center;gap:8px;display:flex}",
			".usg_platformModelName{color:var(--dsw-alias-label-primary);min-width:0;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:12px;font-weight:600;line-height:18px;overflow:hidden}",
			".usg_platformModelCost{color:var(--dsw-alias-label-primary);flex:none;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}",
			".usg_platformTokenLine{align-items:center;gap:8px;display:flex}",
			".usg_platformTokenCount{color:var(--dsw-alias-label-primary);flex:none;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;font-weight:600}",
			".usg_platformChartNote{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;font-variant-numeric:tabular-nums}",
			".usg_platformDivider{height:1px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 14%,transparent);margin:2px 0 10px;flex:none}",
			".usg_settingsActions{align-items:center;gap:7px;margin-top:9px;display:flex;flex-wrap:wrap}",
			".usg_settingsButton{cursor:pointer;box-sizing:border-box;border:1px solid var(--usg-mat-line-soft);background-color:var(--usg-card);background-image:linear-gradient(160deg,var(--usg-mat-3-veil),transparent 70%);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 11px;font:inherit;font-size:12px;line-height:18px;transition:background .12s ease,transform .08s ease}",
			".usg_settingsButton:hover:not(:disabled){background:color-mix(in srgb,var(--usg-blue) 10%,transparent);transform:translateY(-1px)}",
			".usg_settingsButton:disabled{opacity:.5;cursor:default;transform:none}",
			".usg_settingsButton[data-kind=primary]{color:#fff;background:linear-gradient(135deg,var(--usg-blue),color-mix(in srgb,var(--usg-blue) 68%,#000));border-color:transparent;box-shadow:0 4px 14px color-mix(in srgb,var(--usg-blue) 38%,transparent)}",
			".usg_settingsButton[data-kind=danger]{color:var(--dsw-alias-state-error-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}",
			".usg_settingsInput{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);background-color:var(--usg-card);background-image:linear-gradient(160deg,var(--usg-mat-3-veil),transparent 70%);border:1px solid var(--usg-mat-line-soft);border-radius:8px;padding:6px 9px;font:inherit;font-size:12px;line-height:18px}",
			".usg_settingsInput:focus{outline:2px solid color-mix(in srgb,var(--usg-blue) 40%,transparent);outline-offset:1px}",
			// 未保存的输入用琥珀描边提示，保存后自动消失。
			".usg_settingsInput[data-dirty]{border-color:color-mix(in srgb,var(--usg-cost) 55%,transparent)}",
			".usg_disclosureHead{cursor:pointer;box-sizing:border-box;width:100%;align-items:center;gap:3px;background:0 0;border:none;padding:2px 0;font:inherit;text-align:left;display:flex;color:inherit}",
			".usg_disclosureHead:hover .usg_sectionTitle{color:var(--dsw-alias-label-secondary)}",
			".usg_disclosureHead .usg_sectionTitle{flex:1;margin:0;color:var(--dsw-alias-label-secondary)}",
			".usg_disclosureChevron{color:var(--dsw-alias-label-tertiary);display:inline-flex;transition:transform .15s ease}",
			".usg_disclosureChevron[data-open]{transform:rotate(90deg)}",
			".usg_disclosureCount{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;font-variant-numeric:tabular-nums}",
			".usg_disclosureHead + .usg_days{margin-top:7px}",
			".usg_footerNote{color:var(--dsw-alias-label-caption);margin-top:11px;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}",
			// 首屏骨架：几何尺寸对齐真实的「热力图 + 最近 14 天」，加载完成时不跳版。
			".usg_skel{flex-direction:column;gap:13px;display:flex}",
			".usg_skelGrid{grid-template-columns:repeat(7,1fr);gap:4px;display:grid}",
			".usg_skelCell{aspect-ratio:1/1;border-radius:8px}",
			".usg_skelList{flex-direction:column;gap:7px;display:flex}",
			".usg_skelRow{height:30px;border-radius:8px}",
			".usg_skelBlock{background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 13%,transparent);position:relative;overflow:hidden}",
			".usg_skelBlock::after{content:\"\";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,color-mix(in srgb,#fff 20%,transparent),transparent);animation:usg-shimmer 1.5s ease-in-out infinite}",
			"@keyframes usg-shimmer{to{transform:translateX(100%)}}",
			// 视图切换：进入日详情/设置自右推入，返回自左推入，给下钻一个方向感。
			// data-dir 只在切换时出现（首次展开由 usg-body-in 负责淡入），key={view}
			// 让容器重挂载，动画得以重播，同时把滚动位置带回顶部。
			".usg_body[data-dir=forward]{animation:usg-view-forward 260ms cubic-bezier(.22,1,.36,1) both}",
			".usg_body[data-dir=back]{animation:usg-view-back 260ms cubic-bezier(.22,1,.36,1) both}",
			"@keyframes usg-view-forward{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}",
			"@keyframes usg-view-back{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}",
			// 容器是被程序聚焦的（打开面板 / 切换视图），不要画焦点环。
			".usg_panel:focus,.usg_body:focus{outline:none}",
			// 面板自带 tooltip：原生 title 有约 1 秒延迟，且样式由系统决定；这里与面板同一套毛玻璃。
			".usg_tip{position:absolute;z-index:40;pointer-events:none;max-width:260px;color:var(--dsw-alias-label-primary);background-color:color-mix(in srgb,var(--dsw-alias-bg-base) var(--usg-mat-4),transparent);background-image:linear-gradient(160deg,var(--usg-mat-4-veil),transparent 70%);border:1px solid var(--usg-mat-line);border-radius:10px;padding:5px 9px;font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;box-shadow:0 10px 28px rgba(0,0,0,.28),inset 0 1px 0 var(--usg-mat-top);backdrop-filter:blur(var(--usg-mat-blur-4)) saturate(var(--usg-mat-sat-4));-webkit-backdrop-filter:blur(var(--usg-mat-blur-4)) saturate(var(--usg-mat-sat-4));transform:translate(-50%,-100%);animation:usg-tip-in 120ms ease-out both}",
			"@keyframes usg-tip-in{from{opacity:0;transform:translate(-50%,calc(-100% + 4px))}to{opacity:1;transform:translate(-50%,-100%)}}",
			"@media (prefers-reduced-motion:reduce){.usg_tip{animation-duration:1ms}.usg_body[data-dir]{animation-duration:1ms}}"
		].join("");
		const tagId = "dsh-usage-stats/UsageStats.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-usage-stats";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		const S = {
			layer: "usg_layer",
			rail: "usg_rail",
			footerButtons: "usg_footerButtons",
			badge: "usg_badge",
			badgeLabel: "usg_badgeLabel",
			badgeCount: "usg_badgeCount",
			panel: "usg_panel",
			header: "usg_header",
			headerLeft: "usg_headerLeft",
			title: "usg_title",
			headerActions: "usg_headerActions",
			iconButton: "usg_iconButton",
			body: "usg_body",
			section: "usg_section",
			sectionTitle: "usg_sectionTitle",
			note: "usg_note",
			error: "usg_error",
			retry: "usg_retry",
			accountCard: "usg_accountCard",
			accountHead: "usg_accountHead",
			accountMark: "usg_accountMark",
			accountIdentity: "usg_accountIdentity",
			accountName: "usg_accountName",
			accountPlan: "usg_accountPlan",
			accountStatus: "usg_accountStatus",
			balanceNote: "usg_balanceNote",
			balanceMain: "usg_balanceMain",
			balanceAmount: "usg_balanceAmount",
			balanceStatus: "usg_balanceStatus",
			balanceOk: "usg_balanceOk",
			balanceBad: "usg_balanceBad",
			balanceRows: "usg_balanceRows",
			balanceRowsCompact: "usg_balanceRowsCompact",
			balanceRow: "usg_balanceRow",
			statsRow: "usg_statsRow",
			statsBand: "usg_statsBand",
			bandCompact: "usg_bandCompact",
			stat: "usg_stat",
			statValue: "usg_statValue",
			statLabel: "usg_statLabel",
			hitCaption: "usg_hitCaption",
			heat: "usg_heat",
			heatHeader: "usg_heatHeader",
			monthNav: "usg_monthNav",
			navButton: "usg_navButton",
			monthTitle: "usg_monthTitle",
			todayButton: "usg_todayButton",
			monthGrid: "usg_monthGrid",
			weekHeader: "usg_weekHeader",
			weekLabel: "usg_weekLabel",
			heatRow: "usg_heatRow",
			cell: "usg_cell",
			cellSelected: "usg_cellSelected",
			cellToday: "usg_cellToday",
			cellDay: "usg_cellDay",
			emptyCell: "usg_emptyCell",
			legend: "usg_legend",
			legendSwatch: "usg_legendSwatch",
			days: "usg_days",
			day: "usg_day",
			dayDate: "usg_dayDate",
			dayTokens: "usg_dayTokens",
			dayHit: "usg_dayHit",
			dayBar: "usg_dayBar",
			detailHeader: "usg_detailHeader",
			back: "usg_back",
			detailDate: "usg_detailDate",
			detailHit: "usg_detailHit",
			detailSummary: "usg_detailSummary",
			modelRow: "usg_modelRow",
			modelHead: "usg_modelHead",
			modelName: "usg_modelName",
			modelTokens: "usg_modelTokens",
			modelHit: "usg_modelHit",
			modelBarTrack: "usg_modelBarTrack",
			modelBar: "usg_modelBar",
			modelMeta: "usg_modelMeta",
			modelCompTrack: "usg_modelCompTrack",
			dayHeroWrap: "usg_dayHeroWrap",
			dayLeft: "usg_dayLeft",
			dayTitleRow: "usg_dayTitleRow",
			dayTitle: "usg_dayTitle",
			dayHero: "usg_dayHero",
			daySide: "usg_daySide",
			daySideItem: "usg_daySideItem",
			dayRing: "usg_dayRing",
			dayRingSvg: "usg_dayRingSvg",
			dayRingTrack: "usg_dayRingTrack",
			dayRingArc: "usg_dayRingArc",
			dayRingCenter: "usg_dayRingCenter",
			hourBlock: "usg_hourBlock",
			hourChart: "usg_hourChart",
			hourCol: "usg_hourCol",
			hourFill: "usg_hourFill",
			hourPeak: "usg_hourPeak",
			hourAxis: "usg_hourAxis",
			dayKeys: "usg_dayKeys",
			dayKeysCaption: "usg_dayKeysCaption",
			dayKeyRow: "usg_dayKeyRow",
			dayKeyName: "usg_dayKeyName",
			dayKeyTokens: "usg_dayKeyTokens",
			dayKeyMeta: "usg_dayKeyMeta",
			compTrack: "usg_compTrack",
			compSmall: "usg_compSmall",
			compSeg: "usg_compSeg",
			compLegend: "usg_compLegend",
			compLegendItem: "usg_compLegendItem",
			platformCard: "usg_platformCard",
			platformHint: "usg_platformHint",
			platformModel: "usg_platformModel",
			platformModelHead: "usg_platformModelHead",
			platformModelName: "usg_platformModelName",
			platformModelCost: "usg_platformModelCost",
			platformTokenLine: "usg_platformTokenLine",
			platformTokenCount: "usg_platformTokenCount",
			platformChartNote: "usg_platformChartNote",
			platformDivider: "usg_platformDivider",
			settingsActions: "usg_settingsActions",
			settingsButton: "usg_settingsButton",
			settingsInput: "usg_settingsInput",
			disclosureHead: "usg_disclosureHead",
			disclosureChevron: "usg_disclosureChevron",
			disclosureCount: "usg_disclosureCount",
			footerNote: "usg_footerNote",
			headerHint: "usg_headerHint",
			errorText: "usg_errorText",
			skel: "usg_skel",
			skelGrid: "usg_skelGrid",
			skelCell: "usg_skelCell",
			skelList: "usg_skelList",
			skelRow: "usg_skelRow",
			skelBlock: "usg_skelBlock",
			tip: "usg_tip"
		};
		//#endregion

		//#region helpers
		/** Fixed UTC+8 (Asia/Shanghai) offset — DeepSeek platform usage is per China day. */
		const GMT8_OFFSET_MS = 8 * 3600 * 1000;

		/** `YYYY-MM-DD` in GMT+8 for an instant (China has no DST, so a fixed offset is exact). */
		function gmt8Key(date) {
			const d = new Date(date.getTime() + GMT8_OFFSET_MS);
			const month = String(d.getUTCMonth() + 1).padStart(2, "0");
			const day = String(d.getUTCDate()).padStart(2, "0");
			return `${d.getUTCFullYear()}-${month}-${day}`;
		}

		/** `YYYY-MM-DD` in GMT+8 (local session data display timezone). */
		function dayKeyOf(date) {
			return gmt8Key(date);
		}

		/** Today's GMT+8 `YYYY-MM-DD`. */
		function todayKey() {
			return gmt8Key(new Date());
		}

		/** Current month key `YYYY-MM` in GMT+8. */
		function currentMonthKey() {
			return gmt8Key(new Date()).slice(0, 7);
		}

		/** Shift a `YYYY-MM` key by a signed month delta. */
		function shiftMonth(key, delta) {
			const [year, month] = key.split("-").map(Number);
			const date = new Date(year, month - 1 + delta, 1);
			return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
		}

		/** Localized `YYYY-MM` → e.g. "2026年8月" / "Aug 2026". */
		function monthLabelOf(key, translate) {
			const [year, month] = key.split("-").map(Number);
			return translate("month.year", { year, month: monthName(month - 1, translate) });
		}

		/** Group thousands. */
		function fmt(n) {
			return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}

		/** Hit-rate display: null/undefined → "—". */
		function fmtHit(hitRate) {
			return hitRate === null || hitRate === void 0 ? "—" : `${hitRate}%`;
		}

		/** Currency-aware amount: `¥ 36.44` / `$ 12.00` (Intl, fallback keeps the raw value). */
		function fmtCurrency(amount, currency) {
			if (amount === void 0 || amount === null) return "—";
			const numeric = Number(amount);
			if (!Number.isFinite(numeric)) return "—";
			try {
				return new Intl.NumberFormat(undefined, { style: "currency", currency: currency ?? "CNY" }).format(numeric);
			} catch {
				return `${currency ?? "CNY"} ${amount}`;
			}
		}

		/**
		 * Per-request staleness guard: each `start()` bumps a private counter and
		 * only the most recent start may `isCurrent()`. Usage and balance each
		 * hold their OWN loader, so the two never invalidate each other (the
		 * shared-counter race that dropped the first usage response).
		 */
		function createLoader() {
			let current = 0;
			return {
				start: () => ++current,
				isCurrent: (id) => id === current
			};
		}

		/** Panel exit duration in ms — keep in sync with `usg-panel-out` in the stylesheet. */
		const PANEL_EXIT_MS = 250;

		/** Whether the OS asks for reduced motion (the exit delay then collapses to 0). */
		function prefersReducedMotion() {
			return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches === true;
		}

		/**
		 * Resolve the presentation color scheme used by the heatmap scale. DSH owns
		 * the theme preference (`system` / `light` / `dark`) and it can differ from
		 * the OS scheme, so the theme snapshot wins; the media query is only the
		 * fallback for when no theme bridge is mounted.
		 */
		function resolveColorScheme(themeBridge) {
			if (themeBridge !== void 0 && themeBridge !== null && typeof themeBridge.scheme === "function") {
				const scheme = themeBridge.scheme();
				if (scheme === "light" || scheme === "dark") return scheme;
			}
			if (typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
			return "light";
		}

		/** Locale-safe template interpolation: `t("key", {a})` replaces `{a}`. */
		function interpolate(template, params) {
			if (params === void 0) return template;
			return template.replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(params, key) ? String(params[key]) : match));
		}

		async function fetchJson(path) {
			const response = await fetch(path, { headers: { accept: "application/json" } });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const payload = await response.json();
			if (payload === null || typeof payload !== "object") throw new Error("unexpected response");
			return payload;
		}

		/**
		 * Build one month's calendar heatmap: weeks as rows (Mon-first), only
		 * the month's own days, padded with null placeholders. Cell tokens come
		 * from the day map; `max` is the month's largest daily total, used for
		 * the absolute log-scale color mapping.
		 * @param dayMap - date key → day entry map.
		 * @param year - calendar year.
		 * @param month - zero-based month.
		 * @returns `{ weeks, max }`.
		 */
		function buildMonthHeatmap(dayMap, year, month) {
			const first = new Date(year, month, 1);
			const daysInMonth = new Date(year, month + 1, 0).getDate();
			const lead = (first.getDay() + 6) % 7; // Monday = 0
			const weeks = [];
			let max = 0;
			for (let w = 0; w * 7 < lead + daysInMonth; w += 1) {
				const week = [];
				for (let d = 0; d < 7; d += 1) {
					const dayNum = w * 7 + d - lead + 1;
					if (dayNum < 1 || dayNum > daysInMonth) {
						week.push(null);
						continue;
					}
					// Build the GMT+8 date key directly from the calendar numbers
					// (avoids any machine-timezone drift at day boundaries).
					const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
					const entry = dayMap.get(key);
					const tokens = entry?.tokens ?? 0;
					// 平台日（platformDayToLocalShape）带 cost；本地日没有 → 0。
					week.push({ key, day: dayNum, tokens, hitRate: entry?.cacheHitRate ?? null, cost: entry?.cost ?? 0 });
					if (tokens > max) max = tokens;
				}
				weeks.push(week);
			}
			return { weeks, max };
		}

		/**
		 * Codex-style blue cell color: continuous square-root mapping against
		 * the month's max (more tokens → strictly deeper blue, no banding).
		 * The background mixes the brand blue over a theme-aware base:
		 * dark = transparent (equivalent to the old rgba overlay), light =
		 * a pale blue so the ramp stays clean instead of grey-violet.
		 */
		const BLUE_RGB = [77, 107, 254]; // DeepSeek brand blue #4D6BFE
		function cellColor(tokens, max) {
			if (tokens <= 0) {
				return {
					background: "var(--usg-cellEmpty)",
					color: "var(--dsw-alias-label-secondary)",
					alpha: 0
				};
			}
			const ratio = max > 0 ? Math.sqrt(tokens / max) : 1;
			const alpha = Math.min(1, 0.22 + 0.78 * ratio);
			return {
				background: `color-mix(in srgb, rgb(${BLUE_RGB.join(", ")}) ${Math.round(alpha * 100)}%, var(--usg-heatBase))`,
				color: alpha >= 0.6 ? "rgba(255,255,255,0.95)" : "var(--dsw-alias-label-primary)",
				alpha
			};
		}
		//#endregion

		/**
		 * First-load placeholder. The shape mirrors the real heatmap grid plus the
		 * recent-14-days rows so the panel does not jump when the data lands.
		 */
		function UsageSkeleton() {
			const cells = [];
			for (let index = 0; index < 35; index += 1) cells.push(index);
			const rows = [0, 1, 2];
			return react_jsx_runtime.jsxs("div", {
				className: S.skel,
				"aria-hidden": true,
				children: [
					react_jsx_runtime.jsx("div", {
						className: S.skelGrid,
						children: cells.map((index) => react_jsx_runtime.jsx("div", { className: `${S.skelBlock} ${S.skelCell}` }, `skel-cell-${index}`))
					}),
					react_jsx_runtime.jsx("div", {
						className: S.skelList,
						children: rows.map((index) => react_jsx_runtime.jsx("div", { className: `${S.skelBlock} ${S.skelRow}` }, `skel-row-${index}`))
					})
				]
			});
		}

		//#region UsageStatsPanel
		/**
		 * Sidebar footer action: badge + floating panel with balance and usage.
		 * @param props - `wide` from the sidebar shell, `t` bound by the slot runtime.
		 */
		function UsageStatsPanel({ wide, t, theme: themeBridge }) {
			const translate = (key, params) => interpolate(t !== void 0 ? t(key) : key, params);
			// `open` is the logical state that drives loading/polling; `mounted` keeps
			// the element in the DOM through the exit animation that `closing` drives.
			const [open, setOpen] = react.useState(false);
			const [mounted, setMounted] = react.useState(false);
			const [closing, setClosing] = react.useState(false);
			const [refreshing, setRefreshing] = react.useState(false);
			const [scheme, setScheme] = react.useState(() => resolveColorScheme(themeBridge));
			const closeTimerRef = react.useRef(null);
			const [usage, setUsage] = react.useState(null);
			const [usageError, setUsageError] = react.useState(null);
			const [selectedDay, setSelectedDay] = react.useState(null);
			const [account, setAccount] = react.useState(null);
			const [accountLoading, setAccountLoading] = react.useState(false);
			const [accountError, setAccountError] = react.useState(null);
			const [refreshedAt, setRefreshedAt] = react.useState(null);
			const [platform, setPlatform] = react.useState(null);
			const [platformTotal, setPlatformTotal] = react.useState(null);
			const [recentPlat, setRecentPlat] = react.useState(null);
			const [platformError, setPlatformError] = react.useState(null);
			const [platformLoading, setPlatformLoading] = react.useState(false);
			const [platformMonth, setPlatformMonth] = react.useState(() => currentMonthKey());
			const [showSettings, setShowSettings] = react.useState(false);
			const [tokenStatus, setTokenStatus] = react.useState(null);
			const [tokenBusy, setTokenBusy] = react.useState(false);
			const [tokenMessage, setTokenMessage] = react.useState("");
			const [tokenInput, setTokenInput] = react.useState("");
			const [tokenJustSaved, setTokenJustSaved] = react.useState(false);
			const [syncRunning, setSyncRunning] = react.useState(false);
			const [apiKeysOpen, setApiKeysOpen] = react.useState(false);
			// 独立版专属：窗口置顶状态（无边框窗口的图钉按钮）。
			const [pinned, setPinned] = react.useState(false);
			// A1 分层：这两个明细块默认折叠，首屏留给余额/统计/热力图。
			const [recentOpen, setRecentOpen] = react.useState(false);
			const [platformOpen, setPlatformOpen] = react.useState(false);
			const [dayDetail, setDayDetail] = react.useState(null);
			const [dayDetailLoading, setDayDetailLoading] = react.useState(false);
			const dayDetailSeqRef = react.useRef(0);
			const recentPlatSeqRef = react.useRef(0);
			const mountedRef = react.useRef(true);
			const panelRef = react.useRef(null);
			const layerRef = react.useRef(null);
			const badgeRef = react.useRef(null);
			const bodyRef = react.useRef(null);
			const previousViewRef = react.useRef("main");
			const [viewDir, setViewDir] = react.useState(null);
			const [tip, setTip] = react.useState(null);
			const usageLoaderRef = react.useRef(null);
			const accountLoaderRef = react.useRef(null);
			const platformLoaderRef = react.useRef(null);
			if (usageLoaderRef.current === null) usageLoaderRef.current = createLoader();
			if (accountLoaderRef.current === null) accountLoaderRef.current = createLoader();
			if (platformLoaderRef.current === null) platformLoaderRef.current = createLoader();

			// 打开/关闭：关闭先播退场动效（data-closing）再卸载节点；这期间「逻辑上
			// 已关闭」，所以轮询与数据请求立即停止，不会在退场动画里偷偷刷新。
			const openPanel = react.useCallback(() => {
				if (closeTimerRef.current !== null) {
					window.clearTimeout(closeTimerRef.current);
					closeTimerRef.current = null;
				}
				// 每次展开都从「无方向」开始：面板本身的展开动效负责第一印象，
				// 上次下钻留下的方向不该在重新打开时重播。
				setViewDir(null);
				setClosing(false);
				setMounted(true);
				setOpen(true);
			}, []);

			const closePanel = react.useCallback(() => {
				setOpen(false);
				setClosing(true);
				setTip(null);
				if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
				closeTimerRef.current = window.setTimeout(() => {
					closeTimerRef.current = null;
					// 焦点归还：只有在面板内部持有焦点时才把焦点送回徽标，
					// 避免用户点了页面别处却被拉回侧边栏。
					const panel = panelRef.current;
					const active = typeof document === "undefined" ? null : document.activeElement;
					const returnFocus = panel !== null && active !== null && panel.contains(active);
					setMounted(false);
					setClosing(false);
					if (returnFocus) badgeRef.current?.focus?.({ preventScroll: true });
				}, prefersReducedMotion() ? 0 : PANEL_EXIT_MS);
			}, []);

			react.useEffect(() => () => {
				if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
			}, []);

			// ---- 独立版专属：无边框窗口的 Tauri 桥 ----------------------------------
			/** 调用 Tauri 命令；浏览器模式（无 __TAURI__）返回 false，调用方据此回退。 */
			const tauriInvoke = react.useCallback((command, args) => {
				if (typeof window === "undefined" || typeof window.__TAURI__?.core?.invoke !== "function") return false;
				window.__TAURI__.core.invoke(command, args).catch(() => { /* 权限缺失时保持 UI 可用 */ });
				return true;
			}, []);

			/** × 与 Esc 都表示"隐藏窗口到托盘"（Rust 侧 CloseRequested 会 prevent_close + hide），
			 *  只有在没有 Tauri 桥的浏览器预览里才退回"收起面板"。 */
			const dismissPanel = react.useCallback(() => {
				if (tauriInvoke("plugin:window|close")) return;
				closePanel();
			}, [closePanel, tauriInvoke]);

			/** 置顶开关：面板是全窗口应用，置顶后不会被其他窗口盖住。 */
			const togglePin = react.useCallback(() => {
				setPinned((value) => {
					const next = !value;
					tauriInvoke("plugin:window|set_always_on_top", { value: next });
					return next;
				});
			}, [tauriInvoke]);
			// ---- 独立版专属结束 ----------------------------------------------------

			// 视图（主视图 / 日详情 / 设置）：下钻时记下方向，用于切换动效与焦点落点。
			const view = showSettings ? "settings" : selectedDay !== null ? "day" : "main";
			react.useEffect(() => {
				if (previousViewRef.current === view) return;
				previousViewRef.current = view;
				setViewDir(view === "main" ? "back" : "forward");
			}, [view]);

			// 视图切换后：把焦点交给新视图（键盘与读屏用户不会停留在已卸载的节点上），
			// 并收起可能残留的 tooltip。滚动位置由容器重挂载自然回到顶部。
			react.useEffect(() => {
				if (viewDir === null) return;
				bodyRef.current?.focus?.({ preventScroll: true });
				setTip(null);
			}, [view, viewDir]);

			// 面板展开后把焦点移入面板（Esc 关闭、Tab 直接从面板内部开始）。
			react.useEffect(() => {
				if (!mounted) return;
				panelRef.current?.focus?.({ preventScroll: true });
			}, [mounted]);

			// 主题跟随：DSH 的主题偏好（system/light/dark）可以与系统偏好不同，
			// 所以热力图色阶的判据取主题快照，而不是 prefers-color-scheme。
			react.useEffect(() => {
				setScheme(resolveColorScheme(themeBridge));
				if (themeBridge === void 0 || themeBridge === null || typeof themeBridge.subscribe !== "function") return void 0;
				return themeBridge.subscribe(() => setScheme(resolveColorScheme(themeBridge)));
			}, [themeBridge]);

			// Esc：设置视图与日详情逐级返回；主视图下独立版是"隐藏窗口"（dismissPanel）。
			react.useEffect(() => {
				if (!mounted || typeof document === "undefined") return;
				const onKeyDown = (event) => {
					if (event.key !== "Escape" || event.defaultPrevented === true) return;
					if (showSettings) {
						setShowSettings(false);
						return;
					}
					if (selectedDay !== null) {
						setSelectedDay(null);
						return;
					}
					dismissPanel();
				};
				document.addEventListener("keydown", onKeyDown);
				return () => document.removeEventListener("keydown", onKeyDown);
			}, [mounted, showSettings, selectedDay, dismissPanel]);
			// 只保留 DeepSeek：账户区固定为官方 DeepSeek，不再枚举/切换供应商。
			const DEEPSEEK_PROVIDER = { id: "deepseek-official", displayName: "DeepSeek", accountMode: "balance" };

			const loadUsage = react.useCallback((force = false) => {
				const seq = usageLoaderRef.current.start();
				setUsageError(null);
				return fetchJson(`/api/usage-stats/usage${force ? "?refresh=1" : ""}`).then((payload) => {
					if (!mountedRef.current || !usageLoaderRef.current.isCurrent(seq)) return;
					if (payload.ok !== true) {
						setUsageError(payload.message ?? "usage aggregation failed");
						return;
					}
					setUsage(payload);
					setRefreshedAt(Date.now());
				}).catch((error) => {
					if (!mountedRef.current || !usageLoaderRef.current.isCurrent(seq)) return;
					setUsageError(error instanceof Error ? error.message : String(error));
				});
			}, []);

			const loadAccount = react.useCallback((providerId, force = false) => {
				const seq = accountLoaderRef.current.start();
				setAccountLoading(true);
				setAccountError(null);
				const target = providerId;
				if (target === null) {
					setAccountLoading(false);
					setAccountError("no providers");
					return;
				}
				const query = `?provider=${encodeURIComponent(target)}${force ? "&refresh=1" : ""}`;
				return fetchJson(`/api/usage-stats/account${query}`).then((payload) => {
					if (!mountedRef.current || !accountLoaderRef.current.isCurrent(seq)) return;
					if (payload.ok !== true) {
						setAccountError(payload.message ?? "account fetch failed");
						return;
					}
					setAccount(payload.account);
					setRefreshedAt(payload.account?.fetchedAt ?? Date.now());
				}).catch((error) => {
					if (!mountedRef.current || !accountLoaderRef.current.isCurrent(seq)) return;
					setAccountError(error instanceof Error ? error.message : String(error));
				}).finally(() => {
					if (mountedRef.current && accountLoaderRef.current.isCurrent(seq)) setAccountLoading(false);
				});
			}, []);

			const loadPlatform = react.useCallback((monthKey, force = false) => {
				const seq = platformLoaderRef.current.start();
				setPlatformLoading(true);
				setPlatformError(null);
				const [year, month] = monthKey.split("-").map(Number);
				if (!Number.isInteger(year) || !Number.isInteger(month)) {
					setPlatformLoading(false);
					setPlatformError("invalid month");
					return;
				}
				const query = `?month=${month}&year=${year}${force ? "&refresh=1" : ""}`;
				return fetchJson(`/api/usage-stats/platform${query}`).then((payload) => {
					if (!mountedRef.current || !platformLoaderRef.current.isCurrent(seq)) return;
					if (payload.ok !== true) {
						// Unconfigured usage token: keep the quiet state so the
						// panel shows the configuration hint instead of an error.
						if (payload.error === "no-credential") {
							setPlatform(null);
							setPlatformTotal(null);
							return;
						}
						setPlatformError(payload.message ?? "platform usage fetch failed");
						return;
					}
					setPlatform(payload);
					setRefreshedAt(payload.fetchedAt ?? Date.now());
				}).catch((error) => {
					if (!mountedRef.current || !platformLoaderRef.current.isCurrent(seq)) return;
					setPlatformError(error instanceof Error ? error.message : String(error));
				}).finally(() => {
					if (mountedRef.current && platformLoaderRef.current.isCurrent(seq)) setPlatformLoading(false);
				});
			}, []);

			// 平台全部历史 token 合计（平台口径的“累计”）；月度回扫由服务端缓存。
			const loadPlatformTotal = react.useCallback((force = false) => {
				return fetchJson(`/api/usage-stats/platform/total${force ? "?refresh=1" : ""}`).then((payload) => {
					if (!mountedRef.current || payload?.ok !== true) return;
					setPlatformTotal(payload);
				}).catch(() => { /* best-effort: 累计回退到本地全量 */ });
			}, []);

			// 最近 14 天行与热力图同源（平台日数据），且不随查看月份变化：
			// 窗口最多横跨两个月，按需拉取这两个月的平台用量（服务端按月
			// 缓存 5 分钟，与热力图共享缓存）。平台数据不可用时回退本地会话。
			const loadRecentPlatform = react.useCallback((force = false) => {
				const seq = ++recentPlatSeqRef.current;
				const cutoff = dayKeyOf(new Date(Date.now() - 13 * 86400000));
				const today = todayKey();
				const monthKeys = [cutoff.slice(0, 7), today.slice(0, 7)].filter((key, index, all) => all.indexOf(key) === index);
				return Promise.all(monthKeys.map((key) => {
					const [year, month] = key.split("-").map(Number);
					return fetchJson(`/api/usage-stats/platform?month=${month}&year=${year}${force ? "&refresh=1" : ""}`).catch(() => null);
				})).then((payloads) => {
					if (!mountedRef.current || recentPlatSeqRef.current !== seq) return;
					const map = new Map();
					for (const payload of payloads) {
						if (payload?.ok !== true || !Array.isArray(payload.days)) continue;
						for (const day of payload.days) map.set(day.date, platformDayToLocalShape(day));
					}
					setRecentPlat(map.size > 0 ? map : null);
				}).catch(() => {
					if (mountedRef.current && recentPlatSeqRef.current === seq) setRecentPlat(null);
				});
			}, []);

			const loadTokenStatus = react.useCallback(() => {				fetchJson("/api/usage-stats/platform/token").then((payload) => {
					if (!mountedRef.current || payload?.ok !== true) return;
					setTokenStatus({ configured: payload.configured === true, source: payload.source ?? null });
				}).catch(() => { /* status read is best-effort */ });
			}, []);

			/** POST a new usage token, then force-refresh the platform usage so the panel updates immediately. */
			const saveToken = react.useCallback(() => {
				setTokenBusy(true);
				setTokenMessage(translate("token.saving"));
				fetch("/api/usage-stats/platform/token", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ token: tokenInput })
				}).then((response) => response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }))).then((payload) => {
					if (!mountedRef.current) return;
					if (payload?.ok !== true) {
						setTokenMessage(translate("token.saveFailed", { message: payload?.message ?? "" }));
						return;
					}
					setTokenInput("");
					setTokenStatus({ configured: true, source: "stored" });
					setTokenJustSaved(true);
					// 同步更新显示：保存后立即拉取最新平台用量与累计。
					loadPlatform(platformMonth, true);
					loadPlatformTotal(true);
					loadRecentPlatform(true);
				}).catch((error) => {
					if (mountedRef.current) setTokenMessage(translate("token.saveFailed", { message: error instanceof Error ? error.message : String(error) }));
				}).finally(() => {
					if (mountedRef.current) setTokenBusy(false);
				});
			}, [tokenInput, platformMonth, loadPlatform, loadPlatformTotal, loadRecentPlatform, translate]);

			/** DELETE the stored token and reset the platform panel to its hint state. */
			const clearToken = react.useCallback(() => {
				setTokenBusy(true);
				fetch("/api/usage-stats/platform/token", { method: "DELETE" }).then((response) => response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }))).then((payload) => {
					if (!mountedRef.current) return;
					if (payload?.ok !== true) {
						setTokenMessage(translate("token.clearFailed", { message: payload?.message ?? "" }));
						return;
					}
					setTokenStatus({ configured: false, source: null });
					setTokenInput("");
					setTokenMessage(translate("token.cleared"));
					setPlatform(null);
					setPlatformTotal(null);
					setRecentPlat(null);
					setPlatformError(null);
				}).catch((error) => {
					if (mountedRef.current) setTokenMessage(translate("token.clearFailed", { message: error instanceof Error ? error.message : String(error) }));
				}).finally(() => {
					if (mountedRef.current) setTokenBusy(false);
				});
			}, []);

			const pasteToken = react.useCallback(() => {
				if (typeof navigator === "undefined" || typeof navigator.clipboard?.readText !== "function") {
					setTokenMessage(translate("token.pasteUnavailable"));
					return;
				}
				navigator.clipboard.readText().then((text) => {
					if (!mountedRef.current) return;
					setTokenInput(String(text ?? "").trim());
					setTokenMessage(translate("token.pasted"));
				}).catch(() => {
					if (mountedRef.current) setTokenMessage(translate("token.pasteFailed"));
				});
			}, []);

			/**
			 * 方式一：网页登录自动同步。POST 让服务端打开系统浏览器窗口登录
			 * platform.deepseek.com，捕获并验证用量 Token 后自动保存；这里轮询
			 * 同步状态，捕获成功立即强制刷新平台用量并同步显示。
			 */
			const startSync = react.useCallback(() => {
				setTokenBusy(true);
				setSyncRunning(true);
				setTokenMessage(translate("token.syncStarting"));
				fetch("/api/usage-stats/platform/sync", { method: "POST" }).then((response) => response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }))).then((payload) => {
					if (!mountedRef.current) return;
					if (payload?.ok !== true) {
						setSyncRunning(false);
						setTokenMessage(translate(payload?.error === "sync-unavailable" ? "token.syncUnavailable" : "token.syncFailed", { message: payload?.message ?? "" }));
						return;
					}
					setTokenMessage(translate("token.syncOpened"));
					const startedAt = Date.now();
					const timer = window.setInterval(() => {
						if (!mountedRef.current) {
							window.clearInterval(timer);
							return;
						}
						if (Date.now() - startedAt > 390000) {
							window.clearInterval(timer);
							setSyncRunning(false);
							setTokenMessage(translate("token.syncTimeout"));
							return;
						}
						fetch("/api/usage-stats/platform/sync", { headers: { accept: "application/json" } }).then((response) => response.json()).then((statusPayload) => {
							if (!mountedRef.current || statusPayload?.ok !== true) return;
							if (statusPayload.running === true) return;
							window.clearInterval(timer);
							setSyncRunning(false);
							if (statusPayload.last?.ok === true) {
								setTokenStatus({ configured: true, source: "stored" });
								setTokenMessage(translate("token.syncCaptured"));
								setTokenJustSaved(true);
								// 同步更新显示：捕获成功后立即拉取最新平台用量。
								loadPlatform(platformMonth, true);
								loadRecentPlatform(true);
							} else {
								setTokenMessage(translate("token.syncFailed", { message: statusPayload.last?.message ?? "" }));
							}
						}).catch(() => { /* keep polling */ });
					}, 2000);
				}).catch((error) => {
					if (!mountedRef.current) return;
					setSyncRunning(false);
					setTokenMessage(translate("token.syncFailed", { message: error instanceof Error ? error.message : String(error) }));
				}).finally(() => {
					if (mountedRef.current) setTokenBusy(false);
				});
			}, [platformMonth, loadPlatform, loadRecentPlatform, translate]);

			const stopSync = react.useCallback(() => {
				setSyncRunning(false);
				setTokenMessage(translate("token.syncStopped"));
				fetch("/api/usage-stats/platform/sync", { method: "DELETE" }).catch(() => {});
			}, []);

			react.useEffect(() => {
				mountedRef.current = true;
				return () => {
					mountedRef.current = false;
				};
			}, []);

			// 点击面板外任意处即可关闭（弹出式面板常规交互）：面板或徽标
			// 内部的 mousedown 不触发，其余任意位置（含 dsh 页面其他元素）
			// 按下即收起，无需点右上角 ×。
			react.useEffect(() => {
				if (!open || typeof document === "undefined") return;
				const onPointerDown = (event) => {
					const target = event?.target;
					if (target === null || target === void 0 || typeof target.closest !== "function") return;
					if (target.closest(`.${S.panel}, .${S.badge}`) !== null) return;
					closePanel();
				};
				document.addEventListener("mousedown", onPointerDown, true);
				return () => document.removeEventListener("mousedown", onPointerDown, true);
			}, [open, closePanel]);

			react.useEffect(() => {
				if (!open) return;
				loadUsage();
				const usageTimer = window.setInterval(() => loadUsage(), 60000);
				return () => {
					window.clearInterval(usageTimer);
				};
			}, [open, loadUsage]);

			// Warm the panel as soon as the sidebar renders, so the FIRST open already
			// has data and shows the heatmap instead of the loading skeleton. Requests
			// stay silent while closed: the open-time effects above re-issue each one
			// (clearing any error a failed prefetch left behind) and own the polling.
			react.useEffect(() => {
				loadUsage();
				loadAccount("deepseek-official");
				loadPlatform(platformMonth);
				loadPlatformTotal();
				loadRecentPlatform();
				// Page-load-only warm-up: the loaders are stable callbacks, so this runs
				// exactly once per page load and never on a month change.
			}, []);

			// Fetch the DeepSeek account. The server refreshes all providers
			// in the background; this request normally reads its five-minute cache.
			react.useEffect(() => {
				if (!open) return;
				loadAccount("deepseek-official");
				const timer = window.setInterval(() => loadAccount("deepseek-official"), 300000);
				return () => {
					window.clearInterval(timer);
				};
			}, [open, loadAccount]);

			// DeepSeek platform usage follows the viewed month; refresh every five
			// minutes while the panel stays open (server caches per month). The
			// recent-14-days list is windowed independently of the viewed month.
			react.useEffect(() => {
				if (!open) return;
				loadPlatform(platformMonth);
				loadPlatformTotal();
				loadRecentPlatform();
				const timer = window.setInterval(() => loadPlatform(platformMonth), 300000);
				return () => {
					window.clearInterval(timer);
				};
			}, [open, platformMonth, loadPlatform, loadRecentPlatform]);

			// 保存用量 Token 后，平台数据一到达就把“已保存”消息升级为消费金额，
			// 让设置页与主面板的数据同步更新。
			react.useEffect(() => {
				if (tokenJustSaved && platform !== null) {
					setTokenMessage(translate("token.savedCost", { cost: fmtCurrency(platform.monthCost, "CNY") }));
					setTokenJustSaved(false);
				}
			}, [tokenJustSaved, platform, translate]);

			const dayMap = react.useMemo(() => {
				const map = new Map();
				if (usage !== null && Array.isArray(usage.days)) {
					for (const day of usage.days) map.set(day.date, day);
				}
				return map;
			}, [usage]);

			// 热力图数据源：平台用量可用时显示平台获取的每日用量（映射为热力图
			// 需要的日结构，可点选下钻），否则回退到本地会话用量。
			const platformActive = platform !== null && Array.isArray(platform.days) && platform.days.length > 0;
			const heatDayMap = react.useMemo(() => {
				if (!platformActive) return dayMap;
				const map = new Map();
				for (const day of platform.days) map.set(day.date, platformDayToLocalShape(day));
				return map;
			}, [platformActive, platform, dayMap]);

			// Drop a stale selection when refreshed data no longer has that day.
			react.useEffect(() => {
				if (selectedDay !== null && !heatDayMap.has(selectedDay)) setSelectedDay(null);
			}, [heatDayMap, selectedDay]);

			// 选中平台日时拉取当日更细数据（小时分布 + 按 API Key）；本地日没有。
			react.useEffect(() => {
				if (selectedDay === null || !platformActive) {
					dayDetailSeqRef.current += 1;
					setDayDetail(null);
					setDayDetailLoading(false);
					return;
				}
				const seq = ++dayDetailSeqRef.current;
				setDayDetailLoading(true);
				fetchJson(`/api/usage-stats/platform/day?date=${selectedDay}`).then((payload) => {
					if (!mountedRef.current || dayDetailSeqRef.current !== seq) return;
					setDayDetail(payload?.ok === true ? payload : null);
				}).catch(() => {
					if (mountedRef.current && dayDetailSeqRef.current === seq) setDayDetail(null);
				}).finally(() => {
					if (mountedRef.current && dayDetailSeqRef.current === seq) setDayDetailLoading(false);
				});
			}, [selectedDay, platformActive]);

			const heat = react.useMemo(() => {
				// platformMonth is `YYYY-MM` with a 1-based month; the builder wants 0-based.
				const [year, monthOneBased] = platformMonth.split("-").map(Number);
				return buildMonthHeatmap(heatDayMap, year, monthOneBased - 1);
			}, [heatDayMap, platformMonth]);

			const stats = react.useMemo(() => {
				if (usage === null || !Array.isArray(usage.days)) return null;
				const today = todayKey();
				const month = today.slice(0, 7);
				let todayEntry = null;
				let dayTokens = 0;
				let monthTokens = 0;
				let total = usage.total?.tokens ?? 0;
				for (const day of usage.days) {
					if (day.date === today) {
						dayTokens = day.tokens ?? 0;
						todayEntry = day;
					}
					if (day.date.startsWith(month)) monthTokens += day.tokens ?? 0;
				}
				return { dayTokens, monthTokens, total, todayHit: todayEntry?.cacheHitRate ?? null };
			}, [usage]);

			// 平台口径条带：Token 数字与热力图同源（平台可用 → 平台日合计；
			// 否则本地日志折叠）。视图月没有"今日"时显示 0；"本月"为该月
			// 合计；"累计"为平台全部历史（平台合计不可用时回退本地全量）。
			const bandDayTokens = todayKey().startsWith(platformMonth) ? (heatDayMap.get(todayKey())?.tokens ?? 0) : 0;
			const bandMonthTokens = react.useMemo(() => tokensForMonth([...heatDayMap.values()], platformMonth), [heatDayMap, platformMonth]);
			const bandTotalTokens = platformTotal !== null && typeof platformTotal.total === "number" ? platformTotal.total : (stats?.total ?? 0);

			const recent = react.useMemo(() => {
				// Last 14 CALENDAR days (not "last 14 recorded days"): days without
				// usage inside the window are omitted from the list. Cut off by
				// calendar day in GMT+8 to match the unified display timezone.
				// Source-unified with the heatmap: platform days win (they are the
				// same data the heatmap shows), local session days fill the gaps.
				if (usage === null || !Array.isArray(usage.days)) return [];
				const cutoff = new Date(Date.now() - 13 * 86400000);
				return recentDaysOf(recentPlat, usage.days, dayKeyOf(cutoff), todayKey());
			}, [usage, recentPlat]);

			const selectedEntry = selectedDay !== null ? heatDayMap.get(selectedDay) ?? null : null;
			const badgeCount = stats !== null || platformActive ? fmt(bandDayTokens) : null;

			// 手动刷新：按钮立刻进入「刷新中」，这批请求全部落地（无论成败）后复原。
			const refreshAll = () => {
				if (refreshing) return;
				setRefreshing(true);
				Promise.allSettled([
					loadUsage(true),
					loadAccount("deepseek-official", true),
					loadPlatform(platformMonth, true),
					loadPlatformTotal(true),
					loadRecentPlatform(true)
				]).finally(() => {
					if (mountedRef.current) setRefreshing(false);
				});
			};

			const updatedLabel = refreshedAt === null ? "" : translate("panel.updatedAt", {
				time: new Date(refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
			});

			// 面板自带的 tooltip：坐标相对最外层容器（.usg_layer），这样面板关闭时
			// 也能给徽标显示；横向按容器宽度夹取，避免贴边溢出。
			const showTip = react.useCallback((text, element) => {
				const layer = layerRef.current;
				if (layer === null || element === null || element === void 0) return;
				const box = layer.getBoundingClientRect();
				const rect = element.getBoundingClientRect();
				const half = 132;
				const width = Math.max(box.width, 264);
				const center = rect.left - box.left + rect.width / 2;
				setTip({
					text,
					x: Math.min(Math.max(center, half), Math.max(half, width - half)),
					y: rect.top - box.top - 7
				});
			}, []);
			const hideTip = react.useCallback(() => setTip(null), []);
			const hoverTip = react.useMemo(() => ({ show: showTip, hide: hideTip }), [showTip, hideTip]);

			// 视图月不是当月时，"本月/今日 Tokens" 这两个标签会与数字不符（数字跟着视图月走）。
			const viewingCurrentMonth = platformMonth === currentMonthKey();
			const monthBandLabel = translate("usage.monthTokensFor", { month: monthLabelOf(platformMonth, translate) });

			return react_jsx_runtime.jsxs("div", {
				className: wide ? S.layer : `${S.layer} ${S.rail}`,
				ref: layerRef,
				"data-usg-scheme": scheme,
				children: [
					mounted && react_jsx_runtime.jsxs("section", {
						className: S.panel,
						ref: panelRef,
						tabIndex: -1,
						"data-usage-stats-panel": true,
						"data-usg-scheme": scheme,
						"data-closing": closing || void 0,
						"aria-label": translate("panel.title"),
						children: [
							react_jsx_runtime.jsxs("header", {
								className: S.header,
								children: [
									react_jsx_runtime.jsxs("div", {
										className: S.headerLeft,
										children: [
											react_jsx_runtime.jsx(primitives.IconDataOutline16, { size: 16 }),
											react_jsx_runtime.jsx("span", { className: S.title, children: translate("panel.title") }),
											(refreshing || updatedLabel !== "") && react_jsx_runtime.jsx("span", {
												className: S.headerHint,
												// 读屏用户按了刷新也能听到结果（刷新中… → 更新于 hh:mm）。
												role: "status",
												"aria-live": "polite",
												children: refreshing ? translate("action.refreshing") : updatedLabel
											})
										]
									}),
									react_jsx_runtime.jsxs("div", {
										className: S.headerActions,
										// 独立版专属：置顶 / 最小化 / 最大化 / 关闭，顺序遵循 Windows 惯例（✕ 恒为最右）。
										// 三个图标都不挂悬浮气泡（插件侧已确认 Tooltip 在固定定位面板里会飘到内容上方）。
										children: [
											react_jsx_runtime.jsx("button", {
												type: "button",
												className: S.iconButton,
												"aria-label": translate("action.pin"),
												"aria-pressed": pinned,
												onClick: togglePin,
												children: react_jsx_runtime.jsx(primitives.IconPinOutline14, { size: 14 })
											}),
											react_jsx_runtime.jsx("button", {
												type: "button",
												className: S.iconButton,
												"aria-label": translate("action.refresh"),
												disabled: refreshing,
												"data-busy": refreshing || void 0,
												onClick: refreshAll,
												children: react_jsx_runtime.jsx(primitives.IconRefreshOutline14, { size: 14 })
											}),
											react_jsx_runtime.jsx("button", {
												type: "button",
												className: S.iconButton,
												"aria-label": translate("settings.title"),
												onClick: () => {
													// 清掉上一次的成功文案：它留在视图里会被误读成本次结果。
													setTokenMessage("");
													setShowSettings(true);
													loadTokenStatus();
												},
												children: react_jsx_runtime.jsx(primitives.IconSettingsOutline14, { size: 14 })
											}),
											react_jsx_runtime.jsx("button", {
												type: "button",
												className: S.iconButton,
												"aria-label": translate("action.minimize"),
												onClick: () => { tauriInvoke("plugin:window|minimize"); },
												children: react_jsx_runtime.jsx(primitives.IconMinimizeOutline14, { size: 14 })
											}),
											react_jsx_runtime.jsx("button", {
												type: "button",
												className: S.iconButton,
												"aria-label": translate("action.maximize"),
												onClick: () => { tauriInvoke("plugin:window|toggle_maximize"); },
												children: react_jsx_runtime.jsx(primitives.IconMaximizeOutline14, { size: 14 })
											}),
											react_jsx_runtime.jsx("button", {
												type: "button",
												className: S.iconButton,
												"aria-label": translate("action.close"),
												"data-kind": "close",
												onClick: dismissPanel,
												children: react_jsx_runtime.jsx(primitives.IconCloseOutline16, { size: 14 })
											})
										]
									})
								]
							}),
							react_jsx_runtime.jsxs("div", {
								className: S.body,
								key: view,
								ref: bodyRef,
								tabIndex: -1,
								"data-view": view,
								"data-dir": viewDir || void 0,
								onScroll: hideTip,
								children: [
									showSettings ? react_jsx_runtime.jsx(TokenSettingsView, {
										status: tokenStatus,
										busy: tokenBusy,
										message: tokenMessage,
										value: tokenInput,
										onChange: setTokenInput,
										onPaste: pasteToken,
										onSave: saveToken,
										onClear: clearToken,
										syncRunning,
										onStartSync: startSync,
										onStopSync: stopSync,
										onBack: () => setShowSettings(false),
										translate
									}) : (selectedEntry !== null ? react_jsx_runtime.jsx(DayDetail, {
										day: selectedEntry,
										dayDetail,
										detailLoading: dayDetailLoading,
										currency: platform?.currency ?? "CNY",
										translate,
										onBack: () => setSelectedDay(null)
									}) : react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
										children: [
											react_jsx_runtime.jsxs("section", {
												className: S.section,
												children: [
													react_jsx_runtime.jsx("h3", { className: S.sectionTitle, children: translate("account.title") }),
													react_jsx_runtime.jsx(DeepSeekAccountUsageCard, {
														provider: DEEPSEEK_PROVIDER,
														account: account?.id === "deepseek-official" ? account : null,
														accountLoading,
														accountError,
														platform,
														platformLoading,
														platformError,
														month: platformMonth,
														onMonthChange: setPlatformMonth,
														onRetry: () => loadAccount("deepseek-official", true),
														onRetryPlatform: () => loadPlatform(platformMonth, true),
														onConfigure: () => {
															setTokenMessage("");
															setShowSettings(true);
															loadTokenStatus();
														},
														localDayTokens: viewingCurrentMonth ? bandDayTokens : null,
														localMonthTokens: bandMonthTokens,
														// 数字跟着视图月走，标签也要跟着：翻到 7 月时"本月"就不再成立。
														monthBandLabel: viewingCurrentMonth ? void 0 : monthBandLabel,
														localTotalTokens: bandTotalTokens,
														translate
													})
												]
											}),
											stats === null && usageError === null ? react_jsx_runtime.jsx(UsageSkeleton, {}) : null,
											usageError !== null ? react_jsx_runtime.jsxs("div", {
												className: S.error,
												children: [
													react_jsx_runtime.jsx("span", { className: S.errorText, title: translate("usage.error", { message: usageError }), children: translate("usage.error", { message: usageError }) }),
													react_jsx_runtime.jsx("button", {
														type: "button",
														className: S.retry,
														onClick: loadUsage,
														children: translate("action.retry")
													})
												]
											}) : null,
											usage !== null && usageError === null && react_jsx_runtime.jsxs("section", {
												className: S.section,
												children: [
													react_jsx_runtime.jsxs("div", {
														className: S.heatHeader,
														children: [
															react_jsx_runtime.jsx("h3", { className: S.sectionTitle, children: translate("usage.heatmap") }),
															react_jsx_runtime.jsxs("div", {
																className: S.monthNav,
																children: [
																	react_jsx_runtime.jsx("button", {
																		type: "button",
																		className: S.navButton,
																		"aria-label": translate("action.prevMonth"),
																		onClick: () => setPlatformMonth(shiftMonth(platformMonth, -1)),
																		children: react_jsx_runtime.jsx(primitives.IconChevronLeftOutline14, { size: 12 })
																	}),
																	react_jsx_runtime.jsx("span", { className: S.monthTitle, children: monthLabelOf(platformMonth, translate) }),
																	react_jsx_runtime.jsx("button", {
																		type: "button",
																		className: S.navButton,
																		"aria-label": translate("action.nextMonth"),
																		disabled: platformMonth >= currentMonthKey(),
																		onClick: () => setPlatformMonth(shiftMonth(platformMonth, 1)),
																		children: react_jsx_runtime.jsx(primitives.IconChevronRightOutline14, { size: 12 })
																	}),
																	platformMonth !== currentMonthKey() && react_jsx_runtime.jsx("button", {
																		type: "button",
																		className: S.todayButton,
																		onClick: () => setPlatformMonth(currentMonthKey()),
																		children: translate("action.today")
																	})
																]
															})
														]
													}),
													react_jsx_runtime.jsx(MonthHeatmap, {
														heat,
														translate,
														selectedKey: selectedDay,
														onSelect: setSelectedDay,
														today: todayKey(),
														currency: platform?.currency ?? "CNY",
														hoverTip,
														onMonthStep: (delta) => setPlatformMonth(shiftMonth(platformMonth, delta))
													})
												]
											}),
											// A1 分层：首屏只留「账户卡 + 热力图」一屏放得下，
											// 最近 14 天与平台明细折叠在下面，展开状态不跨次记忆。
											recent.length > 0 && react_jsx_runtime.jsxs("section", {
												className: S.section,
												children: [
													react_jsx_runtime.jsxs("button", {
														type: "button",
														className: S.disclosureHead,
														"aria-expanded": recentOpen,
														onClick: () => setRecentOpen((value) => !value),
														children: [
															react_jsx_runtime.jsx("span", {
																className: S.disclosureChevron,
																"data-open": recentOpen || void 0,
																"aria-hidden": true,
																children: [react_jsx_runtime.jsx(primitives.IconChevronRightOutline14, { size: 12 })]
															}),
															react_jsx_runtime.jsx("h3", { className: S.sectionTitle, children: translate("usage.recent") }),
															react_jsx_runtime.jsx("span", { className: S.disclosureCount, children: fmt(recent.length) })
														]
													}),
													recentOpen && react_jsx_runtime.jsx("div", {
														className: S.days,
														children: recent.map((day) => {
															const maxRecent = Math.max(...recent.map((d) => d.tokens ?? 0), 1);
															return react_jsx_runtime.jsxs("button", {
																type: "button",
																className: S.day,
																onClick: () => setSelectedDay(day.date),
																children: [
																	react_jsx_runtime.jsx("span", { className: S.dayDate, children: dayLabel(day.date, translate) }),
																	react_jsx_runtime.jsx("span", { className: S.dayTokens, children: fmt(day.tokens ?? 0) }),
																	react_jsx_runtime.jsx("span", { className: S.dayHit, children: fmtHit(day.cacheHitRate) }),
																	react_jsx_runtime.jsx("div", {
																		className: S.dayBar,
																		style: { width: `${Math.max(4, Math.round(100 * (day.tokens ?? 0) / maxRecent))}%` }
																	})
																]
															}, day.date);
														})
													})
												]
											}),
											// 平台模型明细同样收进折叠：默认只露一行标题 + 模型数。
											react_jsx_runtime.jsxs("section", {
												className: S.section,
												children: [
													react_jsx_runtime.jsxs("button", {
														type: "button",
														className: S.disclosureHead,
														"aria-expanded": platformOpen,
														onClick: () => setPlatformOpen((value) => !value),
														children: [
															react_jsx_runtime.jsx("span", {
																className: S.disclosureChevron,
																"data-open": platformOpen || void 0,
																"aria-hidden": true,
																children: [react_jsx_runtime.jsx(primitives.IconChevronRightOutline14, { size: 12 })]
															}),
															react_jsx_runtime.jsx("h3", { className: S.sectionTitle, children: translate("platform.modelsTitle") }),
															(platform?.models?.length ?? 0) > 0 && react_jsx_runtime.jsx("span", { className: S.disclosureCount, children: fmt(platform.models.length) })
														]
													}),
													platformOpen && react_jsx_runtime.jsx(PlatformSection, {
														platform,
														loading: platformLoading,
														error: platformError,
														month: platformMonth,
														onMonthChange: setPlatformMonth,
														onRetry: () => loadPlatform(platformMonth, true),
														onConfigure: () => {
															setTokenMessage("");
															setShowSettings(true);
															loadTokenStatus();
														},
														translate,
														showStats: false
													})
												]
											}),
											react_jsx_runtime.jsx(ApiKeysSection, {
												apiKeys: platform?.apiKeys,
												currency: platform?.currency,
												open: apiKeysOpen,
												onToggle: () => setApiKeysOpen((value) => !value),
												translate
											}),
											updatedLabel !== "" && react_jsx_runtime.jsx("p", { className: S.footerNote, children: updatedLabel })
										]
									}))
								]
							})
						]
					}),
					react_jsx_runtime.jsx("div", {
						className: S.footerButtons,
						children: react_jsx_runtime.jsxs("button", {
							type: "button",
							className: S.badge,
							ref: badgeRef,
							"data-usage-stats-badge": true,
							"aria-label": translate("panel.badge"),
							"aria-expanded": open,
							// 窄侧栏（rail）只剩一个图标：用面板自绘 tooltip 补上「今日用量」。
							onMouseEnter: wide ? void 0 : (event) => showTip(`${translate("panel.badge")} · ${translate("usage.todayTokens")} ${fmt(bandDayTokens)}`, event.currentTarget),
							onMouseLeave: wide ? void 0 : hideTip,
							onFocus: wide ? void 0 : (event) => showTip(`${translate("panel.badge")} · ${translate("usage.todayTokens")} ${fmt(bandDayTokens)}`, event.currentTarget),
							onBlur: wide ? void 0 : hideTip,
							onClick: () => (open ? closePanel() : openPanel()),
							children: [
								react_jsx_runtime.jsx(primitives.IconDataOutline16, { size: wide ? 14 : 18 }),
								wide && react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
									children: [
										react_jsx_runtime.jsx("span", { className: S.badgeLabel, children: translate("panel.badge") }),
										badgeCount !== null && react_jsx_runtime.jsx("span", { className: S.badgeCount, children: badgeCount })
									]
								})
							]
						})
					}),
					// tooltip 挂在最外层：面板关闭时也要能给徽标显示（坐标相对 .usg_layer）。
					tip !== null && react_jsx_runtime.jsx("div", {
						className: S.tip,
						role: "tooltip",
						style: { left: tip.x, top: tip.y },
						children: tip.text
					})
				]
			});
		}

		/** DeepSeek 官方品牌 logo 中的鲸鱼图形（www.deepseek.com 页面内嵌 SVG 提取）。 */
		const DEEPSEEK_WHALE_D = "M26.5174 3.39471C26.235 3.2567 26.1137 3.52006 25.9487 3.65346C25.8923 3.69659 25.8446 3.75294 25.7969 3.80469C25.3846 4.24516 24.9027 4.53439 24.2737 4.49989C23.3536 4.44814 22.5682 4.73737 21.8735 5.44119C21.7258 4.57349 21.2353 4.0554 20.4889 3.72304C20.0985 3.55054 19.7034 3.37746 19.4297 3.00197C19.2388 2.73459 19.1865 2.43673 19.091 2.14289C19.0301 1.96579 18.9697 1.78466 18.7656 1.75418C18.5442 1.71968 18.4574 1.90541 18.3705 2.06067C18.0232 2.69549 17.8887 3.39471 17.9019 4.10313C17.9324 5.6965 18.6051 6.96556 19.9421 7.86834C20.0939 7.97184 20.133 8.07535 20.0852 8.22658C19.9938 8.53766 19.8857 8.83955 19.7903 9.15063C19.7293 9.34901 19.6384 9.39271 19.4257 9.30588C18.692 8.9994 18.0583 8.54571 17.4982 7.99772C16.5477 7.07827 15.6881 6.06336 14.6162 5.26869C14.3644 5.08296 14.1125 4.91045 13.8521 4.746C12.7584 3.68394 13.9952 2.81164 14.2816 2.70814C14.5812 2.60003 14.3857 2.22857 13.4179 2.23317C12.4502 2.2372 11.5646 2.56151 10.4359 2.99335C10.2708 3.05832 10.0972 3.10547 9.91951 3.14457C8.8954 2.95022 7.83162 2.90709 6.72069 3.03245C4.62877 3.26533 2.95777 4.25436 1.72954 5.94261C0.254043 7.97184 -0.0932678 10.2777 0.33167 12.6824C0.778458 15.2171 2.07225 17.3153 4.06008 18.9558C6.12152 20.6567 8.49577 21.4905 11.2047 21.3306C12.8498 21.2358 14.6812 21.0155 16.7473 19.2669C17.2682 19.5262 17.8151 19.6297 18.7219 19.7074C19.4205 19.7723 20.0933 19.6729 20.6143 19.5648C21.4302 19.3923 21.3739 18.6367 21.0789 18.4981C18.6874 17.3843 19.2124 17.8374 18.7351 17.4706C19.9501 16.033 21.8063 13.4776 22.379 9.99821C22.4353 9.61409 22.5072 9.073 22.4986 8.76192C22.494 8.57216 22.5377 8.49856 22.7545 8.47671C23.3536 8.40771 23.935 8.24383 24.4692 7.94999C26.0188 7.10357 26.6439 5.71318 26.7911 4.04678C26.8129 3.79204 26.7865 3.52869 26.5174 3.39471ZM13.0143 18.3946C10.6964 16.5724 9.5722 15.9726 9.10816 15.9985C8.67402 16.0244 8.75222 16.5212 8.84768 16.8449C8.94773 17.1646 9.07768 17.3849 9.25996 17.6655C9.38589 17.8512 9.47272 18.1272 9.13404 18.3348C8.38766 18.7965 7.08985 18.1796 7.0289 18.1491C5.51833 17.2595 4.25559 16.0853 3.36546 14.4793C2.50581 12.9337 2.0067 11.2753 1.92447 9.50542C1.90262 9.07818 2.02855 8.92695 2.45406 8.84932C3.01413 8.74582 3.59144 8.72397 4.15093 8.80619C6.51656 9.15178 8.53027 10.2092 10.2185 11.8848C11.1822 12.8388 11.9114 13.979 12.6623 15.0929C13.461 16.2757 14.3201 17.4027 15.4144 18.3268C15.8008 18.6505 16.109 18.8966 16.404 19.0783C15.5144 19.1778 14.0297 19.1991 13.0143 18.3958V18.3946ZM14.1252 11.2489C14.1252 11.0591 14.277 10.9079 14.4679 10.9079C14.511 10.9079 14.5501 10.9165 14.5852 10.9292C14.6329 10.9464 14.6766 10.9723 14.7111 11.0114C14.7721 11.0718 14.8066 11.158 14.8066 11.2489C14.8066 11.4386 14.6548 11.5899 14.4639 11.5899C14.273 11.5899 14.1252 11.4386 14.1252 11.2489ZM17.5759 13.0188C17.3545 13.1096 17.1331 13.1873 16.9203 13.1959C16.5903 13.2131 16.2303 13.0791 16.0348 12.9153C15.7312 12.6605 15.5139 12.5179 15.423 12.0734C15.3839 11.8837 15.4057 11.5899 15.4402 11.4214C15.5185 11.0585 15.4316 10.8257 15.1757 10.614C14.9676 10.4415 14.7025 10.3938 14.4115 10.3938C14.3029 10.3938 14.2034 10.3461 14.1292 10.3076C14.0079 10.2472 13.9078 10.096 14.0033 9.91023C14.0338 9.84985 14.1815 9.70322 14.216 9.67734C14.6111 9.45251 15.0665 9.52612 15.488 9.6946C15.8784 9.85445 16.174 10.1477 16.5989 10.5623C17.033 11.0631 17.1112 11.2011 17.3585 11.5772C17.554 11.871 17.7317 12.1729 17.8536 12.5185C17.9272 12.7341 17.8317 12.9107 17.5759 13.0188Z";

		/** 账户角标内容：DeepSeek 官方鲸鱼图形。 */
		function accountMarkContent() {
			return react_jsx_runtime.jsx("svg", {
				viewBox: "-0.4 1.4 27.4 20.4",
				"aria-hidden": true,
				children: react_jsx_runtime.jsx("path", {
					d: DEEPSEEK_WHALE_D,
					fill: "currentColor",
					fillRule: "evenodd",
					clipRule: "evenodd"
				})
			});
		}

		/** Balance body rendered inside the DeepSeek account card. */
		function BalanceContent({ balance, state, message, translate, onRetry, compact }) {
			if (state === "loading" || balance === null && state === "ok") return react_jsx_runtime.jsx("p", { className: S.balanceNote, children: translate("balance.loading") });
			if (state === "unsupported") return react_jsx_runtime.jsx("p", { className: S.balanceNote, children: translate("balance.unsupported") });
			if (state === "no-credential") return react_jsx_runtime.jsx("p", { className: S.balanceNote, children: translate("balance.noCredential", { ref: message ?? "" }) });
			if (state === "error") return react_jsx_runtime.jsxs("div", {
				className: S.error,
				children: [
					react_jsx_runtime.jsx("span", { children: translate("balance.error", { message: message ?? "" }) }),
					react_jsx_runtime.jsx("button", { type: "button", className: S.retry, onClick: onRetry, children: translate("action.retry") })
				]
			});
			const rows = [
				{ value: balance.used, label: translate("balance.used") },
				{ value: balance.total, label: translate("balance.total") },
				{ value: balance.breakdown?.toppedUp, label: translate("balance.toppedUp") },
				{ value: balance.breakdown?.granted, label: translate("balance.granted") }
			].filter((row) => row.value !== null && row.value !== void 0);
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsxs("div", {
						className: S.balanceMain,
						// 余额刷新后播报一次（读屏用户按刷新才知道数字变了）。
						role: "status",
						"aria-live": "polite",
						children: [
							react_jsx_runtime.jsx("span", { className: S.balanceAmount, children: balance.unlimited ? "∞" : fmtCurrency(balance.remaining, balance.currency) }),
							react_jsx_runtime.jsx("span", { className: S.accountPlan, children: translate("balance.remaining") })
						]
					}),
					// compact: 充值/赠送等明细行已删除（用户要求），只留可用余额。
					compact ? null : react_jsx_runtime.jsx("div", {
						className: S.balanceRows,
						children: rows.map((row, index) => react_jsx_runtime.jsxs("div", {
							className: S.balanceRow,
							children: [
								react_jsx_runtime.jsx("span", { children: row.label }),
								react_jsx_runtime.jsx("span", { children: fmtCurrency(row.value, balance.currency) })
							]
						}, `${row.label}-${index}`))
					})
				]
			});
		}

		function accountStatusLabel(status, translate) {
			if (status === "ok") return translate("account.status.ok");
			if (status === "not-configured") return translate("account.status.notConfigured");
			if (status === "unauthorized") return translate("account.status.unauthorized");
			if (status === "rate-limited") return translate("account.status.rateLimited");
			if (status === "invalid-response") return translate("account.status.invalidResponse");
			if (status === "unsupported") return translate("account.status.unsupported");
			return translate("account.status.unavailable");
		}

		/**
		 * One day's per-model breakdown. `day` is the wire day entry carrying
		 * `tokens`, `cacheHitRate`, and `models` (descending by tokens).
		 */
		/** Token composition segments: 命中 / 未命中 / 输出 (本地日追加缓存写入).
		 * 颜色走语义令牌（缓存=青绿、未命中=琥珀、输出=蓝、缓存写=紫），浅深主题各自有一档。 */
		const COMP_COLORS = { hit: "var(--usg-cache)", miss: "var(--usg-cost)", response: "var(--usg-token)", write: "var(--usg-write)" };

		/**
		 * Stacked composition bar: segments share the track by flex-grow (pure
		 * CSS, no chart library). `legend` renders per-segment labels + percent.
		 */
		function CompositionBar({ segments, translate, legend, compact }) {
			const total = segments.reduce((sum, seg) => sum + seg.value, 0);
			if (segments.length === 0 || total <= 0) return null;
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsxs("div", {
						className: compact ? `${S.compTrack} ${S.compSmall}` : S.compTrack,
						children: segments.map((seg) => react_jsx_runtime.jsx("i", {
							className: S.compSeg,
							style: { background: COMP_COLORS[seg.kind ?? seg.key], flexGrow: seg.value }
						}, seg.key))
					}),
					legend && react_jsx_runtime.jsxs("div", {
						className: S.compLegend,
						children: segments.map((seg) => {
							const percent = Math.round((seg.value / total) * 1000) / 10;
							return react_jsx_runtime.jsxs("span", {
								className: S.compLegendItem,
								children: [
									react_jsx_runtime.jsx("i", { style: { background: COMP_COLORS[seg.kind ?? seg.key] } }),
									seg.label,
									react_jsx_runtime.jsx("b", { children: `${percent}%` })
								]
							}, seg.key);
						})
					})
				]
			});
		}

		/**
		 * One day's per-model breakdown. The heatmap always feeds a normalized
		 * day entry (`tokens`, `inputTokens`, `outputTokens`, `cacheReadTokens`,
		 * `cacheWriteTokens`, `models[]`); platform-mapped days additionally
		 * carry `requestCount` and `cost`, and the `dayDetail` payload adds the
		 * hourly distribution + per-API-Key rows for the selected day.
		 */
		function DayDetail({ day, translate, onBack, dayDetail = null, currency = "CNY", detailLoading = false }) {
			const models = Array.isArray(day.models) ? day.models : [];
			const totalTokens = day.tokens ?? 0;
			const hasRequests = (day.requestCount ?? 0) > 0;
			const hasCost = (day.cost ?? 0) > 0;
			const segments = [
				{ key: "hit", label: translate("platform.hit"), value: day.cacheReadTokens ?? 0 },
				{ key: "miss", label: translate("platform.miss"), value: day.inputTokens ?? 0 },
				{ key: "response", label: translate("platform.output"), value: day.outputTokens ?? 0 },
				{ key: "write", label: translate("usage.cacheWrite"), value: day.cacheWriteTokens ?? 0 }
			].filter((seg) => seg.value > 0);
			// 左文字 + 右环形图：标题前置「总消耗」，指标一行跟随，构成图例点收尾。
			const heroValue = fmt(totalTokens);
			const sideItems = [
				...(hasRequests ? [{ value: fmt(day.requestCount), label: translate("platform.requests") }] : []),
				...(hasCost ? [{ value: fmtCurrency(day.cost, currency), label: translate("usage.cost") }] : [])
			];
			// 环形分段：极小占比（如 0.1%）也保证最小可视角度，三类颜色都能看清；
			// 差额从最大段扣除，图例仍显示真实百分比。SVG 圆弧渲染（矢量抗锯齿优于 conic-gradient 硬切）。
			const MIN_SEG_DEG = 3;
			const RING_R = 50;
			const RING_C = 2 * Math.PI * RING_R;
			const ringTotal = segments.reduce((sum, seg) => sum + seg.value, 0);
			const ringFracs = ringTotal > 0 ? segments.map((seg) => Math.max(MIN_SEG_DEG / 360, seg.value / ringTotal)) : [];
			if (ringFracs.length > 0) {
				const maxIndex = ringFracs.indexOf(Math.max(...ringFracs));
				ringFracs[maxIndex] = Math.max(MIN_SEG_DEG / 360, 1 - ringFracs.reduce((sum, frac) => sum + frac, 0) + ringFracs[maxIndex]);
			}
			let ringCursor = 0;
			const ringArcs = segments.map((seg, index) => {
				const start = ringCursor;
				const frac = ringFracs[index] ?? 0;
				ringCursor += frac;
				return { key: seg.key, color: COMP_COLORS[seg.kind ?? seg.key], dash: frac * RING_C, offset: -start * RING_C };
			});
			const hours = dayDetail !== null && Array.isArray(dayDetail.hours) ? dayDetail.hours : null;
			const perKey = dayDetail !== null && Array.isArray(dayDetail.perKey) ? dayDetail.perKey : null;
			const maxHourTokens = hours !== null ? hours.reduce((max, h) => Math.max(max, h.tokens ?? 0), 0) : 0;
			const peakHour = hours !== null && maxHourTokens > 0 ? hours.find((h) => (h.tokens ?? 0) === maxHourTokens)?.hour ?? null : null;
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsxs("div", {
						className: S.detailHeader,
						children: [
							react_jsx_runtime.jsx("button", {
								type: "button",
								className: S.back,
								"aria-label": translate("usage.back"),
								onClick: onBack,
								children: react_jsx_runtime.jsx(primitives.IconChevronLeftOutline14, { size: 14 })
							}),
							react_jsx_runtime.jsx("span", { className: S.detailDate, children: dayLabel(day.date, translate) })
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: S.dayHeroWrap,
						children: [
							react_jsx_runtime.jsxs("div", {
								className: S.dayLeft,
								children: [
									react_jsx_runtime.jsxs("div", {
										className: S.dayTitleRow,
										children: [
											react_jsx_runtime.jsx("span", { className: S.dayTitle, children: translate("usage.dayTotal") }),
											react_jsx_runtime.jsx("b", { className: S.dayHero, children: heroValue })
										]
									}),
									sideItems.length > 0 && react_jsx_runtime.jsxs("div", {
										className: S.daySide,
										children: sideItems.map((item) => react_jsx_runtime.jsxs("span", {
											className: S.daySideItem,
											children: [
												item.label,
												react_jsx_runtime.jsx("b", { children: item.value })
											]
										}, item.label))
									}),
									segments.length > 0 && react_jsx_runtime.jsxs("div", {
										className: S.compLegend,
										children: segments.map((seg) => {
											const percent = ringTotal > 0 ? Math.round((seg.value / ringTotal) * 1000) / 10 : 0;
											return react_jsx_runtime.jsxs("span", {
												className: S.compLegendItem,
												children: [
													react_jsx_runtime.jsx("i", { style: { background: COMP_COLORS[seg.kind ?? seg.key] } }),
													seg.label,
													react_jsx_runtime.jsx("b", { children: `${percent}%` })
												]
											}, seg.key);
										})
									})
								]
							}),
							react_jsx_runtime.jsxs("div", {
								className: S.dayRing,
								role: "img",
								"aria-label": translate("usage.ringLabel", { total: heroValue }),
								children: [
									react_jsx_runtime.jsxs("svg", {
										className: S.dayRingSvg,
										viewBox: "0 0 120 120",
										"aria-hidden": true,
										children: [
											react_jsx_runtime.jsx("circle", { className: S.dayRingTrack, cx: 60, cy: 60, r: RING_R }),
											...ringArcs.map((arc) => react_jsx_runtime.jsx("circle", {
												className: S.dayRingArc,
												cx: 60,
												cy: 60,
												r: RING_R,
												stroke: arc.color,
												strokeDasharray: `${arc.dash.toFixed(3)} ${RING_C.toFixed(3)}`,
												strokeDashoffset: arc.offset.toFixed(3),
												transform: "rotate(-90 60 60)"
											}, arc.key))
										]
									}),
									react_jsx_runtime.jsxs("div", {
										className: S.dayRingCenter,
										children: [
											react_jsx_runtime.jsx("b", { children: fmtHit(day.cacheHitRate) }),
											react_jsx_runtime.jsx("span", { children: translate("usage.hitRate") })
										]
									})
								]
							})
						]
					}),
					react_jsx_runtime.jsx("div", { className: S.dayDivider }),
					// B3: 平台明细还在路上时先给骨架，避免小时图/host 明细"迟到跳入"。
					detailLoading && hours === null ? react_jsx_runtime.jsx("div", {
						className: S.hourBlock,
						"aria-hidden": true,
						children: react_jsx_runtime.jsx("div", {
							className: S.skelList,
							children: [0, 1].map((index) => react_jsx_runtime.jsx("div", { className: `${S.skelBlock} ${S.skelRow}` }, `day-skel-${index}`))
						})
					}) : null,
					hours !== null && hours.length > 0 && react_jsx_runtime.jsxs("div", {
						className: S.hourBlock,
						children: [
							react_jsx_runtime.jsxs("div", {
								className: S.hourChart,
								// 24 根柱子是纯视觉：给读屏一句摘要，柱体本身由 role=img 隐去。
								role: "img",
								"aria-label": translate("usage.hourSummary", {
									peak: peakHour === null ? "—" : `${String(peakHour).padStart(2, "0")}:00`,
									total: fmt(maxHourTokens)
								}),
								children: hours.map((h) => {
									const percent = h.tokens > 0 && maxHourTokens > 0 ? Math.max(6, Math.round(100 * h.tokens / maxHourTokens)) : 2;
									const isPeak = peakHour !== null && h.hour === peakHour;
									return react_jsx_runtime.jsxs("div", {
										className: S.hourCol,
										"data-peak": isPeak ? true : void 0,
										title: `${String(h.hour).padStart(2, "0")}:00–${String((h.hour + 1) % 24).padStart(2, "0")}:00 · ${fmt(h.tokens ?? 0)} tokens · ${translate("platform.requests")} ${fmt(h.requestCount ?? 0)} · ${fmtCurrency(h.cost ?? 0, currency)}`,
										children: [
											isPeak && react_jsx_runtime.jsx("span", { className: S.hourPeak, children: `${String(h.hour).padStart(2, "0")}:00` }),
											react_jsx_runtime.jsx("div", { className: S.hourFill, style: { height: `${percent}%` } })
										]
									}, h.hour);
								})
							}),
							react_jsx_runtime.jsxs("div", {
								className: S.hourAxis,
								children: [1, 6, 12, 18].map((hour) => react_jsx_runtime.jsx("span", {
									style: { left: `${(100 * hour) / 24}%` },
									children: `${String(hour).padStart(2, "0")}`
								}, hour))
							})
						]
					}),
					perKey !== null && perKey.length > 0 && react_jsx_runtime.jsxs("div", {
						className: S.dayKeys,
						children: [
							react_jsx_runtime.jsx("div", { className: S.dayKeysCaption, children: translate("platform.apiKeysTitle") }),
							perKey.map((key) => react_jsx_runtime.jsxs("div", {
								className: S.dayKeyRow,
								children: [
									react_jsx_runtime.jsx("span", { className: S.dayKeyName, title: key.trackingId, children: key.name }),
									react_jsx_runtime.jsx("span", { className: S.dayKeyTokens, children: fmt(key.totalTokens ?? 0) }),
									react_jsx_runtime.jsx("span", { className: S.dayKeyMeta, children: `${translate("platform.requests")} ${fmt(key.requestCount ?? 0)} · ${fmtCurrency(key.cost ?? 0, currency)}` })
								]
							}, key.trackingId))
						]
					}),
					react_jsx_runtime.jsx("div", { className: S.dayDivider }),
					react_jsx_runtime.jsx("div", {
						className: S.days,
						children: models.length === 0 ? react_jsx_runtime.jsx("p", { className: S.note, children: translate("usage.noModels") }) : models.map((model) => {
							const share = totalTokens > 0 ? Math.max(1, Math.round(100 * (model.tokens ?? 0) / totalTokens)) : 0;
							const modelSegments = [
								{ key: "hit", label: translate("platform.hit"), value: model.cacheReadTokens ?? 0 },
								{ key: "miss", label: translate("platform.miss"), value: model.inputTokens ?? 0 },
								{ key: "response", label: translate("platform.output"), value: model.outputTokens ?? 0 },
								{ key: "write", label: translate("usage.cacheWrite"), value: model.cacheWriteTokens ?? 0 }
							].filter((seg) => seg.value > 0);
							// 一条合并条：宽度=模型占当日份额，内部分段=模型自身构成。
							const metaParts = [`${translate("platform.hit")} ${fmt(model.cacheReadTokens ?? 0)}`, `${translate("platform.miss")} ${fmt(model.inputTokens ?? 0)}`, `${translate("platform.output")} ${fmt(model.outputTokens ?? 0)}`];
							if (hasRequests) metaParts.push(`${translate("platform.requests")} ${fmt(model.requestCount ?? 0)}`);
							if (hasCost && (model.cost ?? 0) > 0) metaParts.push(`${translate("usage.cost")} ${fmtCurrency(model.cost, currency)}`);
							return react_jsx_runtime.jsxs("div", {
								className: S.modelRow,
								children: [
									react_jsx_runtime.jsxs("div", {
										className: S.modelHead,
										children: [
											react_jsx_runtime.jsx("span", { className: S.modelName, title: model.model, children: modelLabelOf(model.model, translate) }),
											react_jsx_runtime.jsx("span", { className: S.modelTokens, children: fmt(model.tokens ?? 0) }),
											react_jsx_runtime.jsx("span", { className: S.modelHit, children: fmtHit(model.cacheHitRate) })
										]
									}),
									react_jsx_runtime.jsxs("div", {
										className: S.modelBarTrack,
										children: [
											share > 0 && react_jsx_runtime.jsxs("div", {
												className: S.modelCompTrack,
												style: { width: `${share}%` },
												children: modelSegments.length > 0 ? modelSegments.map((seg) => react_jsx_runtime.jsx("i", {
													className: S.compSeg,
													// 每段至少占 1% 宽，极小占比（输出/未命中）也可见。
													style: { background: COMP_COLORS[seg.kind ?? seg.key], flexGrow: Math.max(seg.value, totalTokens * 0.01) }
												}, seg.key)) : react_jsx_runtime.jsx("i", {
													className: S.compSeg,
													style: { background: COMP_COLORS.hit, flexGrow: 1 }
												})
											})
										]
									}),
									react_jsx_runtime.jsx("div", {
										className: S.modelMeta,
										children: metaParts.join(" · ")
									})
								]
							}, model.model);
						})
					})
				]
			});
		}

		/**
		 * Codex-style blue calendar heatmap for one month: weekday header row,
		 * weeks as rows (Mon-first), padded with placeholders. Cells are buttons
		 * that select a day.
		 */
		function MonthHeatmap({ heat, translate, selectedKey, onSelect, today, currency = "CNY", hoverTip, onMonthStep }) {
			const select = typeof onSelect === "function" ? onSelect : () => {};
			// Optional in-panel tooltip (`{ show(text, element), hide() }`): the built-in
			// `title` attribute waits about a second and is styled by the OS, so the panel
			// draws its own. Standalone renders (tests) simply omit it.
			const tip = hoverTip === void 0 || hoverTip === null ? null : hoverTip;
			const currentToday = today ?? todayKey();
			// B1: 整块日历只占一个 Tab 停靠点（roving tabindex），进入后用方向键在日期
			// 之间走、Home/End 跳周一/周日、PageUp/PageDown 换月。鼠标操作完全不变。
			const gridRef = react.useRef(null);
			// 每个日期在日历里的真实行列：月份不是从周一开始时，用线性下标取模会算错列。
			const positions = react.useMemo(() => {
				const map = new Map();
				heat.weeks.forEach((week, weekIndex) => {
					week.forEach((cell, dayIndex) => {
						if (cell !== null) map.set(cell.key, { weekIndex, dayIndex });
					});
				});
				return map;
			}, [heat]);
			const dayKeys = react.useMemo(() => [...positions.keys()], [positions]);
			const fallbackKey = dayKeys.includes(currentToday)
				? currentToday
				: (selectedKey !== null && dayKeys.includes(selectedKey) ? selectedKey : (dayKeys[0] ?? null));
			const [focusKey, setFocusKey] = react.useState(fallbackKey);
			react.useEffect(() => {
				if (focusKey !== null && dayKeys.includes(focusKey)) return;
				setFocusKey(fallbackKey);
			}, [dayKeys, focusKey, fallbackKey]);
			const focusCell = (key) => {
				setFocusKey(key);
				const node = gridRef.current === null ? null : gridRef.current.querySelector(`[data-key="${key}"]`);
				if (node !== null && node !== void 0) node.focus();
			};
			const stepFocus = (key, delta) => {
				const index = dayKeys.indexOf(key);
				if (index < 0) return;
				const next = dayKeys[Math.min(Math.max(index + delta, 0), dayKeys.length - 1)];
				if (next !== void 0) focusCell(next);
			};
			const onCellKeyDown = (event, key) => {
				const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
				if (step !== void 0) {
					event.preventDefault();
					stepFocus(key, step);
					return;
				}
				if (event.key === "Home" || event.key === "End") {
					event.preventDefault();
					const position = positions.get(key);
					if (position === void 0) return;
					stepFocus(key, event.key === "Home" ? -position.dayIndex : 6 - position.dayIndex);
					return;
				}
				if ((event.key === "PageUp" || event.key === "PageDown") && typeof onMonthStep === "function") {
					event.preventDefault();
					onMonthStep(event.key === "PageUp" ? -1 : 1);
				}
			};
			const weekdayLabels = [
				translate("weekday.mon"),
				translate("weekday.tue"),
				translate("weekday.wed"),
				translate("weekday.thu"),
				translate("weekday.fri"),
				translate("weekday.sat"),
				translate("weekday.sun")
			];
			return react_jsx_runtime.jsxs("div", {
				className: S.heat,
				children: [
					react_jsx_runtime.jsxs("div", {
						className: S.monthGrid,
						ref: gridRef,
						children: [
							react_jsx_runtime.jsx("div", {
								className: S.weekHeader,
								children: weekdayLabels.map((label) => react_jsx_runtime.jsx("span", { className: S.weekLabel, children: label }, label))
							}),
							heat.weeks.map((week, weekIndex) => react_jsx_runtime.jsx("div", {
								className: S.heatRow,
								children: week.map((cell, dayIndex) => {
									if (cell === null) return react_jsx_runtime.jsx("span", { className: S.emptyCell, "aria-hidden": true }, `${weekIndex}-${dayIndex}`);
									const style = cellColor(cell.tokens, heat.max);
									const hit = cell.hitRate === null || cell.hitRate === void 0 ? "" : ` · ${translate("usage.hitRate")} ${cell.hitRate}%`;
									const cost = (cell.cost ?? 0) > 0 ? ` · ${fmtCurrency(cell.cost, currency)}` : "";
									const isToday = cell.key === currentToday;
									const tipText = `${cell.key} · ${fmt(cell.tokens)} tokens${hit}${cost}`;
									return react_jsx_runtime.jsx("button", {
										type: "button",
										className: `${S.cell}${isToday ? ` ${S.cellToday}` : ""}${selectedKey === cell.key ? ` ${S.cellSelected}` : ""}`,
										style: { background: style.background, color: style.color },
										"aria-label": `${cell.key} · ${fmt(cell.tokens)} tokens${cost}`,
										"data-key": cell.key,
										tabIndex: cell.key === focusKey ? 0 : -1,
										onClick: () => {
											setFocusKey(cell.key);
											select(cell.key);
										},
										onKeyDown: (event) => onCellKeyDown(event, cell.key),
										onMouseEnter: tip === null ? void 0 : (event) => tip.show(tipText, event.currentTarget),
										onMouseLeave: tip === null ? void 0 : tip.hide,
										onFocus: tip === null ? void 0 : (event) => tip.show(tipText, event.currentTarget),
										onBlur: tip === null ? void 0 : tip.hide,
										children: react_jsx_runtime.jsx("span", { className: S.cellDay, children: cell.day })
									}, cell.key);
								})
							}, weekIndex))
						]
					}),
					react_jsx_runtime.jsxs("div", {
						className: S.legend,
						children: [
							react_jsx_runtime.jsx("span", { children: translate("usage.legendLess") }),
							[0.22, 0.42, 0.6, 0.8, 1].map((alpha, index) => react_jsx_runtime.jsx("span", {
								className: S.legendSwatch,
								style: { background: `rgba(${BLUE_RGB[0]}, ${BLUE_RGB[1]}, ${BLUE_RGB[2]}, ${alpha})` }
							}, index)),
							react_jsx_runtime.jsx("span", { children: translate("usage.legendMore") })
						]
					})
				]
			});
		}

		/** `YYYY-MM-DD` → `MM-DD 周X` display label. */
		function dayLabel(key, translate) {
			const [, month, day] = key.split("-");
			const date = new Date(Number(key.slice(0, 4)), Number(month) - 1, Number(day));
			const weekdays = [translate("weekday.sun"), translate("weekday.mon"), translate("weekday.tue"), translate("weekday.wed"), translate("weekday.thu"), translate("weekday.fri"), translate("weekday.sat")];
			return `${month}-${day} ${weekdays[date.getDay()]}`;
		}

		function monthName(month, translate) {
			const names = translate("month.names").split(",");
			return names[month] ?? String(month + 1);
		}

		/**
		 * Display label for a `provider/model` attribution key (the same model
		 * served by different providers must stay distinguishable).
		 */
		function modelLabelOf(key, translate) {
			if (typeof key !== "string") return "";
			const slash = key.indexOf("/");
			if (slash === -1) return key;
			const provider = key.slice(0, slash);
			const model = key.slice(slash + 1);
			const providerLabel = provider === "unknown" ? translate("usage.unknownModel") : provider;
			const modelLabel = model === "unknown" || model === "" ? translate("usage.unknownModel") : model;
			return `${providerLabel} · ${modelLabel}`;
		}

		/** Hit/miss/output sums across a platform day's per-model breakdown. */
		function platformDayBreakdown(day) {
			let hit = 0;
			let miss = 0;
			let response = 0;
			const models = day?.models;
			if (models !== null && typeof models === "object") {
				for (const entry of Object.values(models)) {
					hit += entry?.cacheHitTokens ?? 0;
					miss += entry?.cacheMissTokens ?? 0;
					response += entry?.responseTokens ?? 0;
				}
			}
			return { hit, miss, response, total: hit + miss + response };
		}

		/** Prompt-side cache hit rate (0–100, one decimal) for a platform day, or null. */
		function platformDayHitRate(day) {
			const { hit, miss } = platformDayBreakdown(day);
			if (hit + miss <= 0) return null;
			return Math.round((hit / (hit + miss)) * 1000) / 10;
		}

		/**
		 * Map a platform day entry to the local heatmap/day-detail shape so the
		 * single heatmap (and its day drill-down) can display platform data:
		 * prompt cache hits → cacheRead, cache misses → input, responses →
		 * output; cacheWrite is not reported by the platform.
		 */
		function platformDayToLocalShape(day) {
			const breakdown = platformDayBreakdown(day);
			const models = [];
			const rawModels = day?.models;
			if (rawModels !== null && typeof rawModels === "object") {
				for (const [key, entry] of Object.entries(rawModels)) {
					const hit = entry?.cacheHitTokens ?? 0;
					const miss = entry?.cacheMissTokens ?? 0;
					const response = entry?.responseTokens ?? 0;
					models.push({
						model: key,
						tokens: hit + miss + response,
						inputTokens: miss,
						outputTokens: response,
						cacheReadTokens: hit,
						cacheWriteTokens: 0,
						cacheHitRate: hit + miss > 0 ? Math.round((hit / (hit + miss)) * 1000) / 10 : null,
						requestCount: entry?.requestCount ?? 0,
						cost: entry?.cost ?? 0
					});
				}
			}
			models.sort((a, b) => b.tokens - a.tokens);
			return {
				date: day.date,
				tokens: day.totalTokens ?? breakdown.total,
				inputTokens: breakdown.miss,
				outputTokens: breakdown.response,
				cacheReadTokens: breakdown.hit,
				cacheWriteTokens: 0,
				cacheHitRate: platformDayHitRate(day),
				requestCount: day.totalRequests ?? 0,
				cost: day.totalCost ?? 0,
				models
			};
		}

		/** Day totals across a platform month's model list (for the summary stats). */
		function platformModelTotals(models) {
			let tokens = 0;
			let requests = 0;
			let cost = 0;
			if (Array.isArray(models)) {
				for (const model of models) {
					tokens += model?.totalTokens ?? 0;
					requests += model?.requestCount ?? 0;
					cost += model?.cost ?? 0;
				}
			}
			return { tokens, requests, cost };
		}

		/** Sum of local tokens for a `YYYY-MM` month key across per-day entries. */
		function tokensForMonth(days, monthKey) {
			if (!Array.isArray(days)) return 0;
			let sum = 0;
			for (const day of days) {
				if (typeof day?.date === "string" && day.date.startsWith(monthKey)) sum += day.tokens ?? 0;
			}
			return sum;
		}

		/**
		 * Build the "recent N calendar days" list, source-unified with the
		 * heatmap: platform days win (heatmap is platform-fed), local session
		 * days fill dates the platform does not report, and dates inside the
		 * window with no usage at all are omitted. Sorted newest first.
		 * @param recentPlat - `Map<date, day>` of platform-mapped days, or null.
		 * @param localDays - local session days array (ascending), may be empty.
		 * @param cutoffKey - first allowed `YYYY-MM-DD` (inclusive, GMT+8).
		 * @param todayKey - last allowed `YYYY-MM-DD` (inclusive, GMT+8).
		 */
		function recentDaysOf(recentPlat, localDays, cutoffKey, todayKey) {
			const merged = new Map();
			if (recentPlat instanceof Map) {
				for (const [date, day] of recentPlat) merged.set(date, day);
			}
			if (Array.isArray(localDays)) {
				for (const day of localDays) {
					if (typeof day?.date === "string" && !merged.has(day.date)) merged.set(day.date, day);
				}
			}
			return [...merged.entries()]
				.filter(([date]) => date >= cutoffKey && date <= todayKey)
				.map(([, day]) => day)
				.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
		}

		/**
		 * DeepSeek platform usage body: month navigation, monthly spend / today
		 * cost / request stats, and per-model token & cost rows. `embedded`
		 * renders it directly inside the merged account card (no outer section
		 * or wrapping platform card); standalone keeps the previous shape. The
		 * usage token comes from `localStorage.userToken` on platform.deepseek.com
		 * — a session credential, not the API key.
		 */
		function PlatformUsageBody({ platform, loading, error, month, onMonthChange, onRetry, onConfigure, translate, embedded, showStats = true }) {
			const idle = platform === null && !loading && error === null;
			const models = Array.isArray(platform?.models) ? platform.models : [];
			const days = Array.isArray(platform?.days) ? platform.days : [];
			// Platform days are GMT+8-aligned (start/end/tz=28800 buckets), so
			// "today" uses the same GMT+8 convention as local session data.
			const today = days.find((day) => day.date === todayKey()) ?? null;
			const totals = platformModelTotals(models);
			const hasData = platform !== null;
			const dataBlock = react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					showStats && react_jsx_runtime.jsxs("div", {
						className: S.statsRow,
						children: [
							react_jsx_runtime.jsxs("div", { className: S.stat, "data-kind": "cost", children: [react_jsx_runtime.jsx("span", { className: S.statValue, children: fmtCurrency(platform?.monthCost, "CNY") }), react_jsx_runtime.jsx("span", { className: S.statLabel, children: translate("platform.monthCost") })] }),
							react_jsx_runtime.jsxs("div", { className: S.stat, "data-kind": "cost", children: [react_jsx_runtime.jsx("span", { className: S.statValue, children: fmtCurrency(today?.totalCost ?? 0, "CNY") }), react_jsx_runtime.jsx("span", { className: S.statLabel, children: translate("platform.todayCost") })] }),
							react_jsx_runtime.jsxs("div", { className: S.stat, "data-kind": "request", children: [react_jsx_runtime.jsx("span", { className: S.statValue, children: fmt(totals.requests) }), react_jsx_runtime.jsx("span", { className: S.statLabel, children: translate("platform.requests") })] })
						]
					}),
					models.length === 0 && days.length === 0 ? react_jsx_runtime.jsx("p", { className: S.platformHint, children: translate("platform.noData") })
						: react_jsx_runtime.jsx("div", {
							className: S.days,
							children: models.map((model) => {
								const ratio = (model.cost ?? 0) > 0 ? `${fmt(Math.round((model.totalTokens ?? 0) / model.cost))} T/¥` : "—";
								const hitSide = (model.cacheHitTokens ?? 0) + (model.cacheMissTokens ?? 0);
								const hitRate = hitSide > 0 ? `${Math.round(((model.cacheHitTokens ?? 0) / hitSide) * 100)}%` : "—";
								return react_jsx_runtime.jsxs("div", {
									className: S.platformModel,
									children: [
										react_jsx_runtime.jsxs("div", {
											className: S.platformModelHead,
											children: [
												react_jsx_runtime.jsx("span", { className: S.platformModelName, title: model.key, children: model.name }),
												react_jsx_runtime.jsx("span", { className: S.platformModelCost, children: fmtCurrency(model.cost, "CNY") })
											]
										}),
										react_jsx_runtime.jsx("div", {
											className: S.platformChartNote,
											children: `${fmt(model.totalTokens ?? 0)} tokens · ${translate("platform.requests")} ${fmt(model.requestCount ?? 0)} · ${translate("platform.cacheHit")} ${hitRate} · ${ratio}`
										})
									]
								}, model.key);
							})
						})
				]
			});
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsxs("div", {
						className: S.heatHeader,
						children: [
							react_jsx_runtime.jsx("span", { className: S.platformChartNote, children: translate("platform.title") }),
							react_jsx_runtime.jsx("span", { className: S.monthTitle, children: monthLabelOf(month, translate) })
						]
					}),
					loading && platform === null ? react_jsx_runtime.jsx("div", {
						className: S.skelList,
						"aria-hidden": true,
						children: [0, 1, 2].map((index) => react_jsx_runtime.jsx("div", { className: `${S.skelBlock} ${S.skelRow}` }, `platform-skel-${index}`))
					})
						: error !== null ? react_jsx_runtime.jsxs("div", {
							className: S.error,
							children: [
								react_jsx_runtime.jsx("span", { className: S.errorText, title: translate("platform.error", { message: error }), children: translate("platform.error", { message: error }) }),
								react_jsx_runtime.jsx("button", { type: "button", className: S.retry, onClick: onRetry, children: translate("action.retry") })
							]
						})
							: idle ? react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("p", { className: S.platformHint, children: translate("platform.noCredential", { ref: "DEEPSEEK_USAGE_TOKEN" }) }),
									typeof onConfigure === "function" && react_jsx_runtime.jsx("button", {
										type: "button",
										className: S.settingsButton,
										onClick: onConfigure,
										children: translate("platform.configure")
									})
								]
							})
								: hasData ? (embedded ? dataBlock : react_jsx_runtime.jsx("div", { className: S.platformCard, children: dataBlock })) : null
				]
			});
		}

		/** Standalone platform usage section (used when not merged into the account card). */
		function PlatformSection(props) {
			return react_jsx_runtime.jsxs("section", {
				className: S.section,
				children: [react_jsx_runtime.jsx(PlatformUsageBody, { ...props, embedded: false })]
			});
		}

		/**
		 * Merged DeepSeek account card: the provider balance and the platform
		 * usage live in ONE card, separated by a hairline divider — one module,
		 * one selectable provider, no duplicated module title.
		 */
		function DeepSeekAccountUsageCard({ provider, account, accountLoading, accountError, platform, platformLoading, platformError, month, onMonthChange, onRetry, onRetryPlatform, onConfigure, translate, localDayTokens = 0, localMonthTokens = 0, localTotalTokens = 0, monthBandLabel }) {
			const mode = account?.mode ?? provider.accountMode ?? "balance";
			const status = accountLoading && account === null ? "loading" : account?.status ?? "unavailable";
			const statusText = status === "loading" ? translate("account.status.loading")
				: status === "unsupported" ? translate("account.status.unsupported")
					: accountStatusLabel(status, translate);
			const subtitle = account?.plan ?? translate("account.balanceMode");
			const balanceState = accountLoading && account === null ? "loading"
				: accountError !== null ? "error"
					: status === "not-configured" ? "no-credential"
						: status === "unsupported" ? "unsupported"
							: account?.balance !== null && account?.balance !== void 0 ? "ok" : "error";
			const balanceMessage = accountError ?? account?.missingCredentials?.[0]
				?? (account?.policyReason === "private-network" && account?.resolvedAddress ? translate("balance.blockedAddress", { address: account.resolvedAddress }) : status);
			const today = (Array.isArray(platform?.days) ? platform.days : []).find((day) => day.date === todayKey()) ?? null;
			const requests = (Array.isArray(platform?.models) ? platform.models : []).reduce((sum, model) => sum + (model.requestCount ?? 0), 0);
			return react_jsx_runtime.jsxs("article", {
				className: S.accountCard,
				"data-provider": provider.id,
				"data-account-mode": mode,
				children: [
					react_jsx_runtime.jsxs("div", {
						className: S.accountHead,
						children: [
							react_jsx_runtime.jsx("span", { className: S.accountMark, "aria-hidden": true, children: accountMarkContent() }),
							react_jsx_runtime.jsxs("span", {
								className: S.accountIdentity,
								children: [
									react_jsx_runtime.jsx("span", { className: S.accountName, children: provider.displayName }),
									react_jsx_runtime.jsx("span", { className: S.accountPlan, children: subtitle })
								]
							}),
							react_jsx_runtime.jsx("span", { className: S.accountStatus, "data-status": status, children: statusText })
						]
					}),
					react_jsx_runtime.jsx(BalanceContent, { balance: account?.balance ?? null, state: balanceState, message: balanceMessage, translate, onRetry: onRetry, compact: true }),
					// 统一统计条带：两行固定 3+3（第一行平台消费/请求，第二行 Tokens），
					// 每行等宽不换行，避免 4+2 式参差断行。
					react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
						children: [
							react_jsx_runtime.jsxs("div", {
								className: `${S.statsRow} ${S.bandCompact}`,
								children: [
									react_jsx_runtime.jsxs("div", { className: S.stat, "data-kind": "token", children: [react_jsx_runtime.jsx("span", { className: S.statValue, children: fmt(localTotalTokens) }), react_jsx_runtime.jsx("span", { className: S.statLabel, children: translate("usage.totalTokens") })] }),
									react_jsx_runtime.jsxs("div", { className: S.stat, "data-kind": "request", children: [react_jsx_runtime.jsx("span", { className: S.statValue, children: fmt(requests) }), react_jsx_runtime.jsx("span", { className: S.statLabel, children: translate("platform.monthRequests") })] }),
									react_jsx_runtime.jsxs("div", { className: S.stat, "data-kind": "cost", children: [react_jsx_runtime.jsx("span", { className: S.statValue, children: fmtCurrency(platform?.monthCost, platform?.currency ?? "CNY") }), react_jsx_runtime.jsx("span", { className: S.statLabel, children: translate("platform.monthCost") })] })
								]
							}),
							react_jsx_runtime.jsxs("div", {
								className: `${S.statsRow} ${S.bandCompact}`,
								children: [
									react_jsx_runtime.jsxs("div", { className: S.stat, "data-kind": "token", children: [react_jsx_runtime.jsx("span", { className: S.statValue, children: fmt(localMonthTokens) }), react_jsx_runtime.jsx("span", { className: S.statLabel, children: monthBandLabel ?? translate("usage.monthTokens") })] }),
									react_jsx_runtime.jsxs("div", { className: S.stat, "data-kind": "cost", children: [react_jsx_runtime.jsx("span", { className: S.statValue, children: fmtCurrency(today?.totalCost ?? 0, platform?.currency ?? "CNY") }), react_jsx_runtime.jsx("span", { className: S.statLabel, children: translate("platform.todayCost") })] }),
									react_jsx_runtime.jsxs("div", { className: S.stat, "data-kind": "token", children: [react_jsx_runtime.jsx("span", { className: S.statValue, children: localDayTokens === null ? "—" : fmt(localDayTokens) }), react_jsx_runtime.jsx("span", { className: S.statLabel, children: translate("usage.todayTokens") })] })
								]
							})
						]
					})
				]
			});
		}

		/**
		 * Collapsible per-API-Key breakdown, rendered at the end of the panel
		 * (after the local usage section). The platform interface provides the
		 * per-Key dimension; the block hides itself when the payload has none
		 * (legacy fallback) or when no key has usage.
		 */
		function ApiKeysSection({ apiKeys, currency, open, onToggle, translate }) {
			const list = Array.isArray(apiKeys) ? apiKeys : [];
			if (list.length === 0) return null;
			return react_jsx_runtime.jsxs("section", {
				className: S.section,
				children: [
					react_jsx_runtime.jsxs("button", {
						type: "button",
						className: S.disclosureHead,
						"aria-expanded": open,
						onClick: onToggle,
						children: [
							react_jsx_runtime.jsxs("span", {
								className: S.disclosureChevron,
								"data-open": open || void 0,
								"aria-hidden": true,
								children: [react_jsx_runtime.jsx(primitives.IconChevronRightOutline14, { size: 12 })]
							}),
							react_jsx_runtime.jsx("h3", { className: S.sectionTitle, children: translate("platform.apiKeysTitle") }),
							react_jsx_runtime.jsx("span", { className: S.disclosureCount, children: fmt(list.length) })
						]
					}),
					open && react_jsx_runtime.jsx("div", {
						className: S.days,
						children: list.map((key) => {
							const hitSide = (key.cacheHitTokens ?? 0) + (key.cacheMissTokens ?? 0);
							const hitRate = hitSide > 0 ? `${Math.round(((key.cacheHitTokens ?? 0) / hitSide) * 100)}%` : "—";
							return react_jsx_runtime.jsxs("div", {
								className: S.modelRow,
								children: [
									react_jsx_runtime.jsxs("div", {
										className: S.platformModelHead,
										children: [
											react_jsx_runtime.jsx("span", { className: S.platformModelName, title: key.trackingId, children: key.name }),
											react_jsx_runtime.jsx("span", { className: S.platformModelCost, children: fmtCurrency(key.cost, currency ?? "CNY") })
										]
									}),
									react_jsx_runtime.jsx("div", {
										className: S.modelMeta,
										children: `${fmt(key.totalTokens ?? 0)} tokens · ${translate("platform.requests")} ${fmt(key.requestCount ?? 0)} · ${translate("platform.cacheHit")} ${hitRate}`
									})
								]
							}, key.trackingId ?? key.name);
						})
					})
				]
			});
		}

		/**
		 * Panel settings view: manage the DeepSeek platform usage token.
		 * The token is a session credential from platform.deepseek.com
		 * (`localStorage.userToken`), never the API key; it is saved on the
		 * server under DSH_HOME/storages and never sent back to the browser.
		 * Method 1 opens a system browser window and captures the token after
		 * login automatically; method 2 is the manual paste fallback. Saving
		 * or capturing immediately refreshes the platform usage data below.
		 */
		function TokenSettingsView({ status, busy, message, value, onChange, onPaste, onSave, onClear, syncRunning, onStartSync, onStopSync, onBack, translate }) {
			const configured = status?.configured === true;
			return react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
				children: [
					react_jsx_runtime.jsxs("div", {
						className: S.detailHeader,
						children: [
							react_jsx_runtime.jsx("button", {
								type: "button",
								className: S.back,
								"aria-label": translate("settings.back"),
								onClick: onBack,
								children: react_jsx_runtime.jsx(primitives.IconChevronLeftOutline14, { size: 14 })
							}),
							react_jsx_runtime.jsx("span", { className: S.detailDate, children: translate("settings.title") })
						]
					}),
					react_jsx_runtime.jsxs("section", {
						className: S.section,
						children: [
							react_jsx_runtime.jsx("h3", { className: S.sectionTitle, children: translate("token.title") }),
							react_jsx_runtime.jsx("p", { className: S.note, children: translate("token.description") }),
							react_jsx_runtime.jsx("h3", { className: S.sectionTitle, children: translate("token.method1") }),
							react_jsx_runtime.jsx("p", { className: S.platformHint, children: translate("token.syncHint") }),
							react_jsx_runtime.jsxs("div", {
								className: S.settingsActions,
								children: [
									react_jsx_runtime.jsx("button", {
										type: "button",
										className: S.settingsButton,
										"data-kind": "primary",
										onClick: onStartSync,
										disabled: busy || syncRunning,
										children: translate("token.syncButton")
									}),
									syncRunning && react_jsx_runtime.jsx("button", {
										type: "button",
										className: S.settingsButton,
										onClick: onStopSync,
										disabled: busy,
										children: translate("token.syncStop")
									})
								]
							}),
							react_jsx_runtime.jsx("h3", { className: S.sectionTitle, children: translate("token.method2") }),
							react_jsx_runtime.jsx("p", { className: S.platformHint, children: translate("token.howToGet") }),
							react_jsx_runtime.jsx("input", {
								className: S.settingsInput,
								type: "password",
								value: value,
								"data-dirty": value.trim() === "" ? void 0 : true,
								"aria-label": translate("token.title"),
								placeholder: configured ? translate("token.configuredPlaceholder") : translate("token.placeholder"),
								onChange: (event) => onChange(event.target.value)
							}),
							react_jsx_runtime.jsxs("div", {
								className: S.settingsActions,
								children: [
									react_jsx_runtime.jsx("button", {
										type: "button",
										className: S.settingsButton,
										onClick: onPaste,
										disabled: busy,
										children: translate("token.paste")
									}),
									react_jsx_runtime.jsx("button", {
										type: "button",
										className: S.settingsButton,
										"data-kind": "primary",
										onClick: onSave,
										disabled: busy || value.trim() === "",
										children: translate("token.save")
									}),
									react_jsx_runtime.jsx("button", {
										type: "button",
										className: S.settingsButton,
										"data-kind": "danger",
										onClick: onClear,
										disabled: busy || !configured,
										children: translate("token.clear")
									})
								]
							}),
							// 未保存时优先说"还没保存"，避免上次的成功文案被误读成本次结果。
							react_jsx_runtime.jsx("p", { className: S.note, children: value.trim() !== "" ? translate("token.unsaved") : (message !== "" ? message : (configured ? translate("token.configured", { source: status?.source === "credential" ? translate("token.sourceCredential") : translate("token.sourceStored") }) : translate("token.notConfigured"))) })
						]
					})
				]
			});
		}
		//#endregion

		//#region locales
		/** `usageStats` namespace dictionaries (the zh key set is the source of truth). */
		const NS = "usageStats";
		const zh = {
			"panel.title": "用量与余额",
			"panel.badge": "用量/余额",
			"account.title": "账户与用量",
			"account.balanceMode": "API 余额",
			"account.status.loading": "查询中",
			"account.status.ok": "实时",
			"account.status.notConfigured": "未配置",
			"account.status.unauthorized": "需重新登录",
			"account.status.rateLimited": "请求受限",
			"account.status.unavailable": "暂不可用",
			"account.status.unsupported": "不支持余额",
			"account.status.invalidResponse": "响应异常",
			"balance.unsupported": "无法查询余额：目标地址不符合安全策略（HTTPS + 公网）。",
			"balance.blockedAddress": "目标域名解析到内网地址 {address}（本地代理 / VPN 的 DNS 所致，可点重试）",
			"balance.total": "总余额",
			"balance.remaining": "可用余额",
			"balance.used": "已使用",
			"balance.toppedUp": "充值余额",
			"balance.granted": "赠送余额",
			"balance.loading": "正在查询余额…",
			"balance.noCredential": "未配置 {ref}（请编辑 ~/.dsh/.credentials.yaml）",
			"balance.error": "余额获取失败：{message}",
			"usage.todayTokens": "今日 Tokens",
			"usage.monthTokens": "本月 Tokens",
			"usage.monthTokensFor": "{month} Tokens",
			"usage.totalTokens": "累计 Tokens",
			"usage.error": "用量统计失败：{message}",
			"usage.heatmap": "当月每日用量",
			"platform.apiKeysTitle": "按 API Key",
			"usage.recent": "最近 14 天",
			"usage.legendLess": "少",
			"usage.legendMore": "多",
			"usage.back": "返回",
			"usage.hourSummary": "当日 24 小时用量分布：最忙的 {peak} 约 {total} tokens",
			"usage.ringLabel": "总消耗 {total} 的 Token 构成（缓存读 / 未命中 / 输出）",
			"usage.hitRate": "缓存命中",
			"usage.dayTotal": "总消耗",
			"usage.cacheWrite": "缓存写入",
			"usage.cost": "费用",
			"usage.unknownModel": "未知模型",
			"usage.noModels": "这一天没有分模型数据。",
			"platform.title": "DeepSeek 平台用量",
			"platform.modelsTitle": "平台模型明细",
			"platform.error": "平台用量获取失败：{message}",
			"platform.noCredential": "未配置 {ref}。登录 platform.deepseek.com 后打开控制台执行 JSON.parse(localStorage.userToken).value，将结果写入 ~/.dsh/.credentials.yaml。",
			"platform.noData": "本月暂无用量数据。",
			"platform.monthCost": "本月消费",
			"platform.todayCost": "今日消费",
			"platform.requests": "API 请求",
			"platform.monthRequests": "本月 API 请求",
			"platform.cacheHit": "缓存命中",
			"platform.hit": "缓存命中",
			"platform.miss": "缓存未命中",
			"platform.output": "输出",
			"platform.configure": "配置用量 Token",
			"settings.title": "设置",
			"settings.back": "返回",
			"token.title": "DeepSeek 用量 Token",
			"token.description": "用于同步平台用量与消费（与 API Key 不同）。",
			"token.method1": "方式一：网页登录自动同步",
			"token.syncButton": "网页登录自动同步",
			"token.syncStop": "停止同步",
			"token.syncHint": "点击后打开平台登录窗口（Edge/Chrome），登录成功后自动捕获用量 Token、验证并刷新数据。",
			"token.syncStarting": "正在打开登录窗口…",
			"token.syncOpened": "登录窗口已打开，请在窗口中登录 platform.deepseek.com；成功后自动同步。",
			"token.syncCaptured": "已通过网页登录自动同步用量 Token，正在刷新…",
			"token.syncStopped": "已停止同步。",
			"token.syncTimeout": "同步超时，请重试或使用方式二手动粘贴。",
			"token.syncUnavailable": "未找到 Edge/Chrome，无法自动同步；请使用方式二手动粘贴。",
			"token.syncFailed": "登录同步失败：{message}",
			"token.method2": "方式二：手动粘贴",
			"token.howToGet": "获取：登录 platform.deepseek.com 后按 F12 打开控制台，执行 JSON.parse(localStorage.userToken).value，复制返回的字符串粘贴到下方。Token 会过期，查询失败时重新获取即可。",
			"token.placeholder": "粘贴用量 Token…",
			"token.configuredPlaceholder": "已配置（粘贴新 Token 可覆盖）",
			"token.paste": "从剪贴板粘贴",
			"token.save": "保存",
			"token.clear": "清除",
			"token.saving": "正在保存…",
			"token.savedCost": "已保存并同步，本月消费 {cost}",
			"token.saveFailed": "保存失败：{message}",
			"token.cleared": "已清除用量 Token。",
			"token.clearFailed": "清除失败：{message}",
			"token.pasted": "已从剪贴板读取。",
			"token.pasteFailed": "剪贴板读取失败，请手动粘贴。",
			"token.pasteUnavailable": "当前浏览器无法读取剪贴板，请手动粘贴。",
			"token.configured": "已配置（来源：{source}）",
			"token.notConfigured": "未配置。",
			"token.unsaved": "输入还没保存 —— 点「保存」后生效。",
			"token.sourceCredential": "credentials 文件",
			"token.sourceStored": "面板设置",
			"month.year": "{year}年{month}",
			"action.refresh": "刷新",
			"action.refreshing": "刷新中…",
			"action.retry": "重试",
			"action.close": "关闭",
			"action.pin": "窗口置顶",
			"action.minimize": "最小化",
			"action.maximize": "最大化 / 还原",
			"action.prevMonth": "上个月",
			"action.nextMonth": "下个月",
			"action.today": "回到今天",
			"panel.updatedAt": "更新于 {time}",
			"weekday.mon": "一",
			"weekday.tue": "二",
			"weekday.wed": "三",
			"weekday.thu": "四",
			"weekday.fri": "五",
			"weekday.sat": "六",
			"weekday.sun": "日",
			"month.names": "1月,2月,3月,4月,5月,6月,7月,8月,9月,10月,11月,12月"
		};
		const en = {
			"panel.title": "Usage & Balance",
			"panel.badge": "Usage/Balance",
			"account.title": "Account & usage",
			"account.balanceMode": "API balance",
			"account.status.loading": "Loading",
			"account.status.ok": "Live",
			"account.status.notConfigured": "Not configured",
			"account.status.unauthorized": "Sign in again",
			"account.status.rateLimited": "Rate limited",
			"account.status.unavailable": "Unavailable",
			"account.status.unsupported": "Balance unsupported",
			"account.status.invalidResponse": "Invalid response",
			"balance.unsupported": "The balance target failed the security policy (HTTPS + public network).",
			"balance.blockedAddress": "The balance hostname resolved to a private address {address} (local proxy / VPN DNS — retry after switching)",
			"balance.total": "Total balance",
			"balance.remaining": "Available balance",
			"balance.used": "Used",
			"balance.toppedUp": "Topped up",
			"balance.granted": "Granted",
			"balance.loading": "Fetching balance…",
			"balance.noCredential": "{ref} is not configured (edit ~/.dsh/.credentials.yaml)",
			"balance.error": "Balance fetch failed: {message}",
			"usage.todayTokens": "Today tokens",
			"usage.monthTokens": "Month tokens",
			"usage.monthTokensFor": "{month} tokens",
			"usage.totalTokens": "All tokens",
			"usage.error": "Usage aggregation failed: {message}",
			"usage.heatmap": "Daily usage this month",
			"platform.apiKeysTitle": "By API key",
			"usage.recent": "Last 14 days",
			"usage.legendLess": "Less",
			"usage.legendMore": "More",
			"usage.back": "Back",
			"usage.hourSummary": "Hourly usage for the day: busiest hour {peak}, about {total} tokens",
			"usage.ringLabel": "Token composition of {total} total (cache read / miss / output)",
			"usage.hitRate": "Cache hit",
			"usage.dayTotal": "Total consumed",
			"usage.cacheWrite": "Cache write",
			"usage.cost": "Cost",
			"usage.unknownModel": "Unknown model",
			"usage.noModels": "No per-model data for this day.",
			"platform.title": "DeepSeek platform usage",
			"platform.modelsTitle": "Platform models",
			"platform.error": "Platform usage failed: {message}",
			"platform.noCredential": "{ref} is not configured. Sign in to platform.deepseek.com, run JSON.parse(localStorage.userToken).value in the console, and write the result to ~/.dsh/.credentials.yaml.",
			"platform.noData": "No usage data for this month.",
			"platform.monthCost": "This month",
			"platform.todayCost": "Today",
			"platform.requests": "API requests",
			"platform.monthRequests": "Requests this month",
			"platform.cacheHit": "Cache hit",
			"platform.hit": "Cache hit",
			"platform.miss": "Cache miss",
			"platform.output": "Output",
			"platform.configure": "Configure usage token",
			"settings.title": "Settings",
			"settings.back": "Back",
			"token.title": "DeepSeek usage token",
			"token.description": "Syncs platform usage and spend (not the API key).",
			"token.method1": "Method 1: web-login auto-sync",
			"token.syncButton": "Web-login auto-sync",
			"token.syncStop": "Stop sync",
			"token.syncHint": "Opens the platform login window (Edge/Chrome); after login the usage token is captured, verified and the data refreshes automatically.",
			"token.syncStarting": "Opening the login window…",
			"token.syncOpened": "Login window opened — sign in to platform.deepseek.com in it; sync happens automatically.",
			"token.syncCaptured": "Usage token captured via web login; refreshing…",
			"token.syncStopped": "Sync stopped.",
			"token.syncTimeout": "Sync timed out — try again or use method 2 (manual paste).",
			"token.syncUnavailable": "Edge/Chrome not found — auto-sync unavailable; use method 2 (manual paste).",
			"token.syncFailed": "Login sync failed: {message}",
			"token.method2": "Method 2: manual paste",
			"token.howToGet": "To get it: sign in to platform.deepseek.com, press F12, run JSON.parse(localStorage.userToken).value in the console and paste the returned string below. The token expires; fetch a new one when queries fail.",
			"token.placeholder": "Paste usage token…",
			"token.configuredPlaceholder": "Configured (paste a new token to replace)",
			"token.paste": "Paste from clipboard",
			"token.save": "Save",
			"token.clear": "Clear",
			"token.saving": "Saving…",
			"token.savedCost": "Saved and synced — {cost} this month",
			"token.saveFailed": "Save failed: {message}",
			"token.cleared": "Usage token cleared.",
			"token.clearFailed": "Clear failed: {message}",
			"token.pasted": "Read from clipboard.",
			"token.pasteFailed": "Clipboard read failed; paste manually.",
			"token.pasteUnavailable": "This browser cannot read the clipboard; paste manually.",
			"token.configured": "Configured (source: {source})",
			"token.notConfigured": "Not configured.",
			"token.unsaved": "Unsaved input — click Save to apply.",
			"token.sourceCredential": "credentials file",
			"token.sourceStored": "panel settings",
			"month.year": "{month} {year}",
			"action.refresh": "Refresh",
			"action.refreshing": "Refreshing…",
			"action.retry": "Retry",
			"action.close": "Close",
			"action.pin": "Always on top",
			"action.minimize": "Minimize",
			"action.maximize": "Maximize / restore",
			"action.prevMonth": "Previous month",
			"action.nextMonth": "Next month",
			"action.today": "Today",
			"panel.updatedAt": "Updated at {time}",
			"weekday.mon": "M",
			"weekday.tue": "T",
			"weekday.wed": "W",
			"weekday.thu": "T",
			"weekday.fri": "F",
			"weekday.sat": "S",
			"weekday.sun": "S",
			"month.names": "Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec"
		};
		//#endregion

		//#region plugin body
		/** Services required by the client plugin body. */
		const inject = ["slots", "locale"];

		/**
		 * Theme bridge for the panel. `theme` is an OPTIONAL client service, so it is
		 * read through `ctx.get` and never injected: when the service is missing — or
		 * when the context has no service registry at all, as in the smoke test — the
		 * panel silently falls back to the OS `prefers-color-scheme` media query.
		 * @param ctx - client root context.
		 * @returns `{ scheme(), subscribe(listener) }` — the current color scheme and
		 * a subscription to `theme/change`.
		 */
		function createThemeBridge(ctx) {
			const read = () => {
				if (typeof ctx.get !== "function") return null;
				const theme = ctx.get("theme");
				const scheme = theme?.getTheme?.().active?.colorScheme;
				return scheme === "light" || scheme === "dark" ? scheme : null;
			};
			return {
				scheme: read,
				subscribe: (listener) => (typeof ctx.on === "function" ? ctx.on("theme/change", listener) : () => {})
			};
		}

		/**
		 * Client plugin body: register the dictionaries and the sidebar footer action.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "usage-stats: dictionaries");
			// Hand the theme bridge to the panel as a prop so the heatmap scale follows
			// the DSH theme preference (which can differ from the OS color scheme).
			const themeBridge = createThemeBridge(ctx);
			const Panel = (props) => react_jsx_runtime.jsx(UsageStatsPanel, { ...props, theme: themeBridge });
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "usage-stats",
				locale: NS,
				order: 10
			}, Panel));
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		exports.UsageStatsPanel = UsageStatsPanel;
		exports.DayDetail = DayDetail;
		exports.MonthHeatmap = MonthHeatmap;
		exports.PlatformSection = PlatformSection;
		exports.DeepSeekAccountUsageCard = DeepSeekAccountUsageCard;
		exports.ApiKeysSection = ApiKeysSection;
		exports.TokenSettingsView = TokenSettingsView;
		exports.platformDayBreakdown = platformDayBreakdown;
		exports.platformDayHitRate = platformDayHitRate;
		exports.platformDayToLocalShape = platformDayToLocalShape;
		exports.buildMonthHeatmap = buildMonthHeatmap;
		exports.cellColor = cellColor;
		exports.recentDaysOf = recentDaysOf;
		exports.createLoader = createLoader;
		exports.resolveColorScheme = resolveColorScheme;
		exports.createThemeBridge = createThemeBridge;
		exports.prefersReducedMotion = prefersReducedMotion;
		exports.UsageSkeleton = UsageSkeleton;
		exports.modelLabelOf = modelLabelOf;
		exports.fmt = fmt;
		exports.fmtCurrency = fmtCurrency;
		exports.tokensForMonth = tokensForMonth;
		return module.exports;
	}
});
