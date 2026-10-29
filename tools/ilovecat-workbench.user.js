// ==UserScript==
// @name         喵喵的逆袭 · 数据导出与策略执行
// @namespace    https://github.com/ZeroJehovah/ilovecat-battle-sim
// @version      0.3.9
// @description  按范围只读导出战斗数据与 JS，并按 JSON 策略操作战斗页面；支持空闲自动倍速
// @match        https://api.ilovecat520.me/*
// @updateURL    https://raw.githubusercontent.com/ZeroJehovah/ilovecat-battle-sim/main/tools/ilovecat-workbench.user.js
// @downloadURL  https://raw.githubusercontent.com/ZeroJehovah/ilovecat-battle-sim/main/tools/ilovecat-workbench.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const STRATEGY_FORMAT = "ilovecat-battle-strategy";
  const EXPORT_FORMAT = "ilovecat-game-export";
  const USERSCRIPT_VERSION = "0.3.9";
  const STORAGE_KEY = "ilovecat-workbench-strategy";
  const ACTION_GAP_MS = 250;
  const LOOP_MS = 100;
  const BATTLE_START_TIMEOUT_MS = 20000;
  const CANNON_READY = 1;
  const BATTLE_SPEED_KEY = "snowapi-cat-battle-speed";
  const AUTO_SPEED_BASE_EXIT_SECONDS = 5;
  const AUTO_SPEED_MAX_EXTRA_EXIT_SECONDS = 6;
  const AUTO_SPEED_ENTER_LEAD_SECONDS = 4;
  const AUTO_SPEED_STUCK_MS = 1800;
  const ITEM_NAMES = {
    start_coins: "開場金幣",
    fast_coins: "加速補給",
    strong_base: "主堡加固",
    cannon_ready: "貓爪砲預熱",
    rally: "全軍振奮",
  };

  let executor = null;
  let busy = false;
  let speedRestoreToken = 0;
  let stageOptions = null;
  let stageOptionsPromise = null;

  window.__ilovecatWorkbenchV1?.destroy?.();

  const ui = createUi();
  const previousStrategy = readStorage();
  if (previousStrategy) ui.strategy.value = previousStrategy;
  wireUi();
  window.__ilovecatWorkbenchV1 = {
    destroy() {
      stopExecutor("", false);
      speedRestoreToken++;
      ui.host.remove();
      delete window.__ilovecatWorkbenchV1;
    },
  };

  function createUi() {
    const host = document.createElement("div");
    host.id = "ilovecat-workbench-host";
    document.documentElement.append(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        button, textarea, input { font: inherit; }
        .launcher {
          position: fixed; right: 14px; top: 76px; z-index: 2147483647;
          width: 46px; height: 46px; border-radius: 15px; border: 1px solid #5b4a32;
          display: grid; place-items: center; padding: 6px;
          background: #f7e8c7; cursor: pointer;
          box-shadow: 0 8px 30px rgba(0,0,0,.35);
        }
        .launcher svg { display: block; width: 30px; height: 30px; }
        .panel {
          position: fixed; right: 14px; top: 132px; z-index: 2147483647;
          width: min(520px, calc(100vw - 28px)); max-height: min(760px, calc(100vh - 150px));
          overflow: auto; border: 1px solid #6b573b; border-radius: 16px;
          background: #171c24; color: #f7ead0; padding: 14px;
          box-shadow: 0 18px 60px rgba(0,0,0,.5); font-family: system-ui, sans-serif;
        }
        .panel[hidden], .view[hidden] { display: none !important; }
        .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .title { font-size: 16px; font-weight: 750; }
        .version { margin-left: 3px; color: #b9ad98; font-size: 12px; font-weight: 600; }
        .muted { color: #b9ad98; font-size: 12px; line-height: 1.55; }
        .tabs { display: flex; gap: 7px; margin: 12px 0; }
        .tabs button, .actions button, .close {
          border: 1px solid #5e513d; border-radius: 9px; background: #282f3a;
          color: #f7ead0; padding: 7px 10px; cursor: pointer;
        }
        .tabs button.active { background: #d28a28; border-color: #f0b95c; color: #1e160b; font-weight: 700; }
        .actions button.primary { background: #d28a28; border-color: #f0b95c; color: #1e160b; font-weight: 700; }
        .actions button.danger { background: #7f2d2d; border-color: #b44; }
        button:disabled { opacity: .45; cursor: wait; }
        .actions { display: flex; flex-wrap: wrap; gap: 7px; margin: 10px 0; }
        .status {
          min-height: 42px; margin: 9px 0 0; padding: 9px 10px; border-radius: 9px;
          background: #10141a; border: 1px solid #313946; white-space: pre-wrap;
          font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
        }
        .status.error { color: #ffaaa4; border-color: #733; }
        .status.ok { color: #b8e7c0; border-color: #355e3a; }
        label.check { display: flex; align-items: center; gap: 7px; margin: 10px 0; font-size: 13px; }
        textarea {
          width: 100%; min-height: 245px; resize: vertical; border-radius: 10px;
          border: 1px solid #4e5866; background: #0e1218; color: #e8eef6;
          padding: 10px; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
        }
        [data-view="execute"] > textarea { height: 128px; min-height: 128px; resize: none; }
        input[type="file"][hidden] { display: none !important; }
        .warning { color: #f4ca7c; }
        .scope-card {
          display: flex; flex-direction: column; gap: 6px;
          margin: 10px 0; padding: 10px; border: 1px solid #3e4857;
          border-radius: 11px; background: #11161d;
        }
        .scope-card label.check {
          min-height: 32px; margin: 0; padding: 0;
          font-size: 12px; line-height: 18px;
        }
        .scope-card label.radio { line-height: 18px; }
        .scope-card input[type="checkbox"],
        .scope-card input[type="radio"] {
          flex: 0 0 auto; width: 14px; height: 14px; margin: 0;
          position: relative; top: -1px; accent-color: #d28a28;
        }
        .stage-choices { display: flex; flex-direction: column; gap: 6px; margin: 0; }
        .stage-option, .daily-stage-row {
          display: flex; align-items: center; gap: 7px; min-height: 32px; padding: 0;
          border-radius: 6px; font-size: 12px; line-height: 18px;
        }
        .stage-option { cursor: pointer; }
        .daily-stage-row { gap: 10px; white-space: nowrap; }
        .daily-difficulties { display: flex; align-items: center; gap: 8px; }
        .daily-difficulty {
          display: flex; align-items: center; gap: 4px; line-height: 18px; cursor: pointer;
        }
        .stage-kind { color: #f0b95c; font-weight: 700; }
        .fixed-stages {
          display: flex; align-items: center; gap: 8px; min-height: 32px; margin: 0;
          padding: 0; color: #e7c98f; font-size: 12px; font-weight: 700; line-height: 18px;
        }
        .fixed-stage-input {
          flex: 1; min-width: 0; height: 30px; border: 1px solid #4e5866; border-radius: 7px;
          background: #0e1218; color: #e8eef6; padding: 4px 8px;
          font-size: 12px; line-height: 20px;
        }
        .js-scope-row {
          display: flex; align-items: center; gap: 10px; min-height: 32px; margin: 0;
          padding: 0; color: #e7c98f; font-size: 12px; font-weight: 700;
          line-height: 18px; white-space: nowrap;
        }
        .js-scope-row label.check {
          min-height: 0; margin: 0; padding: 0;
          color: #f7ead0; font-weight: 400;
        }
        .execute-options { display: flex; align-items: center; gap: 18px; margin: 10px 0; white-space: nowrap; }
        .execute-options label.check { margin: 0; }
        .item-warning {
          margin: 8px 0 0; padding: 8px 10px; border-radius: 8px;
          border: 1px solid #8a4b2a; background: #2a1b14; color: #ffc38a;
          font-size: 12px; line-height: 1.5;
        }
        .item-warning[hidden] { display: none !important; }
        .strategy-summary {
          margin-top: 10px; padding: 8px 10px; border: 1px solid #313946;
          border-radius: 9px; background: #10141a; color: #f7ead0;
          font: 12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace;
        }
        .strategy-summary-row { display: flex; gap: 4px; min-height: 20px; }
        .strategy-summary-label, .strategy-summary-value { color: #f7ead0; }
        .strategy-summary-value { min-width: 0; overflow-wrap: anywhere; }
        .strategy-summary-team { flex: 1; }
        .strategy-cat-name { color: #f7ead0; }
        .strategy-cat-name.tier-c { color: #b9c1cc; }
        .strategy-cat-name.tier-b { color: #68c7ff; font-weight: 700; }
        .strategy-cat-name.tier-a { color: #d69bff; font-weight: 700; }
        .strategy-cat-name.tier-s { color: #ffbf47; font-weight: 700; }
        .strategy-cat-level { color: #f7ead0; }
        .validation-line { display: block; }
        .validation-line.success { color: #b8e7c0; }
        .validation-line.warning { color: #f4ca7c; }
        .validation-line.error { color: #ffaaa4; }
        .copy-fallback[hidden] { display: none !important; }
        .copy-fallback { margin-top: 10px; }
        .copy-fallback textarea { min-height: 150px; }
      </style>
      <!-- Cat face icon: https://github.com/jdecked/twemoji/blob/main/assets/svg/1f431.svg, © Twitter, Inc and other contributors, CC-BY 4.0. -->
      <button class="launcher" title="喵喵的逆袭工具" aria-label="打开喵喵的逆袭工具">
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <path fill="#FFCC4D" d="M32.348 13.999s3.445-8.812 1.651-11.998c-.604-1.073-8 1.998-10.723 5.442 0 0-2.586-.86-5.276-.86s-5.276.86-5.276.86C10.001 3.999 2.605.928 2.001 2.001.207 5.187 3.652 13.999 3.652 13.999c-.897 1.722-1.233 4.345-1.555 7.16-.354 3.086.35 5.546.658 6.089.35.617 2.123 2.605 4.484 4.306 3.587 2.583 8.967 3.445 10.761 3.445s7.174-.861 10.761-3.445c2.361-1.701 4.134-3.689 4.484-4.306.308-.543 1.012-3.003.659-6.089-.324-2.814-.659-5.438-1.556-7.16z"/>
          <path fill="#F18F26" d="M2.359 2.971c.2-.599 5.348 2.173 6.518 5.404 0 0-3.808 2.624-4.528 4.624 0 0-2.99-7.028-1.99-10.028z"/>
          <path fill="#FFCC4D" d="M5.98 7.261c0-1.414 5.457 2.733 4.457 3.733s-1.255.72-2.255 1.72S5.98 8.261 5.98 7.261z"/>
          <path fill="#F18F26" d="M33.641 2.971c-.2-.599-5.348 2.173-6.518 5.404 0 0 3.808 2.624 4.528 4.624 0 0 2.99-7.028 1.99-10.028z"/>
          <path fill="#FFCC4D" d="M30.02 7.261c0-1.414-5.457 2.733-4.457 3.733s1.255.72 2.255 1.72 2.202-4.453 2.202-5.453z"/>
          <path fill="#292F33" d="M14.001 20.001c0 1.105-.896 1.999-2 1.999s-2-.894-2-1.999c0-1.104.896-1.999 2-1.999s2 .896 2 1.999zm11.998 0c0 1.105-.896 1.999-2 1.999-1.105 0-2-.894-2-1.999 0-1.104.895-1.999 2-1.999s2 .896 2 1.999z"/>
          <path fill="#FEE7B8" d="M2.201 30.458c-.148 0-.294-.065-.393-.19-.171-.217-.134-.531.083-.702.162-.127 4.02-3.12 10.648-2.605.275.021.481.261.46.536-.021.275-.257.501-.537.46-6.233-.474-9.915 2.366-9.951 2.395-.093.07-.202.106-.31.106zm8.868-4.663c-.049 0-.1-.007-.149-.022-4.79-1.497-8.737-.347-8.777-.336-.265.081-.543-.07-.623-.335-.079-.265.071-.543.335-.622.173-.052 4.286-1.247 9.362.338.264.083.411.363.328.627-.066.213-.263.35-.476.35zm22.73 4.663c.148 0 .294-.065.393-.19.171-.217.134-.531-.083-.702-.162-.127-4.02-3.12-10.648-2.605-.275.021-.481.261-.46.536.022.275.257.501.537.46 6.233-.474 9.915 2.366 9.951 2.395.093.07.202.106.31.106zm-8.868-4.663c.049 0 .1-.007.149-.022 4.79-1.497 8.737-.347 8.777-.336.265.081.543-.07.623-.335.079-.265-.071-.543-.335-.622-.173-.052-4.286-1.247-9.362.338-.264.083-.411.363-.328.627.066.213.263.35.476.35z"/>
          <path fill="#67757F" d="M24.736 30.898c-.097-.258-.384-.392-.643-.294-.552.206-1.076.311-1.559.311-1.152 0-1.561-.306-2.033-.659-.451-.338-.956-.715-1.99-.803v-2.339c0-.276-.224-.5-.5-.5s-.5.224-.5.5v2.373c-.81.115-1.346.439-1.816.743-.568.367-1.059.685-2.083.685-.482 0-1.006-.104-1.558-.311-.258-.095-.547.035-.643.294-.097.259.035.547.293.644.664.247 1.306.373 1.907.373 1.319 0 2.014-.449 2.627-.845.524-.339.98-.631 1.848-.635.992.008 1.358.278 1.815.621.538.403 1.147.859 2.633.859.601 0 1.244-.126 1.908-.373.259-.097.391-.385.294-.644z"/>
          <path fill="#E75A70" d="M19.4 24.807h-2.8c-.64 0-1.163.523-1.163 1.163 0 .639.523 1.163 1.163 1.163h.237v.345c0 .639.523 1.163 1.163 1.163s1.163-.523 1.163-1.163v-.345h.237c.639 0 1.163-.523 1.163-1.163s-.524-1.163-1.163-1.163z"/>
          <path fill="#F18F26" d="M18.022 17.154c-.276 0-.5-.224-.5-.5V8.37c0-.276.224-.5.5-.5s.5.224.5.5v8.284c0 .277-.223.5-.5.5zM21 15.572c-.276 0-.5-.224-.5-.5 0-2.882 1.232-5.21 1.285-5.308.13-.244.435-.334.677-.204.243.13.334.433.204.677-.012.021-1.166 2.213-1.166 4.835 0 .276-.224.5-.5.5zm-6 0c-.276 0-.5-.224-.5-.5 0-2.623-1.155-4.814-1.167-4.835-.13-.244-.038-.546.205-.677.242-.131.545-.039.676.204.053.098 1.285 2.426 1.285 5.308.001.276-.223.5-.499.5z"/>
        </svg>
      </button>
      <section class="panel" hidden>
        <div class="head">
          <div class="title">喵喵的逆袭工具 <span class="version">v${USERSCRIPT_VERSION}</span></div>
          <button class="close" title="收起">×</button>
        </div>
        <div class="tabs">
          <button data-tab="export" class="active">导出数据</button>
          <button data-tab="execute">执行策略</button>
        </div>
        <div class="view" data-view="export">
          <div class="scope-card">
            <label class="check"><input class="include-catalog" type="checkbox"> 图鉴基础数据（猫、鼠、道具、规则）</label>
            <label class="check"><input class="include-owned" type="checkbox"> 已拥有猫咪的等级列表</label>
            <div class="stage-choices" role="group" aria-label="页面活动关卡"></div>
            <label class="fixed-stages"><input class="fixed-stage-enable" type="checkbox"> 固定关卡
              <input class="fixed-stage-input" type="text" autocomplete="off" spellcheck="false" placeholder="关卡 id，例如 1,2,3" aria-label="固定关卡 id，例如 1,2,3">
            </label>
            <div class="js-scope-row" role="radiogroup" aria-label="JS 源码">
              <label class="check"><input class="js-enable" type="checkbox"> JS源码</label>
              <label class="check radio"><input class="js-scope" type="radio" name="export-js-scope" value="battle"> 战斗逻辑</label>
              <label class="check radio"><input class="js-scope" type="radio" name="export-js-scope" value="all"> 全部</label>
            </div>
          </div>
          <div class="actions">
            <button class="primary copy-export">复制所选 JSON</button>
            <button class="download-export">下载所选 JSON</button>
          </div>
          <div class="copy-fallback" hidden>
            <p class="muted">自动复制失败。文本框中的内容已选中，请按 Ctrl+C。</p>
            <textarea readonly></textarea>
          </div>
          <pre class="status export-status">尚未读取。</pre>
        </div>
        <div class="view" data-view="execute" hidden>
          <textarea spellcheck="false" placeholder="粘贴 ilovecat-battle-strategy JSON"></textarea>
          <input class="strategy-file" type="file" accept=".json,application/json" hidden>
          <div class="execute-options">
            <label class="check warning"><input class="auto-start" type="checkbox"> 自动开始战斗</label>
            <label class="check"><input class="auto-speed" type="checkbox"> 自动倍速</label>
          </div>
          <p class="item-warning" hidden></p>
          <div class="actions">
            <button class="load-strategy">导入 JSON 文件</button>
            <button class="validate">校验</button>
            <button class="primary run">开始执行</button>
            <button class="danger stop">停止</button>
          </div>
          <div class="strategy-summary" aria-label="策略信息">
            <div class="strategy-summary-row"><span class="strategy-summary-label">策略名称：</span><span class="strategy-summary-name strategy-summary-value"></span></div>
            <div class="strategy-summary-row"><span class="strategy-summary-label">适用关卡：</span><span class="strategy-summary-stage strategy-summary-value"></span></div>
            <div class="strategy-summary-row"><span class="strategy-summary-label">策略配队：</span><span class="strategy-summary-team strategy-summary-value"></span></div>
          </div>
          <div class="status run-status" aria-live="polite">尚未校验。</div>
        </div>
      </section>`;
    return {
      host,
      launcher: root.querySelector(".launcher"),
      panel: root.querySelector(".panel"),
      close: root.querySelector(".close"),
      tabs: [...root.querySelectorAll("[data-tab]")],
      views: [...root.querySelectorAll("[data-view]")],
      includeCatalog: root.querySelector(".include-catalog"),
      includeOwned: root.querySelector(".include-owned"),
      fixedStageEnable: root.querySelector(".fixed-stage-enable"),
      jsScopes: [...root.querySelectorAll(".js-scope")],
      jsEnable: root.querySelector(".js-enable"),
      stageChoices: root.querySelector(".stage-choices"),
      fixedStages: root.querySelector(".fixed-stage-input"),
      copyExport: root.querySelector(".copy-export"),
      downloadExport: root.querySelector(".download-export"),
      copyFallback: root.querySelector(".copy-fallback"),
      copyFallbackText: root.querySelector(".copy-fallback textarea"),
      exportStatus: root.querySelector(".export-status"),
      strategy: root.querySelector('[data-view="execute"] textarea'),
      strategyFile: root.querySelector(".strategy-file"),
      autoStart: root.querySelector(".auto-start"),
      autoSpeed: root.querySelector(".auto-speed"),
      itemWarning: root.querySelector(".item-warning"),
      loadStrategy: root.querySelector(".load-strategy"),
      validate: root.querySelector(".validate"),
      run: root.querySelector(".run"),
      stop: root.querySelector(".stop"),
      summaryName: root.querySelector(".strategy-summary-name"),
      summaryStage: root.querySelector(".strategy-summary-stage"),
      summaryTeam: root.querySelector(".strategy-summary-team"),
      runStatus: root.querySelector(".run-status"),
    };
  }

  function wireUi() {
    ui.launcher.addEventListener("click", () => {
      ui.panel.hidden = !ui.panel.hidden;
      if (!ui.panel.hidden && !ui.views.find((view) => view.dataset.view === "export").hidden) {
        ensureStageOptions().catch((error) => setExportStatus(error.message, true));
      }
    });
    ui.close.addEventListener("click", () => {
      ui.panel.hidden = true;
    });
    for (const tab of ui.tabs) {
      tab.addEventListener("click", () => showTab(tab.dataset.tab));
    }
    ui.copyExport.addEventListener("click", () => runBusy(async () => {
      await ensureStageOptions();
      const selection = readExportSelection();
      const captured = await captureExport(selection);
      const text = JSON.stringify(captured.full, null, 2);
      if (await copyText(text)) {
        ui.copyFallback.hidden = true;
        setExportStatus(`已复制 ${formatBytes(text.length)} JSON。`);
      } else {
        ui.copyFallbackText.value = text;
        ui.copyFallback.hidden = false;
        ui.copyFallbackText.focus();
        ui.copyFallbackText.select();
        setExportStatus(`浏览器拒绝自动写入剪贴板；已显示 ${formatBytes(text.length)} 文本供手动复制。`);
      }
    }));
    ui.downloadExport.addEventListener("click", () => runBusy(async () => {
      await ensureStageOptions();
      const selection = readExportSelection();
      const captured = await captureExport(selection);
      const text = JSON.stringify(captured.full, null, 2) + "\n";
      download(`ilovecat-export-${stamp()}.json`, text);
      setExportStatus(`已下载所选 JSON（${formatBytes(text.length)}）。`);
    }));
    for (const control of [ui.includeCatalog, ui.includeOwned, ...ui.jsScopes]) {
      control.addEventListener("change", () => {
        syncExportControlState();
        updateExportControls();
      });
    }
    ui.fixedStageEnable.addEventListener("change", () => {
      if (ui.fixedStageEnable.checked) {
        ui.fixedStageEnable.checked = false;
      } else {
        ui.fixedStages.value = "";
      }
      syncExportControlState();
      updateExportControls();
    });
    ui.jsEnable.addEventListener("change", () => {
      if (ui.jsEnable.checked) {
        ui.jsEnable.checked = false;
      } else {
        for (const input of ui.jsScopes) input.checked = false;
      }
      syncExportControlState();
      updateExportControls();
    });
    ui.fixedStages.addEventListener("input", () => {
      syncExportControlState();
      updateExportControls();
    });
    ui.stageChoices.addEventListener("change", (event) => {
      if (event.target.matches(".daily-master")) {
        if (event.target.checked) {
          event.target.checked = false;
        } else {
          for (const input of ui.stageChoices.querySelectorAll(".daily-difficulty-input")) {
            input.checked = false;
          }
        }
      }
      syncExportControlState();
      updateExportControls();
    });
    ui.validate.addEventListener("click", () => runBusy(() => validateFromUi()));
    ui.strategy.addEventListener("input", () => {
      if (busy || executor) return;
      clearStrategySummary();
      setRunStatus("尚未校验。");
    });
    ui.loadStrategy.addEventListener("click", () => ui.strategyFile.click());
    ui.strategyFile.addEventListener("change", () => runBusy(async () => {
      const file = ui.strategyFile.files?.[0];
      if (!file) return;
      const text = await file.text();
      ui.strategy.value = text;
      saveStorage(text);
      clearStrategySummary();
      setRunStatus(`已载入 ${file.name}（${text.length} 个字符）。请点击“校验”。`);
      ui.strategyFile.value = "";
    }));
    ui.run.addEventListener("click", () => runBusy(() => startFromUi()));
    ui.stop.addEventListener("click", () => stopExecutor("用户停止。"));
    ui.autoSpeed.addEventListener("change", () => {
      if (!executor) return;
      executor.autoSpeedTarget = 1;
      executor.autoSpeedStuckSince = 0;
      executor.autoSpeedMissingSince = 0;
    });
    syncExportControlState();
    updateExportControls();
  }

  function showTab(name) {
    for (const tab of ui.tabs) tab.classList.toggle("active", tab.dataset.tab === name);
    for (const view of ui.views) view.hidden = view.dataset.view !== name;
    if (name === "export") ensureStageOptions().catch((error) => setExportStatus(error.message, true));
  }

  async function runBusy(task) {
    if (busy) return;
    busy = true;
    ui.copyExport.disabled = true;
    ui.downloadExport.disabled = true;
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExportStatus(message, true);
      setRunStatus(message, true);
    } finally {
      busy = false;
      ui.copyExport.disabled = false;
      ui.downloadExport.disabled = false;
      updateExportControls();
    }
  }

  function setExportStatus(message, error = false) {
    ui.exportStatus.textContent = message;
    ui.exportStatus.classList.toggle("error", error);
    ui.exportStatus.classList.toggle("ok", !error);
  }

  function setRunStatus(message, error = false) {
    ui.runStatus.textContent = message;
    ui.runStatus.classList.toggle("error", error);
    ui.runStatus.classList.toggle("ok", !error && !message.startsWith("运行中"));
  }

  function setValidationResults(results) {
    ui.runStatus.classList.remove("error", "ok");
    const fragment = document.createDocumentFragment();
    for (const result of results) {
      const line = document.createElement("div");
      line.className = `validation-line ${result.type}`;
      line.textContent = result.text;
      fragment.append(line);
    }
    ui.runStatus.replaceChildren(fragment);
  }

  function clearStrategySummary() {
    ui.summaryName.textContent = "";
    ui.summaryStage.textContent = "";
    ui.summaryTeam.replaceChildren();
  }

  function renderStrategySummary(summary) {
    ui.summaryName.textContent = summary.name;
    ui.summaryStage.textContent = summary.stage;
    ui.summaryTeam.replaceChildren();
    summary.team.forEach((cat, index) => {
      if (index) ui.summaryTeam.append("、");
      const entry = document.createElement("span");
      entry.className = "strategy-cat";
      const name = document.createElement("span");
      name.className = "strategy-cat-name";
      const level = document.createElement("span");
      level.className = "strategy-cat-level";
      const tier = String(cat.tier || "").toLowerCase();
      if (["c", "b", "a", "s"].includes(tier)) name.classList.add("tier-" + tier);
      name.textContent = cat.name;
      level.textContent = "(" + cat.level + ")";
      entry.append(name, level);
      ui.summaryTeam.append(entry);
    });
  }

  async function apiGet(name) {
    const uid = localStorage.getItem("uid");
    if (!uid) throw new Error("未找到登录态 uid，请确认当前页面已经登录。");
    const response = await fetch(`/api/cat/battle/${name}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "New-Api-User": uid },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      throw new Error(`/api/cat/battle/${name}: ${body?.message || `HTTP ${response.status}`}`);
    }
    return body.data;
  }

  // testable:buildStageEntries
  function buildStageEntries(catalog, endless, raid, daily) {
    const entries = [];
    const seen = new Set();
    const add = (stage, kind, endlessMeta = null, raidMeta = null) => {
      if (stage?.id == null) return;
      const key = `${kind}:${stage.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ key, kind, stage, endlessMeta, raidMeta });
    };
    add(endless?.stage, "endless", endless
      ? { season: endless.season, ends: endless.ends }
      : null);
    for (const stage of daily?.choices ?? []) {
      add(stage, "daily");
      const entry = entries.at(-1);
      if (entry?.key === "daily:" + stage.id) entry.dailyChosen = daily.chosen === stage.daily;
    }
    const activeRaid = raid?.stage && raid.ended !== true ? raid : null;
    add(activeRaid?.stage, "raid", null, activeRaid
      ? {
        eventId: activeRaid.raid?.id ?? null,
        starts: activeRaid.raid?.start ?? null,
        ends: activeRaid.raid?.end ?? null,
        running: Boolean(activeRaid.running),
      }
      : null);
    for (const stage of catalog?.stages ?? []) add(stage, "campaign");
    return entries;
  }
  // end testable:buildStageEntries

  // testable:buildSelectedSnapshot
  function buildSelectedSnapshot({ catalog, selectedStages, includeCatalog, capturedAt, source }) {
    const campaign = selectedStages.filter((entry) => entry.kind === "campaign");
    const endless = selectedStages.find((entry) => entry.kind === "endless") ?? null;
    const daily = selectedStages.find((entry) => entry.kind === "daily" && entry.dailyChosen)
      ?? selectedStages.find((entry) => entry.kind === "daily")
      ?? null;
    const raid = selectedStages.find((entry) => entry.kind === "raid") ?? null;
    const catalogStages = selectedStages.filter((entry) => entry.kind !== "endless");
    const snapshot = { schemaVersion: 1, capturedAt, source };
    if (includeCatalog) {
      snapshot.catalog = {};
      for (const key of ["cats", "mice", "items", "rules"]) {
        if (catalog?.[key] !== undefined) snapshot.catalog[key] = catalog[key];
      }
      if (catalogStages.length) snapshot.catalog.stages = catalogStages.map((entry) => entry.stage);
    }
    const primary = endless?.stage ?? daily?.stage ?? raid?.stage ?? campaign[0]?.stage ?? null;
    if (primary) snapshot.stage = primary;
    if (endless?.endlessMeta) snapshot.endlessMeta = endless.endlessMeta;
    if (raid?.raidMeta) snapshot.raidMeta = raid.raidMeta;
    return snapshot;
  }
  // end testable:buildSelectedSnapshot

  async function loadStageSources({ requireState = false } = {}) {
    const raidRequest = apiGet("raid").then(
      (data) => ({ data, error: null }),
      (error) => ({ data: null, error }),
    );
    const stateRequest = apiGet("state").then(
      (data) => ({ data, error: null }),
      (error) => ({ data: null, error }),
    );
    const [catalog, endless, raidResult, stateResult] = await Promise.all([
      apiGet("catalog"),
      apiGet("endless"),
      raidRequest,
      stateRequest,
    ]);
    if (!catalog) throw new Error("接口返回缺少 catalog。");
    if (requireState && !stateResult.data) throw new Error("接口返回缺少 state。");
    return {
      catalog,
      endless,
      state: stateResult.data,
      stateError: stateResult.error,
      raid: raidResult.data,
      raidError: raidResult.error,
    };
  }

  async function ensureStageOptions() {
    if (stageOptions) return stageOptions;
    if (stageOptionsPromise) return stageOptionsPromise;
    stageOptionsPromise = (async () => {
      setExportStatus("正在读取页面可选关卡…");
      const sources = await loadStageSources();
      const { catalog, endless, raid, raidError, state, stateError } = sources;
      const entries = buildStageEntries(catalog, endless, raid, state?.daily);
      if (!entries.length) throw new Error("页面没有返回可导出的关卡。");
      stageOptions = { ...sources, entries };
      renderStageOptions(entries);
      updateExportControls();
      const campaignCount = entries.filter((entry) => entry.kind === "campaign").length;
      const endlessCount = entries.filter((entry) => entry.kind === "endless").length;
      const dailyCount = entries.filter((entry) => entry.kind === "daily").length;
      const raidCount = entries.filter((entry) => entry.kind === "raid").length;
      const failed = [
        stateError ? `每日任务读取失败：${stateError.message}` : "",
        raidError ? `限时全服头目读取失败：${raidError.message}` : "",
      ].filter(Boolean).join("\n");
      setExportStatus(`已读取 ${campaignCount} 个普通关卡、${endlessCount} 个当前无尽关卡、${dailyCount} 个每日任务关卡和 ${raidCount} 个限时全服头目。${failed ? "\n" + failed : ""}`);
      return stageOptions;
    })().finally(() => {
      stageOptionsPromise = null;
    });
    return stageOptionsPromise;
  }

  function renderStageOptions(entries) {
    const visibleEntries = entries.filter((entry) => entry.kind !== "campaign");
    const selectedBefore = new Set(
      [...ui.stageChoices.querySelectorAll("input[data-stage-key]:checked")].map((input) => input.value),
    );
    const fragment = document.createDocumentFragment();
    const createStageInput = (entry) => {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = entry.key;
      input.dataset.stageKey = entry.key;
      input.checked = selectedBefore.has(entry.key);
      return input;
    };
    for (const entry of visibleEntries.filter((item) => item.kind !== "daily")) {
      const input = createStageInput(entry);
      const label = document.createElement("label");
      label.className = "stage-option";
      const kind = document.createElement("span");
      kind.className = "stage-kind";
      kind.textContent = entry.kind === "endless"
        ? "当前无尽"
        : "限时活动";
      const detail = document.createElement("span");
      detail.textContent = entry.stage.name || "未命名关卡";
      label.title = `${kind.textContent}：${detail.textContent}`;
      label.append(input, kind, detail);
      fragment.append(label);
    }
    const dailyEntries = visibleEntries.filter((entry) => entry.kind === "daily");
    if (dailyEntries.length) {
      const row = document.createElement("div");
      row.className = "daily-stage-row";
      const master = document.createElement("label");
      master.className = "stage-option";
      const masterInput = document.createElement("input");
      masterInput.type = "checkbox";
      masterInput.className = "daily-master";
      masterInput.checked = false;
      masterInput.setAttribute("aria-label", "每日任务");
      const kind = document.createElement("span");
      kind.className = "stage-kind";
      kind.textContent = "每日任务";
      master.append(masterInput, kind);

      const difficulties = document.createElement("div");
      difficulties.className = "daily-difficulties";
      for (const entry of dailyEntries) {
        const label = document.createElement("label");
        label.className = "daily-difficulty";
        const input = createStageInput(entry);
        input.classList.add("daily-difficulty-input");
        const name = document.createElement("span");
        name.textContent = dailyDifficultyLabel(entry);
        label.append(input, name);
        difficulties.append(label);
      }
      row.append(master, difficulties);
      fragment.append(row);
    }
    ui.stageChoices.replaceChildren(fragment);
    syncExportControlState();
    updateExportControls();
  }

  function dailyDifficultyLabel(entry) {
    return {
      easy: "简单",
      normal: "普通",
      hard: "困难",
      hell: "地狱",
    }[entry.stage.daily] || entry.stage.name || "未知难度";
  }

  // testable:parseFixedStageIds
  function parseFixedStageIds(value) {
    const text = String(value ?? "").trim();
    if (!text) return [];
    const ids = [];
    for (const token of text.split(/[,，\s]+/u).filter(Boolean)) {
      if (!/^\d+$/.test(token)) {
        throw new Error("固定关卡格式有误：“" + token + "”；请输入关卡 id，例如 1,2,3。");
      }
      const id = Number(token);
      if (!Number.isSafeInteger(id) || id < 1) {
        throw new Error("固定关卡 id 无效：“" + token + "”。");
      }
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }
  // end testable:parseFixedStageIds

  function readExportSelection() {
    const checkedStageKeys = [...ui.stageChoices.querySelectorAll("input[data-stage-key]:checked")]
      .map((input) => input.value);
    const fixedStageKeys = parseFixedStageIds(ui.fixedStages.value);
    const fixedKeys = fixedStageKeys
      .map((id) => "campaign:" + id);
    return {
      includeCatalog: ui.includeCatalog.checked,
      includeOwned: ui.includeOwned.checked,
      stageKeys: [...new Set([
        ...checkedStageKeys,
        ...fixedKeys,
      ])],
      jsScope: ui.jsScopes.find((input) => input.checked)?.value ?? "none",
    };
  }

  function syncExportControlState() {
    ui.fixedStageEnable.checked = ui.fixedStages.value.trim() !== "";
    ui.jsEnable.checked = ui.jsScopes.some((input) => input.checked);
    const dailyMaster = ui.stageChoices.querySelector(".daily-master");
    if (dailyMaster) {
      dailyMaster.checked = [...ui.stageChoices.querySelectorAll(".daily-difficulty-input")]
        .some((input) => input.checked);
    }
  }

  function updateExportControls() {
    const stageInputs = [...ui.stageChoices.querySelectorAll("input[data-stage-key]")];
    const hasData = ui.includeCatalog.checked || ui.includeOwned.checked
      || stageInputs.some((input) => input.checked)
      || ui.fixedStages.value.trim() !== ""
      || ui.jsScopes.some((input) => input.checked);
    if (busy) return;
    ui.copyExport.disabled = !hasData;
    ui.downloadExport.disabled = !hasData;
  }

  async function captureExport(selection) {
    const needsState = selection.includeOwned;
    const hasData = selection.includeCatalog || needsState || selection.stageKeys.length
      || selection.jsScope !== "none";
    if (!hasData) throw new Error("至少选择一项导出内容。");
    setExportStatus("正在读取所选数据和页面关卡…");
    const sources = await loadStageSources({ requireState: needsState });
    const { catalog, state, raid, raidError, stateError } = sources;
    const entries = buildStageEntries(catalog, sources.endless, raid, state?.daily);
    stageOptions = { ...sources, entries };
    renderStageOptions(entries);
    const allowedKeys = new Set(entries.map((entry) => entry.key));
    const selectedStages = entries.filter((entry) => selection.stageKeys.includes(entry.key));
    const wantsRaid = selection.stageKeys.some((key) => key.startsWith("raid:"));
    const wantsDaily = selection.stageKeys.some((key) => key.startsWith("daily:"));
    if (wantsDaily && stateError) {
      throw new Error(`所选每日任务关卡读取失败：${stateError.message}`);
    }
    if (wantsDaily && !selectedStages.some((entry) => entry.kind === "daily")) {
      throw new Error("所选每日任务关卡已更新，请重新勾选。");
    }
    if (wantsRaid && raidError) {
      throw new Error(`所选限时全服头目读取失败：${raidError.message}`);
    }
    if (wantsRaid && !selectedStages.some((entry) => entry.kind === "raid")) {
      throw new Error("所选限时全服头目已结束或当前不可用，请重新勾选。");
    }
    if (selection.stageKeys.some((key) => !allowedKeys.has(key))) {
      throw new Error("所选关卡已不在当前页面数据中，请检查固定关卡 id 或重新勾选活动关卡。");
    }

    const capturedAt = new Date().toISOString();
    const pagePath = location.origin + location.pathname;
    const snapshot = selection.includeCatalog || selectedStages.length
      ? buildSelectedSnapshot({
        catalog,
        selectedStages,
        includeCatalog: selection.includeCatalog,
        capturedAt,
        source: pagePath,
      })
      : null;
    const roster = needsState ? buildRoster(catalog, state) : null;
    let client = null;
    if (selection.jsScope !== "none") {
      setExportStatus("正在识别并读取所选战斗 JS…");
      client = await captureClientLogic(selection.jsScope);
    }
    const stageSelection = selectedStages.map((entry) => ({
      kind: entry.kind,
      id: entry.stage.id,
      name: entry.stage.name ?? null,
      waves: entry.stage.waves?.length ?? 0,
    }));
    const full = {
      format: EXPORT_FORMAT,
      version: 2,
      capturedAt,
      selection: {
        catalog: selection.includeCatalog,
        ownedUnits: selection.includeOwned,
        stages: stageSelection,
        scripts: selection.jsScope,
      },
      ...(snapshot ? { snapshot } : {}),
      ...(roster ? { roster } : {}),
      ...(client ? { client } : {}),
    };
    const summary = [];
    if (selection.includeCatalog) {
      summary.push(`图鉴：${catalog.cats?.length ?? 0} 猫 / ${catalog.mice?.length ?? 0} 鼠`);
    }
    summary.push(`关卡：已选 ${selectedStages.length} 个，每关含完整波次`);
    if (roster) {
      summary.push(`额外信息：已拥有 ${roster.ownedUnits.length} 只猫咪`);
    }
    if (client) {
      const bundleSize = client.battleBundles.reduce((total, item) => total + item.bytes, 0);
      summary.push(`战斗逻辑 JS：${client.battleBundles.length} 个 bundle，${formatBytes(bundleSize)}${client.allScripts ? "；另含全部同源脚本正文" : ""}`);
    }
    setExportStatus(summary.join("\n"));
    return { full, snapshot };
  }

  // testable:buildRoster
  function buildRoster(catalog, state) {
    const cats = new Map((catalog.cats ?? []).map((cat) => [cat.id, cat]));
    return {
      ownedUnits: (state.units ?? [])
        .filter((unit) => unit.owned)
        .map((unit) => ({
          id: unit.cat_id,
          name: cats.get(unit.cat_id)?.name ?? unit.cat_id,
          level: Number(unit.level),
        })),
    };
  }
  // end testable:buildRoster

  async function captureClientLogic(jsScope) {
    if (jsScope !== "battle" && jsScope !== "all") {
      throw new Error(`未知的 JS 导出范围：${jsScope}`);
    }
    const includeAllScripts = jsScope === "all";
    const all = loadedScripts();
    const cache = new Map();
    const load = async (url) => {
      if (!cache.has(url)) {
        const response = await fetch(url, { credentials: "same-origin", cache: "force-cache" });
        if (!response.ok) throw new Error(`读取 JS 失败：${new URL(url).pathname} (HTTP ${response.status})`);
        cache.set(url, await response.text());
      }
      return cache.get(url);
    };
    const markerSets = [
      ["this.random=function", "catsOnField", "slotCooldowns"],
      ["this.random = function", "catsOnField", "slotCooldowns"],
      ["cat-battle-screen", "catBaseHp", "enemyBaseHp", "cannonCharge"],
    ];
    const isBattleBundle = (text) => markerSets.some((markers) => markers.every((marker) => text.includes(marker)));
    let hits = [];
    const preferred = all.filter((item) => item.path.includes("/async/"));
    for (const candidate of preferred.length ? preferred : all) {
      const text = await load(candidate.url);
      if (isBattleBundle(text)) hits.push({ ...candidate, text });
    }
    if (hits.length === 0 && preferred.length) {
      for (const candidate of all.filter((item) => !preferred.includes(item))) {
        const text = await load(candidate.url);
        if (isBattleBundle(text)) hits.push({ ...candidate, text });
      }
    }
    if (hits.length === 0) {
      throw new Error("没有在已加载脚本中找到战斗逻辑 JS。请先在本标签页进入一次战斗界面（无需正在战斗），再导出。");
    }
    const battleBundles = [];
    for (const hit of hits) {
      battleBundles.push({
        path: hit.path,
        url: hit.url,
        bytes: new TextEncoder().encode(hit.text).length,
        sha256: await sha256(hit.text),
        text: hit.text,
      });
    }
    let allScripts;
    if (includeAllScripts) {
      allScripts = [];
      for (const item of all) {
        const text = await load(item.url);
        allScripts.push({
          path: item.path,
          url: item.url,
          bytes: new TextEncoder().encode(text).length,
          sha256: await sha256(text),
          text,
        });
      }
    }
    return {
      detectedBy: markerSets,
      battleBundles,
      loadedScripts: all.map(({ path, url, bytes }) => ({ path, url, bytes })),
      ...(allScripts ? { allScripts } : {}),
    };
  }

  function loadedScripts() {
    const seen = new Map();
    for (const entry of performance.getEntriesByType("resource")) {
      let url;
      try {
        url = new URL(entry.name, location.href);
      } catch {
        continue;
      }
      if (url.origin !== location.origin || !/\.js$/i.test(url.pathname) || seen.has(url.href)) continue;
      seen.set(url.href, {
        path: url.pathname,
        url: url.href,
        bytes: Number(entry.decodedBodySize || entry.transferSize || 0),
      });
    }
    return [...seen.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  async function sha256(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.documentElement.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.documentElement.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  }

  function stamp() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  }

  function readStorage() {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  function saveStorage(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Storage is optional.
    }
  }

  function parseStrategy(rawText) {
    let value;
    try {
      value = JSON.parse(rawText);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const hint = /unexpected end/i.test(detail)
        ? `（当前输入 ${rawText.length} 个字符；请从第一个 { 复制到最后一个 }，或使用“导入 JSON 文件”）`
        : "";
      throw new Error(`策略不是合法 JSON：${detail}${hint}`);
    }
    if (!value || value.format !== STRATEGY_FORMAT || value.version !== 1) {
      throw new Error(`策略格式必须是 ${STRATEGY_FORMAT} 且 version=1。`);
    }
    if (!value.policy || typeof value.policy !== "object") throw new Error("策略缺少 policy 对象。");
    const policy = value.policy;
    policy.walletTarget = clampInt(policy.walletTarget ?? 8, 1, 8, "policy.walletTarget");
    policy.economyFirst = policy.economyFirst !== false;
    policy.autoCannon = Boolean(policy.autoCannon);
    policy.automatic = policy.automatic !== false;
    policy.strictTimeline = Boolean(policy.strictTimeline);
    policy.timelineTolerance = policy.timelineTolerance == null
      ? 0.25
      : finiteNumber(policy.timelineTolerance, "policy.timelineTolerance");
    policy.actionGap = policy.actionGap == null
      ? ACTION_GAP_MS / 1000
      : finiteNumber(policy.actionGap, "policy.actionGap");
    policy.openers = stringArray(policy.openers ?? [], "policy.openers");
    policy.priority = stringArray(policy.priority ?? [], "policy.priority");
    policy.fallbackPriority = stringArray(policy.fallbackPriority ?? [], "policy.fallbackPriority");
    policy.deploySequence = repeatedStringArray(policy.deploySequence ?? [], "policy.deploySequence");
    policy.fallbackAfter = policy.fallbackAfter == null
      ? Number.POSITIVE_INFINITY
      : finiteNumber(policy.fallbackAfter, "policy.fallbackAfter");
    policy.targetCounts ??= {};
    if (!policy.targetCounts || typeof policy.targetCounts !== "object" || Array.isArray(policy.targetCounts)) {
      throw new Error("policy.targetCounts 必须是对象。");
    }
    for (const [id, count] of Object.entries(policy.targetCounts)) {
      if (!Number.isInteger(count) || count < 0) throw new Error(`policy.targetCounts.${id} 必须是非负整数。`);
    }
    policy.actions = Array.isArray(policy.actions) ? policy.actions : [];
    policy.actions = policy.actions.map((action, index) => {
      const at = finiteNumber(action?.at, `policy.actions[${index}].at`);
      const type = String(action?.type ?? "");
      if (!["deploy", "wallet", "cannon", "wait"].includes(type)) {
        throw new Error(`policy.actions[${index}].type 不支持：${type}`);
      }
      if (type === "deploy" && !action?.id) throw new Error(`policy.actions[${index}] 缺少猫 id。`);
      return { at, type, ...(action.id ? { id: String(action.id) } : {}) };
    }).sort((left, right) => left.at - right.at);
    if (value.stageId != null) {
      value.stageId = Number(value.stageId);
      if (!Number.isFinite(value.stageId)) throw new Error("stageId 必须是数字。");
    }
    if (value.team != null) {
      if (!Array.isArray(value.team)) throw new Error("team 必须是数组。");
      value.team = value.team.map((entry, index) => ({
        id: String(entry?.id ?? ""),
        level: clampInt(entry?.level, 1, 999, `team[${index}].level`),
      }));
    }
    if (value.items != null) value.items = stringArray(value.items, "items");
    const referenced = [
      ...policy.openers,
      ...policy.priority,
      ...policy.fallbackPriority,
      ...policy.deploySequence,
      ...Object.keys(policy.targetCounts),
      ...policy.actions.map((action) => action.id).filter(Boolean),
    ];
    if (value.team) {
      const ids = new Set(value.team.map((entry) => entry.id));
      const missing = [...new Set(referenced)].filter((id) => !ids.has(id));
      if (missing.length) throw new Error(`策略引用了不在 team 中的猫：${missing.join(", ")}`);
    }
    return value;
  }

  function stringArray(value, label) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(`${label} 必须是字符串数组。`);
    }
    return [...new Set(value)];
  }

  function repeatedStringArray(value, label) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(`${label} 必须是字符串数组。`);
    }
    return value.map((item) => item.trim()).filter(Boolean);
  }

  function clampInt(value, min, max, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
      throw new Error(`${label} 必须是 ${min}–${max} 的整数。`);
    }
    return number;
  }

  function finiteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${label} 必须是非负有限数。`);
    return number;
  }

  async function validateFromUi() {
    clearStrategySummary();
    let strategy;
    try {
      strategy = parseStrategy(ui.strategy.value);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setValidationResults([{ type: "error", text: `JSON 解析失败：${detail}` }]);
      return null;
    }
    saveStorage(ui.strategy.value);
    setValidationResults([{ type: "success", text: "JSON 解析成功。" }]);
    const runtime = findBattleRuntime();
    const active = isActiveRuntime(runtime) ? runtime : { context: null, snapshot: null };
    const prep = active.context ? null : findPreparationRuntime(strategy);
    const display = await resolveStrategyDisplay(strategy, active, prep);
    renderStrategySummary(buildStrategySummary(strategy, display.stageName, display.cats));
    const results = buildUiValidationResults(strategy, active, prep, display.cats, ITEM_NAMES);
    setValidationResults(results);
    updateItemWarning(strategy, prep, Boolean(active.context));
    return strategy;
  }

  function isActiveRuntime(runtime) {
    return Boolean(runtime.context && runtime.snapshot && runtime.snapshot.result === "playing");
  }

  function namesForStrategy(_strategy, runtime, prep) {
    const names = new Map();
    for (const [id, name] of prep?.names ?? []) names.set(id, name);
    for (const entry of prep?.team ?? []) names.set(entry.id, entry.name);
    for (const entry of runtime?.context?.team ?? []) names.set(entry.id, entry.name);
    return names;
  }

  async function resolveStrategyDisplay(strategy, active, prep) {
    const cats = new Map();
    for (const entry of prep?.team ?? []) {
      cats.set(entry.id, { name: String(entry.name ?? ""), tier: String(entry.tier ?? "") });
    }
    for (const entry of active?.context?.team ?? []) {
      cats.set(entry.id, { name: String(entry.name ?? ""), tier: String(entry.tier ?? "") });
    }
    let catalog = stageOptions?.catalog;
    let entries = stageOptions?.entries;
    if (!catalog || !entries) {
      try {
        const sources = await loadStageSources();
        catalog = sources.catalog;
        entries = buildStageEntries(catalog, sources.endless, sources.raid, sources.state?.daily);
      } catch {
        entries = [];
      }
    }
    for (const cat of catalog?.cats ?? []) {
      cats.set(String(cat.id), { name: String(cat.name ?? ""), tier: String(cat.tier ?? "") });
    }
    const matchingStage = strategy.stageId == null
      ? null
      : entries?.find((entry) => Number(entry.stage.id) === Number(strategy.stageId));
    const stageName = String(strategy.stage?.name ?? "").trim()
      || matchingStage?.stage.name
      || prep?.stage?.name
      || active?.context?.stageName
      || "";
    return { cats, stageName };
  }

  // testable:buildStrategySummary
  function buildStrategySummary(strategy, stageName, cats = new Map()) {
    const team = Array.isArray(strategy.team) ? strategy.team : [];
    const resolveCat = (entry) => {
      const cat = cats.get(String(entry.id));
      const name = typeof cat === "string" ? cat : cat?.name;
      return name ? {
        name: String(name),
        level: Number(entry.level),
        tier: typeof cat === "string" ? "" : String(cat?.tier ?? ""),
      } : null;
    };
    return {
      name: String(strategy.name ?? "").trim(),
      stage: String(stageName ?? "").trim(),
      team: team.map(resolveCat).filter(Boolean),
    };
  }
  // end testable:buildStrategySummary

  // testable:buildUiValidationResults
  function buildUiValidationResults(strategy, active, prep, cats = new Map(), itemLabels = {}) {
    const results = [{ type: "success", text: "JSON 解析成功。" }];
    const team = Array.isArray(strategy.team) ? strategy.team : [];
    const levels = new Map(team.map((entry) => [String(entry.id), Number(entry.level)]));
    const policy = strategy.policy ?? {};
    const referenced = new Set(team.map((entry) => String(entry.id)));
    for (const key of ["openers", "priority", "fallbackPriority", "deploySequence"]) {
      for (const id of Array.isArray(policy[key]) ? policy[key] : []) referenced.add(String(id));
    }
    for (const id of Object.keys(policy.targetCounts ?? {})) referenced.add(String(id));
    for (const action of Array.isArray(policy.actions) ? policy.actions : []) {
      if (action?.id) referenced.add(String(action.id));
    }
    const catName = (id) => {
      const cat = cats.get(String(id));
      const name = typeof cat === "string" ? cat : cat?.name;
      return name ? String(name) : "";
    };
    const describeCat = (id) => {
      const name = catName(id);
      const level = levels.get(String(id));
      return name ? (Number.isFinite(level) ? name + "(" + level + ")" : name) : "";
    };
    const itemName = (id) => itemLabels[id] || String(id);
    const stageResults = () => {
      if (active?.context) {
        const expectedId = strategy.stageId;
        const actualId = active.context.stageId;
        if (expectedId != null && Number(expectedId) !== Number(actualId)) {
          const expected = strategy.stage?.name || "id " + expectedId;
          const actual = active.context.stageName || "id " + actualId;
          return [{ type: "error", text: "关卡不符：策略为「" + expected + "」，当前为「" + actual + "」。" }];
        }
        return [{ type: "success", text: "关卡匹配。" }];
      }
      if (prep?.stageMatch === false) {
        const expected = strategy.stage?.name || "id " + strategy.stageId;
        const actual = prep.stage?.name || prep.title || "";
        return [{ type: "error", text: "关卡不符：策略为「" + expected + "」，当前为「" + actual + "」。" }];
      }
      return [{ type: "success", text: "关卡匹配。" }];
    };
    const teamResults = (actualTeam) => {
      const actual = new Map((actualTeam ?? []).map((entry) => [String(entry.id), entry]));
      const missing = [...referenced].filter((id) => !actual.has(id));
      const output = [];
      if (missing.length) {
        const names = missing.map((id) => describeCat(id) || "未知猫咪");
        output.push({ type: "error", text: "配队不符：当前编队缺少 " + names.join("、") + "。" });
      } else if (referenced.size) {
        output.push({ type: "success", text: "配队匹配。" });
      } else {
        output.push({ type: "success", text: "策略未限定配队。" });
      }
      const levelMismatch = team.filter((entry) => {
        return actual.has(String(entry.id)) && Number(actual.get(String(entry.id)).level) !== Number(entry.level);
      });
      if (levelMismatch.length) {
        const details = levelMismatch.map((entry) => {
          const name = catName(entry.id) || "未知猫咪";
          return name + " 策略 " + entry.level + "，当前 " + actual.get(String(entry.id)).level;
        });
        output.push({ type: "warning", text: "等级不符：" + details.join("；") + "。" });
      }
      return output;
    };
    const battleItemResults = () => {
      const expected = new Set((Array.isArray(strategy.items) ? strategy.items : []).map(String));
      const actual = new Set((active?.context?.items ?? []).map((item) => {
        return typeof item === "string" ? item : String(item?.id ?? "");
      }).filter(Boolean));
      const missing = [...expected].filter((id) => !actual.has(id));
      if (missing.length) {
        return [{ type: "error", text: "道具不足：当前战斗未携带 " + missing.map(itemName).join("、") + "。" }];
      }
      const extra = [...actual].filter((id) => !expected.has(id));
      if (extra.length) {
        return [{ type: "warning", text: "额外道具：" + extra.map(itemName).join("、") + "。" }];
      }
      return [{ type: "success", text: expected.size ? "道具匹配。" : "无需消耗品。" }];
    };
    const preparationItemResults = () => {
      const expected = new Set((Array.isArray(strategy.items) ? strategy.items : []).map(String));
      const entries = new Map((prep?.items ?? []).map((item) => [String(item.id), item]));
      const unavailable = [...expected].filter((id) => {
        const item = entries.get(id);
        return !item || Number(item.count) <= 0;
      });
      if (unavailable.length) {
        return [{ type: "error", text: "道具不足：" + unavailable.map(itemName).join("、") + "。" }];
      }
      const selected = new Set([...entries.values()]
        .filter((item) => item.selected)
        .map((item) => String(item.id)));
      const missingSelected = [...expected].filter((id) => !selected.has(id));
      const extraSelected = [...selected].filter((id) => !expected.has(id));
      const changes = [];
      if (missingSelected.length) changes.push("未勾选 " + missingSelected.map(itemName).join("、"));
      if (extraSelected.length) changes.push("多选 " + extraSelected.map(itemName).join("、"));
      if (changes.length) {
        return [{ type: "warning", text: "道具待调整：" + changes.join("；") + "；开始执行时会自动处理。" }];
      }
      return [{ type: "success", text: expected.size ? "道具充足且已勾选。" : "无需消耗品。" }];
    };
    if (active?.context) {
      results.push(...stageResults());
      results.push(...teamResults(active.context.team));
      results.push(...battleItemResults());
    } else if (prep) {
      results.push(...stageResults());
      results.push(...teamResults(prep.team));
      results.push(...preparationItemResults());
    } else {
      results.push({ type: "warning", text: "当前未处于战斗准备界面。" });
      return results;
    }
    if (!results.some((result) => result.type === "error")) {
      results.push({ type: "success", text: "校验通过。" });
    }
    return results;
  }
  // end testable:buildUiValidationResults

  function validateStrategy(strategy, runtime, names = null) {
    const messages = [`策略：${strategy.name || "未命名"}`];
    const nameMap = names ?? new Map((runtime.context?.team ?? []).map((entry) => [entry.id, entry.name]));
    const describe = (id) => `${id} ${nameMap.get(id) || ""}`.trim();
    if (Math.abs(Number(strategy.policy?.actionGap ?? ACTION_GAP_MS / 1000) - ACTION_GAP_MS / 1000) > 1e-9) {
      messages.push(`警告：策略 actionGap=${strategy.policy.actionGap}s，执行器固定 ${ACTION_GAP_MS}ms，节奏会不一致。`);
    }
    let hasError = false;
    if (!runtime.context) {
      messages.push("提示：当前没有进行中的战斗；请先配置队伍、道具并开始战斗。");
      return messages;
    }
    if (strategy.stageId != null && Number(strategy.stageId) !== Number(runtime.context.stageId)) {
      messages.push(`错误：策略关卡是 ${strategy.stageId}，当前战斗是 ${runtime.context.stageId}。`);
      hasError = true;
    } else {
      messages.push(`关卡：${runtime.context.stageId}`);
    }
    const actualIds = new Set(runtime.context.team.map((entry) => entry.id));
    const policy = strategy.policy;
    const referenced = new Set([
      ...policy.openers,
      ...policy.priority,
      ...policy.fallbackPriority,
      ...policy.deploySequence,
      ...Object.keys(policy.targetCounts),
      ...policy.actions.map((action) => action.id).filter(Boolean),
    ]);
    const missingFromBattle = [...referenced].filter((id) => !actualIds.has(id));
    if (missingFromBattle.length) {
      messages.push(`错误：当前战斗队伍缺少策略引用的 ${missingFromBattle.map(describe).join("、")}。`);
      hasError = true;
    }
    if (strategy.team) {
      const missing = strategy.team.filter((entry) => !actualIds.has(entry.id));
      if (missing.length) {
        messages.push(`错误：当前队伍缺少 ${missing.map((entry) => describe(entry.id)).join("、")}。`);
        hasError = true;
      }
      const actualLevels = new Map(runtime.context.team.map((entry) => [entry.id, entry.level]));
      const levelMismatch = strategy.team.filter((entry) => actualIds.has(entry.id) && actualLevels.get(entry.id) !== entry.level);
      if (levelMismatch.length) {
        messages.push(`警告：等级不一致：${levelMismatch.map((entry) => `${describe(entry.id)} 需要 ${entry.level}，当前 ${actualLevels.get(entry.id)}`).join("；")}。`);
      }
    }
    if (strategy.items) {
      const actualItems = new Set((runtime.context.items ?? []).map((item) => typeof item === "string" ? item : item.id));
      const expectedItems = new Set(strategy.items);
      const missing = [...expectedItems].filter((item) => !actualItems.has(item));
      const extra = [...actualItems].filter((item) => !expectedItems.has(item));
      if (missing.length || extra.length) {
        messages.push(`警告：战斗道具不一致。缺少 ${missing.map((id) => `${id} ${ITEM_NAMES[id] || ""}`.trim()).join("、") || "无"}；多出 ${extra.map((id) => `${id} ${ITEM_NAMES[id] || ""}`.trim()).join("、") || "无"}。`);
      }
    }
    messages.push(hasError ? "校验失败。" : "校验通过；执行器仍需在战斗进行中运行。");
    return messages;
  }

  function findPreparationRuntime(strategy) {
    const stageName = typeof strategy.stage?.name === "string" ? strategy.stage.name.trim() : "";
    if (!stageName && strategy.stageId == null) return null;
    const dialogs = [...document.querySelectorAll('[role="dialog"], .snowapi-dialog-content')];
    const seen = new Set();
    let candidate = null;
    for (const dialog of dialogs) {
      if (seen.has(dialog) || !(dialog.offsetWidth || dialog.offsetHeight)) continue;
      seen.add(dialog);
      const title = dialog.querySelector('[data-slot="dialog-title"], h2')?.textContent?.trim() || "";
      const startButton = [...dialog.querySelectorAll("button")].find((button) => {
        if (button.disabled || !(button.offsetWidth || button.offsetHeight)) return false;
        return /^(?:开始战斗|開始戰鬥|开始挑战|開始挑戰)$/.test(button.innerText.trim());
      });
      if (!startButton) continue;
      const meta = readPreparationMeta(startButton, dialog, title);
      if (!meta) continue;
      const runtime = { dialog, startButton, ...meta, stageMatch: true };
      const hasStageId = meta.stage?.id != null && strategy.stageId != null;
      if (hasStageId) {
        if (Number(meta.stage.id) === Number(strategy.stageId)) return runtime;
      } else {
        const titleMatches = matchesStageTitle(title, stageName);
        const metaNameMatches = meta.stage?.name ? matchesStageTitle(meta.stage.name, stageName) : false;
        if (titleMatches || metaNameMatches) return runtime;
      }
      candidate ??= { ...runtime, stageMatch: false };
    }
    // No match: keep the first usable preparation dialog so validation can
    // report exactly which stage is open instead of only "not found".
    return candidate;
  }

  function matchesStageTitle(title, stageName) {
    const normalizedTitle = String(title).replace(/\s+/g, " ").trim();
    const normalizedName = String(stageName).replace(/\s+/g, " ").trim();
    if (!normalizedTitle || !normalizedName) return false;
    if (normalizedTitle === normalizedName) return true;
    return ["·", "・", "-", "—", ":"].some((separator) => {
      return normalizedTitle.endsWith(`${separator} ${normalizedName}`) ||
        normalizedTitle.endsWith(`${separator}${normalizedName}`);
    });
  }

  function readPreparationMeta(startButton, dialog, title) {
    const fiberKey = Object.keys(startButton).find((key) => key.startsWith("__reactFiber$"));
    if (!fiberKey) return null;
    let fiber = startButton[fiberKey];
    let props = null;
    let stage = null;
    let depth = 0;
    while (fiber && depth++ < 45) {
      const candidate = fiber.memoizedProps;
      if (candidate && typeof candidate === "object" &&
          candidate.catalog && candidate.state &&
          Array.isArray(candidate.team) && typeof candidate.onStart === "function") {
        props = candidate;
        stage = readStageFromFiber(fiber, title);
        break;
      }
      fiber = fiber.return;
    }
    if (!props) return null;

    const cats = new Map((props.catalog.cats ?? []).map((cat) => [String(cat.id), cat]));
    const names = new Map([...cats].map(([id, cat]) => [id, String(cat?.name ?? id)]));
    const units = new Map((props.state.units ?? []).map((unit) => [String(unit.cat_id), unit]));
    const team = props.team.map((id, slot) => {
      const key = String(id);
      const cat = cats.get(key);
      const unit = units.get(key);
      return {
        slot,
        id: key,
        name: String(cat?.name ?? key),
        tier: String(cat?.tier ?? ""),
        level: Number(unit?.level ?? 1),
      };
    });
    const items = [...dialog.querySelectorAll("label.cat-battle-item-pick")].map((label) => {
      const input = label.querySelector('input[type="checkbox"]');
      const src = label.querySelector("img")?.getAttribute("src") || "";
      const id = (src.match(/item-([a-z0-9_]+)\.webp/i) ?? [])[1] || "";
      const countText = [...label.querySelectorAll("span")].at(-1)?.textContent || "";
      const count = Number((countText.match(/×\s*(\d+)/) ?? [])[1] ?? 0);
      return {
        id,
        name: label.querySelector(".font-medium")?.textContent?.trim() || id,
        count,
        selected: Boolean(input?.checked),
        input,
      };
    }).filter((item) => item.id);
    return {
      title,
      team,
      items,
      names,
      stage,
      starting: Boolean(props.starting),
    };
  }

  function readStageFromFiber(fiber, title) {
    const candidates = [];
    let hook = fiber.memoizedState;
    let index = 0;
    while (hook && index++ < 160) {
      const value = hook.memoizedState;
      if (value && typeof value === "object" && value.id != null && value.name && Array.isArray(value.waves)) {
        candidates.push({ id: Number(value.id), name: String(value.name) });
      }
      hook = hook.next;
    }
    if (!candidates.length) return null;
    return candidates.find((stage) => matchesStageTitle(title, stage.name) || String(title).includes(stage.name)) || candidates[0];
  }

  function validatePreparation(strategy, prep) {
    const messages = [`准备界面：${prep.title}`];
    const stageCheck = validatePreparationStage(strategy, prep);
    messages.push(...stageCheck.messages);
    let hasError = stageCheck.hasError;
    const expectedTeam = Array.isArray(strategy.team) ? strategy.team : [];
    const nameOf = (id) => prep.names?.get(id) || prep.team.find((entry) => entry.id === id)?.name || id;

    if (expectedTeam.length) {
      const actualIds = prep.team.map((entry) => entry.id);
      const expectedIds = expectedTeam.map((entry) => entry.id);
      const missing = expectedIds.filter((id) => !actualIds.includes(id));
      if (missing.length) {
        messages.push(`错误：编队缺少策略需要的 ${missing.map((id) => `${id} ${nameOf(id)}`).join("、")}。当前编队：${prep.team.map((entry) => `${entry.id} ${entry.name}`).join(" / ") || "空"}。`);
        hasError = true;
      } else {
        messages.push(`队伍：所需猫咪均在编队中（${expectedIds.map((id) => `${id} ${nameOf(id)}`).join(" / ")}）。顺序不强制。`);
        const positions = expectedIds.map((id) => actualIds.indexOf(id));
        const orderPreserved = positions.every((slot, index) => index === 0 || slot > positions[index - 1]);
        if (!orderPreserved) {
          messages.push("提示：编队顺序与策略不同；游戏机制不受影响，执行器按猫 id 查找槽位。");
        }
        const onSecondPage = expectedIds.filter((id) => actualIds.indexOf(id) >= 5);
        if (onSecondPage.length) {
          messages.push(`提示：${onSecondPage.map((id) => `${id} ${nameOf(id)}`).join("、")} 在第 2 页；执行器会直接按 6–0 部署，不切换页面。`);
        }
        const extras = actualIds.filter((id) => !expectedIds.includes(id));
        if (extras.length) {
          messages.push(`额外槽位：${extras.map((id) => `${id} ${nameOf(id)}`).join("、")}；不会被策略主动部署。`);
        }
      }
      const actualLevels = new Map(prep.team.map((entry) => [entry.id, entry.level]));
      const levelMismatch = expectedTeam.filter((entry) => actualIds.includes(entry.id) && Number(entry.level) !== actualLevels.get(entry.id));
      if (levelMismatch.length) {
        messages.push(`警告：准备等级不一致：${levelMismatch.map((entry) => `${entry.id} ${nameOf(entry.id)} 需要 ${entry.level}，当前 ${actualLevels.get(entry.id)}`).join("；")}。`);
      }
    }

    const expectedItems = new Set((Array.isArray(strategy.items) ? strategy.items : []).map(String));
    const itemName = (id) => prep.items.find((item) => item.id === id)?.name || ITEM_NAMES[id] || id;
    const selectedItems = prep.items.filter((item) => item.selected);
    const missing = [...expectedItems].filter((id) => !selectedItems.some((item) => item.id === id));
    const extra = selectedItems.filter((item) => !expectedItems.has(item.id));
    const unavailable = [...expectedItems].filter((id) => {
      const item = prep.items.find((entry) => entry.id === id);
      return !item || item.count <= 0;
    });
    if (missing.length || extra.length || unavailable.length) {
      messages.push(`错误：准备道具不一致。缺少 ${missing.map(itemName).join("、") || "无"}；多选 ${extra.map((item) => itemName(item.id)).join("、") || "无"}；库存不足 ${unavailable.map(itemName).join("、") || "无"}。`);
      hasError = true;
    } else {
      messages.push(`道具：${selectedItems.length ? selectedItems.map((item) => item.name).join("、") : "未使用"}。`);
    }

    messages.push(hasError ? "准备校验失败，未点击开始战斗。" : "准备校验通过。");
    return messages;
  }

  function validatePreparationStage(strategy, prep) {
    if (prep.stageMatch !== false) {
      return {
        hasError: false,
        messages: prep.stage?.id != null ? [`关卡：${prep.stage.name}（id ${prep.stage.id}）`] : [],
      };
    }
    const expected = strategy.stageId != null
      ? `id ${strategy.stageId}`
      : `「${strategy.stage?.name ?? ""}」`;
    const actual = prep.stage
      ? `「${prep.stage.name}」（id ${prep.stage.id}）`
      : `「${prep.title}」`;
    return {
      hasError: true,
      messages: [`错误：当前准备界面是 ${actual}，与策略关卡 ${expected} 不符。`],
    };
  }

  function updateItemWarning(strategy, prep, inBattle = false) {
    const ids = Array.isArray(strategy.items) ? strategy.items.map(String) : [];
    const selectedExtras = prep?.items.filter((item) => item.selected && !ids.includes(item.id)) ?? [];
    if (!ids.length) {
      if (selectedExtras.length) {
        ui.itemWarning.hidden = false;
        ui.itemWarning.textContent = `策略未要求消耗品，但准备界面已勾选：${selectedExtras.map((item) => item.name).join("、")}。校验会阻拦，自动勾选会取消这些选择。`;
      } else {
        ui.itemWarning.hidden = true;
        ui.itemWarning.textContent = "";
      }
      return;
    }

    const detail = ids.map((id) => {
      const item = prep?.items.find((entry) => entry.id === id);
      const label = item?.name || ITEM_NAMES[id] || id;
      if (!item) return `${label}（准备界面未找到）`;
      return `${label}（${item.count <= 0 ? "库存不足" : `库存 ${item.count}`}${item.selected ? "，已勾选" : "，未勾选"}）`;
    });
    const lacking = ids.some((id) => {
      const item = prep?.items.find((entry) => entry.id === id);
      return !item || item.count <= 0;
    });
    const action = inBattle
      ? "当前已在战斗中，无法更改道具选择。"
      : lacking
        ? "库存不足，脚本会阻断开战；自动勾选也无法继续。"
        : "开始执行时会按策略自动勾选/取消。";
    ui.itemWarning.hidden = false;
    ui.itemWarning.textContent = `本策略要求消耗：${detail.join("、")}。${action}`;
  }

  async function selectPreparationItems(strategy, prep) {
    const expected = new Set((Array.isArray(strategy.items) ? strategy.items : []).map(String));
    const missing = [...expected].filter((id) => !prep.items.some((item) => item.id === id));
    if (missing.length) {
      throw new Error(`准备界面没有策略所需消耗品：${missing.map((id) => `${id} ${ITEM_NAMES[id] || ""}`.trim()).join("、")}。`);
    }
    const changes = [];
    for (const item of prep.items) {
      const shouldSelect = expected.has(item.id);
      if (shouldSelect && item.count <= 0) {
        throw new Error(`消耗品库存不足：${item.name}（${item.id}）。`);
      }
      if (item.selected === shouldSelect) continue;
      if (!item.input || item.input.disabled) {
        throw new Error(`消耗品无法勾选：${item.name}（${item.id}），库存 ${item.count}。`);
      }
      item.input.click();
      changes.push(`${shouldSelect ? "勾选" : "取消"} ${item.name}`);
    }
    if (!changes.length) return prep;

    let current = prep;
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      current = findPreparationRuntime(strategy) ?? current;
      const selected = new Set(current.items.filter((item) => item.selected).map((item) => item.id));
      if (selected.size === expected.size && [...expected].every((id) => selected.has(id))) return current;
    }
    throw new Error(`道具勾选后未能确认准备界面状态；已执行：${changes.join("、")}。`);
  }

  async function startFromUi() {
    const strategy = parseStrategy(ui.strategy.value);
    saveStorage(ui.strategy.value);
    const runtime = findBattleRuntime();
    const active = isActiveRuntime(runtime) ? runtime : { context: null, snapshot: null };
    let prep = active.context ? null : findPreparationRuntime(strategy);
    const names = namesForStrategy(strategy, active, prep);
    const validation = validateStrategy(strategy, active, names);
    setRunStatus(validation.join("\n"), validation.some((line) => line.startsWith("错误")));
    updateItemWarning(strategy, prep, Boolean(active.context));
    if (validation.some((line) => line.startsWith("错误"))) {
      throw new Error(validation.join("\n") || "策略校验失败，未开始执行。");
    }

    if (active.context) {
      startExecutor(strategy, active);
      return;
    }

    if (!ui.autoStart.checked) {
      throw new Error("当前没有进行中的战斗。勾选“自动开始战斗”，或先手动开始战斗。");
    }

    if (!prep) throw new Error("没有找到可用的“出战”准备界面。请先打开策略对应的关卡准备界面。");
    const stageCheck = validatePreparationStage(strategy, prep);
    if (stageCheck.hasError) {
      const full = [...validation, `准备界面：${prep.title}`, ...stageCheck.messages];
      setRunStatus(full.join("\n"), true);
      throw new Error(stageCheck.messages.join("\n"));
    }
    setRunStatus(`${validation.join("\n")}\n\n正在按策略勾选消耗品…`);
    prep = await selectPreparationItems(strategy, prep);
    updateItemWarning(strategy, prep);
    const preparation = validatePreparation(strategy, prep);
    const combined = [...validation, ...preparation];
    const hasError = combined.some((line) => line.startsWith("错误"));
    setRunStatus(combined.join("\n"), hasError);
    if (hasError) {
      throw new Error(combined.join("\n") || "准备校验失败，未点击开始战斗。");
    }

    stopExecutor("", false);
    speedRestoreToken++;
    executor = {
      strategy,
      policy: strategy.policy,
      context: null,
      expectedStageId: Number(strategy.stageId),
      waitingForBattle: true,
      waitStartedAt: performance.now(),
      actionIndex: 0,
      sequenceIndex: 0,
      opened: new Set(),
      nextActionAt: 0,
      lastStatus: "",
      lastTime: 0,
      staleSince: performance.now(),
      moneyHistory: [],
      autoSpeedTarget: 1,
      autoSpeedEta: null,
      autoSpeedRaised: false,
      autoSpeedStuckSince: 0,
      autoSpeedMissingSince: 0,
      timer: null,
      stopped: false,
    };
    ui.run.disabled = true;
    ui.validate.disabled = true;
    executor.timer = setTimeout(executeTick, 0);
    const speedNote = ui.autoSpeed.checked ? "\n自动倍速：已把战斗保存倍速设为 1×。" : "";
    setRunStatus(`${combined.join("\n")}${speedNote}\n\n正在点击“开始战斗”…`);
    if (ui.autoSpeed.checked) setStoredBattleSpeed(1);
    prep.startButton.click();
  }

  function startExecutor(strategy, runtime) {
    stopExecutor("", false);
    speedRestoreToken++;
    executor = {
      strategy,
      policy: strategy.policy,
      context: runtime.context,
      expectedStageId: Number(strategy.stageId),
      waitingForBattle: false,
      actionIndex: 0,
      sequenceIndex: 0,
      opened: new Set(),
      nextActionAt: 0,
      lastStatus: "",
      lastTime: runtime.snapshot.time,
      staleSince: performance.now(),
      moneyHistory: [],
      autoSpeedTarget: 1,
      autoSpeedEta: null,
      autoSpeedRaised: false,
      autoSpeedStuckSince: 0,
      autoSpeedMissingSince: 0,
      timer: null,
      stopped: false,
    };
    ui.run.disabled = true;
    ui.validate.disabled = true;
    executor.timer = setTimeout(executeTick, 0);
    setRunStatus("运行中：等待战斗快照…");
  }

  function stopExecutor(message, updateStatus = true) {
    const raised = Boolean(executor?.autoSpeedRaised);
    const token = ++speedRestoreToken;
    if (executor?.timer) clearTimeout(executor.timer);
    if (executor) executor.stopped = true;
    executor = null;
    ui.run.disabled = false;
    ui.validate.disabled = false;
    if (raised) {
      setStoredBattleSpeed(1);
      restoreSpeedTo1(token);
    }
    if (message && updateStatus) setRunStatus(message);
  }

  async function restoreSpeedTo1(token) {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (token !== speedRestoreToken) return;
      const button = findBattleSpeedButton();
      const current = readBattleSpeedNumber();
      if (!button || button.disabled || current == null || current === 1) return;
      button.click();
      await new Promise((resolve) => setTimeout(resolve, ACTION_GAP_MS));
    }
  }

  function scheduleExecutorTick() {
    if (!executor || executor.stopped) return;
    const now = performance.now();
    const delay = executor.nextActionAt > now ? executor.nextActionAt - now : LOOP_MS;
    executor.timer = setTimeout(executeTick, Math.max(0, delay));
  }

  function executeTick() {
    if (executor?.stopped) return;
    try {
      if (!executor.strategy) return;

      if (executor.waitingForBattle) {
        const started = findBattleRuntime(executor.expectedStageId, { requirePlaying: true });
        if (!started.context || !started.snapshot) {
          if (performance.now() - executor.waitStartedAt > BATTLE_START_TIMEOUT_MS) {
            stopExecutor("已点击开始战斗，但 20 秒内没有检测到战斗开始。若页面出现错误，请处理后重试。");
          } else {
            setRunStatus("已点击开始战斗，等待战斗快照…");
          }
          return;
        }
        const liveMessages = validateStrategy(executor.strategy, started);
        if (liveMessages.some((line) => line.startsWith("错误"))) {
          stopExecutor(`战斗已开始，但实时校验失败：\n${liveMessages.join("\n")}`);
          return;
        }
        executor.context = started.context;
        executor.waitingForBattle = false;
        executor.lastTime = started.snapshot.time;
        executor.staleSince = performance.now();
        executor.nextActionAt = 0;
        setRunStatus("战斗已开始，开始执行。");
      }

      const runtime = findBattleRuntime(executor.expectedStageId);
      if (!runtime.snapshot || !runtime.context) {
        stopExecutor("战斗快照消失，执行器已停止。");
        return;
      }
      const snapshot = runtime.snapshot;
      if (snapshot.result !== "playing") {
        stopExecutor(`战斗已结束（${snapshot.result}），执行器停止。`);
        return;
      }
      if (document.querySelector(".cat-battle-screen__overlay") || document.querySelector(".cat-battle-tip--modal")) {
        setRunStatus("运行中：战斗暂停或提示层尚未关闭。");
        return;
      }
      if (snapshot.time === executor.lastTime) {
        if (performance.now() - executor.staleSince > 1500) {
          setRunStatus("运行中：战斗时间没有推进，请确认未暂停、页面在前台。");
        }
      } else {
        executor.lastTime = snapshot.time;
        executor.staleSince = performance.now();
      }
      if (performance.now() - executor.staleSince > 1500) return;
      const autoSpeedOn = ui.autoSpeed.checked;
      const speedState = autoSpeedOn
        ? manageAutoSpeed(snapshot, runtime.context)
        : (executor.autoSpeedRaised ? restoreAutoSpeedTick() : null);
      if (speedState?.busy) {
        executor.nextActionAt = performance.now() + ACTION_GAP_MS;
        updateRunningStatus(snapshot, speedState);
        return;
      }
      if (autoSpeedOn && speedState.current !== 1) {
        updateRunningStatus(snapshot, speedState);
        return;
      }
      if (performance.now() < executor.nextActionAt) {
        updateRunningStatus(snapshot, speedState);
        return;
      }
      const acted = decideAndAct(snapshot, runtime.context);
      if (!executor || executor.stopped) return;
      if (acted) executor.nextActionAt = performance.now() + ACTION_GAP_MS;
      updateRunningStatus(snapshot, speedState);
    } catch (error) {
      stopExecutor(`执行器错误：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      scheduleExecutorTick();
    }
  }

  function decideAndAct(snapshot, context) {
    const policy = executor.policy;
    while (executor.actionIndex < policy.actions.length && policy.actions[executor.actionIndex].at <= snapshot.time) {
      const action = policy.actions[executor.actionIndex];
      if (action.type === "wait") {
        executor.actionIndex++;
        return true;
      }
      if (action.type === "deploy") {
        const outcome = tryDeploy(action.id, snapshot, context);
        if (outcome === "page") return true;
        if (outcome !== true) return scheduleMiss(snapshot, action);
        executor.actionIndex++;
        return true;
      }
      if (action.type === "wallet") {
        if (snapshot.walletLevel >= 8 || snapshot.money < snapshot.walletCost) {
          return scheduleMiss(snapshot, action);
        }
        if (!clickWallet()) return scheduleMiss(snapshot, action);
        executor.actionIndex++;
        return true;
      }
      if (snapshot.cannon < CANNON_READY || !clickCannon()) {
        return scheduleMiss(snapshot, action);
      }
      executor.actionIndex++;
      return true;
    }
    if (!policy.automatic) return false;

    if (snapshot.walletLevel < policy.walletTarget) {
      for (const id of policy.openers) {
        if (executor.opened.has(id)) continue;
        const outcome = tryDeploy(id, snapshot, context);
        if (outcome === "page") return true;
        if (outcome === true) {
          executor.opened.add(id);
          return true;
        }
      }
      if (snapshot.money >= snapshot.walletCost && clickWallet()) return true;
      if (policy.economyFirst) {
        return policy.autoCannon && snapshot.cannon >= CANNON_READY ? clickCannon() : false;
      }
    }

    const counts = snapshot.onField ?? {};
    if (snapshot.walletLevel >= policy.walletTarget || !policy.economyFirst) {
      if (executor.sequenceIndex < policy.deploySequence.length) {
        const id = policy.deploySequence[executor.sequenceIndex];
        const outcome = tryDeploy(id, snapshot, context);
        if (outcome === "page") return true;
        if (outcome === true) {
          executor.sequenceIndex++;
          return true;
        }
        return policy.autoCannon && snapshot.cannon >= CANNON_READY ? clickCannon() : false;
      }
    }
    for (const id of policy.priority) {
      if ((counts[id] ?? 0) < (policy.targetCounts[id] ?? 0)) {
        const outcome = tryDeploy(id, snapshot, context);
        if (outcome) return true;
      }
    }

    if (snapshot.time >= policy.fallbackAfter) {
      for (const id of policy.fallbackPriority) {
        const outcome = tryDeploy(id, snapshot, context);
        if (outcome) return true;
      }
    }
    return policy.autoCannon && snapshot.cannon >= CANNON_READY ? clickCannon() : false;
  }

  function scheduleMiss(snapshot, action) {
    const policy = executor.policy;
    const late = snapshot.time - action.at;
    if (policy.strictTimeline && late > policy.timelineTolerance) {
      const label = action.id ? ` ${action.id}` : "";
      stopExecutor(`定时动作错过：${action.type}${label} @ ${action.at.toFixed(2)}s，当前 ${snapshot.time.toFixed(2)}s。`);
    } else if (!policy.strictTimeline && late > policy.timelineTolerance) {
      executor.actionIndex++;
    }
    return false;
  }

  function tryDeploy(id, snapshot, context) {
    const slot = context.team.findIndex((entry) => entry.id === id);
    if (slot < 0) throw new Error(`当前队伍没有 ${id}`);
    const entry = context.team[slot];
    if (snapshot.cats >= 20) return false;
    if ((snapshot.cooldowns?.[slot] ?? 0) > 0) return false;
    if (snapshot.money < entry.cost) return false;
    return pressDeployKey(slot, context);
  }

  function clickCardForId(id, context) {
    const slot = context.team.findIndex((entry) => entry.id === id);
    if (slot < 0) throw new Error(`当前队伍没有 ${id}`);
    return pressDeployKey(slot, context);
  }

  function deployKeyForSlot(slot) {
    return slot === 9 ? "0" : String(slot + 1);
  }

  function pressDeployKey(slot, context) {
    const pageButton = findPageButton();
    if (slot < 5) {
      const currentPage = pageButton ? readPage(pageButton) : 0;
      if (currentPage == null) return clickVisibleCard(slot, context);
      if (currentPage !== 0) {
        pageButton.click();
        return "page";
      }
    }
    // Keys 1-5 deploy the current page; 6-9 and 0 deploy absolute slots 5-9,
    // so back-page units never require switching pages.
    const key = deployKeyForSlot(slot);
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key,
      code: `Digit${key}`,
      bubbles: true,
      cancelable: true,
    }));
    return true;
  }

  function clickVisibleCard(slot, context) {
    const button = [...document.querySelectorAll("button[title]")].find((candidate) => {
      const match = candidate.title.match(/\((\d+)\)\s*$/);
      return match && Number(match[1]) === slot + 1 && candidate.title.includes(context.team[slot].name);
    });
    if (!button) return false;
    button.click();
    return true;
  }

  function clickWallet() {
    const button = [...document.querySelectorAll("button[title]")].find((candidate) => {
      return /wallet/i.test(candidate.title) || candidate.title.includes("钱包") || candidate.title.includes("錢包");
    });
    if (!button) return false;
    button.click();
    return true;
  }

  function clickCannon() {
    const button = [...document.querySelectorAll("button[title]")].find((candidate) => {
      return /cannon/i.test(candidate.title) || candidate.title.includes("猫爪炮") || candidate.title.includes("貓爪炮");
    });
    if (!button) return false;
    button.click();
    return true;
  }

  function findPageButton() {
    return [...document.querySelectorAll("button")].find((button) => {
      if (!/switch.*cats|切换到另外|切換到另外/i.test(button.title || "")) return false;
      return /(?:^|\n)\s*\d+\s*\/\s*\d+\s*(?:\n|$)/.test(button.innerText || "");
    });
  }

  function readPage(button) {
    const match = (button?.innerText || "").match(/(\d+)\s*\/\s*(\d+)/);
    return match ? Number(match[1]) - 1 : null;
  }

  function findBattleSpeedButton() {
    return [...document.querySelectorAll("button")].find((candidate) => {
      const label = `${candidate.title || ""} ${candidate.getAttribute("aria-label") || ""}`;
      return /战斗速度|戰鬥速度|Battle speed/i.test(label);
    }) || null;
  }

  function readBattleSpeedNumber() {
    const button = findBattleSpeedButton();
    if (!button) return null;
    const label = `${button.innerText || ""} ${button.getAttribute("aria-label") || ""}`;
    const match = label.match(/([123])\s*(?:[×x]|倍)/i);
    return match ? Number(match[1]) : null;
  }

  function setStoredBattleSpeed(speed) {
    try {
      localStorage.setItem(BATTLE_SPEED_KEY, String(speed));
    } catch {
      // Storage is optional; the battle still starts at the previous speed.
    }
  }

  function cycleBattleSpeed() {
    const button = findBattleSpeedButton();
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }

  function estimateIncome(snapshot, context) {
    const walletLevel = Math.max(1, Number(snapshot.walletLevel ?? 1));
    const hasFastCoins = (context?.items ?? []).some((item) => {
      return (typeof item === "string" ? item : item?.id) === "fast_coins";
    });
    const base = (25 + 8 * (walletLevel - 1)) * (hasFastCoins ? 1.3 : 1);
    const history = executor.moneyHistory;
    const sample = { time: snapshot.time, money: snapshot.money, walletLevel };
    const last = history.at(-1);
    if (!last || sample.time < last.time || sample.time - last.time > 1) history.length = 0;
    else if (sample.money < last.money || sample.walletLevel !== last.walletLevel) history.length = 0;
    history.push(sample);
    while (history.length > 2 && sample.time - history[0].time > 3) history.shift();
    if (history.length < 2) return { rate: base, base };
    const first = history[0];
    const seconds = sample.time - first.time;
    const observed = seconds > 0 ? (sample.money - first.money) / seconds : base;
    return { rate: Math.max(base, observed), base };
  }

  function earliestCandidate(candidates) {
    if (!candidates.length) return null;
    return candidates.reduce((best, candidate) => candidate.at < best.at ? candidate : best);
  }

  function estimateNextAction(snapshot, context, income) {
    const policy = executor.policy;
    const now = snapshot.time;
    const candidates = [];
    const add = (at, reason) => {
      if (!Number.isFinite(at)) return;
      candidates.push({ at: Math.max(now, at), reason });
    };

    for (let index = executor.actionIndex; index < policy.actions.length; index++) {
      const action = policy.actions[index];
      if (action.type === "wait") continue;
      add(action.at, `定时${action.type}`);
      break;
    }

    if (!policy.automatic) return earliestCandidate(candidates);

    const money = Number(snapshot.money ?? 0);
    const maxMoney = Number(snapshot.maxMoney ?? (600 + 400 * (Number(snapshot.walletLevel ?? 1) - 1)));
    const team = context.team;
    const cooldowns = snapshot.cooldowns ?? [];
    const counts = snapshot.onField ?? {};

    const affordAt = (cost) => {
      const deficit = Math.max(0, Number(cost) - money);
      if (deficit <= 0) return now;
      if (money >= maxMoney) return Number.POSITIVE_INFINITY;
      return now + deficit / Math.max(1e-9, income.rate);
    };

    const deployAt = (id) => {
      const slot = team.findIndex((entry) => entry.id === id);
      if (slot < 0) return Number.POSITIVE_INFINITY;
      if (Number(snapshot.cats ?? 0) >= 20) return now;
      const entry = team[slot];
      const cooldown = Math.max(0, Number(cooldowns[slot] ?? 0)) * Math.max(0, Number(entry.cooldown ?? 0));
      return Math.max(now + cooldown, affordAt(entry.cost ?? 0));
    };

    if (snapshot.walletLevel < policy.walletTarget) {
      add(affordAt(snapshot.walletCost), "钱包");
    }
    for (const id of policy.openers) {
      if (!executor.opened.has(id)) add(deployAt(id), `首发${id}`);
    }
    if (executor.sequenceIndex < policy.deploySequence.length) {
      add(deployAt(policy.deploySequence[executor.sequenceIndex]), "固定序列");
    }
    for (const id of policy.priority) {
      if ((counts[id] ?? 0) < (policy.targetCounts[id] ?? 0)) add(deployAt(id), `补位${id}`);
    }
    if (policy.fallbackPriority.length) {
      if (now >= policy.fallbackAfter) {
        for (const id of policy.fallbackPriority) add(deployAt(id), `兜底${id}`);
      } else {
        add(policy.fallbackAfter, "兜底时间");
      }
    }
    if (policy.autoCannon) {
      const cannon = Number(snapshot.cannon ?? 0);
      add(
        cannon >= CANNON_READY ? now : now + (CANNON_READY - cannon) * 30,
        cannon >= CANNON_READY ? "猫爪炮已充满" : "猫爪炮",
      );
    }
    return earliestCandidate(candidates);
  }

  function manageAutoSpeed(snapshot, context) {
    const current = readBattleSpeedNumber();
    if (current == null) {
      const missingSince = executor.autoSpeedMissingSince ||= performance.now();
      if (performance.now() - missingSince > AUTO_SPEED_STUCK_MS) {
        throw new Error("自动倍速找不到战斗倍速按钮；为避免在未知倍速下执行动作，执行器已停止。");
      }
      return { current: null, target: 1, eta: null, reason: "倍速未知", busy: false };
    }
    executor.autoSpeedMissingSince = 0;

    const income = estimateIncome(snapshot, context);
    const estimate = estimateNextAction(snapshot, context, income);
    const eta = estimate ? Math.max(0, estimate.at - snapshot.time) : Number.POSITIVE_INFINITY;
    const extraExit = Math.min(
      AUTO_SPEED_MAX_EXTRA_EXIT_SECONDS,
      Math.max(0, income.rate - income.base) * 1.5,
    );
    const exitSeconds = AUTO_SPEED_BASE_EXIT_SECONDS + extraExit;
    const enterSeconds = exitSeconds + AUTO_SPEED_ENTER_LEAD_SECONDS;
    const target = executor.autoSpeedTarget === 3
      ? (eta <= exitSeconds ? 1 : 3)
      : (eta >= enterSeconds ? 3 : 1);
    executor.autoSpeedTarget = target;
    executor.autoSpeedEta = eta;
    executor.autoSpeedReason = estimate?.reason ?? "无后续动作";

    if (current === target) {
      executor.autoSpeedStuckSince = 0;
      if (current > 1) executor.autoSpeedRaised = true;
      return { current, target, eta, exitSeconds, busy: false };
    }
    if (performance.now() < executor.nextActionAt) {
      return { current, target, eta, exitSeconds, busy: false, waiting: true };
    }
    const stuckSince = executor.autoSpeedStuckSince ||= performance.now();
    if (performance.now() - stuckSince > AUTO_SPEED_STUCK_MS) {
      throw new Error(`自动倍速无法从 ${current}× 切到 ${target}×；请手动切到 1× 后重试。`);
    }
    if (!cycleBattleSpeed()) {
      return { current, target, eta, exitSeconds, busy: false, disabled: true };
    }
    executor.autoSpeedRaised = true;
    return { current, target, eta, exitSeconds, busy: true };
  }

  function restoreAutoSpeedTick() {
    const current = readBattleSpeedNumber();
    if (current === 1 || current == null) {
      if (current === 1) executor.autoSpeedRaised = false;
      return { current, target: 1, eta: null, busy: false };
    }
    if (performance.now() < executor.nextActionAt) {
      return { current, target: 1, eta: null, busy: false, waiting: true };
    }
    if (cycleBattleSpeed()) return { current, target: 1, eta: null, busy: true };
    return { current, target: 1, eta: null, busy: false, disabled: true };
  }

  function updateRunningStatus(snapshot, speedState = null) {
    const policy = executor.policy;
    const counts = policy.priority
      .map((id) => `${id}:${snapshot.onField?.[id] ?? 0}/${policy.targetCounts[id] ?? 0}`)
      .join(" ");
    const sequence = policy.deploySequence.length
      ? `  序列 ${executor.sequenceIndex}/${policy.deploySequence.length}`
      : "";
    const speed = speedState?.current ?? readBattleSpeedNumber();
    const autoSpeed = ui.autoSpeed.checked;
    const speedText = speed == null ? "" : `  速度 ${speed}×${autoSpeed ? "（自动）" : ""}`;
    let speedNote = "";
    if (autoSpeed) {
      const eta = executor.autoSpeedEta;
      const etaText = eta == null
        ? ""
        : Number.isFinite(eta)
          ? `，预计 ${eta.toFixed(1)}s 后可能有操作（${executor.autoSpeedReason || ""}）`
          : "，没有已知的后续操作";
      speedNote = `\n自动倍速：${executor.autoSpeedTarget === 3 ? "空闲 3×" : "动作前 1×"}${etaText}。`;
      if (speed != null && speed !== 1) speedNote += " 当前不会执行策略动作。";
    } else if (speed != null && speed !== 1) {
      speedNote = `\n提示：当前为 ${speed}× 倍速；动作节流按真实时间，精确复刻建议 1×。`;
    }
    const status = `运行中 t=${snapshot.time.toFixed(2)}s  钱包 ${snapshot.walletLevel}/${policy.walletTarget}${sequence}  金币 ${Math.floor(snapshot.money)}  场上 ${snapshot.cats}/20${speedText}\n${counts}${speedNote}`;
    if (status !== executor.lastStatus) {
      executor.lastStatus = status;
      setRunStatus(status);
    }
  }

  function findBattleRuntime(expectedStageId = null, { requirePlaying = false } = {}) {
    const screens = [...document.querySelectorAll(".cat-battle-screen")];
    for (const screen of screens) {
      const runtime = readBattleRuntime(screen);
      if (!runtime.context) continue;
      if (expectedStageId != null && Number(runtime.context.stageId) !== Number(expectedStageId)) continue;
      if (requirePlaying && runtime.snapshot?.result !== "playing") continue;
      return runtime;
    }
    return { context: null, snapshot: null };
  }

  function readBattleRuntime(screen) {
    const fiberKey = Object.keys(screen).find((key) => key.startsWith("__reactFiber$"));
    if (!fiberKey) return { context: null, snapshot: null };
    let context = null;
    let snapshot = null;
    let fiber = screen[fiberKey];
    let depth = 0;
    while (fiber && depth++ < 40) {
      const props = fiber.memoizedProps;
      if (!context) {
        if (props && typeof props === "object" && "seed" in props && "stage" in props && Array.isArray(props.team)) {
          context = {
            stageId: Number(props.stage?.id),
            stageName: String(props.stage?.name ?? ""),
            team: props.team.map((entry, slot) => {
              const cat = entry?.cat ?? {};
              return {
                slot,
                id: String(cat.id ?? entry?.id ?? ""),
                name: String(cat.name ?? cat.id ?? entry?.id ?? ""),
                tier: String(cat.tier ?? ""),
                cost: Number(cat.cost ?? 0),
                cooldown: Number(cat.cooldown ?? 0),
                level: Number(entry?.level ?? 1),
              };
            }).filter((entry) => entry.id),
            items: Array.isArray(props.items) ? props.items : [],
          };
        }
      }
      if (!snapshot) {
        let hook = fiber.memoizedState;
        let hookIndex = 0;
        while (hook && hookIndex++ < 160) {
          const value = hook.memoizedState;
          if (isSnapshot(value)) {
            snapshot = value;
            break;
          }
          hook = hook.next;
        }
      }
      if (context && snapshot) break;
      fiber = fiber.return;
    }
    return { context, snapshot };
  }

  function isSnapshot(value) {
    return value && typeof value === "object" &&
      Number.isFinite(value.time) &&
      Number.isFinite(value.money) &&
      Number.isFinite(value.walletLevel) &&
      Number.isFinite(value.walletCost) &&
      Number.isFinite(value.cats) &&
      value.onField && typeof value.onField === "object" &&
      Array.isArray(value.cooldowns) &&
      typeof value.result === "string";
  }
})();
