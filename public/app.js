import { eventsForDay } from "./ical.js";
import { initWeather } from "./weather.js";
import { initMonth, refreshMonth } from "./month.js";

const $ = (id) => document.getElementById(id);
const state = { name: "", tickers: [], calendarConfigured: false, icsText: null, calError: null, stocks: null, stocksAt: null };

// ---------------------------------------------------------------- clock

function period(h) {
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

function greetingWord(h) {
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  return "Good evening";
}

let lastDayKey = null;
let lastPeriod = null;
function tick() {
  const now = new Date();
  const h = now.getHours();
  const h12 = h % 12 || 12;
  $("time").textContent = `${h12}:${String(now.getMinutes()).padStart(2, "0")}`;
  $("ampm").textContent = h < 12 ? "AM" : "PM";
  $("seconds").textContent = String(now.getSeconds()).padStart(2, "0");
  $("date").textContent = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const g = greetingWord(h);
  const greet = state.name ? `${g}, <b>${escapeHtml(state.name)}</b>` : g;
  if ($("greeting").innerHTML !== greet) $("greeting").innerHTML = greet;

  const p = period(h);
  if (lastPeriod !== p) {
    lastPeriod = p;
    document.body.dataset.period = p;
    // Match the window's title bar to the top of the background.
    const top = getComputedStyle(document.body).getPropertyValue("--bg-1").trim();
    if (top) $("theme-color").setAttribute("content", top);
  }

  // New day -> re-render calendar for the new date.
  const key = now.toDateString();
  if (lastDayKey && key !== lastDayKey) renderCalendar();
  lastDayKey = key;

  setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
}

// ---------------------------------------------------------------- helpers

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const pct = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
function fmtPrice(v, currency) {
  const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  const n = v.toLocaleString(undefined, opts);
  return currency === "USD" ? `$${n}` : n;
}
function relMinutes(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

// ---------------------------------------------------------------- calendar

async function loadCalendar() {
  if (!state.calendarConfigured) { renderCalendar(); return; }
  try {
    const r = await fetch("/api/calendar", { cache: "no-store" });
    const type = r.headers.get("content-type") || "";
    if (type.includes("json")) {
      const j = await r.json();
      state.calError = j.error ? "Couldn't reach your calendar." : null;
    } else {
      state.icsText = await r.text();
      state.calError = null;
    }
  } catch {
    state.calError = "Couldn't reach your calendar.";
  }
  renderCalendar();
  refreshMonth();
}

function renderCalendar() {
  const list = $("events");
  const count = $("cal-count");
  const note = $("day-note");

  if (!state.calendarConfigured) {
    count.textContent = "not set up";
    note.textContent = "";
    list.innerHTML = `<li class="empty"><span class="big">◌</span>
      Paste your Google Calendar <b>secret iCal address</b><br/>into <code>ical_url</code> in <code>config.json</code>.</li>`;
    return;
  }
  if (!state.icsText) {
    count.textContent = state.calError ? "offline" : "loading";
    list.innerHTML = `<li class="empty">${state.calError ? escapeHtml(state.calError) : "Loading…"}</li>`;
    return;
  }

  let events;
  try { events = eventsForDay(state.icsText, new Date()); }
  catch { list.innerHTML = `<li class="empty">Couldn't read the calendar file.</li>`; return; }

  const now = Date.now();
  const timed = events.filter((e) => !e.allDay);
  const upcoming = timed.filter((e) => e.start.getTime() > now);
  const current = timed.filter((e) => e.start.getTime() <= now && e.end.getTime() > now);
  const nextEv = upcoming[0];

  count.textContent = events.length ? `${events.length} event${events.length > 1 ? "s" : ""}` : "clear";

  if (current.length) note.textContent = `Now: ${current[0].title}`;
  else if (nextEv) note.textContent = `Next up: ${nextEv.title} in ${relMinutes(nextEv.start - now)}`;
  else if (timed.length) note.textContent = "That's everything on today's calendar.";
  else note.textContent = "";

  if (!events.length) {
    list.innerHTML = `<li class="empty"><span class="big">☼</span>Nothing on the calendar today.</li>`;
    return;
  }

  list.innerHTML = events.map((e) => {
    let cls = "event", tag = "", when;
    if (e.allDay) {
      when = `All day`;
    } else {
      const s = e.start.getTime(), en = e.end.getTime();
      const today = new Date().toDateString();
      const shortDate = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const startTxt = e.start.toDateString() === today ? fmtTime(e.start) : `Since ${shortDate(e.start)}`;
      const endTxt = en <= s ? "" : e.end.toDateString() === today ? fmtTime(e.end) : `until ${shortDate(e.end)}`;
      when = `${startTxt}<small>${endTxt}</small>`;
      if (en <= now && en > s || (en === s && s < now)) cls += " past";
      else if (s <= now && en > now) { cls += " now"; tag = `<span class="tag">Now</span>`; }
      else if (e === nextEv) { cls += " next"; tag = `<span class="tag">in ${relMinutes(s - now)}</span>`; }
    }
    const meta = e.location ? `<div class="meta">${escapeHtml(e.location)}</div>` : "";
    return `<li class="${cls}"><span class="bar"></span><div class="when">${when}</div>
      <div class="what"><div class="title">${tag}${escapeHtml(e.title)}</div>${meta}</div></li>`;
  }).join("");
}

// ---------------------------------------------------------------- stocks

function brief(q) {
  const c = q.closes;
  const n = c.length;
  if (n < 2) return "Not enough recent data for a summary yet.";
  const price = q.price ?? c[n - 1];
  const prev = c[n - 2];
  const day = ((price - prev) / prev) * 100;
  const a = Math.abs(day);

  const isLive = q.regularStart && q.regularEnd && Date.now() / 1000 >= q.regularStart && Date.now() / 1000 < q.regularEnd;
  const lastDate = new Date((q.timestamps[n - 1]) * 1000);
  const sameDay = lastDate.toDateString() === new Date().toDateString();
  const when = isLive ? "so far today" : sameDay ? "today" : `on ${lastDate.toLocaleDateString(undefined, { weekday: "long" })}`;

  let verb;
  if (a < 0.25) verb = "Roughly flat";
  else if (day > 0) verb = a < 1 ? "Edged up" : a < 2.5 ? "Rose" : "Jumped";
  else verb = a < 1 ? "Slipped" : a < 2.5 ? "Fell" : "Dropped";
  let s = a < 0.25 ? `${verb} ${when}` : `${verb} ${a.toFixed(1)}% ${when}`;

  // Biggest daily move in the window?
  const moves = [];
  for (let i = 1; i < n; i++) moves.push(Math.abs((c[i] - c[i - 1]) / c[i - 1]) * 100);
  moves[moves.length - 1] = a;
  if (a >= 1 && a >= Math.max(...moves)) s += " — its biggest one-day move this month";
  s += ".";

  const lookback = Math.min(5, n - 1);
  const wk = ((price - c[n - 1 - lookback]) / c[n - 1 - lookback]) * 100;
  const mo = ((price - c[0]) / c[0]) * 100;
  const dir = (v) => (Math.abs(v) < 0.25 ? "flat" : `${v > 0 ? "up" : "down"} ${Math.abs(v).toFixed(1)}%`);
  let ctx = `${cap(dir(wk))} over 5 days, ${dir(mo)} over the month`;

  if (q.high52 && price >= q.high52 * 0.98) ctx += "; near its 52-week high";
  else if (q.low52 && price <= q.low52 * 1.02) ctx += "; near its 52-week low";
  return `${s} ${ctx}.`;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

function sparkline(q) {
  const W = 300, H = 58, pad = 5;
  const c = q.closes.slice();
  if (q.price != null) c[c.length - 1] = q.price;
  const prev = c.length > 1 ? c[c.length - 2] : c[0];
  const min = Math.min(...c, prev), max = Math.max(...c, prev);
  const span = max - min || 1;
  const x = (i) => (c.length === 1 ? W / 2 : (i / (c.length - 1)) * W);
  const y = (v) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const pts = c.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const id = `g-${q.label}`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="currentColor" stop-opacity=".32"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/>
    </linearGradient></defs>
    <line class="base" x1="0" x2="${W}" y1="${y(prev)}" y2="${y(prev)}" vector-effect="non-scaling-stroke"/>
    <path class="area" fill="url(#${id})" d="M${pts[0]} L${pts.join(" L")} L${W},${H} L0,${H} Z"/>
    <polyline class="line" points="${pts.join(" ")}" vector-effect="non-scaling-stroke"/>
    <line class="cross" x1="0" x2="0" y1="0" y2="${H}" vector-effect="non-scaling-stroke" style="display:none"/>
  </svg>
  <span class="enddot" style="left:${(x(c.length - 1) / W) * 100}%;top:${(y(c[c.length - 1]) / H) * 100}%"></span>
  <span class="scrubdot" hidden></span>`;
}

function stockCard(q) {
  if (!q.ok || !q.closes || !q.closes.length) {
    return `<article class="glass stock"><div class="stock-top"><span class="ticker">${escapeHtml(q.label)}</span>
      <span class="company">${escapeHtml(q.name || "")}</span></div>
      <p class="brief" style="margin-top:14px">Quote unavailable right now — will retry shortly.</p></article>`;
  }
  const n = q.closes.length;
  const price = q.price ?? q.closes[n - 1];
  const prev = n > 1 ? q.closes[n - 2] : price;
  const ch = price - prev;
  const p = (ch / prev) * 100;
  const dir = Math.abs(p) < 0.005 ? "flat" : p > 0 ? "up" : "down";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "■";
  const isIndex = q.symbol.startsWith("^");
  return `<article class="glass stock" data-label="${escapeHtml(q.label)}">
    <div class="stock-top"><span class="ticker">${escapeHtml(q.label)}</span><span class="company">${escapeHtml(q.name || q.longName || "")}</span></div>
    <div class="price-row">
      <span class="price">${isIndex ? price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmtPrice(price, q.currency)}</span>
      <span class="chg ${dir}" title="vs previous close"><span class="arrow">${arrow}</span>${pct(p)}</span>
    </div>
    <div class="abs-chg ${dir}">${ch >= 0 ? "+" : "−"}${isIndex ? "" : "$"}${Math.abs(ch).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span>today</span></div>
    <div class="spark ${dir}">${sparkline(q)}</div>
    <p class="brief">${escapeHtml(brief(q))}</p>
  </article>`;
}

function renderStocks() {
  const wrap = $("stocks");
  const n = (state.stocks || state.tickers).length;
  wrap.hidden = n === 0;
  wrap.style.setProperty("--cols", Math.min(Math.max(n, 1), 6));
  if (!state.stocks) {
    wrap.innerHTML = state.tickers.map((t) => `<article class="glass stock skeleton">
      <div class="stock-top"><span class="ticker">${escapeHtml(t)}</span></div>
      <div class="price-row"><span class="price">000.00</span></div><div class="spark"></div>
      <p class="brief">loading loading loading loading</p></article>`).join("");
    return;
  }
  wrap.innerHTML = state.stocks.map(stockCard).join("");
  wireSparkHover();
}

async function loadStocks() {
  try {
    const r = await fetch("/api/stocks", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    state.stocks = await r.json();
    state.stocksAt = new Date();
  } catch {
    /* keep showing the last good data */
  }
  renderStocks();
  renderStatus();
}

function renderStatus() {
  const q = state.stocks?.find((s) => s.ok && s.regularStart);
  const nowS = Date.now() / 1000;
  const live = q && nowS >= q.regularStart && nowS < q.regularEnd;
  const parts = [];
  if (state.stocksAt) parts.push(`Quotes updated ${fmtTime(state.stocksAt)}`);
  if (q) parts.push(live ? "US market open" : "US market closed");
  parts.push("Yahoo Finance · delayed");
  $("status").textContent = parts.join("  ·  ");
}

// Hover: crosshair + tooltip on each sparkline.
function wireSparkHover() {
  const tip = $("tooltip");
  document.querySelectorAll(".stock[data-label]").forEach((card) => {
    const q = state.stocks.find((s) => s.label === card.dataset.label);
    const spark = card.querySelector(".spark");
    const svg = spark.querySelector("svg");
    const cross = svg.querySelector(".cross");
    const dot = spark.querySelector(".scrubdot");
    const c = q.closes.slice();
    if (q.price != null) c[c.length - 1] = q.price;
    const isIndex = q.symbol.startsWith("^");
    // same scale as sparkline()
    const prevClose = c.length > 1 ? c[c.length - 2] : c[0];
    const lo = Math.min(...c, prevClose), hi = Math.max(...c, prevClose), sp = hi - lo || 1;
    const yFrac = (v) => (5 + (1 - (v - lo) / sp) * (58 - 10)) / 58;

    spark.addEventListener("pointermove", (ev) => {
      const rect = spark.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      const i = Math.round(fx * (c.length - 1));
      const xPos = c.length === 1 ? 150 : (i / (c.length - 1)) * 300;
      cross.setAttribute("x1", xPos); cross.setAttribute("x2", xPos);
      cross.style.display = "";
      const d = new Date(q.timestamps[i] * 1000);
      const v = c[i];
      const val = isIndex ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fmtPrice(v, q.currency);
      const chg = i > 0 ? ` <span>${pct(((v - c[i - 1]) / c[i - 1]) * 100)}</span>` : "";
      tip.innerHTML = `<span>${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span><br/><b>${val}</b>${chg}`;
      tip.style.left = `${rect.left + (xPos / 300) * rect.width}px`;
      tip.style.top = `${rect.top}px`;
      tip.hidden = false;
      dot.style.left = `${(xPos / 300) * 100}%`;
      dot.style.top = `${yFrac(v) * 100}%`;
      dot.hidden = false;
      spark.classList.add("scrubbing");
    });
    spark.addEventListener("pointerleave", () => {
      cross.style.display = "none"; tip.hidden = true; dot.hidden = true;
      spark.classList.remove("scrubbing");
    });
  });
}

// ---------------------------------------------------------------- glass highlight follows pointer

document.addEventListener("pointermove", (e) => {
  document.querySelectorAll(".glass").forEach((el) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
});

// ---------------------------------------------------------------- boot

async function boot() {
  try {
    const cfg = await (await fetch("/api/config", { cache: "no-store" })).json();
    state.name = cfg.name || "";
    state.calendarConfigured = !!cfg.calendarConfigured;
    state.tickers = cfg.tickers || [];
    if (cfg.weatherConfigured === false) document.querySelector(".weather").hidden = true;
  } catch { /* offline: keep defaults */ }

  tick();
  initWeather();
  initMonth(() => state.icsText);
  renderStocks();
  renderCalendar();
  loadStocks();
  loadCalendar();

  setInterval(loadStocks, 2 * 60 * 1000);
  setInterval(loadCalendar, 10 * 60 * 1000);
  setInterval(renderCalendar, 30 * 1000); // keep "Now" / "in 12 min" fresh

  // Laptop woke up / window re-shown -> refresh right away.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { loadStocks(); loadCalendar(); }
  });
}

boot();
