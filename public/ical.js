// Minimal iCalendar (.ics) reader: finds the events that overlap a given local day.
// Handles: timed + all-day events, TZID times (via the browser's Intl time-zone data),
// RRULE (DAILY / WEEKLY / MONTHLY / YEARLY with INTERVAL, COUNT, UNTIL, BYDAY,
// BYMONTHDAY, BYMONTH), EXDATE, moved/cancelled single instances (RECURRENCE-ID).
// Not handled: BYSETPOS, BYWEEKNO, BYYEARDAY, hourly/minutely rules.

const DAY_MS = 86400000;
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function unescapeText(s) {
  return s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function parseEvents(text) {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const colon = indexOfUnquoted(line, ":");
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = head.split(";");
    const params = {};
    for (const p of paramParts) {
      const eq = p.indexOf("=");
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    const key = name.toUpperCase();
    (cur[key] = cur[key] || []).push({ params, value });
  }
  return events;
}

function indexOfUnquoted(s, ch) {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') q = !q;
    else if (s[i] === ch && !q) return i;
  }
  return -1;
}

// ---- time handling -------------------------------------------------------

function parseDateValue(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const allDay = params.VALUE === "DATE" || m[4] === undefined;
  return {
    allDay,
    y: +m[1], mo: +m[2], d: +m[3],
    h: allDay ? 0 : +m[4], mi: allDay ? 0 : +m[5], s: allDay ? 0 : +(m[6] || 0),
    tz: m[7] ? "UTC" : (params.TZID || null),
  };
}

const offsetCache = new Map();
function tzFormatter(tz) {
  if (!offsetCache.has(tz)) {
    let f = null;
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
    } catch { f = null; } // unknown zone name -> treat as local time
    offsetCache.set(tz, f);
  }
  return offsetCache.get(tz);
}

function tzOffsetMs(utcMs, fmt) {
  const parts = {};
  for (const p of fmt.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - utcMs;
}

// Wall-clock time in a zone -> real instant (ms since epoch).
function wallToInstant(y, mo, d, h, mi, s, tz) {
  if (tz === "UTC") return Date.UTC(y, mo - 1, d, h, mi, s);
  const fmt = tz ? tzFormatter(tz) : null;
  if (!fmt) return new Date(y, mo - 1, d, h, mi, s).getTime();
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - tzOffsetMs(guess, fmt);
  t = guess - tzOffsetMs(t, fmt); // second pass settles DST edges
  return t;
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v || "");
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * DAY_MS) + ((+m[3] || 0) * DAY_MS) +
    ((+m[4] || 0) * 3600000) + ((+m[5] || 0) * 60000) + ((+m[6] || 0) * 1000);
  return m[1] === "-" ? -ms : ms;
}

// ---- recurrence ----------------------------------------------------------

function parseRule(v) {
  const r = {};
  for (const part of v.split(";")) {
    const [k, val] = part.split("=");
    r[k.toUpperCase()] = val;
  }
  return {
    freq: r.FREQ,
    interval: Math.max(1, +(r.INTERVAL || 1)),
    count: r.COUNT ? +r.COUNT : null,
    until: r.UNTIL || null,
    byday: r.BYDAY ? r.BYDAY.split(",").map((x) => {
      const mm = /^([+-]?\d+)?([A-Z]{2})$/.exec(x.trim());
      return mm ? { n: mm[1] ? +mm[1] : 0, wd: WD[mm[2]] } : null;
    }).filter(Boolean) : null,
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : null,
    bymonth: r.BYMONTH ? r.BYMONTH.split(",").map(Number) : null,
  };
}

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

function dayMatchesWithinMonth(dt, rule, startDate) {
  const d = dt.getUTCDate(), dow = dt.getUTCDay();
  const dim = daysInMonth(dt.getUTCFullYear(), dt.getUTCMonth() + 1);
  if (rule.bymonthday) {
    return rule.bymonthday.some((n) => (n > 0 ? n === d : dim + n + 1 === d));
  }
  if (rule.byday) {
    return rule.byday.some(({ n, wd }) => {
      if (wd !== dow) return false;
      if (n === 0) return true;
      if (n > 0) return Math.ceil(d / 7) === n;
      return Math.floor((dim - d) / 7) === -n - 1;
    });
  }
  return d === startDate.getUTCDate();
}

function dayMatches(dayMs, startDayMs, rule) {
  const dt = new Date(dayMs), st = new Date(startDayMs);
  const diffDays = Math.round((dayMs - startDayMs) / DAY_MS);
  switch (rule.freq) {
    case "DAILY":
      if (diffDays % rule.interval) return false;
      if (rule.bymonth && !rule.bymonth.includes(dt.getUTCMonth() + 1)) return false;
      return !rule.byday || rule.byday.some((b) => b.wd === dt.getUTCDay());
    case "WEEKLY": {
      const week = Math.floor((diffDays + ((st.getUTCDay() + 6) % 7)) / 7); // weeks start Monday
      if (week % rule.interval) return false;
      const days = rule.byday ? rule.byday.map((b) => b.wd) : [st.getUTCDay()];
      return days.includes(dt.getUTCDay());
    }
    case "MONTHLY": {
      const months = (dt.getUTCFullYear() - st.getUTCFullYear()) * 12 + dt.getUTCMonth() - st.getUTCMonth();
      if (months % rule.interval) return false;
      return dayMatchesWithinMonth(dt, rule, st);
    }
    case "YEARLY": {
      const years = dt.getUTCFullYear() - st.getUTCFullYear();
      if (years % rule.interval) return false;
      const months = rule.bymonth || [st.getUTCMonth() + 1];
      if (!months.includes(dt.getUTCMonth() + 1)) return false;
      if (!rule.bymonthday && !rule.byday) return dt.getUTCDate() === st.getUTCDate();
      return dayMatchesWithinMonth(dt, rule, st);
    }
    default:
      return false;
  }
}

// ---- main entry ----------------------------------------------------------

const parseCache = { text: null, raw: null };

/**
 * @param {string} text  raw .ics
 * @param {Date} day     any time on the local day you want
 * @returns {{title:string, location:string, start:Date, end:Date, allDay:boolean}[]}
 */
export function eventsForDay(text, day = new Date()) {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  // The month view asks for ~42 days at once; parse the file only once per text.
  if (parseCache.text !== text) { parseCache.text = text; parseCache.raw = parseEvents(text); }
  const raw = parseCache.raw;
  const get = (ev, k) => (ev[k] ? ev[k][0] : null);

  // Instances that were moved or cancelled individually.
  const overridden = new Map(); // uid -> Set of instant ms
  for (const ev of raw) {
    const rid = get(ev, "RECURRENCE-ID");
    const uid = get(ev, "UID");
    if (!rid || !uid) continue;
    const p = parseDateValue(rid.value, rid.params);
    if (!p) continue;
    const t = wallToInstant(p.y, p.mo, p.d, p.h, p.mi, p.s, p.allDay ? null : p.tz);
    if (!overridden.has(uid.value)) overridden.set(uid.value, new Set());
    overridden.get(uid.value).add(t);
  }

  const out = [];
  for (const ev of raw) {
    const status = get(ev, "STATUS");
    if (status && status.value.toUpperCase() === "CANCELLED") continue;
    const ds = get(ev, "DTSTART");
    if (!ds) continue;
    const s = parseDateValue(ds.value, ds.params);
    if (!s) continue;
    const tz = s.allDay ? null : s.tz;
    const startInstant = wallToInstant(s.y, s.mo, s.d, s.h, s.mi, s.s, tz);

    let duration;
    const de = get(ev, "DTEND");
    const du = get(ev, "DURATION");
    if (de) {
      const e = parseDateValue(de.value, de.params);
      duration = e ? wallToInstant(e.y, e.mo, e.d, e.h, e.mi, e.s, e.allDay ? null : e.tz) - startInstant : 0;
    } else if (du) {
      duration = parseDuration(du.value) || 0;
    } else {
      duration = s.allDay ? DAY_MS : 0;
    }
    if (s.allDay) duration = Math.max(DAY_MS, Math.round(duration / DAY_MS) * DAY_MS);

    const base = {
      title: unescapeText(get(ev, "SUMMARY")?.value || "(No title)"),
      location: unescapeText(get(ev, "LOCATION")?.value || ""),
      allDay: s.allDay,
    };

    const emit = (wallDayMs) => {
      const w = new Date(wallDayMs);
      const st = wallToInstant(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), s.h, s.mi, s.s, tz);
      const en = s.allDay
        ? wallToInstant(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate() + Math.round(duration / DAY_MS), 0, 0, 0, null)
        : st + duration;
      return { st, en };
    };
    const overlapsToday = ({ st, en }) => st < dayEnd && Math.max(en, st + 1) > dayStart;

    const rr = get(ev, "RRULE");
    if (!rr || get(ev, "RECURRENCE-ID")) {
      const occ = emit(Date.UTC(s.y, s.mo - 1, s.d));
      if (overlapsToday(occ)) out.push({ ...base, start: new Date(occ.st), end: new Date(occ.en) });
      continue;
    }

    const rule = parseRule(rr.value);
    if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(rule.freq)) continue;
    let untilMs = Infinity;
    if (rule.until) {
      const u = parseDateValue(rule.until, {});
      if (u) untilMs = u.allDay
        ? wallToInstant(u.y, u.mo, u.d, 23, 59, 59, null)
        : wallToInstant(u.y, u.mo, u.d, u.h, u.mi, u.s, u.tz || tz);
    }
    if (untilMs < dayStart - DAY_MS * 2) continue;

    const exdates = new Set();
    for (const ex of ev.EXDATE || []) {
      for (const v of ex.value.split(",")) {
        const p = parseDateValue(v, ex.params);
        if (p) exdates.add(wallToInstant(p.y, p.mo, p.d, p.h, p.mi, p.s, p.allDay ? null : (p.tz || tz)));
      }
    }
    const uid = get(ev, "UID")?.value;
    const skip = (uid && overridden.get(uid)) || new Set();

    const startDay = Date.UTC(s.y, s.mo - 1, s.d);
    const lastDay = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const lookback = Math.ceil(duration / DAY_MS) + 1; // multi-day events that began earlier
    // A series can have several instances overlapping today when each instance is
    // longer than the repeat gap; show just one: the one starting today, else the
    // most recent one still running.
    let count = 0, pick = null;
    for (let d = startDay; d <= lastDay; d += DAY_MS) {
      if (d !== startDay && !dayMatches(d, startDay, rule)) continue;
      const occ = emit(d);
      if (occ.st > untilMs) break;
      count++;
      if (rule.count && count > rule.count) break;
      if (d < lastDay - (lookback + 1) * DAY_MS) continue;
      if (exdates.has(occ.st) || skip.has(occ.st)) continue;
      if (!overlapsToday(occ)) continue;
      const startsToday = occ.st >= dayStart;
      if (!pick || startsToday || !pick.startsToday) pick = { ...occ, startsToday };
      if (startsToday) break;
    }
    if (pick) out.push({ ...base, start: new Date(pick.st), end: new Date(pick.en) });
  }

  out.sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start) || a.title.localeCompare(b.title));
  return out;
}
