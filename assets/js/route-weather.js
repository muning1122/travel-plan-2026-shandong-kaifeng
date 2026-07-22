(function () {
  "use strict";

  var config = window.ROUTE_WEATHER_CONFIG;
  var snapshot = window.ROUTE_WEATHER_SNAPSHOT || {};
  var scriptUrl = document.currentScript && document.currentScript.src;
  var snapshotUrl = scriptUrl
    ? new URL("weather-snapshot.js", scriptUrl).href
    : "../assets/js/weather-snapshot.js";
  if (!config || !config.routes) return;

  var weatherNames = {
    0: "晴",
    2: "多云",
    3: "阴",
    45: "雾",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    80: "阵雨",
    95: "雷暴"
  };
  var fields = [
    "weather_text",
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "wind_direction",
    "wind_scale",
    "wind_gusts_10m_max",
    "forecast_type"
  ];

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function dateFromIso(value) {
    var parts = value.split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }

  function addDays(value, days) {
    var date = typeof value === "string" ? dateFromIso(value) : new Date(value.getTime());
    date.setUTCDate(date.getUTCDate() + days);
    return isoDate(date);
  }

  function tomorrow() {
    var date = new Date();
    return isoDate(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1)));
  }

  function shortDate(value) {
    var parts = value.split("-");
    return Number(parts[1]) + "月" + Number(parts[2]) + "日";
  }

  function safeNumber(value, fallback) {
    if (value == null || value === "") return fallback;
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function setRefreshStatus(panel, text, status) {
    var node = panel && panel.querySelector(".weather-auto-status");
    if (!node) return;
    node.textContent = text;
    node.dataset.status = status || "loading";
  }

  function refreshPublishedSnapshot(routeId, route, start, panel) {
    setRefreshStatus(panel, "正在读取最新官方天气…", "loading");
    var loader = document.createElement("script");
    loader.src = snapshotUrl + (snapshotUrl.indexOf("?") >= 0 ? "&" : "?") + "refresh=" + Date.now();
    loader.async = true;
    loader.onload = function () {
      snapshot = window.ROUTE_WEATHER_SNAPSHOT || snapshot;
      renderPanel(routeId, route, snapshot.locations || {}, start);
      var generated = snapshot.generatedAt
        ? new Date(snapshot.generatedAt).toLocaleString("zh-CN", { hour12: false })
        : "时间待核";
      setRefreshStatus(panel, "已读取最新官方快照｜" + generated, "ok");
      loader.remove();
    };
    loader.onerror = function () {
      setRefreshStatus(panel, "网络暂不可用，已显示网页内置官方快照", "cached");
      loader.remove();
    };
    document.head.appendChild(loader);
  }

  function readDay(location, date) {
    if (!location || !location.daily || !Array.isArray(location.daily.time)) return null;
    var index = location.daily.time.indexOf(date);
    if (index < 0) return null;
    var result = { date: date };
    fields.forEach(function (field) {
      result[field] = location.daily[field] && location.daily[field][index];
    });
    return result;
  }

  function windLevel(text) {
    var levels = String(text || "").match(/\d+/g) || [];
    return levels.length ? Math.max.apply(null, levels.map(Number)) : 0;
  }

  function assess(day, route) {
    if (!day) return { status: "unknown", label: "超出官方快照", reason: "当前官方页面未覆盖这一天" };
    var weather = String(day.weather_text || weatherNames[day.weather_code] || "天气待核");
    var max = safeNumber(day.temperature_2m_max, 0);
    var min = safeNumber(day.temperature_2m_min, 99);
    var wind = windLevel(day.wind_scale);
    var isTrend = String(day.forecast_type).indexOf("8—15") >= 0;
    var red = [];
    var amber = [];

    if (/雷暴|雷阵雨|冰雹|暴雨|大雪|暴雪/.test(weather)) red.push(weather);
    if (wind >= 8) red.push("8级及以上大风");
    if (max >= 38) red.push("极端高温");
    if (/中雨|阵雨|雨夹雪|小雪/.test(weather)) amber.push(weather);
    if (wind >= 6 && wind < 8) amber.push("风力偏强");
    if (max >= 35 && max < 38) amber.push("高温");
    if (route.highAltitude && min <= 4) amber.push("高海拔低温");

    if (isTrend && (red.length || amber.length)) {
      return { status: "amber", label: "趋势有风险，临近复核", reason: Array.from(new Set(red.concat(amber))).join("、") + "；当前仍是8—15天趋势" };
    }
    if (red.length) return { status: "red", label: "不建议按原计划", reason: Array.from(new Set(red)).join("、") };
    if (amber.length) return { status: "amber", label: "能去但要调整", reason: Array.from(new Set(amber)).join("、") };
    if (isTrend) {
      return { status: "green", label: "趋势暂可，临近复核", reason: "当前仅为官方8—15天客观趋势，不等同短期精细预报" };
    }
    return { status: "green", label: "目前可去", reason: "官方7天预报未见强降雨、雷暴、强风或极端高温信号" };
  }

  function overall(days, route) {
    var assessments = days.map(function (item) {
      return assess(item.weather, route);
    });
    var typhoon = snapshot.typhoon || {};
    var hasRed = assessments.some(function (item) {
      return item.status === "red";
    });
    var hasAmber = assessments.some(function (item) {
      return item.status === "amber";
    });
    var allUnknown = assessments.every(function (item) {
      return item.status === "unknown";
    });
    var hasTrend = days.some(function (item) {
      return item.weather && String(item.weather.forecast_type).indexOf("8—15") >= 0;
    });

    if (typhoon.active && route.coastal) {
      return { status: "red", label: "先不要锁死", reason: "中央气象台有台风预警，海岛船班和华南大交通必须重新核对" };
    }
    if (typhoon.active && !hasRed) {
      return { status: "amber", label: "先核对大交通", reason: "中央气象台有台风预警，广州/佛山出发交通可能受影响" };
    }
    if (hasRed) return { status: "red", label: "不建议按原计划", reason: "至少一天出现雷暴、暴雨、强风或极端高温风险" };
    if (hasAmber) return { status: "amber", label: "能去但要调整", reason: "沿线存在降雨、风力、高温或高海拔低温风险，按每日卡删减" };
    if (allUnknown) return { status: "unknown", label: "暂不能判断", reason: "旅行日期超出当前中国天气网快照范围，请临近出发再看" };
    if (hasTrend) return { status: "green", label: "趋势暂可，临近复核", reason: "当前部分日期属于中国天气网8—15天趋势，距出发48—72小时必须再看7天预报" };
    return { status: "green", label: "目前可以去", reason: "官方7天预报覆盖期内未见需要取消整条路线的天气信号" };
  }

  function buildDays(route, start, locations) {
    return route.days.map(function (item) {
      var date = addDays(start, item.offset);
      return { config: item, date: date, weather: readDay(locations[item.location], date) };
    });
  }

  function weatherDetails(day) {
    if (!day) return "等待官方预报覆盖";
    var weather = day.weather_text || weatherNames[day.weather_code] || "天气待核";
    var low = safeNumber(day.temperature_2m_min, null);
    var high = safeNumber(day.temperature_2m_max, null);
    var temperature = low == null || high == null ? "温度待核" : Math.round(low) + "—" + Math.round(high) + "℃";
    return escapeHtml(weather) + "｜" + temperature;
  }

  function riskDetails(day) {
    if (!day) return "当前仅显示中国天气网已发布的官方日期";
    return (
      escapeHtml(day.forecast_type || "官方预报") +
      "｜" +
      escapeHtml(day.wind_direction || "风向待核") +
      " " +
      escapeHtml(day.wind_scale || "风力待核")
    );
  }

  function renderPanel(routeId, route, locations, start) {
    var panel = document.querySelector(".route-weather-panel");
    if (!panel) return;
    var days = buildDays(route, start, locations);
    var verdict = overall(days, route);
    var typhoon = snapshot.typhoon || {};
    var generated = snapshot.generatedAt
      ? new Date(snapshot.generatedAt).toLocaleString("zh-CN", { hour12: false })
      : "未知";

    panel.querySelector(".weather-live-badge").textContent = "中国气象局体系官方快照";
    var verdictNode = panel.querySelector(".weather-overall");
    verdictNode.dataset.status = verdict.status;
    var dateContext = route.departureDate
      ? "游玩段按 <b>" +
        shortDate(start) +
        "</b> 起算；大交通出发日为 <b>" +
        shortDate(route.departureDate) +
        "</b>，广州/佛山天气与台风需同时核对。"
      : "当前按 <b>" + shortDate(start) + "</b> 出发逐日判断。";
    verdictNode.innerHTML =
      '<div class="weather-verdict">' +
      verdict.label +
      '</div><div class="weather-reason">' +
      verdict.reason +
      "。" +
      dateContext +
      "</div>";

    panel.querySelector(".weather-days").innerHTML = days
      .map(function (item) {
        var result = assess(item.weather, route);
        var location = locations[item.config.location] || {};
        var sourceUrl = location.sourceUrl || "https://www.weather.com.cn/";
        var noteText = location.queryNote || "";
        if (location.stale) noteText += (noteText ? "；" : "") + "本次联网刷新失败，暂用上一版官方快照";
        var note = noteText ? '<small class="weather-station-note">' + escapeHtml(noteText) + "</small>" : "";
        return (
          '<article class="weather-day" data-status="' +
          result.status +
          '"><strong>D' +
          item.config.day +
          "｜" +
          shortDate(item.date) +
          '</strong><div class="weather-place">' +
          escapeHtml(config.locations[item.config.location].name) +
          " · " +
          escapeHtml(item.config.label) +
          '</div><div class="weather-main">' +
          weatherDetails(item.weather) +
          "</div><small>" +
          riskDetails(item.weather) +
          '</small><small><b>' +
          result.label +
          "：</b>" +
          escapeHtml(result.reason) +
          '</small><a class="weather-source-mini" href="' +
          escapeHtml(sourceUrl) +
          '" target="_blank" rel="noopener">查看中国天气网原页</a>' +
          note +
          "</article>"
        );
      })
      .join("");

    var typhoonText = typhoon.summary || "台风数据暂未取得，请点击中央气象台人工核对。";
    panel.querySelector(".typhoon-copy").innerHTML =
      "<h3>台风预报｜" +
      (typhoon.active === true ? "有生效预警" : typhoon.active === false ? "当前无生效预警" : "需人工核对") +
      "</h3><p>" +
      escapeHtml(typhoonText) +
      "</p>";
    panel.querySelector(".weather-foot").textContent =
      "逐日天气：中国天气网（中国气象局公共气象服务）；台风：中央气象台。未来7天为官方城市预报，第8—15天仅为客观趋势参考。快照更新时间 " +
      generated +
      "；船班、航班、索道和景区开放仍以当天官方公告为准。";
  }

  function makePanel(routeId, route, start) {
    var panel = document.createElement("section");
    var slot = document.getElementById("route-weather-slot");
    var compact = Boolean(slot && slot.hasAttribute("data-weather-compact"));
    panel.className = "route-weather-panel";
    if (compact) panel.classList.add("is-compact");
    panel.id = "route-weather";
    var heading =
      '<div class="weather-head"><div><h2>天气与台风官方判断</h2><p>' +
      escapeHtml(route.name) +
      (route.dateLabel ? "｜" + escapeHtml(route.dateLabel) : "") +
      '｜先看能不能去，再决定是否调整。</p><span class="weather-auto-status" data-status="loading">打开页面自动读取最新快照</span></div><span class="weather-live-badge">官方快照</span></div>';
    var controls =
      '<div class="weather-controls"><label>推算出发日期<input class="weather-date" type="date" value="' +
      start +
      '"></label><button class="weather-refresh" type="button">重新读取最新快照</button><a class="weather-official-link" href="https://www.weather.com.cn/" target="_blank" rel="noopener">中国天气网</a><a class="weather-official-link" href="https://www.nmc.cn/publish/typhoon/warning_index.html" target="_blank" rel="noopener">中央气象台台风</a></div>' +
      '<div class="weather-days"></div>' +
      '<div class="typhoon-card"><div class="typhoon-copy"><h3>台风预报</h3><p>读取中央气象台发布快照。</p></div><a class="weather-official-link" href="https://www.nmc.cn/publish/typhoon/warning_index.html" target="_blank" rel="noopener">打开官方预警</a></div><p class="weather-foot"></p>';
    var verdict = '<div class="weather-overall" data-status="unknown"><div class="weather-verdict">正在判断</div><div class="weather-reason">读取官方快照中。</div></div>';
    panel.innerHTML = compact
      ? heading + verdict + '<details class="weather-detail"><summary>展开逐日预报、台风和官方链接</summary><div class="weather-detail-body">' + controls + "</div></details>"
      : heading + controls.replace('<div class="weather-days"></div>', verdict + '<div class="weather-days"></div>');
    var main = document.querySelector("main");
    if (slot) slot.appendChild(panel);
    else if (main) document.body.insertBefore(panel, main);
    else document.body.appendChild(panel);
    panel.querySelector(".weather-refresh").addEventListener("click", function () {
      var value = panel.querySelector(".weather-date").value;
      if (!value) return;
      try {
        localStorage.setItem("route-weather-date-" + routeId, value);
      } catch (error) {}
      renderPanel(routeId, route, snapshot.locations || {}, value);
      refreshPublishedSnapshot(routeId, route, value, panel);
    });
    return panel;
  }

  function routeIdFromHref(href) {
    var name = (href || "").split("/").pop().replace(".html", "");
    return name === "jiuzhaigou-7days" ? "jiuzhaigou-7days" : name;
  }

  function renderIndex() {
    document.querySelectorAll(".route-tile").forEach(function (tile) {
      var routeId = routeIdFromHref(tile.getAttribute("href"));
      var route = config.routes[routeId];
      if (!route) return;
      var start = route.fixedStart || tomorrow();
      var result = overall(buildDays(route, start, snapshot.locations || {}), route);
      var badge = document.createElement("span");
      badge.className = "route-live-status";
      badge.dataset.status = result.status;
      badge.textContent = (route.fixedStart ? "计划日期" : "未来预演") + "：" + result.label;
      var summary = tile.querySelector(".route-summary");
      if (summary) summary.appendChild(badge);
    });
  }

  var routeId = document.body.getAttribute("data-route-id");
  if (routeId && config.routes[routeId]) {
    var route = config.routes[routeId];
    var stored = "";
    try {
      stored = localStorage.getItem("route-weather-date-" + routeId) || "";
    } catch (error) {}
    var start = stored || route.fixedStart || tomorrow();
    var panel = makePanel(routeId, route, start);
    renderPanel(routeId, route, snapshot.locations || {}, start);
    refreshPublishedSnapshot(routeId, route, start, panel);
  } else if (document.body.hasAttribute("data-weather-index")) {
    renderIndex();
  }
})();
