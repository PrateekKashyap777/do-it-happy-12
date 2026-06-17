import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ─── shared types ────────────────────────────────────────────────────────────
type SignalRow = {
  client_id: string;
  signal_type: "news" | "market" | "competitor";
  source: "rss" | "aqi" | "youtube";
  title: string;
  content: string;
  data: Record<string, unknown>;
  urgency: "high" | "medium" | "low";
  week_date: string;
  is_included: boolean;
};

async function insertSignals(rows: SignalRow[]) {
  if (rows.length === 0) return 0;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("signals").upsert(rows as never, {
    onConflict: "client_id,title,week_date,source",
    ignoreDuplicates: false,
  });
  if (error) throw new Error(error.message);
  return rows.length;
}

// Minimal RSS/XML extraction without a parser dependency.
function extractTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
}

// ─── 1. NEWS via Google News RSS ─────────────────────────────────────────────
const NewsInput = z.object({
  clientId: z.string(),
  market: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  weekDate: z.string(),
  limit: z.number().int().min(1).max(20).default(8),
});

export const pullNewsSignals = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => NewsInput.parse(input))
  .handler(async ({ data }) => {
    const { clientId, market, keywords, weekDate, limit } = data;
    const query = encodeURIComponent(
      `${market} real estate ${keywords.slice(0, 3).join(" OR ")}`.trim(),
    );
    const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`News RSS error ${res.status}`);
    const xml = await res.text();
    const items = extractTags(xml, "item").slice(0, limit);
    const since = Date.now() - 1000 * 60 * 60 * 24 * 14;
    const rows: SignalRow[] = items.flatMap((item) => {
      const title = stripCdata(extractTags(item, "title")[0] ?? "");
      const link = stripCdata(extractTags(item, "link")[0] ?? "");
      const pub = stripCdata(extractTags(item, "pubDate")[0] ?? "");
      const source = stripCdata(extractTags(item, "source")[0] ?? "");
      const ts = pub ? new Date(pub).getTime() : NaN;
      if (!title || (Number.isFinite(ts) && ts < since)) return [];
      return [{
        client_id: clientId,
        signal_type: "news",
        source: "rss",
        title: title.slice(0, 240),
        content: source ? `${source} — ${pub}` : pub,
        data: { url: link, published_at: pub, publisher: source },
        urgency: "medium",
        week_date: weekDate,
        is_included: true,
      }];
    });
    const inserted = await insertSignals(rows);
    return { inserted };
  });

// ─── 2. AQI via Open-Meteo air-quality (no key required) ─────────────────────
const AQIInput = z.object({
  clientId: z.string(),
  market: z.string().min(1),
  weekDate: z.string(),
});

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  gurgaon: { lat: 28.4595, lng: 77.0266 },
  gurugram: { lat: 28.4595, lng: 77.0266 },
  delhi: { lat: 28.6139, lng: 77.209 },
  noida: { lat: 28.5355, lng: 77.391 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  pune: { lat: 18.5204, lng: 73.8567 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  chennai: { lat: 13.0827, lng: 80.2707 },
  kolkata: { lat: 22.5726, lng: 88.3639 },
};

function resolveCoords(market: string): { lat: number; lng: number } {
  const key = market.toLowerCase().split(/[\s,]+/).find((p) => CITY_COORDS[p]);
  return (key && CITY_COORDS[key]) || CITY_COORDS.gurgaon;
}

export const checkAQISignal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AQIInput.parse(input))
  .handler(async ({ data }) => {
    const { clientId, market, weekDate } = data;
    const { lat, lng } = resolveCoords(market);
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi,pm2_5,pm10`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`AQI error ${res.status}`);
    const json = (await res.json()) as {
      current?: { us_aqi?: number; pm2_5?: number; pm10?: number; time?: string };
    };
    const aqi = json.current?.us_aqi;
    if (aqi === undefined || aqi === null) return { inserted: 0 };
    const urgency: "high" | "medium" | "low" =
      aqi >= 150 ? "high" : aqi >= 100 ? "medium" : "low";
    const label =
      aqi >= 200 ? "Very Unhealthy"
      : aqi >= 150 ? "Unhealthy"
      : aqi >= 100 ? "Unhealthy for Sensitive Groups"
      : aqi >= 50 ? "Moderate"
      : "Good";
    const rows: SignalRow[] = [{
      client_id: clientId,
      signal_type: "market",
      source: "aqi",
      title: `${market} AQI ${Math.round(aqi)} — ${label}`,
      content: `PM2.5 ${json.current?.pm2_5 ?? "—"} µg/m³ · PM10 ${json.current?.pm10 ?? "—"} µg/m³ (as of ${json.current?.time ?? "now"})`,
      data: { aqi, pm2_5: json.current?.pm2_5, pm10: json.current?.pm10, label, lat, lng },
      urgency,
      week_date: weekDate,
      is_included: true,
    }];
    const inserted = await insertSignals(rows);
    return { inserted, aqi, label };
  });

// ─── 3. YOUTUBE competitor activity via YouTube search RSS ───────────────────
const YTInput = z.object({
  clientId: z.string(),
  competitors: z.array(z.string()).min(1),
  weekDate: z.string(),
  perCompetitor: z.number().int().min(1).max(5).default(2),
});

export const pullYouTubeCompetitors = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => YTInput.parse(input))
  .handler(async ({ data }) => {
    const { clientId, competitors, weekDate, perCompetitor } = data;
    const since = Date.now() - 1000 * 60 * 60 * 24 * 14;
    const all: SignalRow[] = [];
    // YouTube exposes a per-query RSS via a search page wrapper isn't stable;
    // use the public search-feed endpoint that returns Atom XML.
    for (const comp of competitors.slice(0, 8)) {
      const q = encodeURIComponent(`${comp} real estate`);
      const url = `https://www.youtube.com/feeds/videos.xml?search_query=${q}`;
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!res.ok) continue;
        const xml = await res.text();
        const entries = extractTags(xml, "entry").slice(0, perCompetitor);
        for (const e of entries) {
          const title = stripCdata(extractTags(e, "title")[0] ?? "");
          const pub = stripCdata(extractTags(e, "published")[0] ?? "");
          const channel = stripCdata(extractTags(e, "name")[0] ?? comp);
          const linkMatch = e.match(/<link[^>]*href="([^"]+)"/);
          const link = linkMatch?.[1] ?? "";
          const ts = pub ? new Date(pub).getTime() : NaN;
          if (!title || (Number.isFinite(ts) && ts < since)) continue;
          all.push({
            client_id: clientId,
            signal_type: "competitor",
            source: "youtube",
            title: `${channel}: ${title}`.slice(0, 240),
            content: `YouTube · ${pub}`,
            data: { url: link, published_at: pub, channel, competitor: comp, platform: "youtube" },
            urgency: "medium",
            week_date: weekDate,
            is_included: true,
          });
        }
      } catch {
        // skip this competitor; surface aggregate via Promise.allSettled at caller
      }
    }
    const inserted = await insertSignals(all);
    return { inserted };
  });
