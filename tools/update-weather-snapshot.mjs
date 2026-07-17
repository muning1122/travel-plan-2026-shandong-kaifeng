import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "assets/data/route-weather.json");
const configJsPath = resolve(root, "assets/js/route-weather-config.js");
const snapshotPath = resolve(root, "assets/js/weather-snapshot.js");
const config = JSON.parse(await readFile(configPath, "utf8"));
let previousSnapshot = {};
try {
  const previousText = await readFile(snapshotPath, "utf8");
  const start = previousText.indexOf("{");
  const end = previousText.lastIndexOf("}");
  if (start >= 0 && end > start) previousSnapshot = JSON.parse(previousText.slice(start, end + 1));
} catch {
  previousSnapshot = {};
}

const headers = {
  Referer: "https://www.weather.com.cn/",
  "User-Agent": "Mozilla/5.0 travel-planner-official-weather/2.0"
};

const officialQuery = {
  huanglong: "松潘",
  qinghai_lake: "共和",
  chaka: "乌兰",
  water_yadan: "大柴旦",
  tiger_leaping: "香格里拉",
  tianmen: "张家界",
  yading: "稻城",
  hemu: "布尔津",
  kanas: "布尔津",
  arctic_village: "漠河",
  beihong: "漠河",
  first_bay: "漠河"
};

const locationQuery = {
  guangzhou: "广州",
  qingdao: "青岛",
  weihai: "威海",
  kaifeng: "开封",
  zhengzhou: "郑州",
  chengdu: "成都",
  huanglong: "松潘",
  jiuzhaigou: "九寨沟",
  ruoergai: "若尔盖",
  songpan: "松潘",
  lanzhou: "兰州",
  xining: "西宁",
  zhangye: "张掖",
  jiayuguan: "嘉峪关",
  dunhuang: "敦煌",
  qinghai_lake: "共和",
  chaka: "乌兰",
  dachaidan: "大柴旦",
  water_yadan: "大柴旦",
  lijiang: "丽江",
  tiger_leaping: "香格里拉",
  yulong: "玉龙",
  zhangjiajie: "张家界",
  wulingyuan: "武陵源",
  tianmen: "张家界",
  daocheng: "稻城",
  yading: "稻城",
  urumqi: "乌鲁木齐",
  burqin: "布尔津",
  hemu: "布尔津",
  kanas: "布尔津",
  harbin: "哈尔滨",
  mohe: "漠河",
  arctic_village: "漠河",
  beihong: "漠河",
  first_bay: "漠河"
};

function cleanText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&gt;/gi, ">")
    .replace(/&lt;/gi, "<")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function chinaToday() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day) };
}

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function datedRows(rows) {
  const today = chinaToday();
  let year = today.year;
  let month = today.month;
  let previous = today.day;
  return rows.map((row, index) => {
    if (index > 0 && row.day < previous) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    previous = row.day;
    return { ...row, date: isoDate(year, month, row.day) };
  });
}

function weatherCode(text) {
  if (/冰雹|雷阵雨|雷暴/.test(text)) return 95;
  if (/暴雪/.test(text)) return 75;
  if (/大雪/.test(text)) return 75;
  if (/中雪/.test(text)) return 73;
  if (/小雪|雨夹雪/.test(text)) return 71;
  if (/暴雨|大雨/.test(text)) return 65;
  if (/中雨/.test(text)) return 63;
  if (/阵雨/.test(text)) return 80;
  if (/小雨|雨/.test(text)) return 61;
  if (/雾|霾/.test(text)) return 45;
  if (/阴/.test(text)) return 3;
  if (/多云/.test(text)) return 2;
  return 0;
}

function windKmh(scaleText) {
  const values = [...scaleText.matchAll(/\d+/g)].map((item) => Number(item[0]));
  const level = values.length ? Math.max(...values) : 0;
  const kmh = { 0: 5, 1: 7, 2: 11, 3: 19, 4: 28, 5: 38, 6: 49, 7: 61, 8: 74, 9: 88, 10: 102, 11: 117, 12: 134 };
  return kmh[Math.min(level, 12)] || 11;
}

function sliceSection(html, id, length = 26000) {
  const start = html.indexOf(`id="${id}"`);
  return start >= 0 ? html.slice(start, start + length) : "";
}

function parseSevenDay(html) {
  const section = sliceSection(html, "7d");
  const rows = [];
  for (const match of section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const block = match[1];
    const dayMatch = block.match(/<h1[^>]*>[\s\S]*?(\d{1,2})日[\s\S]*?<\/h1>/i);
    if (!dayMatch) continue;
    const weather = cleanText(block.match(/<p[^>]*class="wea"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "");
    const temperatureBlock = block.match(/<p[^>]*class="tem"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "";
    const temperatures = (cleanText(temperatureBlock).match(/-?\d+/g) || []).map(Number);
    const windDirection = [...block.matchAll(/<span[^>]*title="([^"]+)"[^>]*>/gi)]
      .map((item) => item[1])
      .filter((value) => /风/.test(value))
      .join("转") || "风向待核";
    const windScale = cleanText(block.match(/<p[^>]*class="win"[^>]*>[\s\S]*?<i>([\s\S]*?)<\/i>/i)?.[1] || "") || "风力待核";
    rows.push({
      day: Number(dayMatch[1]),
      weather_text: weather || "天气待核",
      weather_code: weatherCode(weather),
      temperature_2m_max: temperatures.length ? Math.max(...temperatures) : null,
      temperature_2m_min: temperatures.length ? Math.min(...temperatures) : null,
      wind_direction: windDirection,
      wind_scale: windScale,
      wind_gusts_10m_max: windKmh(windScale),
      forecast_type: "官方7天预报"
    });
  }
  return datedRows(rows.slice(0, 7));
}

function parseEightToFifteenDay(html) {
  const section = sliceSection(html, "15d");
  const rows = [];
  for (const match of section.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const block = match[1];
    const dayMatch = block.match(/<span[^>]*class="time"[^>]*>[\s\S]*?(\d{1,2})日[\s\S]*?<\/span>/i);
    if (!dayMatch) continue;
    const weather = cleanText(block.match(/<span[^>]*class="wea"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const temperatureBlock = block.match(/<span[^>]*class="tem"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "";
    const temperatures = (cleanText(temperatureBlock).match(/-?\d+/g) || []).map(Number);
    const windDirection = cleanText(block.match(/<span[^>]*class="wind"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "") || "风向待核";
    const windScale = cleanText(block.match(/<span[^>]*class="wind1"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "") || "风力待核";
    rows.push({
      day: Number(dayMatch[1]),
      weather_text: weather || "天气待核",
      weather_code: weatherCode(weather),
      temperature_2m_max: temperatures.length ? Math.max(...temperatures) : null,
      temperature_2m_min: temperatures.length ? Math.min(...temperatures) : null,
      wind_direction: windDirection,
      wind_scale: windScale,
      wind_gusts_10m_max: windKmh(windScale),
      forecast_type: "官方8—15天趋势"
    });
  }
  return datedRows(rows.slice(0, 9));
}

async function resolveWeatherCode(query) {
  const url = `https://toy1.weather.com.cn/search?cityname=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`中国天气网城市检索 ${response.status}`);
  const raw = (await response.text()).trim().replace(/^\(/, "").replace(/\)$/, "");
  const items = JSON.parse(raw);
  const candidates = items
    .map((item) => item.ref.split("~"))
    .filter((parts) => parts[0]?.length === 9);
  const exact = candidates.find((parts) => parts[2] === query);
  const selected = exact || candidates[0];
  if (!selected) throw new Error(`未找到官方天气城市代码：${query}`);
  return { code: selected[0], officialName: selected[2] };
}

function dailyObject(rows) {
  const keys = [
    "time",
    "weather_text",
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "wind_direction",
    "wind_scale",
    "wind_gusts_10m_max",
    "forecast_type"
  ];
  const daily = Object.fromEntries(keys.map((key) => [key, []]));
  for (const row of rows) {
    daily.time.push(row.date);
    for (const key of keys.slice(1)) daily[key].push(row[key]);
  }
  return daily;
}

async function fetchForecast(id, location) {
  const query = officialQuery[id] || locationQuery[id] || location.name.split(/[\/—]/)[0];
  const { code, officialName } = await resolveWeatherCode(query);
  const sevenUrl = `https://www.weather.com.cn/weather/${code}.shtml`;
  const trendUrl = `https://www.weather.com.cn/weather15d/${code}.shtml`;
  const [sevenResponse, trendResponse] = await Promise.all([
    fetch(sevenUrl, { headers, signal: AbortSignal.timeout(15000) }),
    fetch(trendUrl, { headers, signal: AbortSignal.timeout(15000) })
  ]);
  if (!sevenResponse.ok || !trendResponse.ok) {
    throw new Error(`中国天气网 ${sevenResponse.status}/${trendResponse.status}`);
  }
  const [sevenHtml, trendHtml] = await Promise.all([sevenResponse.text(), trendResponse.text()]);
  const rows = [...parseSevenDay(sevenHtml), ...parseEightToFifteenDay(trendHtml)];
  const uniqueRows = [...new Map(rows.map((row) => [row.date, row])).values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!uniqueRows.length) throw new Error(`官方页面解析不到逐日预报：${officialName}`);
  return [
    id,
    {
      name: location.name,
      officialName,
      weatherCode: code,
      source: "中国天气网",
      sourceUrl: sevenUrl,
      trendUrl,
      queryNote: officialName === location.name ? "" : `${location.name}采用最近的官方预报站“${officialName}”`,
      daily: dailyObject(uniqueRows)
    }
  ];
}

async function runPool(entries, previousLocations = {}, concurrency = 4) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor++;
      const [id, location] = entries[index];
      try {
        results[index] = await fetchForecast(id, location);
      } catch (error) {
        const previous = previousLocations[id];
        results[index] = [
          id,
          previous?.daily
            ? {
                ...previous,
                stale: true,
                refreshError: String(error.message || error)
              }
            : {
                name: location.name,
                source: "中国天气网",
                error: String(error.message || error)
              }
        ];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  return Object.fromEntries(results);
}

async function fetchTyphoon(previousTyphoon = null) {
  const url = "https://www.nmc.cn/publish/typhoon/warning_index.html";
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": headers["User-Agent"] },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`中央气象台 ${response.status}`);
    const bodyText = cleanText(await response.text());
    const start = bodyText.indexOf("预报：");
    const product = start >= 0 ? bodyText.slice(start, start + 900) : bodyText.slice(-1200);
    const released = /解除台风|停止编\s*号|影响趋于结束/.test(product);
    const active = !released && /(?:发布|继续发布).{0,20}台风.{0,20}(?:蓝色|黄色|橙色|红色).{0,10}预警/.test(product);
    const end = product.indexOf("相关产品");
    const summary = (end > 0 ? product.slice(0, end) : product.slice(0, 620)).trim();
    return {
      source: "中央气象台",
      url,
      active,
      summary: summary || "中央气象台当前页面没有新台风预警正文，请点击官方入口核对。",
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    if (previousTyphoon?.summary) {
      return {
        ...previousTyphoon,
        stale: true,
        refreshError: String(error.message || error)
      };
    }
    return {
      source: "中央气象台",
      url,
      active: null,
      summary: "台风页面抓取失败，请点击中央气象台官方入口人工核对。",
      error: String(error.message || error),
      fetchedAt: new Date().toISOString()
    };
  }
}

await mkdir(dirname(configJsPath), { recursive: true });
const locations = await runPool(Object.entries(config.locations), previousSnapshot.locations || {});
const snapshot = {
  generatedAt: new Date().toISOString(),
  timezone: "Asia/Shanghai",
  provider: "中国天气网（中国气象局公共气象服务）",
  providerUrl: "https://www.weather.com.cn/",
  confidenceRule: "未来7天使用官方城市预报；第8—15天仅作客观趋势参考，临近出发必须复核。",
  locations,
  typhoon: await fetchTyphoon(previousSnapshot.typhoon)
};

await writeFile(configJsPath, `window.ROUTE_WEATHER_CONFIG=${JSON.stringify(config)};\n`, "utf8");
await writeFile(snapshotPath, `window.ROUTE_WEATHER_SNAPSHOT=${JSON.stringify(snapshot)};\n`, "utf8");

const failed = Object.values(locations).filter((location) => location.error);
console.log(
  `Official weather snapshot refreshed: ${snapshot.generatedAt}; locations=${Object.keys(locations).length}; failed=${failed.length}; typhoon=${snapshot.typhoon.active}`
);
if (failed.length) {
  console.warn(failed.map((location) => `${location.name}: ${location.error}`).join("\n"));
}
