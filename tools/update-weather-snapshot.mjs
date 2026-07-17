import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "assets/data/route-weather.json");
const configJsPath = resolve(root, "assets/js/route-weather-config.js");
const snapshotPath = resolve(root, "assets/js/weather-snapshot.js");
const config = JSON.parse(await readFile(configPath, "utf8"));

const dailyFields = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "apparent_temperature_max",
  "precipitation_sum",
  "precipitation_probability_max",
  "wind_gusts_10m_max"
].join(",");

async function fetchForecast(id, location) {
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    daily: dailyFields,
    timezone: "Asia/Shanghai",
    forecast_days: String(config.forecastDays || 16)
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    headers: { "User-Agent": "travel-planner-weather-snapshot/1.0" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Open-Meteo ${response.status}`);
  const data = await response.json();
  return [id, { name: location.name, latitude: data.latitude, longitude: data.longitude, daily: data.daily }];
}

async function runPool(entries, concurrency = 6) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor++;
      const [id, location] = entries[index];
      try {
        results[index] = await fetchForecast(id, location);
      } catch (error) {
        results[index] = [id, { name: location.name, error: String(error.message || error) }];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  return Object.fromEntries(results);
}

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

async function fetchTyphoon() {
  const url = "https://www.nmc.cn/publish/typhoon/warning_index.html";
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 travel-planner-weather-snapshot/1.0" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`NMC ${response.status}`);
    const html = await response.text();
    const bodyText = cleanText(html);
    const match = bodyText.match(/中央气象台[^。；]{0,120}(?:台风|热带)[\s\S]{0,420}?(?:。|；)/);
    const summary = (match?.[0] || bodyText.slice(0, 520)).trim();
    const released = /解除台风|停止编号|影响趋于结束/.test(summary);
    const active = !released && /台风(?:红色|橙色|黄色|蓝色)?预警|台风预警/.test(summary);
    return { source: "中央气象台", url, active, summary, fetchedAt: new Date().toISOString() };
  } catch (error) {
    return { source: "中央气象台", url, active: null, summary: "台风页面抓取失败，请点击官方入口人工核对。", error: String(error.message || error), fetchedAt: new Date().toISOString() };
  }
}

await mkdir(dirname(configJsPath), { recursive: true });
const locations = await runPool(Object.entries(config.locations));
const snapshot = {
  generatedAt: new Date().toISOString(),
  timezone: "Asia/Shanghai",
  provider: "Open-Meteo",
  locations,
  typhoon: await fetchTyphoon()
};

await writeFile(configJsPath, `window.ROUTE_WEATHER_CONFIG=${JSON.stringify(config)};\n`, "utf8");
await writeFile(snapshotPath, `window.ROUTE_WEATHER_SNAPSHOT=${JSON.stringify(snapshot)};\n`, "utf8");
console.log(`Weather snapshot refreshed: ${snapshot.generatedAt}; locations=${Object.keys(locations).length}; typhoon=${snapshot.typhoon.active}`);
