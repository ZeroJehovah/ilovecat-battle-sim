// ==UserScript==
// @name         喵喵的逆袭 · 数据导出与策略执行
// @namespace    https://github.com/ZeroJehovah/ilovecat-battle-sim
// @version      0.1.7
// @description  只读导出战斗数据与当前 JS，并按 JSON 策略操作战斗页面
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
  const USERSCRIPT_VERSION = "0.1.7";
  const STORAGE_KEY = "ilovecat-workbench-strategy";
  const ACTION_GAP_MS = 250;
  const LOOP_MS = 100;
  const BATTLE_START_TIMEOUT_MS = 20000;
  const CANNON_READY = 1;
  const ITEM_NAMES = {
    start_coins: "開場金幣",
    fast_coins: "加速補給",
    strong_base: "主堡加固",
    cannon_ready: "貓爪砲預熱",
    rally: "全軍振奮",
  };

  let executor = null;
  let busy = false;

  window.__ilovecatWorkbenchV1?.destroy?.();

  const ui = createUi();
  const previousStrategy = readStorage();
  if (previousStrategy) ui.strategy.value = previousStrategy;
  wireUi();
  window.__ilovecatWorkbenchV1 = {
    destroy() {
      stopExecutor("", false);
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
          background: #f7e8c7; color: #4c351d; font-size: 23px; cursor: pointer;
          box-shadow: 0 8px 30px rgba(0,0,0,.35);
        }
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
        input[type="file"][hidden] { display: none !important; }
        .warning { color: #f4ca7c; }
        .item-warning {
          margin: 8px 0 0; padding: 8px 10px; border-radius: 8px;
          border: 1px solid #8a4b2a; background: #2a1b14; color: #ffc38a;
          font-size: 12px; line-height: 1.5;
        }
        .item-warning[hidden] { display: none !important; }
        .copy-fallback[hidden] { display: none !important; }
        .copy-fallback { margin-top: 10px; }
        .copy-fallback textarea { min-height: 150px; }
      </style>
      <button class="launcher" title="喵喵的逆袭工具">🐱</button>
      <section class="panel" hidden>
        <div class="head">
          <div>
            <div class="title">喵喵的逆袭工具</div>
            <div class="muted">v${USERSCRIPT_VERSION} · 只读导出；执行器只点击页面上的战斗按钮</div>
          </div>
          <button class="close" title="收起">×</button>
        </div>
        <div class="tabs">
          <button data-tab="export" class="active">导出数据</button>
          <button data-tab="execute">执行策略</button>
        </div>
        <div class="view" data-view="export">
          <p class="muted">导出当前图鉴、本周无尽关卡、当前队伍/等级/可用战斗道具，以及当前战斗 JS。导出内容不会上传；登录 UID 和请求头不会写入结果。</p>
          <label class="check"><input class="include-all" type="checkbox"> 附带全部已加载 JS（文件会大很多）</label>
          <div class="actions">
            <button class="primary copy-export">复制完整 JSON</button>
            <button class="download-export">下载完整 JSON</button>
            <button class="download-snapshot">下载 snapshot.json</button>
          </div>
          <div class="copy-fallback" hidden>
            <p class="muted">自动复制失败。文本框中的内容已选中，请按 Ctrl+C。</p>
            <textarea readonly></textarea>
          </div>
          <pre class="status export-status">尚未读取。</pre>
        </div>
        <div class="view" data-view="execute" hidden>
          <p class="muted">先按策略配置好队伍和道具，再把策略 JSON 粘贴到这里。已在战斗中时直接执行；停留在“出战”准备界面时，可授权脚本点击“开始战斗”。执行器从 React 战斗快照读取金币、存活数量和冷却，通过页面按钮操作；不会直接修改战斗状态。</p>
          <textarea spellcheck="false" placeholder="粘贴 ilovecat-battle-strategy JSON"></textarea>
          <input class="strategy-file" type="file" accept=".json,application/json" hidden>
          <label class="check warning"><input class="auto-start" type="checkbox"> 无战斗时由脚本点击“开始战斗”（消耗 1 次挑战）</label>
          <p class="item-warning" hidden></p>
          <label class="check warning"><input class="auto-items" type="checkbox"> 自动勾选策略所需消耗品（会消耗库存）</label>
          <div class="actions">
            <button class="load-strategy">导入 JSON 文件</button>
            <button class="validate">校验</button>
            <button class="primary run">开始执行</button>
            <button class="danger stop">停止</button>
          </div>
          <pre class="status run-status">未执行。</pre>
          <p class="muted warning">自动开战只会在关卡名称、队伍前几槽和道具都与策略一致时点击准备界面的“开始战斗”；不会调整队伍、使用道具或选择服务器种子。点击后仍有少量网络与渲染延迟。</p>
        </div>
      </section>`;
    return {
      host,
      launcher: root.querySelector(".launcher"),
      panel: root.querySelector(".panel"),
      close: root.querySelector(".close"),
      tabs: [...root.querySelectorAll("[data-tab]")],
      views: [...root.querySelectorAll("[data-view]")],
      includeAll: root.querySelector(".include-all"),
      copyExport: root.querySelector(".copy-export"),
      downloadExport: root.querySelector(".download-export"),
      downloadSnapshot: root.querySelector(".download-snapshot"),
      copyFallback: root.querySelector(".copy-fallback"),
      copyFallbackText: root.querySelector(".copy-fallback textarea"),
      exportStatus: root.querySelector(".export-status"),
      strategy: root.querySelector('[data-view="execute"] textarea'),
      strategyFile: root.querySelector(".strategy-file"),
      autoStart: root.querySelector(".auto-start"),
      autoItems: root.querySelector(".auto-items"),
      itemWarning: root.querySelector(".item-warning"),
      loadStrategy: root.querySelector(".load-strategy"),
      validate: root.querySelector(".validate"),
      run: root.querySelector(".run"),
      stop: root.querySelector(".stop"),
      runStatus: root.querySelector(".run-status"),
    };
  }

  function wireUi() {
    ui.launcher.addEventListener("click", () => {
      ui.panel.hidden = !ui.panel.hidden;
    });
    ui.close.addEventListener("click", () => {
      ui.panel.hidden = true;
    });
    for (const tab of ui.tabs) {
      tab.addEventListener("click", () => showTab(tab.dataset.tab));
    }
    ui.copyExport.addEventListener("click", () => runBusy(async () => {
      const captured = await captureExport();
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
      const captured = await captureExport();
      const text = JSON.stringify(captured.full, null, 2) + "\n";
      download(`ilovecat-export-${stamp()}.json`, text);
      setExportStatus(`已下载完整 JSON（${formatBytes(text.length)}）。`);
    }));
    ui.downloadSnapshot.addEventListener("click", () => runBusy(async () => {
      const captured = await captureExport({ skipLogic: true });
      const text = JSON.stringify(captured.snapshot, null, 2) + "\n";
      download(`snapshot-${stamp()}.json`, text);
      setExportStatus(`已下载可直接用于模拟器的 snapshot.json（${formatBytes(text.length)}）。`);
    }));
    ui.validate.addEventListener("click", () => runBusy(() => validateFromUi()));
    ui.loadStrategy.addEventListener("click", () => ui.strategyFile.click());
    ui.strategyFile.addEventListener("change", () => runBusy(async () => {
      const file = ui.strategyFile.files?.[0];
      if (!file) return;
      const text = await file.text();
      ui.strategy.value = text;
      saveStorage(text);
      setRunStatus(`已载入 ${file.name}（${text.length} 个字符）。请点击“校验”。`);
      ui.strategyFile.value = "";
    }));
    ui.run.addEventListener("click", () => runBusy(() => startFromUi()));
    ui.stop.addEventListener("click", () => stopExecutor("用户停止。"));
    ui.autoItems.addEventListener("change", () => {
      try {
        const strategy = parseStrategy(ui.strategy.value);
        updateItemWarning(strategy, findPreparationRuntime(strategy));
      } catch {
        // Keep the previous warning when the textarea is not yet valid JSON.
      }
    });
  }

  function showTab(name) {
    for (const tab of ui.tabs) tab.classList.toggle("active", tab.dataset.tab === name);
    for (const view of ui.views) view.hidden = view.dataset.view !== name;
  }

  async function runBusy(task) {
    if (busy) return;
    busy = true;
    ui.copyExport.disabled = true;
    ui.downloadExport.disabled = true;
    ui.downloadSnapshot.disabled = true;
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
      ui.downloadSnapshot.disabled = false;
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

  async function captureExport({ skipLogic = false } = {}) {
    setExportStatus("正在读取图鉴、无尽关卡和当前队伍…");
    const [catalog, endless, state] = await Promise.all([
      apiGet("catalog"),
      apiGet("endless"),
      apiGet("state"),
    ]);
    if (!catalog || !endless?.stage || !state) throw new Error("接口返回缺少 catalog、endless.stage 或 state。");

    const capturedAt = new Date().toISOString();
    const pagePath = location.origin + location.pathname;
    const snapshot = {
      schemaVersion: 1,
      capturedAt,
      source: pagePath,
      catalog,
      stage: endless.stage,
      endlessMeta: {
        season: endless.season,
        ends: endless.ends,
      },
    };
    const roster = buildRoster(catalog, state);
    let client = null;
    if (!skipLogic) {
      setExportStatus("正在识别并读取当前战斗 JS…");
      client = await captureClientLogic(ui.includeAll.checked);
    }
    const full = {
      format: EXPORT_FORMAT,
      version: 1,
      capturedAt,
      snapshot,
      roster,
      client,
      privacy: {
        excluded: ["uid", "cookies", "authorization", "cans", "clears", "stars", "pity", "draws", "attempts"],
        note: "账号筛选只保留当前队伍、已拥有猫咪等级和战斗道具数量。",
      },
    };
    const summary = [
      `图鉴：${catalog.cats?.length ?? 0} 猫 / ${catalog.mice?.length ?? 0} 鼠`,
      `无尽：第 ${endless.stage.id} 关，${endless.stage.waves?.length ?? 0} 波`,
      `队伍：${roster.team.length} 槽 / 已有 ${roster.ownedUnits.length} 只`,
    ];
    if (client) {
      summary.push(`战斗 JS：${client.battleBundles.map((item) => `${item.path} (${formatBytes(item.bytes)})`).join(", ")}`);
    }
    setExportStatus(summary.join("\n"));
    return { full, snapshot };
  }

  function buildRoster(catalog, state) {
    const cats = new Map((catalog.cats ?? []).map((cat) => [cat.id, cat]));
    const units = new Map((state.units ?? []).filter((unit) => unit.owned).map((unit) => [unit.cat_id, unit]));
    const team = (state.team ?? []).map((id, slot) => {
      const cat = cats.get(id);
      return {
        slot,
        id,
        name: cat?.name ?? id,
        level: Number(units.get(id)?.level ?? 1),
      };
    });
    const ownedUnits = (state.units ?? [])
      .filter((unit) => unit.owned)
      .map((unit) => ({
        id: unit.cat_id,
        name: cats.get(unit.cat_id)?.name ?? unit.cat_id,
        level: Number(unit.level),
      }));
    const inventory = Object.fromEntries(
      (catalog.items ?? []).map((item) => [item.id, Number(state.items?.[item.id] ?? 0)]),
    );
    return {
      team,
      scenarioTeam: team.map(({ id, level }) => ({ id, level })),
      ownedUnits,
      inventory,
    };
  }

  async function captureClientLogic(includeAllScripts) {
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
      throw new Error("没有在已加载脚本中找到战斗块。请先进入一次战斗页面再导出。");
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
    const strategy = parseStrategy(ui.strategy.value);
    saveStorage(ui.strategy.value);
    const runtime = findBattleRuntime();
    const active = isActiveRuntime(runtime) ? runtime : { context: null, snapshot: null };
    const prep = active.context ? null : findPreparationRuntime(strategy);
    const names = namesForStrategy(strategy, active, prep);
    const messages = validateStrategy(strategy, active, names);
    if (!active.context) {
      if (prep) messages.push(...validatePreparation(strategy, prep));
      else messages.push("提示：没有找到可用的“出战”准备界面（按策略关卡 id/名称匹配）。");
    }
    updateItemWarning(strategy, prep, Boolean(active.context));
    setRunStatus(messages.join("\n"), messages.some((line) => line.startsWith("错误")));
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

  function strategyRosterLines(strategy, names = new Map()) {
    const team = Array.isArray(strategy.team) ? strategy.team : [];
    if (!team.length) return [];
    const roster = team.map((entry) => {
      const name = names.get(entry.id) || entry.id;
      const target = strategy.policy?.targetCounts?.[entry.id];
      return `${entry.id} ${name} Lv.${entry.level}${target != null ? ` ×${target}` : ""}`;
    });
    const sequence = compressSequence(strategy.policy?.deploySequence ?? [], names);
    return [
      `策略队伍：${roster.join("；")}`,
      sequence ? `出战顺序：${sequence}` : null,
    ].filter(Boolean);
  }

  function compressSequence(ids, names = new Map()) {
    const groups = [];
    for (const id of ids) {
      const last = groups.at(-1);
      if (last?.id === id) last.count++;
      else groups.push({ id, count: 1 });
    }
    return groups.map(({ id, count }) => {
      const name = names.get(id) || id;
      return `${id} ${name}${count > 1 ? `×${count}` : ""}`;
    }).join(" → ");
  }

  function validateStrategy(strategy, runtime, names = null) {
    const messages = [`策略：${strategy.name || "未命名"}`];
    const nameMap = names ?? new Map((runtime.context?.team ?? []).map((entry) => [entry.id, entry.name]));
    const describe = (id) => `${id} ${nameMap.get(id) || ""}`.trim();
    messages.push(...strategyRosterLines(strategy, nameMap));
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
          messages.push(`提示：${onSecondPage.map((id) => `${id} ${nameOf(id)}`).join("、")} 在第 2 页；执行器需要翻页，会增加真实操作时间。`);
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
        : ui.autoItems.checked
          ? "开始执行时会按策略自动勾选/取消。"
          : "请先在准备界面手动勾选，或启用自动勾选。";
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
      throw new Error("当前没有进行中的战斗。勾选“无战斗时由脚本点击开始战斗”，或先手动开始战斗。");
    }

    if (!prep) throw new Error("没有找到可用的“出战”准备界面。请先打开策略对应的关卡准备界面。");
    const stageCheck = validatePreparationStage(strategy, prep);
    if (stageCheck.hasError) {
      const full = [...validation, `准备界面：${prep.title}`, ...stageCheck.messages];
      setRunStatus(full.join("\n"), true);
      throw new Error(stageCheck.messages.join("\n"));
    }
    if (ui.autoItems.checked) {
      setRunStatus(`${validation.join("\n")}\n\n正在按策略勾选消耗品…`);
      prep = await selectPreparationItems(strategy, prep);
    }
    updateItemWarning(strategy, prep);
    const preparation = validatePreparation(strategy, prep);
    const combined = [...validation, ...preparation];
    const hasError = combined.some((line) => line.startsWith("错误"));
    setRunStatus(combined.join("\n"), hasError);
    if (hasError) {
      throw new Error(combined.join("\n") || "准备校验失败，未点击开始战斗。");
    }

    stopExecutor("", false);
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
      timer: null,
      stopped: false,
    };
    ui.run.disabled = true;
    ui.validate.disabled = true;
    executor.timer = setInterval(executeTick, LOOP_MS);
    setRunStatus(`${combined.join("\n")}\n\n正在点击“开始战斗”…`);
    prep.startButton.click();
  }

  function startExecutor(strategy, runtime) {
    stopExecutor("", false);
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
      timer: null,
      stopped: false,
    };
    ui.run.disabled = true;
    ui.validate.disabled = true;
    executor.timer = setInterval(executeTick, LOOP_MS);
    setRunStatus("运行中：等待战斗快照…");
  }

  function stopExecutor(message, updateStatus = true) {
    if (executor?.timer) clearInterval(executor.timer);
    if (executor) executor.stopped = true;
    executor = null;
    ui.run.disabled = false;
    ui.validate.disabled = false;
    if (message && updateStatus) setRunStatus(message);
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
      if (performance.now() < executor.nextActionAt) {
        updateRunningStatus(snapshot);
        return;
      }
      const acted = decideAndAct(snapshot, runtime.context);
      if (!executor || executor.stopped) return;
      if (acted) executor.nextActionAt = performance.now() + ACTION_GAP_MS;
      updateRunningStatus(snapshot);
    } catch (error) {
      stopExecutor(`执行器错误：${error instanceof Error ? error.message : String(error)}`);
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
    return clickCardForSlot(slot, context);
  }

  function clickCardForId(id, context) {
    const slot = context.team.findIndex((entry) => entry.id === id);
    if (slot < 0) throw new Error(`当前队伍没有 ${id}`);
    return clickCardForSlot(slot, context);
  }

  function clickCardForSlot(slot, context) {
    const pageButton = findPageButton();
    const targetPage = Math.floor(slot / 5);
    const currentPage = readPage(pageButton);
    if (currentPage != null && currentPage !== targetPage) {
      pageButton?.click();
      return "page";
    }
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

  function readBattleSpeed() {
    const button = [...document.querySelectorAll("button")].find((candidate) => {
      return /战斗速度|戰鬥速度/.test(candidate.title || "");
    });
    return (button?.innerText || "").trim().replace(/\s+/g, " ");
  }

  function updateRunningStatus(snapshot) {
    const policy = executor.policy;
    const counts = policy.priority
      .map((id) => `${id}:${snapshot.onField?.[id] ?? 0}/${policy.targetCounts[id] ?? 0}`)
      .join(" ");
    const sequence = policy.deploySequence.length
      ? `  序列 ${executor.sequenceIndex}/${policy.deploySequence.length}`
      : "";
    const speed = readBattleSpeed();
    const speedText = speed ? `  速度 ${speed}` : "";
    const speedWarning = speed && !/^1\s*[×x]$/i.test(speed)
      ? `\n提示：当前为 ${speed} 倍速；动作节流按真实时间，精确复刻建议 1×。`
      : "";
    const status = `运行中 t=${snapshot.time.toFixed(2)}s  钱包 ${snapshot.walletLevel}/${policy.walletTarget}${sequence}  金币 ${Math.floor(snapshot.money)}  场上 ${snapshot.cats}/20${speedText}\n${counts}${speedWarning}`;
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
            team: props.team.map((entry, slot) => {
              const cat = entry?.cat ?? {};
              return {
                slot,
                id: String(cat.id ?? entry?.id ?? ""),
                name: String(cat.name ?? cat.id ?? entry?.id ?? ""),
                cost: Number(cat.cost ?? 0),
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
