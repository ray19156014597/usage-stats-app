/**
 * app backdrop — 玻璃背后的"页面内容"。
 *
 * 插件里面板浮在**会话内容**上，`backdrop-filter: blur(6px) saturate(1.9)` 糊的
 * 就是那层内容；独立版把窗口后方的**真实屏幕画面**抓进页面（Rust 侧 GDI 抓屏 +
 * 抓之前把自己从屏幕捕获里排除），铺成最底下一层画布，面板继续用插件原配方去糊
 * 它 —— 两边连模糊半径都是同一个 6px。
 *
 * 两种刷新策略：
 *   - 实时模式（默认，托盘菜单"实时玻璃背景"勾选）：窗口持续对屏幕捕获隐身，逐帧
 *     抓取（~22fps，单帧约 10ms），背景无滞后；代价是这期间截图/录屏里看不到窗口。
 *   - 跟手模式（取消勾选）：只在移动/缩放（节流 150ms）、点击、聚焦时抓帧，截图正常。
 *
 * 窗口收进托盘（隐藏）时暂停并恢复可捕获状态；重新显示后按偏好继续。
 */
(function () {
  "use strict";

  var canvas = document.getElementById("usg_appBackdropCanvas");
  var tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
  if (!canvas || !tauri || !tauri.core || typeof tauri.core.invoke !== "function") {
    return;
  }
  var context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    return;
  }

  var FRAME_INTERVAL_MS = 33; // ~30fps（抓屏降到半分辨率后单帧约 4-6ms）
  var FOLLOW_POLL_MS = 4000;

  var ready = false;
  var busy = false;
  var failures = 0;
  var liveEnabled = true; // 用户偏好（托盘勾选状态）
  var liveRunning = false;
  var liveTimer = 0;
  var followTimer = 0;
  var pumpTimer = 0;
  var lastSampleAt = 0;

  function invoke(command, args) {
    return tauri.core.invoke(command, args);
  }

  function draw(buffer) {
    if (!buffer || buffer.byteLength < 9) {
      return false;
    }
    var view = new DataView(buffer);
    var width = view.getUint32(0, true);
    var height = view.getUint32(4, true);
    if (!width || !height) {
      return false;
    }
    var pixels = new Uint8ClampedArray(buffer, 8);
    // GDI 抓回来是 BGRA；Canvas 要 RGBA。
    for (var i = 0; i < pixels.length; i += 4) {
      var blue = pixels[i];
      pixels[i] = pixels[i + 2];
      pixels[i + 2] = blue;
      pixels[i + 3] = 255;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.putImageData(new ImageData(pixels, width, height), 0, 0);
    if (!ready) {
      ready = true;
      canvas.classList.add("usg_appBackdropReady");
    }
    return true;
  }

  //#region 实时模式

  var busySince = 0;

  /**
   * 实时循环。为了不"停摆"：页面不可见时不是直接 return（那会让循环永远断掉，
   * 而 liveRunning 还是 true，之后没有任何东西会重启它），而是慢速重试；
   * 单帧请求卡住超过 1s 时重置 busy，避免一次丢失的 Promise 让循环永远空转。
   */
  function liveTick() {
    liveTimer = 0;
    if (!liveRunning) {
      return;
    }
    if (document.hidden) {
      liveTimer = window.setTimeout(liveTick, 250);
      return;
    }
    if (busy) {
      if (busySince && Date.now() - busySince > 1000) {
        busy = false;
        failures += 1;
        busySince = 0;
      }
      liveTimer = window.setTimeout(liveTick, 8);
      return;
    }
    busy = true;
    busySince = Date.now();
    var startedAt = window.performance.now();
    invoke("capture_backdrop")
      .then(function (buffer) {
        busy = false;
        busySince = 0;
        failures = 0;
        draw(buffer);
        diagFrames += 1;
        diagSpent += window.performance.now() - startedAt;
        if (liveRunning) {
          var spent = window.performance.now() - startedAt;
          liveTimer = window.setTimeout(liveTick, Math.max(0, FRAME_INTERVAL_MS - spent));
        }
      })
      .catch(function () {
        busy = false;
        busySince = 0;
        failures += 1;
        if (failures >= 8) {
          // 实时抓帧连续失败：退回跟手模式，别空转。
          stopLive();
          startFollow();
          return;
        }
        if (liveRunning) {
          liveTimer = window.setTimeout(liveTick, 200);
        }
      });
  }

  function startLive() {
    if (liveRunning) {
      // 已在实时模式但循环可能已停摆（例如页面曾经不可见）：确保它活着。
      if (!liveTimer) {
        liveTick();
      }
      return;
    }
    liveRunning = true;
    stopFollow();
    invoke("set_backdrop_live", { live: true }).catch(function () {});
    liveTick();
  }

  /** 停掉实时循环，并把窗口恢复到"可被截图"的状态（不改用户偏好）。 */
  function stopLive() {
    liveRunning = false;
    if (liveTimer) {
      window.clearTimeout(liveTimer);
      liveTimer = 0;
    }
    invoke("set_backdrop_live", { live: false }).catch(function () {});
  }

  //#endregion

  //#region 跟手模式（事件驱动 + 低频轮询）

  function sample() {
    if (busy || liveRunning || document.hidden) {
      return;
    }
    busy = true;
    invoke("capture_backdrop")
      .then(function (buffer) {
        busy = false;
        failures = 0;
        draw(buffer);
      })
      .catch(function () {
        busy = false;
        failures += 1;
        if (failures >= 3) {
          stopFollow();
        }
      });
  }

  function schedule(delay) {
    if (pumpTimer) {
      window.clearTimeout(pumpTimer);
    }
    pumpTimer = window.setTimeout(function () {
      pumpTimer = 0;
      lastSampleAt = Date.now();
      sample();
    }, delay || 0);
  }

  /** 节流补帧：最多每 minGap 毫秒抓一帧（拖动窗口时约 6-7fps）。 */
  function pump(minGap) {
    if (pumpTimer || liveRunning || document.hidden) {
      return;
    }
    var wait = Math.max(0, (minGap || 0) - (Date.now() - lastSampleAt));
    if (wait === 0) {
      lastSampleAt = Date.now();
      sample();
      return;
    }
    pumpTimer = window.setTimeout(function () {
      pumpTimer = 0;
      lastSampleAt = Date.now();
      sample();
    }, wait);
  }

  function startFollow() {
    if (followTimer || liveRunning) {
      return;
    }
    followTimer = window.setInterval(function () {
      if (document.hasFocus()) {
        pump(FOLLOW_POLL_MS);
      }
    }, FOLLOW_POLL_MS);
  }

  function stopFollow() {
    if (followTimer) {
      window.clearInterval(followTimer);
      followTimer = 0;
    }
    if (pumpTimer) {
      window.clearTimeout(pumpTimer);
      pumpTimer = 0;
    }
  }

  //#endregion

  function resume() {
    if (document.hidden) {
      return;
    }
    if (liveEnabled) {
      startLive();
    } else {
      startFollow();
      pump(0);
    }
  }

  function suspend() {
    stopLive();
    stopFollow();
  }

  function applyPref(pref) {
    liveEnabled = pref;
    if (pref) {
      stopFollow();
      startLive();
    } else {
      stopLive();
      if (!document.hidden) {
        startFollow();
        pump(0);
      }
    }
  }

  // 窗口移动/缩放：跟手模式下节流补帧（实时模式无需）。
  try {
    var current = tauri.window && tauri.window.getCurrentWindow ? tauri.window.getCurrentWindow() : null;
    if (current && typeof current.onMoved === "function") {
      current.onMoved(function () {
        if (!liveRunning) {
          pump(150);
        }
      });
    }
    if (current && typeof current.onResized === "function") {
      current.onResized(function () {
        if (!liveRunning) {
          pump(150);
        }
      });
    }
  } catch (error) {
    /* 老版本没有这些事件：靠点击/聚焦刷新 */
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      suspend();
      return;
    }
    invoke("backdrop_live_pref")
      .then(applyPref)
      .catch(function () {
        applyPref(liveEnabled);
      });
  });

  window.addEventListener("focus", function () {
    if (!liveRunning) {
      pump(150);
    }
  });

  document.addEventListener("pointerdown", function () {
    if (!liveRunning) {
      pump(250);
    }
  }, { passive: true });

  // 托盘"实时玻璃背景"开关：Rust 侧已切换排除状态并广播，这里只需切刷新策略。
  try {
    if (tauri.event && typeof tauri.event.listen === "function") {
      tauri.event.listen("usg-live-backdrop", function (event) {
        applyPref(Boolean(event && event.payload));
      });
    }
  } catch (error) {
    /* 事件 API 不可用：保持默认实时模式 */
  }

  // 快捷键 Ctrl+Alt+L：临时暂停/恢复实时背景（暂停后可正常截图）。
  document.addEventListener("keydown", function (event) {
    if (!event.ctrlKey || !event.altKey || (event.key !== "l" && event.key !== "L")) {
      return;
    }
    event.preventDefault();
    var next = !liveEnabled;
    invoke("set_backdrop_live_pref", { enabled: next })
      .then(function (enabled) {
        applyPref(Boolean(enabled));
      })
      .catch(function () {
        applyPref(next);
      });
  });

  // 诊断（隐藏）：Ctrl+Alt+F 开关"帧率上报到应用日志"，以后调帧率时可核对实测值。
  var debugFps = false;
  var diagFrames = 0;
  var diagSpent = 0;
  var diagSince = 0;
  window.setInterval(function () {
    if (!debugFps) {
      return;
    }
    var now = Date.now();
    if (!diagSince) {
      diagSince = now;
      return;
    }
    var fps = (diagFrames * 1000) / (now - diagSince);
    var cost = diagFrames ? diagSpent / diagFrames : 0;
    invoke("report_backdrop_fps", { fps: fps, cost: cost }).catch(function () {});
    diagFrames = 0;
    diagSpent = 0;
    diagSince = now;
  }, 1000);
  document.addEventListener("keydown", function (event) {
    if (!event.ctrlKey || !event.altKey || (event.key !== "f" && event.key !== "F")) {
      return;
    }
    event.preventDefault();
    debugFps = !debugFps;
    diagFrames = 0;
    diagSpent = 0;
    diagSince = 0;
    invoke("report_backdrop_fps", { fps: debugFps ? -1 : -2, cost: 0 }).catch(function () {});
  });

  // 首帧：Rust 在窗口显示前就抓好了缓存，这里取到即画（无等待、无闪烁）。
  invoke("backdrop_live_pref")
    .then(applyPref)
    .catch(function () {
      resume();
    });
})();
