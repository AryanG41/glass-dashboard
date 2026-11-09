// Weather card: current conditions + a 12-hour strip with a Temp / Rain / Wind / Humidity toggle.
// Data comes from /api/weather (Open-Meteo, proxied + cached by server.py).

const $ = (id) => document.getElementById(id);
let data = null;
let mode = "temp";

// ---------------------------------------------------------------- icons (inline SVG, 64x64)

const SUN = `<circle cx="32" cy="32" r="12" fill="#ffd36b"/><g stroke="#ffd36b" stroke-width="4" stroke-linecap="round">
  <path d="M32 6v7M32 51v7M6 32h7M51 32h7M13.6 13.6l5 5M45.4 45.4l5 5M13.6 50.4l5-5M45.4 18.6l5-5"/></g>`;
const MOON = `<path d="M40 10a22 22 0 1 0 14 34A18 18 0 0 1 40 10z" fill="#e9e6ff"/>`;
const CLOUD = (y = 0, o = 1) => `<path transform="translate(0 ${y})" opacity="${o}" fill="#fff"
  d="M20 50h26a11 11 0 0 0 1-22 15 15 0 0 0-28.5 4A9 9 0 0 0 20 50z"/>`;
const SMALL_SUN = `<g transform="translate(-6 -8) scale(.75)">${SUN}</g>`;
const SMALL_MOON = `<g transform="translate(-4 -6) scale(.7)">${MOON}</g>`;
const DROPS = `<g stroke="#7cc8ff" stroke-width="3.5" stroke-linecap="round"><path d="M24 54l-3 7M34 54l-3 7M44 54l-3 7"/></g>`;
const FLAKES = `<g fill="#fff"><circle cx="23" cy="57" r="2.6"/><circle cx="33" cy="60" r="2.6"/><circle cx="43" cy="57" r="2.6"/></g>`;
const BOLT = `<path d="M34 46l-8 11h7l-4 9 11-13h-7l4-7z" fill="#ffd36b"/>`;
const FOG = `<g stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".85"><path d="M12 28h40M8 37h48M14 46h36"/></g>`;

function icon(code, isDay) {
  const svg = (inner) => `<svg class="icon" viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>`;
  const celestial = isDay ? SUN : MOON;
  if (code === 0) return svg(celestial);
  if (code === 1 || code === 2) return svg((isDay ? SMALL_SUN : SMALL_MOON) + CLOUD(4));
  if (code === 3) return svg(CLOUD(-6, 0.55) + CLOUD(0));
  if (code === 45 || code === 48) return svg(FOG);
  if (code >= 95) return svg(CLOUD(-6) + BOLT);
  if ([71, 73, 75, 77, 85, 86].includes(code)) return svg(CLOUD(-6) + FLAKES);
  if (code >= 51) return svg(CLOUD(-6) + DROPS); // drizzle, rain, showers
  return svg(CLOUD(0));
}

function describe(code) {
  const map = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Freezing fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Light showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Snow showers",
    95: "Thunderstorms", 96: "Thunderstorms, hail", 99: "Thunderstorms, hail",
  };
  return map[code] ?? "—";
}

// ---------------------------------------------------------------- render

const fmtHour = (d) => d.toLocaleTimeString(undefined, { hour: "numeric" }).replace(" ", "").toLowerCase();
const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const r = Math.round;

function render() {
  const now = $("wx-now"), list = $("wx-hourly");
  if (!data) { now.innerHTML = `<div class="desc"><div class="meta">Loading weather…</div></div>`; list.innerHTML = ""; return; }
  if (data.error) { now.innerHTML = `<div class="desc"><div class="meta">Weather unavailable right now — will retry.</div></div>`; return; }

  const c = data.current, d = data.daily, h = data.hourly;
  const deg = "°";
  const speed = data.fahrenheit ? "mph" : "km/h";
  $("wx-place").textContent = data.place || "Weather";

  // next sunrise/sunset that hasn't happened yet
  const t = Date.now();
  const sunEvents = [
    ...d.sunrise.map((s) => ({ k: "Sunrise", at: new Date(s) })),
    ...d.sunset.map((s) => ({ k: "Sunset", at: new Date(s) })),
  ].filter((e) => e.at.getTime() > t).sort((a, b) => a.at - b.at);
  const sun = sunEvents[0] ? `${sunEvents[0].k} <b>${fmtTime(sunEvents[0].at)}</b>` : "";

  now.innerHTML = `${icon(c.weather_code, c.is_day)}
    <div class="temp">${r(c.temperature_2m)}${deg}</div>
    <div class="desc">
      <div class="cond">${describe(c.weather_code)}</div>
      <div class="meta">Feels <b>${r(c.apparent_temperature)}${deg}</b> · H <b>${r(d.temperature_2m_max[0])}${deg}</b> L <b>${r(d.temperature_2m_min[0])}${deg}</b> · Rain <b>${d.precipitation_probability_max[0] ?? 0}%</b></div>
      <div class="meta">Humidity <b>${c.relative_humidity_2m}%</b> · Wind <b>${r(c.wind_speed_10m)} ${speed}</b> · UV <b>${r(d.uv_index_max[0] ?? 0)}</b>${sun ? " · " + sun : ""}</div>
    </div>`;

  // 12 hours starting with the current hour
  const hourStart = new Date(); hourStart.setMinutes(0, 0, 0);
  let i0 = h.time.findIndex((s) => new Date(s).getTime() >= hourStart.getTime());
  if (i0 < 0) i0 = 0;
  const idx = Array.from({ length: 12 }, (_, k) => i0 + k).filter((i) => i < h.time.length);
  const maxWind = Math.max(10, ...idx.map((i) => h.wind_speed_10m[i]));

  list.dataset.mode = mode;
  list.innerHTML = idx.map((i, k) => {
    const when = k === 0 ? "Now" : fmtHour(new Date(h.time[i]));
    let v, frac = 0, barCls = "";
    if (mode === "temp") v = `${r(h.temperature_2m[i])}${deg}`;
    else if (mode === "rain") { const p = h.precipitation_probability[i] ?? 0; v = `${p}%`; frac = p / 100; barCls = "rain"; }
    else if (mode === "wind") { const w = h.wind_speed_10m[i]; v = `${r(w)}`; frac = w / maxWind; }
    else { const u = h.relative_humidity_2m[i]; v = `${u}%`; frac = u / 100; }
    return `<li class="hour${k === 0 ? " now" : ""}">
      <span class="h">${when}</span>
      ${icon(h.weather_code[i], h.is_day[i])}
      <span class="bar ${barCls}"><i style="height:${Math.max(4, frac * 100)}%"></i></span>
      <span class="v">${v}</span>
    </li>`;
  }).join("");
}

// ---------------------------------------------------------------- data + controls

async function load() {
  try {
    const res = await fetch("/api/weather", { cache: "no-store" });
    const j = await res.json();
    if (j.configured === false) { $("wx-now").innerHTML = `<div class="desc"><div class="meta">Add a "weather" block to config.json.</div></div>`; return; }
    if (j.error && data) return; // keep last good data
    data = j;
  } catch {
    if (!data) data = { error: true };
  }
  render();
}

export function initWeather() {
  document.querySelectorAll(".seg button").forEach((b) => {
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      render();
    });
  });
  render();
  load();
  setInterval(load, 15 * 60 * 1000);
  setInterval(render, 60 * 1000); // roll the "Now" column over each hour
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}
