const state = {
  data: null,
  staticSignals: [],
  staticDailyChanges: [],
  staticCurrentHoldings: [],
  liveData: null,
  liveApplied: false,
  candidateScope: "changes",
  trades: [],
  filteredTrades: [],
  page: 1,
  pageSize: 40,
  drawerType: "",
  drawerId: "",
  charts: {},
  formalCloseReloadCheckedAt: 0,
  monitorStatus: null,
};

const DARK_CHART_COLORS = {
  text: "#e8f2f7",
  soft: "#9cb1c1",
  dim: "#627b8e",
  cyan: "#48e1d1",
  red: "#ff5b6e",
  green: "#20c98c",
  amber: "#f6b94b",
  blue: "#5a9bff",
  grid: "rgba(131,173,207,0.08)",
  axis: "rgba(131,173,207,0.18)",
  panel: "#0a1726",
  tooltipBg: "rgba(5,15,24,0.96)",
  tooltipBorder: "rgba(131,173,207,0.22)",
  tooltipShadow: "0 14px 40px rgba(0,0,0,.35)",
  zoomBg: "rgba(131,173,207,0.04)",
  zoomFill: "rgba(72,225,209,0.08)",
  zoomLine: "rgba(72,225,209,0.3)",
  zoomArea: "rgba(72,225,209,0.06)",
};
const LIGHT_CHART_COLORS = {
  text: "#162638",
  soft: "#50667a",
  dim: "#7b8b99",
  cyan: "#0c8f86",
  red: "#d63d50",
  green: "#118b64",
  amber: "#b77700",
  blue: "#326ec7",
  grid: "rgba(40,69,94,0.10)",
  axis: "rgba(40,69,94,0.20)",
  panel: "#ffffff",
  tooltipBg: "rgba(255,255,255,0.98)",
  tooltipBorder: "rgba(40,69,94,0.18)",
  tooltipShadow: "0 14px 40px rgba(28,52,76,.16)",
  zoomBg: "rgba(40,69,94,0.05)",
  zoomFill: "rgba(12,143,134,0.09)",
  zoomLine: "rgba(12,143,134,0.3)",
  zoomArea: "rgba(12,143,134,0.07)",
};
const COLOR = { ...DARK_CHART_COLORS };
const THEME_STORAGE_KEY = "ma-cycle3-theme";

const FONT_MONO = '"Cascadia Code","Consolas",monospace';
const FONT_SANS = '"Microsoft YaHei UI","PingFang SC",sans-serif';
const MAX_POSITIONS_PER_GROUP = 2;
const POSITION_STAGE_TARGETS = {
  "空": 30,
  "空转多1": 30,
  "空转多2": 60,
  "空转多3": 60,
  "多": 80,
  "多转空1": 0,
  "多转空2": 0,
  "多转空3": 0,
};
const AI_HARDWARE_GROUPS = new Set([
  "PCB",
  "CPO",
  "光上游",
  "半导体上游",
  "半导体芯片",
  "半导体设备",
  "MLCC",
  "存储",
  "AIDC",
]);
const SIGNAL_GROUP_ORDER = new Map(
  [
    "PCB",
    "CPO",
    "光上游",
    "半导体芯片",
    "半导体设备",
    "半导体上游",
    "MLCC",
    "存储",
    "AIDC",
    "算力",
    "AI应用",
    "机器人",
    "药",
    "互金证券",
    "固态锂电",
    "电力",
    "电网设备",
    "储能",
    "商业航天",
    "黄金白银",
    "金属矿业",
    "军工",
  ].map((group, index) => [group, index])
);
const OBSERVATION_GROUPS = new Set(["黄金白银", "金属矿业", "军工"]);

document.addEventListener("DOMContentLoaded", init);

async function init() {
  setupThemeToggle();
  try {
    if (location.protocol === "file:") {
      throw new Error("请通过本地网址打开看板，不能直接双击 index.html。");
    }
    state.data = await fetchJsonWithRetry(
      `data/backtest.json?ts=${Date.now()}`,
      5
    );
    state.staticSignals = [...(state.data.signals || [])];
    state.staticDailyChanges = [...(state.data.dailyChanges || [])];
    state.staticCurrentHoldings = [...(state.data.currentHoldings || [])];
    state.liveData = await fetchLiveSignals();
    applyLiveSignals(state.liveData);
    state.trades = [...(state.data.strategyTransactions || [])].sort((a, b) => {
      const entryOrder = String(b.entryDate || b.date || "").localeCompare(
        String(a.entryDate || a.date || "")
      );
      if (entryOrder !== 0) return entryOrder;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
    state.filteredTrades = [...state.trades];
    populateOverview();
    populateCandidates();
    populatePositionRules();
    populateFilters();
    populateTradeTable();
    populateHoldingBars();
    bindInteractions();
    bindMonitorControls();
    await refreshMonitorStatus();
    renderAllCharts();
    setupNavigation();
    updateCandidateRunHeader();
    window.setInterval(refreshLiveSignals, 10_000);
    window.setInterval(refreshMonitorStatus, 10_000);
    window.addEventListener("resize", resizeCharts);
    document.getElementById("loadingScreen").classList.add("hidden");
  } catch (error) {
    console.error(error);
    const screen = document.getElementById("loadingScreen");
    screen.innerHTML = `
      <div class="loading-mark">!</div>
      <div class="loading-copy">
        <strong>看板装载失败</strong>
        <span>${escapeHtml(error.message || String(error))}</span>
      </div>`;
  }
}

async function fetchJsonWithRetry(url, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`数据读取失败：HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, 600 * attempt)
        );
      }
    }
  }
  throw lastError || new Error("数据读取失败");
}

async function fetchLiveSignals() {
  try {
    const response = await fetch(`data/live_signals.json?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function shanghaiClock() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function shiftShanghaiDate(date, days) {
  const shifted = new Date(`${date}T12:00:00+08:00`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    })
      .formatToParts(shifted)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
  };
}

function previousWeekday(date) {
  let previous = shiftShanghaiDate(date, -1);
  while (["Sat", "Sun"].includes(previous.weekday)) {
    previous = shiftShanghaiDate(previous.date, -1);
  }
  return previous.date;
}

function marketSessionDate(clock = shanghaiClock()) {
  return ["Sat", "Sun"].includes(clock.weekday)
    ? previousWeekday(clock.date)
    : clock.date;
}

function dailyChangesForSession(rows, clock = shanghaiClock()) {
  const sessionDate = marketSessionDate(clock);
  return (rows || []).filter(
    (row) =>
      row &&
      (row.isHolding ||
        !row.date ||
        String(row.date) === sessionDate)
  );
}

function displayDateTime(value) {
  const text = String(value || "");
  return text ? text.replace("T", " ").slice(0, 19) : "—";
}

function updateMarketSyncDetail(live = state.liveData) {
  const syncedAt = displayDateTime(live?.generatedAt);
  const marketTime = String(live?.marketTime || "");
  setText(
    "marketSyncDetail",
    `本地行情同步：${syncedAt}${
      marketTime ? ` · 行情快照：${marketTime}` : ""
    }`
  );
}

function marketDisplayState(clock = shanghaiClock()) {
  const weekend = ["Sat", "Sun"].includes(clock.weekday);
  if (weekend) {
    return {
      date: previousWeekday(clock.date),
      label: "收盘",
      intraday: false,
    };
  }
  if (clock.minuteOfDay < 9 * 60 + 30) {
    return {
      date: previousWeekday(clock.date),
      label: "收盘",
      intraday: false,
    };
  }
  if (clock.minuteOfDay < 15 * 60) {
    return {
      date: clock.date,
      label: "盘中",
      intraday: true,
    };
  }
  return {
    date: clock.date,
    label: "收盘",
    intraday: false,
  };
}

function shouldUseLiveSignals(live) {
  if (
    !live ||
    !live.available ||
    live.status !== "scanning" ||
    !Array.isArray(live.signals) ||
    !live.marketDate
  ) {
    return false;
  }
  const clock = shanghaiClock();
  const formalDate = String(state.data?.meta?.candidateDate || "");
  if (formalDate === live.marketDate) {
    // 收盘正式数据一旦生成，就始终覆盖同一交易日最后一份盘中快照，
    // 即使监控随后又被手动启动，也不能把持仓状态回退到盘中。
    return false;
  }
  // 正式收盘数据生成前，保留同一交易日最后一份盘中信号。
  return clock.date === live.marketDate;
}

function groupRatioMapFromRows(rows, explicitRatios = {}) {
  const ratios = {};
  (rows || []).forEach((row) => {
    const ratio = Number(row.groupManyRatioPct);
    if (row.group && Number.isFinite(ratio)) {
      ratios[row.group] = ratio;
    }
  });
  Object.assign(ratios, explicitRatios || {});
  return ratios;
}

function applyGroupRatios(rows, ratios) {
  return (rows || []).map((row) => {
    const ratio = Number(ratios[row.group]);
    return Number.isFinite(ratio)
      ? { ...row, groupManyRatioPct: ratio }
      : { ...row };
  });
}

function isObservationSignal(row) {
  return Boolean(
    row?.observeOnly ||
      OBSERVATION_GROUPS.has(String(row?.group || "")) ||
      String(row?.reasonRaw || row?.reason || "").includes("仅观察")
  );
}

function sortSignalRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    const observationRankA = isObservationSignal(a) ? 1 : 0;
    const observationRankB = isObservationSignal(b) ? 1 : 0;
    if (observationRankA !== observationRankB) {
      return observationRankA - observationRankB;
    }

    const ratioA = Number(a.groupManyRatioPct);
    const ratioB = Number(b.groupManyRatioPct);
    const safeRatioA = Number.isFinite(ratioA) ? ratioA : Number.NEGATIVE_INFINITY;
    const safeRatioB = Number.isFinite(ratioB) ? ratioB : Number.NEGATIVE_INFINITY;
    if (safeRatioA !== safeRatioB) return safeRatioB - safeRatioA;

    const groupA = String(a.group || "");
    const groupB = String(b.group || "");
    const rankA = SIGNAL_GROUP_ORDER.get(groupA) ?? Number.MAX_SAFE_INTEGER;
    const rankB = SIGNAL_GROUP_ORDER.get(groupB) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    if (groupA !== groupB) return groupA.localeCompare(groupB, "zh-CN");

    const scoreA = Number(a.score);
    const scoreB = Number(b.score);
    const safeScoreA = Number.isFinite(scoreA) ? scoreA : Number.NEGATIVE_INFINITY;
    const safeScoreB = Number.isFinite(scoreB) ? scoreB : Number.NEGATIVE_INFINITY;
    if (safeScoreA !== safeScoreB) return safeScoreB - safeScoreA;
    return String(a.code || "").localeCompare(String(b.code || ""));
  });
}

function applyLiveSignals(live) {
  const useLive = shouldUseLiveSignals(live);
  const liveHoldingPreview =
    useLive && Array.isArray(live?.holdingPreview)
      ? live.holdingPreview
      : [];
  const liveBuyPreview =
    useLive && Array.isArray(live?.signals)
      ? live.signals
          .filter((row) => row?.isBuy && !row?.isHolding)
          .map((row) => ({
            ...row,
            changeType: "buy",
            actionLabel: "预计买入",
          }))
      : [];
  const seenLiveChangeCodes = new Set();
  const liveChanges = [...liveBuyPreview, ...liveHoldingPreview].filter(
    (row) => {
      const code = String(row?.code || "");
      if (!code || seenLiveChangeCodes.has(code)) return false;
      seenLiveChangeCodes.add(code);
      return true;
    }
  );
  const sessionDailyChanges = dailyChangesForSession(
    state.staticDailyChanges
  );
  state.liveApplied = useLive;
  state.liveData = live;
  if (live?.chartBars && typeof live.chartBars === "object") {
    state.data.chartBars = {
      ...(state.data.chartBars || {}),
      ...live.chartBars,
    };
  }
  const displayRatios = useLive
    ? groupRatioMapFromRows(
        [...(live.signals || []), ...(live.intradayJumps || [])],
        live.groupRatios
      )
    : groupRatioMapFromRows(
        [
          ...state.staticSignals,
          ...sessionDailyChanges,
          ...(state.staticCurrentHoldings || []),
        ],
        state.data.groupRatios
      );
  state.data.intradayJumps = applyGroupRatios(
    Array.isArray(live?.intradayJumps) ? live.intradayJumps : [],
    displayRatios
  );
  state.data.signals = applyGroupRatios(
    useLive ? live.signals : state.staticSignals,
    displayRatios
  );
  state.data.dailyChanges = applyGroupRatios(
    liveChanges.length ? liveChanges : sessionDailyChanges,
    displayRatios
  );
  state.data.currentHoldings = applyGroupRatios(
    liveHoldingPreview.length
      ? liveHoldingPreview.filter((row) => row.isHolding)
      : state.staticCurrentHoldings || [],
    displayRatios
  );
  updateMarketSyncDetail(live);
  return useLive;
}

async function refreshLiveSignals() {
  const live = await fetchLiveSignals();
  if (!live) return;
  if (!shouldUseLiveSignals(live)) {
    await reloadAfterOfficialCloseIfReady();
  }
  if (
    state.liveApplied &&
    live.marketDate === state.liveData?.marketDate &&
    !shouldUseLiveSignals(live)
  ) {
    // 收盘后到下一交易日首次扫描前，持续保留同一交易日的最后一份信号。
    state.liveData = live;
    if (live?.chartBars && typeof live.chartBars === "object") {
      state.data.chartBars = {
        ...(state.data.chartBars || {}),
        ...live.chartBars,
      };
    }
    updateMarketSyncDetail(live);
    const staticRatios =
      state.data.groupRatioDate === live.marketDate
        ? state.data.groupRatios
        : {};
    const displayRatios = groupRatioMapFromRows(
      [...(live.signals || []), ...(live.intradayJumps || [])],
      live.groupRatios || staticRatios
    );
    state.data.signals = applyGroupRatios(
      state.data.signals,
      displayRatios
    );
    state.data.intradayJumps = applyGroupRatios(
      Array.isArray(live.intradayJumps) ? live.intradayJumps : [],
      displayRatios
    );
    state.data.dailyChanges = applyGroupRatios(
      state.data.dailyChanges,
      displayRatios
    );
    state.data.currentHoldings = applyGroupRatios(
      state.data.currentHoldings,
      displayRatios
    );
    renderIntradayJumpTable();
    updateCandidateRunHeader();
    return;
  }
  const wasApplied = state.liveApplied;
  applyLiveSignals(live);
  updateCandidateRunHeader();
  if (wasApplied || state.liveApplied) {
    populateCandidates();
    populatePositionRules();
  }
}

async function reloadAfterOfficialCloseIfReady() {
  const clock = shanghaiClock();
  if (
    ["Sat", "Sun"].includes(clock.weekday) ||
    clock.minuteOfDay < 15 * 60 + 5 ||
    Date.now() - state.formalCloseReloadCheckedAt < 30_000
  ) {
    return;
  }
  state.formalCloseReloadCheckedAt = Date.now();
  try {
    const official = await fetchJsonWithRetry(
      `data/backtest.json?ts=${Date.now()}`,
      2
    );
    const generatedAt = String(official?.meta?.generatedAt || "");
    const generatedDate = generatedAt.slice(0, 10);
    const generatedClock = generatedAt.slice(11, 16);
    const currentGeneratedAt = String(
      state.data?.meta?.generatedAt || ""
    );
    if (
      generatedDate === clock.date &&
      generatedClock >= "15:05" &&
      generatedAt !== currentGeneratedAt
    ) {
      window.location.reload();
    }
  } catch {
    // Keep the last intraday preview until the 15:05 official data is ready.
  }
}

function updateCandidateRunHeader() {
  const display = marketDisplayState(shanghaiClock());
  setText("topDataDate", `${display.date} ${display.label}`);
  document
    .querySelector(".top-status .status-dot")
    ?.classList.toggle("intraday", display.intraday);
}

function bindMonitorControls() {
  document
    .getElementById("monitorStartButton")
    .addEventListener("click", () => controlMonitor("start"));
  document
    .getElementById("monitorStopButton")
    .addEventListener("click", () => controlMonitor("stop"));
}

async function refreshMonitorStatus() {
  try {
    const response = await fetch(`api/monitor/status?ts=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderMonitorStatus(await response.json());
  } catch {
    renderMonitorStatus({
      control_available: false,
      running: false,
      state_label: "本地控制不可用",
      detail: "公网页面只读；请通过本机 127.0.0.1:8765 打开后控制监控。",
    });
  }
}

function renderMonitorStatus(status) {
  state.monitorStatus = status;
  const available = Boolean(status.control_available);
  const running = Boolean(status.running);
  const dot = document.getElementById("monitorStatusDot");
  dot.classList.toggle("running", available && running);
  dot.classList.toggle("stopped", available && !running);

  const heartbeat = status.last_heartbeat_at
    ? String(status.last_heartbeat_at).replace("T", " ").slice(0, 19)
    : "—";
  const started = status.started_at
    ? String(status.started_at).replace("T", " ").slice(0, 19)
    : "";
  const schedule = status.schedule || {};
  setText(
    "monitorStatusText",
    available
      ? `监控${status.state_label || (running ? "运行中" : "已停止")}`
      : status.state_label || "本地控制不可用"
  );
  setText(
    "monitorStatusDetail",
    available
      ? [
          running ? `实际运行${started ? ` · 启动于 ${started}` : ""}` : "实际已停止",
          `最后心跳 ${heartbeat}`,
          `${status.interval_seconds || 60}秒轮询`,
          `${status.session_phase || "—"} · 计划 ${schedule.start || "09:15"} 启动 / ${schedule.stop || "15:00"} 停止`,
        ].join(" · ")
      : status.detail
  );
  document.getElementById("monitorStartButton").disabled =
    !available || running;
  document.getElementById("monitorStopButton").disabled =
    !available || !running;
  updateCandidateRunHeader();
}

async function controlMonitor(action) {
  const startButton = document.getElementById("monitorStartButton");
  const stopButton = document.getElementById("monitorStopButton");
  startButton.disabled = true;
  stopButton.disabled = true;
  setText(
    "monitorStatusText",
    action === "start" ? "正在启动监控…" : "正在停止监控…"
  );
  try {
    const response = await fetch(`api/monitor/${action}`, {
      method: "POST",
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    renderMonitorStatus(payload);
    showToast(action === "start" ? "监控已启动" : "监控已停止");
  } catch (error) {
    showToast(`操作失败：${error.message || String(error)}`);
    await refreshMonitorStatus();
  }
}

function populateOverview() {
  const { meta, funnel, portfolio, stats } = state.data;
  setText("topDataDate", `${meta.dataEnd} 收盘`);
  setText("heroRange", `${meta.start} → ${meta.end}`);
  setText("heroUpdated", meta.latestUpdateAt || meta.runTime);
  setText("heroSamples", `${formatInt(stats.all.count)} 笔`);

  const last = state.data.equity[state.data.equity.length - 1];
  const nominal = 1000000;
  const account = nominal * last.equity;
  setText("accountValue", `¥${formatAmount(account)}`);
  setText("accountReturn", formatPct(portfolio.totalReturnPct, true));
  setText("accountDrawdown", formatPct(portfolio.maxDrawdownPct, true));
  setText("accountSharpe", formatNumber(portfolio.sharpe, 2));
  toneElement("accountReturn", portfolio.totalReturnPct);
  toneElement("accountDrawdown", portfolio.maxDrawdownPct);

  setText("funnelSignals", formatInt(funnel.signals));
  setText("funnelLimit", formatInt(funnel.limitSkipped));
  setText("funnelBuyable", formatInt(funnel.buyable));
  setText("funnelProjected", formatInt(funnel.projected));
  setText("funnelRate", `${formatNumber(funnel.projectedRatePct, 1)}% 成功率`);
  setText("funnelGap", formatInt(funnel.gapPassed));
  setText("funnelGapRate", `${formatNumber(funnel.gapRatePct, 1)}% 进入回测`);
  setText("funnelBacktested", formatInt(funnel.backtested));
  setText("funnelPending", `另 ${formatInt(funnel.pending)} 个待回测`);

  setText("kpiTotalReturn", formatPct(portfolio.totalReturnPct, true));
  setText("kpiAnnualized", formatPct(portfolio.annualizedPct, true));
  setText("kpiWinRate", formatPct(stats.all.winRatePct, false));
  setText("kpiTradeCount", formatInt(stats.all.count));
  setText("kpiAvgReturn", formatPct(stats.all.avgReturnPct, true));
  setText("kpiMedian", formatPct(stats.all.medianReturnPct, true));
  setText("kpiPf", formatNumber(stats.all.profitFactor, 2));
  setText("kpiDrawdown", formatPct(portfolio.maxDrawdownPct, true));
  setText("kpiHolding", `${formatNumber(stats.all.avgHoldingDays, 1)} 天`);
  setText("kpiMfe", formatPct(stats.all.avgMfePct, true));
  setText("kpiMae", formatPct(stats.all.avgMaePct, true));
  setText("kpiActive", `${formatNumber(portfolio.avgActive, 1)} 笔`);
  setText("kpiMaxActive", formatInt(portfolio.maxActive));
  setText("kpiDayWin", formatPct(portfolio.positiveDaysPct, false));
  setText("kpiDays", formatInt(portfolio.tradingDays));
  setText("distributionSampleTip", `${formatInt(stats.all.count)} 笔`);
  toneElement("kpiTotalReturn", portfolio.totalReturnPct);
  toneElement("kpiAnnualized", portfolio.annualizedPct);
  toneElement("kpiAvgReturn", stats.all.avgReturnPct);
  toneElement("kpiDrawdown", portfolio.maxDrawdownPct);
  toneElement("kpiMfe", stats.all.avgMfePct);
  toneElement("kpiMae", stats.all.avgMaePct);

  setText("trainValue", formatPct(stats.train.avgReturnPct, true));
  setText("testValue", formatPct(stats.test.avgReturnPct, true));
  const maxSplit = Math.max(
    Math.abs(stats.train.avgReturnPct),
    Math.abs(stats.test.avgReturnPct),
    1
  );
  document.getElementById("trainBar").style.width =
    `${Math.max(5, Math.abs(stats.train.avgReturnPct) / maxSplit * 100)}%`;
  document.getElementById("testBar").style.width =
    `${Math.max(5, Math.abs(stats.test.avgReturnPct) / maxSplit * 100)}%`;
  toneElement("trainValue", stats.train.avgReturnPct);
  toneElement("testValue", stats.test.avgReturnPct);

  setText("candidateDateChip", meta.candidateDate);
  setText(
    "candidateRunTime",
    meta.snapshotRunLabel || meta.candidateRunTime || `回测更新 ${meta.runTime}`
  );
  setText("rawSummary", meta.summaryText || "无原始摘要");
  setText(
    "footerGenerated",
    `生成 ${meta.generatedAt} · 行情缓存 ${meta.barsUpdated || "—"}`
  );
}

function populateCandidates() {
  const signals = state.data.signals || [];
  const dailyChanges = state.data.dailyChanges || [];
  const intradayJumps = state.data.intradayJumps || [];
  setText("scopeChangeCount", formatInt(dailyChanges.length));
  setText("scopeAllCount", formatInt(signals.length));
  renderCandidateTable();
  renderIntradayJumpTable();
}

function positionManagementHoldings() {
  // 今日仓位管理明细只在15:05正式收盘数据生成后更新。
  // 盘中仍使用上一份正式收盘持仓，其他模块继续使用实时持仓预览。
  return state.staticCurrentHoldings || state.data.currentHoldings || [];
}

function populatePositionRules() {
  const signals = state.liveApplied
    ? state.data.signals || []
    : state.staticSignals || state.data.signals || [];
  const holdings = positionManagementHoldings();
  const representative =
    signals.find((row) => row.indexStage) || {};
  const liveDate = String(state.liveData?.marketDate || "");
  const formalDate = String(state.data.meta?.candidateDate || "");
  const useLiveRegime =
    state.liveApplied ||
    Boolean(liveDate && formalDate && liveDate === formalDate);
  const liveStage = useLiveRegime
    ? String(state.liveData?.indexStage || "")
    : "";
  const stage = liveStage || String(representative.indexStage || "");
  const progress = liveStage
    ? Number(state.liveData?.indexProgress || 0)
    : Number(representative.indexProgress || 0);
  const stageKey =
    stage === "多" || stage === "空"
      ? stage
      : stage
        ? `${stage}${progress}`
        : "";
  const liveAiTargetRaw = useLiveRegime
    ? Number(state.liveData?.aiTargetPct)
    : Number.NaN;
  const liveAiTarget = Number.isFinite(liveAiTargetRaw)
    ? liveAiTargetRaw
    : null;
  const currentTotalRaw = holdings.reduce(
    (sum, row) => sum + Number(row.weightPct || 0),
    0
  );
  const currentTotal = Math.min(100, currentTotalRaw);
  const lastEquity = Number(
    state.data.equity?.[state.data.equity.length - 1]?.equity
  );
  const totalAssets = Number.isFinite(lastEquity)
    ? 1000000 * lastEquity
    : null;
  const holdingCodes = new Set(holdings.map((row) => row.code));
  const pendingTotal = signals
    .filter((row) => row.isBuy && !holdingCodes.has(row.code))
    .reduce((sum, row) => sum + Number(row.suggestedPositionPct || 0), 0);
  const plannedTotal = Math.min(100, currentTotal + pendingTotal);
  const stageTarget =
    POSITION_STAGE_TARGETS[stageKey] ??
    liveAiTarget ??
    Number(representative.aiTargetPct || 0);

  setText("positionPendingTotal", `${formatNumber(pendingTotal, 1)}%`);
  setText("positionPlannedTotal", `${formatNumber(plannedTotal, 1)}%`);
  setText(
    "positionHeadroom",
    `${formatNumber(Math.max(0, 100 - plannedTotal), 1)}%`
  );

  document
    .querySelectorAll("#positionStageLadder .position-stage")
    .forEach((node) => {
      node.classList.toggle("current", node.dataset.stageKey === stageKey);
    });

  const groups = new Map();
  const ensureGroup = (name) => {
    const key = name || "未分组";
    if (!groups.has(key)) {
      groups.set(key, {
        name: key,
        currentWeight: 0,
        currentNames: [],
        candidates: new Map(),
        fundCap: AI_HARDWARE_GROUPS.has(key)
          ? (liveAiTarget ?? Number(representative.aiTargetPct || 30))
          : 20,
        candidateCount: 0,
        stageKey,
      });
    }
    return groups.get(key);
  };

  holdings.forEach((row) => {
    const group = ensureGroup(row.group);
    group.currentWeight += Number(row.weightPct || 0);
    group.currentNames.push(
      `${row.name} ${formatNumber(row.weightPct, 1)}%`
    );
  });

  signals.forEach((row) => {
    const group = ensureGroup(row.group);
    group.fundCap = Number(row.fundCapPct || group.fundCap);
    group.candidateCount = Math.max(
      group.candidateCount,
      Number(row.groupCandidates || 0)
    );
    if (row.indexStage) {
      const rowProgress = Number(row.indexProgress || 0);
      group.stageKey =
        row.indexStage === "多" || row.indexStage === "空"
          ? row.indexStage
          : `${row.indexStage}${rowProgress}`;
    }
    if (row.isBuy && Number(row.suggestedPositionPct || 0) > 0) {
      group.candidates.set(row.code, row);
    }
  });

  const body = document.getElementById("allocationTableBody");
  const isEmpty = holdings.length === 0;
  const groupRows = [...groups.values()]
    .filter((group) => Number(group.currentWeight || 0) > 0.0001)
    .sort((a, b) => {
      if (a.currentWeight !== b.currentWeight) {
        return b.currentWeight - a.currentWeight;
      }
      return a.name.localeCompare(b.name, "zh-CN");
    })
    .map(
      (group) => `
        <tr>
          <td><strong>${escapeHtml(group.name)}</strong></td>
          <td class="num">${formatNumber(group.currentWeight, 1)}%</td>
          <td class="num">${formatInt(group.currentNames.length)} / ${MAX_POSITIONS_PER_GROUP}</td>
        </tr>`
    );
  setText(
    "positionTotalAssets",
    totalAssets === null ? "—" : `¥${formatAmount(totalAssets)}`
  );
  setText(
    "positionTotalPosition",
    isEmpty ? "空仓" : `${formatNumber(currentTotal, 1)}%`
  );
  body.innerHTML = isEmpty
    ? `
      <tr class="allocation-empty-row">
        <td></td>
        <td></td>
        <td></td>
      </tr>`
    : groupRows.join("");
}

function renderCandidateTable() {
  const allSignals = state.data.signals || [];
  const holdings = state.data.currentHoldings || [];
  const dailyChanges = state.data.dailyChanges || holdings;
  const rows = sortSignalRows(
    state.candidateScope === "changes"
      ? dailyChanges
      : allSignals
  );
  document
    .getElementById("candidateTable")
    .classList.toggle("changes-view", state.candidateScope === "changes");
  setText(
    "candidateChangeHeader",
    state.candidateScope === "changes" ? "当日变动" : "信号判定"
  );
  const body = document.getElementById("candidateTableBody");
  body.innerHTML = rows
    .map((row) =>
      candidateRowHtml(
        row,
        state.candidateScope === "changes",
        true
      )
    )
    .join("");

  body.querySelectorAll("tr[data-code]").forEach((row) => {
    row.addEventListener("click", () =>
      openSignal(row.dataset.code, state.candidateScope)
    );
  });
}

function candidateRowHtml(
  row,
  showDailyChange = true,
  showSignalJudgment = true
) {
  const isHolding = Boolean(row.isHolding);
  const changeType = String(row.changeType || "");
  const limitUpBlocked =
    Boolean(row.limitUp) && isLimitUpPositionReason(row.reason, row);
  const groupCapBlocked =
    !row.isBuy &&
    !row.isHolding &&
    passesNonPositionSignalChecks(row) &&
    isOnlyGroupCapReason(row.reason);
  const statusClass =
    row.intradayJumpToMany
      ? "jump"
      : limitUpBlocked
      ? "limit-up"
      : groupCapBlocked
      ? "group-cap"
      : changeType === "sell"
      ? "sell"
      : changeType === "buy" || row.isBuy
        ? "buy"
        : changeType === "hold" || isHolding
          ? "hold"
          : "skip";
  const statusText =
    row.intradayJumpToMany
      ? row.reason || "盘中直接跳级转多"
      : limitUpBlocked
      ? "涨停无法买进"
      : changeType === "sell"
      ? row.actionLabel || "当天卖出"
      : changeType === "buy"
        ? row.actionLabel || "新买入"
        : changeType === "hold"
          ? "持仓未动"
          : row.isBuy
            ? "买入候选"
            : showDailyChange
              ? holdingReasonText(row.reason)
              : signalReasonText(row.reason, row.priorHighBreak);
  return `
    <tr class="clickable ${statusClass}-row" data-code="${escapeAttr(row.code)}">
      <td class="change-first-col"><span class="status-badge ${statusClass}">${signalStatusHtml(statusText)}</span></td>
      <td class="sticky-col col-code code-cell">${escapeHtml(row.code)}</td>
      <td class="sticky-col col-name">
        <span class="name-cell">
          <strong>${escapeHtml(row.name)}</strong>
          <small>${escapeHtml(row.group || "未分组")}</small>
        </span>
      </td>
      <td class="first-selected-col">${escapeHtml(firstSelectedTime(row.firstSelectedAt))}</td>
      <td>${pricePairHtml(row.close, row.changePct)}</td>
      <td class="num position-col">${holdingCostReturnHtml(row)}</td>
      <td class="num position-context-col">${positionContextHtml(row)}</td>
      ${showDailyChange ? `<td class="num market-value-col">${holdingMarketValueHtml(row)}</td>` : ""}
      ${showDailyChange ? `<td class="hold-days-col">${holdingDaysHtml(row)}</td>` : ""}
      <td class="num mfe-col ${
        row.mfePct === null || row.mfePct === undefined
          ? ""
          : pctClass(row.mfePct)
      }">${
        row.mfePct === null || row.mfePct === undefined
          ? '<span class="flat">—</span>'
          : formatPct(row.mfePct, true)
      }</td>
      <td class="num mae-col ${
        row.maePct === null || row.maePct === undefined
          ? ""
          : pctClass(row.maePct)
      }">${
        row.maePct === null || row.maePct === undefined
          ? '<span class="flat">—</span>'
          : formatPct(row.maePct, true)
      }</td>
      <td><span class="trend-badge">${escapeHtml(row.trendLabel || row.trend || "—")}</span></td>
      <td class="prior-high-col">${
        row.priorHighBreak === true
          ? '<strong class="up">是</strong>'
          : row.priorHighBreak === false
            ? '<strong class="flat">否</strong>'
            : '<span class="flat">—</span>'
      }</td>
      <td>${maDirectionHtml(row.ma10Dir, row.ma10Run)}</td>
      <td>${projectedMa10DirectionHtml(row)}</td>
      <td>${levelHtml(row.ma10Turn, row.ma10TurnPct)}</td>
      <td>${levelHtml(row.ma10Rebound, row.ma10ReboundPct)}</td>
      <td>${maDirectionHtml(row.ma5Dir, row.ma5Run)}</td>
      <td>${levelHtml(row.ma5Turn, row.ma5TurnPct)}</td>
      <td>${levelHtml(row.ma5Rebound, row.ma5ReboundPct)}</td>
      <td class="projection-col">${gapProjectionHtml(row.projectedGapPct, row.gapDeltaPct)}</td>
      <td class="num group-ratio-col">${groupRatioText(row.groupManyRatioPct)}</td>
      <td class="score-col">${
        row.intradayJumpToMany
          ? scoreOnlyHtml(row.score)
          : scorePositionHtml(
              row.score,
              row.suggestedPositionPct,
              row.holdingWeightPct
            )
      }</td>
      ${
        showSignalJudgment
          ? `<td class="change-last-col"><span class="status-badge ${statusClass}">${signalStatusHtml(statusText)}</span></td>`
          : ""
      }
      ${
        showDailyChange
          ? `<td class="change-reason-col">${
              changeType === "sell"
                ? escapeHtml(holdingReasonText(row.reason))
                : '<span class="flat">-</span>'
            }</td>`
          : ""
      }
    </tr>`;
}

function renderIntradayJumpTable() {
  const rows = sortSignalRows(state.data.intradayJumps || []);
  const body = document.getElementById("intradayJumpTableBody");
  if (!rows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="18" class="empty-cell">暂无盘中直接跳级转多信号</td>
      </tr>`;
    return;
  }
  body.innerHTML = rows
    .map((row) => candidateRowHtml(row, false, false))
    .join("");
  body.querySelectorAll("tr[data-code]").forEach((row) => {
    row.addEventListener("click", () =>
      openSignal(row.dataset.code, "intradayJumps")
    );
  });
}

function firstSelectedTime(value) {
  const text = String(value || "");
  const match = text.match(/\b(\d{2}:\d{2}:\d{2})\b/);
  return match ? match[1] : "—";
}

function groupRatioText(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return `${Number(value).toFixed(2)}%`;
}

function isOnlyLimitUpReason(value) {
  const text = String(value || "").trim();
  return (
    text.includes("涨停") &&
    (text.includes("买不进") || text.includes("无法买进")) &&
    !/[；;]/.test(text)
  );
}

function isLimitUpPositionReason(value, row = {}) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (!passesNonPositionSignalChecks(row)) return false;
  const parts = text
    .split(/[；;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return false;
  const hasLimitUp = parts.some(
    (part) =>
      part.includes("涨停") &&
      (part.includes("买不进") || part.includes("无法买进"))
  );
  if (!hasLimitUp) return false;
  return parts.every(
    (part) =>
      (part.includes("涨停") &&
        (part.includes("买不进") || part.includes("无法买进"))) ||
      isOnlyGroupCapReason(part)
  );
}

function passesNonPositionSignalChecks(row = {}) {
  const groupRatio = Number(row.groupManyRatioPct);
  if (Number.isFinite(groupRatio) && groupRatio < 10) return false;
  const gapDelta = Number(row.gapDeltaPct);
  if (Number.isFinite(gapDelta) && gapDelta < 1) return false;
  const score = Number(row.score);
  if (Number.isFinite(score) && score < 0.30) return false;
  if (row.projectedSuccess === false) return false;
  if (row.priorHighBreak === false) return false;
  return true;
}

function isOnlyGroupCapReason(value) {
  const parts = String(value || "")
    .split(/[；;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every(isSingleGroupCapReason);
}

function isSingleGroupCapReason(value) {
  const text = String(value || "").trim();
  return (
    /^同组综合评分第\d+[，,]\s*超过每组(?:持仓)?上限\d+$/.test(text) ||
    /^评分第\d+[，,]\s*同组已有持仓[，,]\s*超过仓位上限$/.test(text) ||
    /^同组已有持仓[，,]\s*超过仓位上限$/.test(text) ||
    /^同组已有持仓$/.test(text) ||
    /^评分第\d+$/.test(text) ||
    /^评分第\d+[，,]\s*超过同组持仓上限\d+只$/.test(text) ||
    /^评分第\d+[，,]\s*未进入同组评分前(?:两名|\d+名)$/.test(text) ||
    /^同分组已有[^，,；;]+持仓，仓位已达到[\d.]+%上限$/.test(text) ||
    /^同组已持有\d+只，达到上限\d+$/.test(text) ||
    /^评分第\d+[，,]\s*和(?:储能|固态锂电)共享仓位上限[，,]\s*已有持仓且达到上限$/.test(
      text
    ) ||
    /^和(?:储能|固态锂电)共享仓位上限[，,]\s*已有持仓且达到上限$/.test(
      text
    ) ||
    text === "总仓位不足，资金优先分配给多占比较高的分组" ||
    /^双下·空总仓位上限[\d.]+%，现有持仓已占满$/.test(text) ||
    /^储能与固态锂电共享[\d.]+%仓位上限，已有储能持仓(?:（[^，,；;]+）)?且达到分组上限$/.test(
      text
    )
  );
}

function holdingReasonText(value) {
  return String(value || "")
    .replace(/(?:尾盘)?涨停(?:\s*[·,，]\s*)买不进/g, "涨停无法买进")
    .replace(/(\d+(?:\.\d+)?)pp/g, "$1%")
    .replace(
      /(?:收盘价?|运行价)[^；;]*?(?:低于|跌破|下穿)\s*MA5[^；;]*/g,
      "跌破MA5"
    );
}

function signalReasonText(value, priorHighBreak) {
  const priorHighReason = "最高价未超前两日高点1%";
  const reason = String(value || "")
    .replace(/(?:尾盘)?涨停(?:\s*[·,，]\s*)买不进/g, "涨停无法买进")
    .replace(/(\d+(?:\.\d+)?)pp/g, "$1%");
  if (priorHighBreak !== false || reason.includes(priorHighReason)) {
    return reason;
  }
  return reason ? `${priorHighReason}；${reason}` : priorHighReason;
}

function signalStatusHtml(value) {
  const parts = String(value || "").split("；");
  if (parts.length < 3) return escapeHtml(value);
  return `${escapeHtml(parts.slice(0, 2).join("；"))}；<br>${escapeHtml(
    parts.slice(2).join("；")
  )}`;
}

function scorePositionHtml(score, positionPct, holdingWeightPct) {
  const holdingWeight = Number(holdingWeightPct);
  const hasScore = score !== null && score !== undefined;
  if (!hasScore && holdingWeight > 0) {
    return `<span class="flat">—</span>`;
  }
  if (!hasScore) {
    return `<span class="flat">—</span>`;
  }
  const pos =
    positionPct === null || positionPct === undefined
      ? "—"
      : `${formatNumber(positionPct, 1)}%`;
  const detail =
    holdingWeight > 0
      ? `持有 ${formatNumber(holdingWeight, 1)}% · 不新增`
      : Number(positionPct) > 0
        ? `建议仓位 ${pos}`
        : "未入仓";
  return `
    <span class="price-pair">
      <strong>${formatNumber(score, 3)}</strong>
      <small>${detail}</small>
    </span>`;
}

function scoreOnlyHtml(score) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) {
    return `<span class="flat">—</span>`;
  }
  return `
    <span class="price-pair">
      <strong>${formatNumber(score, 3)}</strong>
    </span>`;
}

function positionContextHtml(row) {
  const weight = Number(row.holdingWeightPct ?? row.weightPct);
  if (row.changeType === "sell") {
    return `
      <span class="price-pair">
        <strong>0%</strong>
      </span>`;
  }
  if (row.isHolding) {
    return `
      <span class="price-pair">
        <strong>${Number.isFinite(weight) ? `${formatNumber(weight, 1)}%` : "—"}</strong>
      </span>`;
  }
  const suggested = Number(row.suggestedPositionPct);
  if (Number.isFinite(suggested) && suggested > 0) {
    return `
      <span class="price-pair">
        <strong>${formatNumber(suggested, 1)}%</strong>
      </span>`;
  }
  return `<span class="flat">—</span>`;
}

function holdingMarketValueHtml(row) {
  const actualMarketValue = Number(row.currentMarketValue);
  if (Number.isFinite(actualMarketValue) && actualMarketValue >= 0) {
    return `
      <span class="price-pair">
        <strong>¥${formatAmount(actualMarketValue)}</strong>
      </span>`;
  }
  const lastEquity = Number(
    state.data?.equity?.[state.data.equity.length - 1]?.equity
  );
  if (!Number.isFinite(lastEquity)) return '<span class="flat">—</span>';
  const totalAssets = 1000000 * lastEquity;
  if (row.changeType === "sell") {
    return '<span class="price-pair"><strong>¥0</strong></span>';
  }
  if (!row.isHolding) return '<span class="flat">—</span>';
  const weight = Number(
    row.currentWeightPct ?? row.holdingWeightPct ?? row.weightPct
  );
  if (!Number.isFinite(weight) || weight <= 0) {
    return '<span class="flat">—</span>';
  }
  return `
    <span class="price-pair">
      <strong>¥${formatAmount(totalAssets * weight / 100)}</strong>
    </span>`;
}

function currentHoldingDays(row) {
  if (!row.entryDate) return null;
  const dates = state.data.chartBars?.[row.code]?.dates || [];
  const endDate = state.data.meta?.candidateDate || "";
  if (dates.length) {
    const heldBars = dates.filter(
      (date) => date >= row.entryDate && (!endDate || date <= endDate)
    );
    return Math.max(0, heldBars.length - 1);
  }
  const start = new Date(`${row.entryDate}T00:00:00`);
  const end = new Date(`${endDate || row.date}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function pricePairHtml(price, changePct) {
  return `
    <span class="price-pair">
      <strong>${formatPrice(price)}</strong>
      <small class="${pctClass(changePct)}">${formatPct(changePct, true)}</small>
    </span>`;
}

function holdingReturnPct(row) {
  if (
    row?.returnPct !== null &&
    row?.returnPct !== undefined &&
    Number.isFinite(Number(row.returnPct))
  ) {
    return Number(row.returnPct);
  }
  const entryPrice = Number(row?.entryPrice);
  const currentPrice = Number(row?.currentPrice ?? row?.close);
  if (entryPrice > 0 && currentPrice > 0) {
    return (currentPrice / entryPrice - 1) * 100;
  }
  return null;
}

function holdingCostReturnHtml(row) {
  if (!row?.isHolding && row?.changeType !== "sell") {
    return '<span class="flat">—</span>';
  }
  const returnValue = holdingReturnPct(row);
  const cost =
    Number(row?.entryPrice) > 0 ? formatPrice(row.entryPrice) : "—";
  return `
    <span class="price-pair">
      <strong>${cost}</strong>
      <small class="${returnValue === null ? "flat" : pctClass(returnValue)}">
        ${returnValue === null ? "—" : formatPct(returnValue, true)}
      </small>
    </span>`;
}

function holdingDaysHtml(row) {
  if (!row?.isHolding && row?.changeType !== "sell") {
    return '<span class="flat">—</span>';
  }
  const days =
    row.changeType === "sell"
      ? Number(row.holdingDays)
      : currentHoldingDays(row);
  if (!Number.isFinite(days)) {
    return '<span class="flat">—</span>';
  }
  return `<span class="price-pair"><strong>${formatInt(
    Math.max(0, days)
  )}</strong></span>`;
}

function levelHtml(price, pct) {
  if (price === null || price === undefined) return `<span class="flat">—</span>`;
  return `
    <span class="ma-level">
      <strong>${formatPrice(price)}</strong>
      <small class="${pctClass(pct)}">${formatPct(pct, true)}</small>
    </span>`;
}

function maDirectionHtml(direction, run) {
  const up = direction === "向上";
  const down = direction === "向下";
  const cls = up ? "up" : down ? "down" : "flat";
  const signedRun = Number(run) || 0;
  const runText = signedRun === 0 ? "走平" : `${Math.abs(signedRun)}天`;
  return `
    <span class="ma-cell">
      <strong class="${cls}">${escapeHtml(direction || "—")}</strong>
      <span>${runText}</span>
    </span>`;
}

function projectedMa10DirectionHtml(row) {
  const current = Number(row.ma10);
  const projected = Number(row.projectedMa10);
  let direction = String(row.projectedMa10Dir || "");
  if (!direction && Number.isFinite(current) && Number.isFinite(projected)) {
    direction = projected > current ? "向上" : projected < current ? "向下" : "走平";
  }
  if (!direction) return `<span class="flat">—</span>`;
  const cls =
    direction === "向上" ? "up" : direction === "向下" ? "down" : "flat";
  return `
    <span class="ma-cell" title="仅作参考，不进入评分">
      <strong class="${cls}">${escapeHtml(direction)}</strong>
    </span>`;
}

function gapProjectionHtml(projectedGap, gapDelta) {
  const pass = Number(gapDelta) >= 1.0;
  return `
    <span class="ma-cell">
      <strong class="${pctClass(projectedGap)}">${formatPct(projectedGap, true)}</strong>
      <span class="${pass ? "up" : "flat"}">增幅 ${formatPct(gapDelta, true)}</span>
    </span>`;
}

function populateFilters() {
  const groupSelect = document.getElementById("groupFilter");
  const groups = [...new Set(state.trades.map((row) => row.group).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, "zh-CN")
  );
  groups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group;
    option.textContent = group;
    groupSelect.appendChild(option);
  });

  const monthSelect = document.getElementById("monthFilter");
  const months = [
    ...new Set(state.trades.map((row) => row.date.slice(0, 7))),
  ].sort((a, b) => b.localeCompare(a));
  months.forEach((month) => {
    const option = document.createElement("option");
    option.value = month;
    option.textContent = month;
    monthSelect.appendChild(option);
  });
}

function bindInteractions() {
  document.querySelectorAll("#candidateScope button").forEach((button) => {
    button.addEventListener("click", () => {
      state.candidateScope = button.dataset.scope;
      document
        .querySelectorAll("#candidateScope button")
        .forEach((item) => item.classList.toggle("active", item === button));
      renderCandidateTable();
    });
  });

  const search = document.getElementById("tradeSearch");
  search.addEventListener("input", () => {
    state.page = 1;
    applyTradeFilters();
  });
  ["groupFilter", "resultFilter", "monthFilter"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      state.page = 1;
      applyTradeFilters();
    });
  });
  document.getElementById("resetFilters").addEventListener("click", () => {
    search.value = "";
    document.getElementById("groupFilter").value = "";
    document.getElementById("resultFilter").value = "";
    document.getElementById("monthFilter").value = "";
    state.page = 1;
    applyTradeFilters();
  });

  document
    .getElementById("mobileNavToggle")
    .addEventListener("click", () => setMobileNavigation(true));
  document
    .getElementById("mobileNavClose")
    .addEventListener("click", closeMobileNavigation);
  document
    .getElementById("mobileNavBackdrop")
    .addEventListener("click", closeMobileNavigation);
  document.querySelectorAll(".mobile-nav-links a").forEach((link) => {
    link.addEventListener("click", closeMobileNavigation);
  });

  document.getElementById("drawerClose").addEventListener("click", closeDrawer);
  document.getElementById("drawerBackdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (document.getElementById("mobileNavPanel").classList.contains("open")) {
      closeMobileNavigation();
    } else if (document.getElementById("drawer").classList.contains("open")) {
      closeDrawer();
    }
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeMobileNavigation();
  });
}

function currentTheme() {
  return document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";
}

function setupThemeToggle() {
  syncChartTheme();
  syncThemeToggle();
  document.getElementById("themeToggle").addEventListener("click", () => {
    const theme = currentTheme() === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (_) {
      // Theme still applies for this page view when storage is unavailable.
    }
    syncThemeToggle();
    syncChartTheme();
    rerenderChartsForTheme();
  });
}

function syncThemeToggle() {
  const theme = currentTheme();
  const nextTheme = theme === "light" ? "dark" : "light";
  const button = document.getElementById("themeToggle");
  const label = document.getElementById("themeToggleLabel");
  const meta = document.getElementById("themeColorMeta");
  button.setAttribute(
    "aria-label",
    nextTheme === "light" ? "切换到浅色主题" : "切换到深色主题"
  );
  button.setAttribute("aria-pressed", String(theme === "light"));
  label.textContent = nextTheme === "light" ? "浅色" : "深色";
  meta.setAttribute(
    "content",
    theme === "light" ? "#f3f7fa" : "#07111d"
  );
}

function syncChartTheme() {
  Object.assign(
    COLOR,
    currentTheme() === "light" ? LIGHT_CHART_COLORS : DARK_CHART_COLORS
  );
}

function rerenderChartsForTheme() {
  if (!state.data) return;
  const openDrawer = document.getElementById("drawer").classList.contains("open");
  Object.values(state.charts).forEach((chart) => chart.dispose());
  state.charts = {};
  renderAllCharts();
  if (openDrawer) {
    const collection =
      state.drawerType === "trade"
        ? state.data.trades
        : state.data.signals;
    const item = (collection || []).find(
      (row) => row.id === state.drawerId || row.code === state.drawerId
    );
    if (item) window.setTimeout(() => renderTradeChart(item), 40);
  }
}

function setMobileNavigation(open) {
  const panel = document.getElementById("mobileNavPanel");
  const backdrop = document.getElementById("mobileNavBackdrop");
  const toggle = document.getElementById("mobileNavToggle");
  panel.classList.toggle("open", open);
  backdrop.classList.toggle("open", open);
  panel.setAttribute("aria-hidden", String(!open));
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "关闭快捷菜单" : "打开快捷菜单");
  syncPageScrollLock();
}

function closeMobileNavigation() {
  setMobileNavigation(false);
}

function applyTradeFilters() {
  const query = document.getElementById("tradeSearch").value.trim().toLowerCase();
  const group = document.getElementById("groupFilter").value;
  const result = document.getElementById("resultFilter").value;
  const month = document.getElementById("monthFilter").value;
  state.filteredTrades = state.trades.filter((row) => {
    if (query) {
      const haystack = `${row.code} ${row.name} ${row.group}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (group && row.group !== group) return false;
    if (month && !row.date.startsWith(month)) return false;
    if (result && row.action !== result) return false;
    return true;
  });
  populateTradeTable();
}

function tradeReasonText(value) {
  return String(value || "—")
    .replace(/持仓收益[>＞]0%(?:且)?/g, "")
    .trim() || "—";
}

function populateTradeTable() {
  const total = state.filteredTrades.length;
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
  state.page = Math.min(state.page, pageCount);
  const start = (state.page - 1) * state.pageSize;
  const rows = state.filteredTrades.slice(start, start + state.pageSize);
  const body = document.getElementById("tradeTableBody");

  if (!rows.length) {
    body.innerHTML = `
      <tr><td colspan="11" style="padding:42px;text-align:center;color:var(--text-dim)">
        当前筛选条件下没有策略成交
      </td></tr>`;
  } else {
    body.innerHTML = rows
      .map((trade) => {
        const isBuy = trade.action === "buy";
        return `
          <tr>
            <td>
              <div class="trade-date">
                <span>${escapeHtml(trade.entryDate || trade.date || "—")}</span>
                <small>${isBuy ? "尚未卖出" : `卖出 ${escapeHtml(trade.date || "—")}`}</small>
              </div>
            </td>
            <td class="num">${
              trade.holdingDays === null || trade.holdingDays === undefined
                ? "—"
                : `${formatInt(trade.holdingDays)} 天`
            }</td>
            <td><span class="status-badge ${isBuy ? "buy" : "sell"}">${escapeHtml(trade.actionLabel)}</span></td>
            <td class="code-cell">${escapeHtml(trade.code)}</td>
            <td><strong style="color:var(--text);font-weight:600">${escapeHtml(trade.name)}</strong></td>
            <td>${escapeHtml(trade.group)}</td>
            <td class="num">${formatPrice(trade.entryPrice ?? trade.price)}</td>
            <td class="num">${formatPrice(trade.price)}</td>
            <td class="num">${formatNumber(trade.weightPct, 1)}%</td>
            <td class="num ${trade.returnPct === null || trade.returnPct === undefined ? "" : pctClass(trade.returnPct)}">
              ${
                trade.returnPct === null || trade.returnPct === undefined
                  ? '<span class="flat">—</span>'
                  : `<strong style="font-weight:600">${formatPct(trade.returnPct, true)}</strong>`
              }
            </td>
            <td class="trade-reason">${escapeHtml(tradeReasonText(trade.reason))}</td>
          </tr>`;
      })
      .join("");
  }

  setText(
    "tradeCountLabel",
    `当前 ${formatInt(total)} 条成交 · 第 ${state.page} / ${pageCount} 页`
  );
  renderPagination(pageCount);
}

function renderPagination(pageCount) {
  const container = document.getElementById("pagination");
  const pages = [];
  const current = state.page;
  pages.push(
    `<button type="button" data-page="${current - 1}" ${current <= 1 ? "disabled" : ""}>‹</button>`
  );
  const candidates = new Set([1, pageCount, current - 2, current - 1, current, current + 1, current + 2]);
  const visible = [...candidates]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((a, b) => a - b);
  let previous = 0;
  visible.forEach((page) => {
    if (previous && page - previous > 1) pages.push(`<span style="color:var(--text-dim)">…</span>`);
    pages.push(
      `<button type="button" data-page="${page}" class="${page === current ? "active" : ""}">${page}</button>`
    );
    previous = page;
  });
  pages.push(
    `<button type="button" data-page="${current + 1}" ${current >= pageCount ? "disabled" : ""}>›</button>`
  );
  container.innerHTML = pages.join("");
  container.querySelectorAll("button[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const page = Number(button.dataset.page);
      if (!Number.isFinite(page) || page < 1 || page > pageCount) return;
      state.page = page;
      populateTradeTable();
      document.getElementById("trades").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function populateHoldingBars() {
  const rows = state.data.holdingBuckets || [];
  const container = document.getElementById("holdingBars");
  const maxCount = Math.max(...rows.map((row) => row.count), 1);
  container.innerHTML = rows
    .map(
      (row) => `
        <div class="holding-card">
          <span>${escapeHtml(row.label)}</span>
          <strong>${formatPct(row.avgReturnPct, true)}</strong>
          <div class="holding-meta">
            <span>胜率 ${formatPct(row.winRatePct, false)}</span>
            <span>${formatInt(row.count)} 笔</span>
          </div>
          <div class="holding-track"><i style="width:${Math.max(4, row.count / maxCount * 100)}%"></i></div>
        </div>`
    )
    .join("");
}

function renderAllCharts() {
  renderEquityChart();
  renderDrawdownChart();
  renderPositionChart();
  renderMonthlyChart();
  renderDistributionChart();
  renderGroupChart();
  renderScatterChart();
  renderExitReasonChart();
}

function chartBase() {
  return {
    animationDuration: 650,
    animationEasing: "cubicOut",
    textStyle: { fontFamily: FONT_SANS },
    tooltip: {
      backgroundColor: COLOR.tooltipBg,
      borderColor: COLOR.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: COLOR.text, fontSize: 10, fontFamily: FONT_SANS },
      extraCssText: `box-shadow:${COLOR.tooltipShadow};border-radius:9px;`,
    },
  };
}

function renderEquityChart() {
  const chart = getChart("equityChart");
  const points = state.data.equity;
  const dates = points.map((point) => point.date);
  const values = points.map((point) => point.equity);
  chart.setOption({
    ...chartBase(),
    grid: { left: 52, right: 20, top: 28, bottom: 62 },
    tooltip: {
      ...chartBase().tooltip,
      trigger: "axis",
      formatter(params) {
        const point = points[params[0].dataIndex];
        return `
          <div style="font-family:${FONT_MONO};color:${COLOR.soft};font-size:9px">${point.date}</div>
          <div style="margin-top:7px;font-size:12px;color:${COLOR.text}">
            净值 <b style="float:right;margin-left:24px;color:${point.equity >= 1 ? COLOR.red : COLOR.green}">${point.equity.toFixed(4)}</b>
          </div>
          <div style="margin-top:3px;color:${COLOR.soft};font-size:10px">
            当日 <b style="float:right;margin-left:24px;color:${point.dailyReturnPct >= 0 ? COLOR.red : COLOR.green}">${signed(point.dailyReturnPct)}%</b>
          </div>
          <div style="margin-top:3px;color:${COLOR.dim};font-size:9px">
            在场持仓 <b style="float:right;margin-left:24px;color:${COLOR.soft}">${point.active} 笔</b>
          </div>`;
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: dates,
      axisLine: { lineStyle: { color: COLOR.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: COLOR.dim,
        fontSize: 9,
        fontFamily: FONT_MONO,
        formatter: (value) => value.slice(5),
        hideOverlap: true,
      },
    },
    yAxis: {
      type: "value",
      scale: true,
      splitNumber: 4,
      axisLabel: {
        color: COLOR.dim,
        fontSize: 9,
        fontFamily: FONT_MONO,
        formatter: (value) => value.toFixed(2),
      },
      splitLine: { lineStyle: { color: COLOR.grid } },
      axisLine: { show: false },
    },
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      {
        type: "slider",
        height: 16,
        bottom: 14,
        borderColor: "transparent",
        backgroundColor: COLOR.zoomBg,
        fillerColor: COLOR.zoomFill,
        handleStyle: { color: COLOR.cyan, borderColor: COLOR.cyan },
        textStyle: { color: COLOR.dim, fontSize: 8 },
        dataBackground: {
          lineStyle: { color: COLOR.zoomLine },
          areaStyle: { color: COLOR.zoomArea },
        },
      },
    ],
    series: [
      {
        name: "组合净值",
        type: "line",
        data: values,
        symbol: "none",
        lineStyle: { width: 2, color: COLOR.cyan },
        itemStyle: { color: COLOR.cyan },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(72,225,209,0.28)" },
            { offset: 0.7, color: "rgba(72,225,209,0.04)" },
            { offset: 1, color: "rgba(72,225,209,0)" },
          ]),
        },
        markLine: {
          silent: true,
          symbol: ["none", "none"],
          label: { show: false },
          lineStyle: { color: "rgba(131,173,207,0.2)", width: 1, type: "dashed" },
          data: [{ yAxis: 1 }],
        },
      },
      {
        name: "训练/测试切分",
        type: "line",
        data: [],
        markLine: {
          silent: true,
          symbol: ["none", "none"],
          lineStyle: { color: "rgba(246,185,75,0.35)", width: 1, type: "dashed" },
          label: {
            show: true,
            formatter: "训练 / 测试",
            color: COLOR.amber,
            fontSize: 8,
            position: "insideEndTop",
          },
          data: [{ xAxis: "2026-07-01" }],
        },
      },
    ],
  });
}

function renderDrawdownChart() {
  const chart = getChart("drawdownChart");
  const points = state.data.equity;
  chart.setOption({
    ...chartBase(),
    grid: { left: 48, right: 14, top: 20, bottom: 30 },
    tooltip: {
      ...chartBase().tooltip,
      trigger: "axis",
      formatter(params) {
        const point = points[params[0].dataIndex];
        return `<div style="font-family:${FONT_MONO};color:${COLOR.soft};font-size:9px">${point.date}</div>
          <div style="margin-top:5px;color:${COLOR.green}">回撤 <b style="float:right;margin-left:18px">${signed(point.drawdownPct)}%</b></div>`;
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((point) => point.date),
      axisLine: { lineStyle: { color: COLOR.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: COLOR.dim,
        fontSize: 8,
        formatter: (value) => value.slice(5),
        hideOverlap: true,
      },
    },
    yAxis: {
      type: "value",
      max: 0,
      axisLabel: {
        color: COLOR.dim,
        fontSize: 8,
        formatter: (value) => `${value}%`,
      },
      splitLine: { lineStyle: { color: COLOR.grid } },
      axisLine: { show: false },
    },
    series: [
      {
        type: "line",
        data: points.map((point) => point.drawdownPct),
        symbol: "none",
        lineStyle: { width: 1.5, color: COLOR.green },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(32,201,140,0.05)" },
            { offset: 1, color: "rgba(32,201,140,0.3)" },
          ]),
        },
        markLine: {
          silent: true,
          symbol: ["none", "none"],
          lineStyle: { color: "rgba(32,201,140,0.3)", type: "dashed" },
          label: { show: false },
          data: [{ yAxis: state.data.portfolio.maxDrawdownPct }],
        },
      },
    ],
  });
}

function renderPositionChart() {
  const chart = getChart("positionChart");
  const points = state.data.equity;
  chart.setOption({
    ...chartBase(),
    grid: { left: 46, right: 12, top: 8, bottom: 24 },
    tooltip: {
      ...chartBase().tooltip,
      trigger: "axis",
      formatter(params) {
        const point = points[params[0].dataIndex];
        return `
          <div style="font-family:${FONT_MONO};color:${COLOR.soft};font-size:9px">${point.date}</div>
          <div style="margin-top:4px;color:${COLOR.amber};font-size:10px">
            总仓位 <b style="float:right;margin-left:20px">${(point.positionPct ?? 0).toFixed(1)}%</b>
          </div>
          <div style="margin-top:3px;color:${COLOR.dim};font-size:9px">
            在场持仓 <b style="float:right;margin-left:20px;color:${COLOR.soft}">${point.active} 笔</b>
          </div>`;
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((point) => point.date),
      axisLine: { lineStyle: { color: COLOR.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: COLOR.dim,
        fontSize: 8,
        fontFamily: FONT_MONO,
        formatter: (value) => value.slice(5),
        hideOverlap: true,
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      interval: 50,
      axisLabel: {
        color: COLOR.amber,
        fontSize: 8,
        fontFamily: FONT_MONO,
        formatter: (value) => `${Math.round(value)}%`,
      },
      splitLine: {
        lineStyle: { color: COLOR.grid, type: "dashed" },
      },
      axisLine: { show: false },
    },
    series: [
      {
        name: "总仓位",
        type: "line",
        data: points.map((point) => point.positionPct ?? 0),
        symbol: "none",
        step: "end",
        lineStyle: { width: 1.4, color: COLOR.amber },
        itemStyle: { color: COLOR.amber },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(246,185,75,0.28)" },
            { offset: 0.7, color: "rgba(246,185,75,0.08)" },
            { offset: 1, color: "rgba(246,185,75,0.02)" },
          ]),
        },
      },
    ],
  });
}

function renderMonthlyChart() {
  const chart = getChart("monthlyChart");
  const storedRows = state.data.monthly || [];
  const year =
    String(
      storedRows[0]?.month ||
        state.data.meta?.end ||
        state.data.meta?.candidateDate ||
        ""
    ).slice(0, 4) || String(new Date().getFullYear());
  const byMonth = new Map(storedRows.map((row) => [row.month, row]));
  const rows = Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    return (
      byMonth.get(month) || {
        month,
        returnPct: null,
        days: 0,
      }
    );
  });
  chart.setOption({
    ...chartBase(),
    grid: { left: 56, right: 32, top: 32, bottom: 42 },
    tooltip: {
      ...chartBase().tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter(params) {
        const row = rows[params[0].dataIndex];
        if (row.returnPct === null || row.returnPct === undefined) {
          return `<div style="font-family:${FONT_MONO};color:${COLOR.soft};font-size:9px">${row.month}</div>
            <div style="margin-top:5px;color:${COLOR.dim}">暂无交易</div>`;
        }
        return `<div style="font-family:${FONT_MONO};color:${COLOR.soft};font-size:9px">${row.month}</div>
          <div style="margin-top:5px;color:${row.returnPct >= 0 ? COLOR.red : COLOR.green}">
            组合收益 <b style="float:right;margin-left:18px">${signed(row.returnPct)}%</b>
          </div>
          <div style="margin-top:2px;color:${COLOR.dim};font-size:9px">${row.days} 个交易日</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.month),
      axisLine: { lineStyle: { color: COLOR.axis } },
      axisTick: { show: false },
      axisLabel: { color: COLOR.dim, fontSize: 9, formatter: (value) => value.slice(5) },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: COLOR.dim, fontSize: 8, formatter: (value) => `${value}%` },
      splitLine: { lineStyle: { color: COLOR.grid } },
      axisLine: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: "45%",
        data: rows.map((row) => ({
          value: row.returnPct,
          itemStyle: {
            color:
              row.returnPct === null || row.returnPct === undefined
                ? "transparent"
                : row.returnPct >= 0
                  ? "rgba(255,91,110,0.72)"
                  : "rgba(32,201,140,0.72)",
            borderRadius:
              row.returnPct === null || row.returnPct === undefined
                ? [0, 0, 0, 0]
                : row.returnPct >= 0
                  ? [4, 4, 0, 0]
                  : [0, 0, 4, 4],
          },
        })),
        label: {
          show: true,
          position: "top",
          color: COLOR.soft,
          fontFamily: FONT_MONO,
          fontSize: 8,
          formatter: (params) =>
            params.value === null || params.value === undefined
              ? ""
              : `${params.value >= 0 ? "+" : ""}${Number(params.value).toFixed(1)}%`,
        },
      },
    ],
  });
}

function renderDistributionChart() {
  const chart = getChart("distributionChart");
  const compact = chart.getWidth() <= 560;
  const allRows = state.data.distribution;
  const firstActive = allRows.findIndex((row) => row.count > 0);
  const lastActive = allRows.findLastIndex((row) => row.count > 0);
  const rows =
    firstActive === -1
      ? allRows
      : allRows.slice(firstActive, lastActive + 1);
  chart.setOption({
    ...chartBase(),
    grid: {
      left: compact ? 24 : 50,
      right: compact ? 52 : 30,
      top: 34,
      bottom: compact ? 64 : 56,
      containLabel: compact,
    },
    tooltip: {
      ...chartBase().tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter(params) {
        const row = rows[params[0].dataIndex];
        return `<div style="color:${COLOR.soft};font-size:9px">收益区间 ${row.label}</div>
          <div style="margin-top:5px;color:${COLOR.text}">交易数 <b style="float:right;margin-left:18px">${row.count}</b></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.label),
      axisLine: { lineStyle: { color: COLOR.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: COLOR.dim,
        fontSize: compact ? 6.2 : 7,
        lineHeight: compact ? 7 : 12,
        interval: 0,
        rotate: 0,
        hideOverlap: false,
        formatter: compact
          ? (value) => String(value).replace("~", "\n~\n")
          : undefined,
      },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: COLOR.dim, fontSize: 8 },
      splitLine: { lineStyle: { color: COLOR.grid } },
      axisLine: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: "68%",
        data: rows.map((row) => ({
          value: row.count,
          itemStyle: {
            color: row.lo >= 0 ? "rgba(255,91,110,0.7)" : "rgba(32,201,140,0.62)",
            borderRadius: [3, 3, 0, 0],
          },
        })),
        label: {
          show: true,
          position: "top",
          color: COLOR.dim,
          fontFamily: FONT_MONO,
          fontSize: 7,
        },
      },
    ],
  });
}

function renderGroupChart() {
  const chart = getChart("groupChart");
  const compact = chart.getWidth() <= 560;
  const rows = state.data.groups
    .filter((row) => row.count > 8)
    .sort((a, b) => b.avgReturnPct - a.avgReturnPct)
    .slice(0, 12)
    .reverse();
  chart.setOption({
    ...chartBase(),
    grid: {
      left: compact ? 62 : 105,
      right: compact ? 72 : 120,
      top: 18,
      bottom: 30,
    },
    tooltip: {
      ...chartBase().tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter(params) {
        const row = rows[params[0].dataIndex];
        return `<div style="color:${COLOR.text};font-size:11px">${row.group}</div>
          <div style="margin-top:5px;color:${row.avgReturnPct >= 0 ? COLOR.red : COLOR.green}">平均单笔 <b style="float:right;margin-left:18px">${signed(row.avgReturnPct)}%</b></div>
          <div style="margin-top:2px;color:${COLOR.soft};font-size:9px">胜率 <b style="float:right;margin-left:18px">${row.winRatePct.toFixed(1)}%</b></div>
          <div style="margin-top:2px;color:${COLOR.dim};font-size:9px">样本 <b style="float:right;margin-left:18px">${row.count} 笔</b></div>`;
      },
    },
    xAxis: {
      type: "value",
      axisLabel: {
        color: COLOR.dim,
        fontSize: compact ? 7 : 8,
        formatter: (value) => `${value}%`,
      },
      splitLine: { lineStyle: { color: COLOR.grid } },
      axisLine: { show: false },
    },
    yAxis: {
      type: "category",
      data: rows.map((row) => row.group),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: COLOR.soft,
        fontSize: compact ? 8 : 9,
        width: compact ? 68 : 84,
        overflow: "truncate",
      },
    },
    series: [
      {
        type: "bar",
        barWidth: "58%",
        data: rows.map((row) => ({
          value: row.avgReturnPct,
          itemStyle: {
            color: row.avgReturnPct >= 0 ? "rgba(255,91,110,0.68)" : "rgba(32,201,140,0.62)",
            borderRadius: row.avgReturnPct >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3],
          },
        })),
        label: {
          show: true,
          position: "right",
          color: COLOR.dim,
          fontFamily: FONT_MONO,
          fontSize: 8,
          formatter: (params) => {
            const row = rows[params.dataIndex];
            return `${params.value >= 0 ? "+" : ""}${Number(params.value).toFixed(1)}% ${row.count}笔`;
          },
        },
      },
    ],
  });
}

function renderScatterChart() {
  const chart = getChart("scatterChart");
  const trades = state.data.performanceTrades || state.data.trades;
  const maeValues = trades.map((trade) => Number(trade.maePct) || 0);
  const mfeValues = trades.map((trade) => Number(trade.mfePct) || 0);
  const xMin = Math.min(-10, Math.floor(Math.min(...maeValues) / 5) * 5);
  const xMax = Math.max(0, Math.ceil(Math.max(...maeValues) / 5) * 5);
  const yMax = Math.max(60, Math.ceil(Math.max(...mfeValues) / 20) * 20);
  const diagonalLimit = Math.min(Math.abs(xMin), yMax);
  chart.setOption({
    ...chartBase(),
    grid: { left: 64, right: 30, top: 24, bottom: 48 },
    tooltip: {
      ...chartBase().tooltip,
      formatter(params) {
        if (params.seriesType === "line") return "";
        const [mae, mfe, ret, code, name, date] = params.value;
        return `<div style="color:${COLOR.text};font-size:11px">${name} <span style="color:${COLOR.dim};font-family:${FONT_MONO}">${code}</span></div>
          <div style="margin-top:4px;color:${COLOR.dim};font-size:9px">${date}</div>
          <div style="margin-top:6px;color:${ret >= 0 ? COLOR.red : COLOR.green}">最终收益 <b style="float:right;margin-left:18px">${signed(ret)}%</b></div>
          <div style="margin-top:2px;color:${COLOR.soft};font-size:9px">MFE <b style="float:right;margin-left:18px">${signed(mfe)}%</b></div>
          <div style="margin-top:2px;color:${COLOR.soft};font-size:9px">MAE <b style="float:right;margin-left:18px">${signed(mae)}%</b></div>`;
      },
    },
    xAxis: {
      type: "value",
      name: "MAE %",
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: {
        color: COLOR.dim,
        fontSize: 8,
        fontWeight: 500,
      },
      axisLabel: { color: COLOR.dim, fontSize: 8 },
      splitLine: { lineStyle: { color: COLOR.grid } },
      axisLine: { lineStyle: { color: COLOR.axis } },
      min: xMin,
      max: xMax,
    },
    yAxis: {
      type: "value",
      name: "MFE %",
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 42,
      nameTextStyle: {
        color: COLOR.dim,
        fontSize: 8,
        fontWeight: 500,
      },
      axisLabel: { color: COLOR.dim, fontSize: 8 },
      splitLine: { lineStyle: { color: COLOR.grid } },
      axisLine: { show: false },
      min: 0,
      max: yMax,
    },
    series: [
      {
        type: "scatter",
        data: trades.map((trade) => [
          trade.maePct,
          trade.mfePct,
          trade.returnPct,
          trade.code,
          trade.name,
          trade.entryDate,
        ]),
        symbolSize(value) {
          return Math.max(3, Math.min(10, Math.abs(value[2]) * 0.32 + 3));
        },
        itemStyle: {
          color(params) {
            return params.value[2] >= 0
              ? "rgba(255,91,110,0.46)"
              : "rgba(32,201,140,0.42)";
          },
          borderWidth: 0,
        },
        emphasis: {
          itemStyle: { opacity: 1, borderColor: COLOR.text, borderWidth: 1 },
        },
      },
      {
        type: "line",
        data: [
          [-diagonalLimit, diagonalLimit],
          [(-diagonalLimit * 2) / 3, (diagonalLimit * 2) / 3],
          [-diagonalLimit / 3, diagonalLimit / 3],
          [0, 0],
        ],
        symbol: "none",
        silent: true,
        lineStyle: { color: "rgba(246,185,75,0.28)", type: "dashed", width: 1 },
      },
    ],
  });
}

function renderExitReasonChart() {
  const chart = getChart("exitReasonChart");
  const rows = state.data.exitReasons || [];
  const stopped = rows
    .filter((row) => row.reason.includes("强制卖出"))
    .reduce((total, row) => total + row.count, 0);
  const gapStops = rows
    .filter((row) => row.reason.includes("强制卖出（低开）"))
    .reduce((total, row) => total + row.count, 0);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  setText(
    "exitMixTip",
    `止损 ${formatInt(stopped)} 笔 · ${formatPct(
      total ? stopped / total * 100 : 0,
      false
    )} · 低开 ${formatInt(gapStops)} 笔`
  );
  const ordered = [...rows].reverse();
  const colorFor = (reason) => {
    if (reason.includes("强制卖出（低开）")) return COLOR.amber;
    if (reason.includes("MFE")) return COLOR.amber;
    if (reason.includes("强制卖出")) return COLOR.green;
    if (reason === "跌破MA5") return COLOR.cyan;
    return COLOR.dim;
  };
  const compactLabel = (reason) => {
    const cleanReason = String(reason)
      .replace("持仓收益>0%且", "")
      .replace("持仓收益＞0%且", "");
    if (cleanReason.includes("低开")) return "−8% 强制止损（低开）";
    if (cleanReason.includes("MFE")) return "前2日 MFE<2% 提前退出";
    if (
      cleanReason.includes("AI硬件") &&
      cleanReason.includes("指数多转空")
    ) {
      return cleanReason.includes("最高价首次下移")
        ? "最高价下移 · AI 硬件强平"
        : "指数多转空 · AI 硬件强平";
    }
    if (
      cleanReason.includes("指数空转多") &&
      cleanReason.includes("最高价连续2日下移")
    ) {
      return "空转多 · 连续两日下移清仓";
    }
    if (
      cleanReason.includes("指数多") &&
      cleanReason.includes("最高价连续2日下移")
    ) {
      return "多 · 连续两日下移清仓";
    }
    if (cleanReason.includes("最高价首次下移")) {
      if (
        cleanReason.includes("持仓收益≤-8%") ||
        cleanReason.includes("持仓收益触及-8%")
      ) {
        return "最高价下移 · 剩余半仓 −8% 止损";
      }
      if (cleanReason.includes("同日原卖出规则")) {
        return "最高价下移 · 同日跌破 MA5 清仓";
      }
      if (cleanReason.includes("次日继续下移")) {
        return "最高价下移 · 次日下移清仓";
      }
      if (cleanReason.includes("后续最高价连续两天下移")) {
        return "最高价下移 · 后续下移清仓";
      }
      return "最高价下移 · 剩余半仓跌破 MA5";
    }
    if (
      cleanReason.includes("持仓收益≤-8%") ||
      cleanReason.includes("持仓收益触及-8%")
    ) {
      return "−8% 强制止损";
    }
    if (cleanReason === "跌破MA5") return "跌破 MA5";
    return cleanReason;
  };
  const compact = chart.getWidth() < 720;
  const chartHeight = Math.max(
    compact ? 360 : 340,
    ordered.length * (compact ? 27 : 24) + 44
  );
  chart.getDom().style.height = `${chartHeight}px`;
  chart.resize();
  chart.setOption({
    ...chartBase(),
    grid: {
      left: compact ? 175 : 265,
      right: compact ? 100 : 140,
      top: 18,
      bottom: 24,
    },
    tooltip: {
      ...chartBase().tooltip,
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter(params) {
        const row = ordered[params[0].dataIndex];
        return `<div style="color:${COLOR.text};font-size:11px">${row.reason}</div>
          <div style="margin-top:5px;color:${COLOR.soft};font-size:9px">笔数 <b style="float:right;margin-left:18px">${row.count}</b></div>
          <div style="margin-top:2px;color:${COLOR.dim};font-size:9px">占比 <b style="float:right;margin-left:18px">${row.sharePct.toFixed(1)}%</b></div>
          <div style="margin-top:2px;color:${row.avgReturnPct >= 0 ? COLOR.red : COLOR.green};font-size:9px">平均收益 <b style="float:right;margin-left:18px">${signed(row.avgReturnPct)}%</b></div>
          <div style="margin-top:2px;color:${COLOR.dim};font-size:9px">平均持有 <b style="float:right;margin-left:18px">${row.avgHoldingDays.toFixed(1)} 天</b></div>`;
      },
    },
    xAxis: {
      type: "value",
      minInterval: 1,
      splitNumber: compact ? 3 : 4,
      axisLabel: {
        color: COLOR.dim,
        fontSize: 8,
        hideOverlap: true,
      },
      splitLine: { lineStyle: { color: COLOR.grid } },
      axisLine: { show: false },
    },
    yAxis: {
      type: "category",
      data: ordered.map((row) => row.reason),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: COLOR.soft,
        fontSize: 9,
        width: compact ? 150 : 250,
        overflow: "truncate",
        lineHeight: 12,
        align: "left",
        interval: 0,
        margin: compact ? 160 : 255,
        formatter: compactLabel,
      },
    },
    series: [
      {
        type: "bar",
        barWidth: "52%",
        barMaxWidth: 20,
        data: ordered.map((row) => ({
          value: row.count,
          itemStyle: {
            color: colorFor(row.reason),
            opacity: row.reason === "数据末尾" ? 0.35 : 0.72,
            borderRadius: [0, 3, 3, 0],
          },
        })),
        label: {
          show: true,
          position: "right",
          color: COLOR.soft,
          fontFamily: FONT_MONO,
          fontSize: 8,
          formatter: (params) => {
            const row = ordered[params.dataIndex];
            return `${row.count} 笔 · ${row.sharePct.toFixed(1)}%`;
          },
        },
      },
    ],
  });
}

function getChart(id) {
  if (!state.charts[id]) {
    state.charts[id] = echarts.init(document.getElementById(id), null, {
      renderer: "canvas",
    });
  }
  return state.charts[id];
}

function resizeCharts() {
  Object.values(state.charts).forEach((chart) => chart.resize());
}

function openTrade(id) {
  const trade = state.data.trades.find((row) => row.id === id);
  if (!trade) return;
  state.drawerType = "trade";
  state.drawerId = id;
  setText("drawerKicker", "逐笔复盘");
  setText("drawerTitle", `${trade.name} · ${trade.code}`);
  document.getElementById("drawerTags").innerHTML = `
    <span class="tag trend-badge">${escapeHtml(trade.group)}</span>
    <span class="tag ${trade.returnPct >= 0 ? "status-badge buy" : "status-badge skip"}">${formatPct(trade.returnPct, true)}</span>
    <span class="tag status-badge">${escapeHtml(trade.exitReason)}</span>`;
  document.getElementById("drawerMetrics").innerHTML = [
    metricHtml("最终收益", formatPct(trade.returnPct, true), trade.returnPct),
    metricHtml("持有交易日", `${trade.holdingDays} 天`),
    metricHtml("MFE", formatPct(trade.mfePct, true), trade.mfePct),
    metricHtml("MAE", formatPct(trade.maePct, true), trade.maePct),
  ].join("");
  document.getElementById("drawerDetails").innerHTML = detailTable([
    ["入场", `${trade.entryDate} / ${formatPrice(trade.entryPrice)}`],
    ["当日 5-10 间距", formatPct(trade.gapPct, true)],
    ["推演次日 5-10 / 增幅", `${formatPct(trade.projectedGapPct, true)} / ${formatPct(trade.gapDeltaPct, true)}`],
    ["出场", `${trade.exitDate} / ${formatPrice(trade.exitPrice)}`],
    ["推演 5破10 日", trade.projectedDate],
    ["实际次日 5破10", trade.actualSuccess ? "成功" : "未成功"],
    ["状态", trade.status],
    ["分组", trade.group],
  ]);
  openDrawer();
  window.setTimeout(() => renderTradeChart(trade), 90);
}

function openSignal(code, scope = "changes") {
  const signal =
    scope === "intradayJumps"
      ? (state.data.intradayJumps || []).find((row) => row.code === code) ||
        state.data.signals.find((row) => row.code === code)
      : scope === "all"
      ? state.data.signals.find((row) => row.code === code)
      : (state.data.dailyChanges || []).find((row) => row.code === code) ||
        (state.data.currentHoldings || []).find((row) => row.code === code) ||
        state.data.signals.find((row) => row.code === code);
  if (!signal) return;
  state.drawerType = "signal";
  state.drawerId = code;
  const buyLabel = signal.actionLabel || "尾盘买入";
  const groupCapBlocked =
    !signal.isBuy &&
    !signal.isHolding &&
    isOnlyGroupCapReason(signal.reason);
  setText(
    "drawerKicker",
    signal.intradayJumpToMany
      ? "盘中跳级转多 · 非买入"
      : Boolean(signal.limitUp) &&
        isLimitUpPositionReason(signal.reason, signal)
      ? "涨停无法买进"
      : signal.changeType === "sell"
      ? signal.actionLabel || "当天卖出"
      : signal.changeType === "buy"
        ? buyLabel
        : signal.isHolding
          ? "持仓未动"
          : "今日候选"
  );
  setText("drawerTitle", `${signal.name} · ${signal.code}`);
  document.getElementById("drawerTags").innerHTML = `
    <span class="tag trend-badge">${escapeHtml(signal.trendLabel || signal.trend || "—")}</span>
    <span class="tag status-badge ${
      signal.intradayJumpToMany
        ? "jump"
        : Boolean(signal.limitUp) &&
          isLimitUpPositionReason(signal.reason, signal)
        ? "limit-up"
        : groupCapBlocked
        ? "group-cap"
        : signal.changeType === "sell"
        ? "sell"
        : signal.changeType === "buy" || signal.isBuy
          ? "buy"
          : signal.changeType === "hold"
            ? "hold"
            : "skip"
    }">${escapeHtml(signalReasonText(signal.reason, signal.priorHighBreak))}</span>
    <span class="tag status-badge">${escapeHtml(signal.group)}</span>`;
  const positionReturn = holdingReturnPct(signal);
  const positionMetrics =
    signal.isHolding || signal.changeType === "sell"
      ? [
          metricHtml("持仓成本", formatPrice(signal.entryPrice)),
          metricHtml(
            signal.changeType === "sell" ? "已实现收益" : "持仓收益",
            positionReturn === null ? "—" : formatPct(positionReturn, true),
            positionReturn
          ),
        ]
      : [];
  document.getElementById("drawerMetrics").innerHTML = [
    metricHtml("现价", formatPrice(signal.close)),
    metricHtml("涨幅", formatPct(signal.changePct, true), signal.changePct),
    metricHtml("MA10 连续", `${signal.ma10Dir} ${Math.abs(signal.ma10Run)}天`, signal.ma10Dir === "向上" ? 1 : -1),
    metricHtml("MA5 连续", `${signal.ma5Dir} ${Math.abs(signal.ma5Run)}天`, signal.ma5Dir === "向上" ? 1 : -1),
    ...positionMetrics,
  ].join("");
  document.getElementById("drawerDetails").innerHTML = detailTable([
    ["日期", signal.date],
    ["首次入选时间", signal.firstSelectedAt || "—"],
    ...(signal.changeType
      ? [[
          "当日变动",
          signal.changeType === "buy"
            ? buyLabel
            : signal.changeType === "sell"
              ? `${signal.actionLabel || "当天卖出"} ${formatPrice(signal.close)}`
              : "持仓未动",
        ]]
      : []),
    ["入场", signal.entryDate ? `${signal.entryDate} / ${formatPrice(signal.entryPrice)}` : "—"],
    ["5-10 间距", formatPct(signal.gapPct, true)],
    ["推演次日 5-10 间距", formatPct(signal.projectedGapPct, true)],
    ["间距增幅", formatPct(signal.gapDeltaPct, true)],
    ["分组多占比", signal.groupManyRatioPct === null || signal.groupManyRatioPct === undefined ? "—" : `${formatNumber(signal.groupManyRatioPct, 2)}%`],
    ["推演次日 MA5", formatPrice(signal.projectedMa5)],
    ["推演次日 MA10", formatPrice(signal.projectedMa10)],
    [
      "推演次日 MA10 方向",
      signal.projectedMa10Dir || "—",
    ],
    ["MA10 拐头 / 回踩", `${formatPrice(signal.ma10Turn)} / ${formatPrice(signal.ma10Rebound)}`],
    ["MA5 拐头 / 回踩", `${formatPrice(signal.ma5Turn)} / ${formatPrice(signal.ma5Rebound)}`],
  ]);
  openDrawer();
  window.setTimeout(() => renderTradeChart(signal), 90);
}

function metricHtml(label, value, tone) {
  const cls = tone === undefined ? "" : tone >= 0 ? "up" : "down";
  return `<div class="drawer-metric"><span>${escapeHtml(label)}</span><strong class="${cls}">${escapeHtml(value)}</strong></div>`;
}

function detailTable(rows) {
  return `<div class="detail-table">${rows
    .map(
      ([label, value]) => `
        <div class="detail-cell">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value || "—")}</strong>
        </div>`
    )
    .join("")}</div>`;
}

function openDrawer() {
  document.getElementById("drawerBackdrop").classList.add("open");
  const drawer = document.getElementById("drawer");
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  syncPageScrollLock();
}

function closeDrawer() {
  document.getElementById("drawerBackdrop").classList.remove("open");
  const drawer = document.getElementById("drawer");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  syncPageScrollLock();
}

function syncPageScrollLock() {
  const locked =
    document.getElementById("drawer").classList.contains("open") ||
    document.getElementById("mobileNavPanel").classList.contains("open");
  document.body.classList.toggle("no-scroll", locked);
}

function renderTradeChart(item) {
  const bars =
    state.data.chartBars?.[item.code] ||
    state.liveData?.chartBars?.[item.code];
  const element = document.getElementById("tradeChart");
  if (!bars || !bars.dates.length) {
    element.innerHTML =
      '<div style="padding:80px;text-align:center;color:var(--text-dim);font-size:10px">该标的暂无本地行情缓存</div>';
    return;
  }
  if (state.charts.tradeChart) {
    state.charts.tradeChart.dispose();
  }
  element.innerHTML = "";
  const chart = echarts.init(element, null, { renderer: "canvas" });
  state.charts.tradeChart = chart;
  const isTrade = state.drawerType === "trade";
  const entryDate = isTrade ? item.entryDate : item.date;
  const exitDate = isTrade ? item.exitDate : null;
  const entryPrice = isTrade
    ? item.entryPrice
    : bars.ohlc[bars.dates.indexOf(item.date)]?.[1];
  const exitPrice = isTrade
    ? item.exitPrice
    : bars.ohlc[bars.dates.indexOf(item.date)]?.[1];
  const points = [];
  if (entryDate && entryPrice) {
    points.push({
      name: isTrade ? "买" : "今",
      coord: [entryDate, entryPrice],
      value: isTrade ? "买" : "今",
      itemStyle: { color: isTrade ? COLOR.red : COLOR.cyan },
      label: { color: isTrade ? COLOR.red : COLOR.cyan, fontSize: 9, fontWeight: 600 },
    });
  }
  if (isTrade && exitDate && exitPrice) {
    points.push({
      name: "卖",
      coord: [exitDate, exitPrice],
      value: "卖",
      itemStyle: { color: COLOR.green },
      label: { color: COLOR.green, fontSize: 9, fontWeight: 600 },
    });
  }
  chart.setOption({
    ...chartBase(),
    grid: { left: 48, right: 14, top: 30, bottom: 48 },
    tooltip: {
      ...chartBase().tooltip,
      trigger: "axis",
      axisPointer: { type: "cross", crossStyle: { color: COLOR.axis } },
      formatter(params) {
        const candle = params.find((param) => param.seriesType === "candlestick");
        if (!candle) return "";
        const [open, close, low, high] = candle.value.slice(1);
        const line = (name, value) =>
          value === null || value === undefined
            ? ""
            : `<div style="margin-top:2px;color:${COLOR.soft};font-size:9px">${name} <b style="float:right;margin-left:18px">${Number(value).toFixed(2)}</b></div>`;
        return `<div style="font-family:${FONT_MONO};color:${COLOR.soft};font-size:9px">${candle.axisValue}</div>
          <div style="margin-top:5px;color:${COLOR.text};font-size:10px">
            收 <b style="float:right;margin-left:18px;color:${close >= open ? COLOR.red : COLOR.green}">${close.toFixed(2)}</b>
          </div>
          ${line("开", open)}${line("高", high)}${line("低", low)}
          ${line("MA5", params.find((param) => param.seriesName === "MA5")?.value)}
          ${line("MA10", params.find((param) => param.seriesName === "MA10")?.value)}`;
      },
    },
    xAxis: {
      type: "category",
      data: bars.dates,
      boundaryGap: true,
      axisLine: { lineStyle: { color: COLOR.axis } },
      axisTick: { show: false },
      axisLabel: {
        color: COLOR.dim,
        fontSize: 8,
        formatter: (value) => value.slice(5),
        hideOverlap: true,
      },
    },
    yAxis: {
      scale: true,
      splitNumber: 4,
      axisLabel: { color: COLOR.dim, fontSize: 8, fontFamily: FONT_MONO },
      splitLine: { lineStyle: { color: COLOR.grid } },
      axisLine: { show: false },
    },
    dataZoom: [
      { type: "inside", start: bars.dates.length > 75 ? 25 : 0, end: 100 },
    ],
    series: [
      {
        name: "K线",
        type: "candlestick",
        data: bars.ohlc,
        itemStyle: {
          color: COLOR.red,
          color0: COLOR.green,
          borderColor: COLOR.red,
          borderColor0: COLOR.green,
        },
        markPoint: {
          symbol: "pin",
          symbolSize: 28,
          data: points,
        },
      },
      {
        name: "MA5",
        type: "line",
        data: bars.ma5,
        symbol: "none",
        smooth: true,
        lineStyle: { width: 1, color: COLOR.red, opacity: 0.72 },
      },
      {
        name: "MA10",
        type: "line",
        data: bars.ma10,
        symbol: "none",
        smooth: true,
        lineStyle: { width: 1.2, color: COLOR.amber, opacity: 0.78 },
      },
    ],
  });
}

function setupNavigation() {
  const links = [
    ...document.querySelectorAll(".main-nav a, .mobile-nav-links a"),
  ];
  const sections = [
    ...new Set(
      links
        .map((link) => document.querySelector(link.getAttribute("href")))
        .filter(Boolean)
    ),
  ];
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      links.forEach((link) =>
        link.classList.toggle(
          "active",
          link.getAttribute("href") === `#${visible.target.id}`
        )
      );
    },
    { rootMargin: "-20% 0px -65% 0px", threshold: [0.05, 0.2, 0.5] }
  );
  sections.forEach((section) => observer.observe(section));
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value ?? "—";
}

function formatInt(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(
    Number(value) || 0
  );
}

function formatAmount(value) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const number = Number(value);
  return number >= 100 ? number.toFixed(2) : number.toFixed(2);
}

function signed(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`;
}

function formatPct(value, withSign = true, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const number = Number(value);
  const sign = withSign && number >= 0 ? "+" : "";
  return `${sign}${number.toFixed(digits)}%`;
}

function pctClass(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "flat";
  return Number(value) >= 0 ? "up" : "down";
}

function toneElement(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.classList.remove("up", "down", "flat");
  element.classList.add(pctClass(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
