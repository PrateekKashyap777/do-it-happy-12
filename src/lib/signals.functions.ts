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

// ─── 1. NEWS via Indian real estate RSS feeds ────────────────────────────────
const REAL_ESTATE_FEEDS = [
  { name: "ET Real Estate", url: "https://economictimes.indiatimes.com/industry/services/property-/-citi-/-land/rssfeeds/20308536.cms" },
  { name: "MagicBricks", url: "https://www.magicbricks.com/blog/feed" },
  { name: "Housing.com", url: "https://housing.com/news/feed" },
  { name: "99acres", url: "https://www.99acres.com/articles/feed" },
];

const NewsInput = z.object({
  clientId: z.string(),
  keywords: z.array(z.string()).default([]),
  competitors: z.array(z.string()).default([]),
  weekDate: z.string(),
  limit: z.number().int().min(1).max(15).default(10),
});

export const pullNewsSignals = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => NewsInput.parse(input))
  .handler(async ({ data }) => {
    const { clientId, keywords, competitors, weekDate, limit } = data;
    const since = Date.now() - 1000 * 60 * 60 * 24 * 7;
    const allTerms = [...keywords, ...competitors].map((t) => t.toLowerCase());

    const feedResults = await Promise.allSettled(
      REAL_ESTATE_FEEDS.map(async (feed) => {
        const res = await fetch(feed.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Terrain/1.0)" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return { items: [] as SignalRow[] };
        const xml = await res.text();
        const items = extractTags(xml, "item");
        const rows: SignalRow[] = [];

        for (const item of items) {
          const title = stripCdata(extractTags(item, "title")[0] ?? "");
          const link = stripCdata(extractTags(item, "link")[0] ?? "");
          const pub = stripCdata(extractTags(item, "pubDate")[0] ?? "");
          const desc = stripCdata(extractTags(item, "description")[0] ?? "");

          if (!title) continue;
          const ts = pub ? new Date(pub).getTime() : NaN;
          if (Number.isFinite(ts) && ts < since) continue;

          if (allTerms.length > 0) {
            const combined = (title + " " + desc).toLowerCase();
            if (!allTerms.some((t) => combined.includes(t))) continue;
          }

          rows.push({
            client_id: clientId,
            signal_type: "news",
            source: "rss",
            title: title.slice(0, 200),
            content: desc.slice(0, 300) || `${feed.name} — ${pub}`,
            data: { url: link, feed_source: feed.name, published_at: pub },
            urgency: "medium",
            week_date: weekDate,
            is_included: true,
          });
        }
        return { items: rows };
      }),
    );

    const allRows: SignalRow[] = [];
    const seenTitles = new Set<string>();
    for (const result of feedResults) {
      if (result.status === "fulfilled") {
        for (const row of result.value.items) {
          if (!seenTitles.has(row.title)) {
            seenTitles.add(row.title);
            allRows.push(row);
          }
        }
      }
    }

    const inserted = await insertSignals(allRows.slice(0, limit));
    return { inserted };
  });

// ─── 2. AQI via WAQI API (source vs destination logic) ───────────────────────
const AQIInput = z.object({
  clientId: z.string(),
  weekDate: z.string(),
  sourceCities: z.array(z.string()).default(["delhi", "gurgaon"]),
  destinationCity: z.string().default("dehradun"),
  threshold: z.number().default(280),
});

const WAQI_CITY_SLUGS: Record<string, string> = {
  delhi: "delhi", gurgaon: "gurgaon", gurugram: "gurgaon",
  noida: "noida", chandigarh: "chandigarh", mumbai: "mumbai",
  pune: "pune", dehradun: "dehradun", bangalore: "bangalore",
  bengaluru: "bangalore", hyderabad: "hyderabad", chennai: "chennai",
};

async function fetchWAQI(city: string, token: string): Promise<number | null> {
  const slug = WAQI_CITY_SLUGS[city.toLowerCase()] ?? city.toLowerCase();
  try {
    const res = await fetch(`https://api.waqi.info/feed/${slug}/?token=${token}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { status: string; data?: { aqi?: number } };
    return json.status === "ok" && typeof json.data?.aqi === "number" ? json.data.aqi : null;
  } catch { return null; }
}

export const checkAQISignal = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AQIInput.parse(input))
  .handler(async ({ data }) => {
    const { clientId, weekDate, sourceCities, destinationCity, threshold } = data;
    const token = process.env.AQI_TOKEN ?? "demo";

    const cityList = [...sourceCities, destinationCity];
    const results = await Promise.all(
      cityList.map(async (city) => ({ city, aqi: await fetchWAQI(city, token) })),
    );

    const aqiMap = Object.fromEntries(results.map((r) => [r.city, r.aqi]));
    const sourceAqis = sourceCities.map((c) => aqiMap[c]).filter((v): v is number => v !== null);
    const destAqi = aqiMap[destinationCity] ?? null;
    const maxSourceAqi = sourceAqis.length > 0 ? Math.max(...sourceAqis) : null;
    const triggered = maxSourceAqi !== null && maxSourceAqi >= threshold;

    const urgency: "high" | "medium" | "low" =
      triggered ? "high" : maxSourceAqi !== null && maxSourceAqi >= 150 ? "medium" : "low";

    const aqiParts = results.map(
      (r) => `${r.city.charAt(0).toUpperCase() + r.city.slice(1)}: ${r.aqi ?? "—"}`,
    );

    const titleLine = triggered
      ? `AQI Spike — Campaign Trigger Active (${sourceCities[0]}: ${maxSourceAqi})`
      : `AQI Update — ${sourceCities[0]}: ${maxSourceAqi ?? "—"}, ${destinationCity}: ${destAqi ?? "—"}`;

    const actionLine = triggered
      ? ` · Threshold exceeded — AQI burst campaign recommended.`
      : "";

    const rows: SignalRow[] = [{
      client_id: clientId,
      signal_type: "market",
      source: "aqi",
      title: titleLine,
      content: aqiParts.join(" · ") + actionLine,
      data: {
        ...Object.fromEntries(results.map((r) => [`${r.city}_aqi`, r.aqi])),
        max_source_aqi: maxSourceAqi,
        destination_aqi: destAqi,
        triggered,
        threshold,
        source_cities: sourceCities,
        destination_city: destinationCity,
      },
      urgency,
      week_date: weekDate,
      is_included: true,
    }];

    const inserted = await insertSignals(rows);
    return { inserted, triggered, maxSourceAqi, destAqi };
  });

// ─── 3. YOUTUBE competitors via Data API v3 (real view counts) ───────────────
const YTInput = z.object({
  clientId: z.string(),
  competitors: z.array(z.string()).min(1),
  marketGeography: z.string().default(""),
  weekDate: z.string(),
  minViews: z.number().default(200),
});

export const pullYouTubeCompetitors = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => YTInput.parse(input))
  .handler(async ({ data }) => {
    const { clientId, competitors, marketGeography, weekDate, minViews } = data;
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error("Missing YOUTUBE_API_KEY");

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows: SignalRow[] = [];

    for (const comp of competitors.slice(0, 6)) {
      try {
        const chRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(comp)}&key=${apiKey}&maxResults=1`,
        );
        const chData = (await chRes.json()) as { items?: Array<{ id?: { channelId?: string } }> };
        const channelId = chData.items?.[0]?.id?.channelId;
        if (!channelId) continue;

        const vRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&type=video&publishedAfter=${sevenDaysAgo}&key=${apiKey}&maxResults=5`,
        );
        const vData = (await vRes.json()) as {
          items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; publishedAt?: string; description?: string } }>;
        };
        if (!vData.items?.length) continue;

        const videoIds = vData.items.map((v) => v.id?.videoId).filter(Boolean).join(",");

        const stRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoIds}&key=${apiKey}`,
        );
        const stData = (await stRes.json()) as {
          items?: Array<{ id?: string; statistics?: { viewCount?: string; likeCount?: string } }>;
        };
        const statsMap = new Map(stData.items?.map((s) => [s.id, s.statistics]) ?? []);

        for (const video of vData.items) {
          const videoId = video.id?.videoId;
          if (!videoId) continue;
          const stats = statsMap.get(videoId);
          const views = parseInt(stats?.viewCount ?? "0", 10);
          if (views < minViews) continue;
          const likes = parseInt(stats?.likeCount ?? "0", 10);
          const title = video.snippet?.title ?? "";
          const published = video.snippet?.publishedAt ?? "";
          const desc = (video.snippet?.description ?? "").slice(0, 150);

          rows.push({
            client_id: clientId,
            signal_type: "competitor",
            source: "youtube",
            title: `${comp}: "${title}"`.slice(0, 240),
            content: `${views.toLocaleString()} views · ${likes.toLocaleString()} likes · ${new Date(published).toLocaleDateString("en-IN")}. ${desc}`,
            data: {
              channel_id: channelId,
              video_id: videoId,
              views,
              likes,
              published_at: published,
              url: `https://www.youtube.com/watch?v=${videoId}`,
              competitor: comp,
              platform: "youtube",
            },
            urgency: views > 10000 ? "high" : views > 2000 ? "medium" : "low",
            week_date: weekDate,
            is_included: true,
          });
        }
      } catch { /* skip failed competitor */ }
    }

    if (marketGeography) {
      try {
        const mktRes = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(marketGeography + " property real estate")}&order=viewCount&publishedAfter=${sevenDaysAgo}&key=${apiKey}&maxResults=5`,
        );
        const mktData = (await mktRes.json()) as {
          items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; publishedAt?: string } }>;
        };
        const mktIds = (mktData.items ?? []).map((v) => v.id?.videoId).filter(Boolean).slice(0, 3).join(",");

        if (mktIds) {
          const mktStRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${mktIds}&key=${apiKey}`,
          );
          const mktStData = (await mktStRes.json()) as {
            items?: Array<{ id?: string; statistics?: { viewCount?: string } }>;
          };
          const mktStatsMap = new Map(mktStData.items?.map((s) => [s.id, s.statistics]) ?? []);

          for (const item of (mktData.items ?? []).slice(0, 3)) {
            const videoId = item.id?.videoId;
            if (!videoId) continue;
            const views = parseInt(mktStatsMap.get(videoId)?.viewCount ?? "0", 10);
            if (views < minViews) continue;

            rows.push({
              client_id: clientId,
              signal_type: "competitor",
              source: "youtube",
              title: `Market: "${item.snippet?.title ?? ""}"`.slice(0, 240),
              content: `${item.snippet?.channelTitle ?? ""} · ${views.toLocaleString()} views · Top in ${marketGeography} this week`,
              data: {
                video_id: videoId,
                views,
                channel: item.snippet?.channelTitle,
                published_at: item.snippet?.publishedAt,
                url: `https://www.youtube.com/watch?v=${videoId}`,
                is_market_video: true,
                platform: "youtube",
              },
              urgency: views > 5000 ? "high" : "medium",
              week_date: weekDate,
              is_included: true,
            });
          }
        }
      } catch { /* market search failure is non-critical */ }
    }

    const inserted = await insertSignals(rows);
    return {
      inserted,
      competitor_videos: rows.filter((r) => !r.data.is_market_video).length,
      market_videos: rows.filter((r) => r.data.is_market_video).length,
    };
  });
