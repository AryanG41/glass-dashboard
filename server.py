"""Glass Dashboard - tiny local server (Python standard library only).

Serves the page in ./public plus a few JSON/text endpoints:
  /api/config    -> name, ticker labels, which cards are set up
  /api/stocks    -> recent daily closes + quote info per ticker (Yahoo Finance, no key)
  /api/weather   -> forecast for your location (Open-Meteo, no key)
  /api/calendar  -> your calendar(s) as raw .ics text (iCal links and/or local .ics files)

The browser can't call those services directly (CORS), so this proxies and caches them.
Binds to 127.0.0.1 only. If the port is already taken (dashboard already running),
it exits quietly.

Settings live in config.json (created from config.example.json on first run).
"""

import json
import os
import shutil
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
CONFIG_PATH = os.path.join(ROOT, "config.json")
EXAMPLE_CONFIG_PATH = os.path.join(ROOT, "config.example.json")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GlassDashboard/1.0"

STOCK_TTL = 60            # seconds
CALENDAR_TTL = 5 * 60     # seconds
WEATHER_TTL = 10 * 60     # seconds
GEOCODE_TTL = 24 * 3600   # seconds

_cache = {}
_lock = threading.Lock()


# ---------------------------------------------------------------- helpers

def load_config():
    if not os.path.exists(CONFIG_PATH) and os.path.exists(EXAMPLE_CONFIG_PATH):
        shutil.copyfile(EXAMPLE_CONFIG_PATH, CONFIG_PATH)
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def http_get(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def cached(key, ttl, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _lock:
        _cache[key] = (now, value)
    return value


# ---------------------------------------------------------------- stocks

def fetch_quote(symbol):
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        + urllib.parse.quote(symbol)
        + "?range=1mo&interval=1d"
    )
    data = json.loads(http_get(url))
    res = data["chart"]["result"][0]
    meta = res["meta"]
    stamps = res.get("timestamp") or []
    closes = (res.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
    points = [(t, c) for t, c in zip(stamps, closes) if c is not None]
    period = meta.get("currentTradingPeriod", {}).get("regular", {})
    return {
        "symbol": symbol,
        "longName": meta.get("longName") or meta.get("shortName"),
        "currency": meta.get("currency"),
        "price": meta.get("regularMarketPrice"),
        "marketTime": meta.get("regularMarketTime"),
        "high52": meta.get("fiftyTwoWeekHigh"),
        "low52": meta.get("fiftyTwoWeekLow"),
        "regularStart": period.get("start"),
        "regularEnd": period.get("end"),
        "timestamps": [p[0] for p in points],
        "closes": [p[1] for p in points],
    }


def get_stocks():
    out = []
    for t in load_config().get("tickers", []):
        sym = t["symbol"]
        t = {"label": sym, **t}
        try:
            q = cached("q:" + sym, STOCK_TTL, lambda s=sym: fetch_quote(s))
            out.append({**t, "ok": True, **q, "symbol": sym})
        except Exception as e:  # keep the other cards alive
            out.append({**t, "ok": False, "error": str(e)})
    return out


# ---------------------------------------------------------------- weather

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}


def geocode(place):
    """'Austin, TX' / 'London, UK' / 'Paris' -> (lat, lon) via Open-Meteo geocoding."""
    parts = [p.strip() for p in place.split(",") if p.strip()]
    if not parts:
        raise ValueError("weather.place is empty")
    url = "https://geocoding-api.open-meteo.com/v1/search?" + urllib.parse.urlencode(
        {"name": parts[0], "count": 20, "language": "en", "format": "json"})
    results = json.loads(http_get(url)).get("results") or []
    if not results:
        raise ValueError("couldn't find a place called %r" % place)
    if len(parts) > 1:
        want = [p.lower() for p in parts[1:]]
        want += [US_STATES[p.upper()].lower() for p in parts[1:] if p.upper() in US_STATES]
        for r in results:
            fields = {str(r.get(k, "")).lower() for k in ("admin1", "admin2", "country", "country_code")}
            if any(w in fields for w in want):
                return r["latitude"], r["longitude"]
    return results[0]["latitude"], results[0]["longitude"]


def fetch_weather(w):
    """Open-Meteo forecast (free, no API key)."""
    fahrenheit = w.get("units", "fahrenheit") == "fahrenheit"
    lat, lon = w.get("latitude"), w.get("longitude")
    if lat is None or lon is None:
        lat, lon = cached("geo:" + w.get("place", ""), GEOCODE_TTL, lambda: geocode(w.get("place", "")))
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,apparent_temperature,weather_code,is_day,"
                   "relative_humidity_2m,wind_speed_10m,precipitation",
        "hourly": "temperature_2m,precipitation_probability,weather_code,is_day,"
                  "wind_speed_10m,relative_humidity_2m",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,"
                 "sunrise,sunset,uv_index_max",
        "temperature_unit": "fahrenheit" if fahrenheit else "celsius",
        "wind_speed_unit": "mph" if fahrenheit else "kmh",
        "precipitation_unit": "inch" if fahrenheit else "mm",
        "timezone": "auto",
        "forecast_days": 2,
    }
    url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(params)
    data = json.loads(http_get(url))
    data["place"] = w.get("place", "")
    data["fahrenheit"] = fahrenheit
    return data


# ---------------------------------------------------------------- calendar

def calendar_sources(cfg):
    """ical_url may be one string or a list; each entry is a URL or a path to a local .ics file."""
    src = cfg.get("ical_url", "")
    items = src if isinstance(src, list) else [src]
    return [s.strip() for s in items if isinstance(s, str) and s.strip()]


def read_calendar(source):
    if source.startswith("webcal://"):
        source = "https://" + source[len("webcal://"):]
    if source.startswith(("http://", "https://")):
        return cached("ics:" + source, CALENDAR_TTL, lambda: http_get(source, timeout=15))
    path = source if os.path.isabs(source) else os.path.join(ROOT, source)
    with open(path, "rb") as f:
        return f.read()


# ---------------------------------------------------------------- HTTP

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=PUBLIC, **kw)

    def log_message(self, *args):
        pass  # silent (runs under pythonw)

    def end_headers(self):
        # Never let the browser keep stale copies of the page/scripts.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/health":
            return self.send_json({"ok": True})

        if path == "/api/config":
            cfg = load_config()
            return self.send_json({
                "name": cfg.get("name", ""),
                "tickers": [t.get("label", t["symbol"]) for t in cfg.get("tickers", [])],
                "calendarConfigured": bool(calendar_sources(cfg)),
                "weatherConfigured": bool(cfg.get("weather")),
            })

        if path == "/api/stocks":
            return self.send_json(get_stocks())

        if path == "/api/weather":
            w = load_config().get("weather")
            if not w:
                return self.send_json({"configured": False})
            try:
                key = "wx:%s,%s,%s,%s" % (w.get("place"), w.get("latitude"), w.get("longitude"), w.get("units"))
                return self.send_json(cached(key, WEATHER_TTL, lambda: fetch_weather(w)))
            except Exception as e:
                return self.send_json({"configured": True, "error": str(e)}, status=502)

        if path == "/api/calendar":
            sources = calendar_sources(load_config())
            if not sources:
                return self.send_json({"configured": False})
            parts, errors = [], []
            for s in sources:
                try:
                    parts.append(read_calendar(s))
                except Exception as e:
                    errors.append(str(e))
            if not parts:
                return self.send_json({"configured": True, "error": "; ".join(errors)}, status=502)
            body = b"\r\n".join(parts)  # the page reads every VEVENT, so plain joining works
            self.send_response(200)
            self.send_header("Content-Type", "text/calendar; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        return super().do_GET()


class Server(ThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets two processes share a port; turn it off so a
    # second launch fails to bind and exits instead of running twice.
    allow_reuse_address = False
    daemon_threads = True


def main():
    port = int(load_config().get("port", 47613))
    try:
        server = Server(("127.0.0.1", port), Handler)
    except OSError:
        sys.exit(0)  # already running
    server.serve_forever()


if __name__ == "__main__":
    main()
