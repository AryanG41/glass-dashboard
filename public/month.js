// Month view: a Google-Calendar-style month grid in a glass panel.
// Click a day to see its events; ‹ › (or ← →) change month; Esc closes.

import { eventsForDay } from "./ical.js";

const $ = (id) => document.getElementById(id);
let getIcs = () => null;        // supplied by app.js
let view = null;                // first day of the month being shown
let selected = null;            // selected day (Date at local midnight)

const sameDay = (a, b) => a.toDateString() === b.toDateString();
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function dayEvents(day) {
  const ics = getIcs();
  if (!ics) return [];
  try { return eventsForDay(ics, day); } catch { return []; }
}

// ---------------------------------------------------------------- render

function renderGrid() {
  const today = midnight(new Date());
  $("month-title").textContent = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // Sunday-first grid, always 6 rows so the panel doesn't jump in size
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - first.getDay());

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const evs = dayEvents(d);
    const cls = ["day"];
    if (d.getMonth() !== view.getMonth()) cls.push("other");
    if (sameDay(d, today)) cls.push("today");
    if (selected && sameDay(d, selected)) cls.push("selected");
    if (d < today) cls.push("past");

    const shown = evs.slice(0, 3).map((e) => {
      const time = e.allDay ? "" : `<b>${fmtTime(e.start).replace(":00", "").replace(" ", "").toLowerCase()}</b> `;
      return `<span class="chip${e.allDay ? " allday" : ""}">${time}${esc(e.title)}</span>`;
    }).join("");
    const more = evs.length > 3 ? `<span class="more">+${evs.length - 3} more</span>` : "";

    cells.push(`<button type="button" class="${cls.join(" ")}" data-date="${d.toDateString()}"
      aria-label="${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}, ${evs.length} event${evs.length === 1 ? "" : "s"}">
      <span class="num">${d.getDate()}</span>${shown}${more}</button>`);
  }
  $("month-grid").innerHTML = cells.join("");
}

function renderDetail() {
  const d = selected;
  $("day-dow").textContent = sameDay(d, new Date()) ? "Today" : d.toLocaleDateString(undefined, { weekday: "long" });
  $("day-date").textContent = d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

  const list = $("day-events");
  if (!getIcs()) {
    list.innerHTML = `<li class="empty">Calendar not connected.</li>`;
    return;
  }
  const evs = dayEvents(d);
  if (!evs.length) {
    list.innerHTML = `<li class="empty"><span class="big">☼</span>Nothing scheduled.</li>`;
    return;
  }
  const shortDate = (x) => x.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  list.innerHTML = evs.map((e) => {
    let when;
    if (e.allDay) {
      const lastDay = new Date(e.end.getTime() - 1);
      when = sameDay(e.start, lastDay) ? "All day" : `All day<small>${shortDate(e.start)} – ${shortDate(lastDay)}</small>`;
    } else {
      const startTxt = sameDay(e.start, d) ? fmtTime(e.start) : `From ${shortDate(e.start)}`;
      const endTxt = e.end <= e.start ? "" : sameDay(e.end, d) ? fmtTime(e.end) : `until ${shortDate(e.end)}`;
      when = `${startTxt}<small>${endTxt}</small>`;
    }
    const meta = e.location ? `<div class="meta">${esc(e.location)}</div>` : "";
    return `<li class="event"><span class="bar"></span><div class="when">${when}</div>
      <div class="what"><div class="title">${esc(e.title)}</div>${meta}</div></li>`;
  }).join("");
}

function render() { renderGrid(); renderDetail(); }

// ---------------------------------------------------------------- navigation

function goMonth(delta) {
  view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
  // keep the selection inside the visible month (same day number when possible)
  const dim = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  selected = new Date(view.getFullYear(), view.getMonth(), Math.min(selected.getDate(), dim));
  render();
}

function goToday() {
  selected = midnight(new Date());
  view = new Date(selected.getFullYear(), selected.getMonth(), 1);
  render();
}

export function openMonth() {
  goToday();
  const ov = $("month-overlay");
  ov.hidden = false;
  requestAnimationFrame(() => ov.classList.add("open"));
  $("month-close").focus({ preventScroll: true });
}

function closeMonth() {
  const ov = $("month-overlay");
  ov.classList.remove("open");
  setTimeout(() => { ov.hidden = true; }, 220);
}

const isOpen = () => !$("month-overlay").hidden;

/** Re-render if open (e.g. after the calendar feed refreshes). */
export function refreshMonth() { if (isOpen()) render(); }

export function initMonth(icsGetter) {
  getIcs = icsGetter;
  const names = Array.from({ length: 7 }, (_, i) =>
    new Date(2026, 10, 1 + i).toLocaleDateString(undefined, { weekday: "short" })); // Nov 1 2026 is a Sunday
  $("weekdays").innerHTML = names.map((n) => `<span>${n}</span>`).join("");

  $("open-month").addEventListener("click", openMonth);
  $("month-close").addEventListener("click", closeMonth);
  $("month-prev").addEventListener("click", () => goMonth(-1));
  $("month-next").addEventListener("click", () => goMonth(1));
  $("month-today").addEventListener("click", goToday);

  $("month-grid").addEventListener("click", (e) => {
    const cell = e.target.closest(".day");
    if (!cell) return;
    selected = new Date(cell.dataset.date);
    if (selected.getMonth() !== view.getMonth()) view = new Date(selected.getFullYear(), selected.getMonth(), 1);
    render();
  });

  // click on the dimmed backdrop closes
  $("month-overlay").addEventListener("click", (e) => { if (e.target.id === "month-overlay") closeMonth(); });

  // scroll wheel over the grid flips months
  let wheelLock = 0;
  $("month-grid").addEventListener("wheel", (e) => {
    e.preventDefault();
    if (Date.now() < wheelLock || Math.abs(e.deltaY) < 20) return;
    wheelLock = Date.now() + 350;
    goMonth(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  if (location.hash === "#month") openMonth();

  document.addEventListener("keydown", (e) => {
    if (!isOpen()) return;
    if (e.key === "Escape") closeMonth();
    else if (e.key === "ArrowLeft") goMonth(-1);
    else if (e.key === "ArrowRight") goMonth(1);
    else if (e.key === "t" || e.key === "T") goToday();
  });
}
