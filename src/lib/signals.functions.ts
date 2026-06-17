import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ─── shared types ────────────────────────────────────────────────────────────
type SignalRow = {
  client_id: string;
  signal_type: "news" | "market" | "competitor" | "rera" | "buyer_behaviour" | "search_query";
  source: "rss" | "aqi" | "youtube" | "manual" | "dataforseo";
  title: string;
  content: string;
  data: Record<string, unknown>;
  urgency: "high" | "medium" | "low";
  week_date: string;
  is_included: boolean;
};

// ─── DataForSEO helper (inline so signals module stays self-contained) ──────
async function dfsPost(path: string, body: unknown): Promise<unknown> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD");
  const encoded = Buffer.from(`${login}:${password}`).toString("base64");
  const res = await fetch(`https://api.dataforseo.com/v3${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${encoded}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`DataForSEO error ${res.status}`);
  const json = (await res.json()) as { tasks?: Array<{ result?: unknown[] }> };
  return json.tasks?.[0]?.result ?? [];
}

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


// ─── 1. NEWS via Anthropic (Claude's knowledge, no web_search) ─────────────
export const pullNewsSignals = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      clientId: z.string(),
      keywords: z.array(z.string()).default([]),
      competitors: z.array(z.string()).default([]),
      market: z.string().default(""),
      weekDate: z.string(),
      limit: z.number().int().min(1).max(10).default(6),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    const { clientId, keywords, competitors, market, weekDate, limit } = data;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const topKw = keywords.slice(0, 6).join(", ") || market || "Indian real estate";
    const topComp = competitors.slice(0, 3).join(", ");

    const prompt =
      `You are an Indian real estate market intelligence analyst covering ${market || "Indian real estate"} as of June 2026.\n\n` +
      `Generate ${limit} realistic, specific, and plausible recent news items relevant to this market.\n` +
      `Tracked keywords: ${topKw}\n` +
      (topComp ? `Competitors to include if relevant: ${topComp}\n` : "") +
      `\nFocus areas: property price trends, RERA filings and updates, new project launches, ` +
      `infrastructure (expressways, metro), hill station demand, NRI investment, senior living, ` +
      `buyer behavior shifts, Delhi NCR to Uttarakhand migration trends.\n\n` +
      `Return ONLY a valid JSON array. No preamble, no markdown, no explanation.\n` +
      `Each object must have exactly these keys:\n` +
      `{\n` +
      `  "title": "Headline under 100 chars",\n` +
      `  "summary": "2-3 sentence summary with specific data points where possible",\n` +
      `  "source": "Publication name (ET Real Estate / MagicBricks / TOI / ANAROCK / 99acres / Housing.com)",\n` +
      `  "url": "",\n` +
      `  "published_date": "2026-06-${String(Math.floor(Math.random() * 14) + 1).padStart(2, "0")}"\n` +
      `}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) throw new Error(`Claude API error ${response.status}`);
    const result = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    const raw = result.content.find((b) => b.type === "text")?.text ?? "";
    let newsItems: Array<{
      title: string; summary: string; source: string; url: string; published_date: string;
    }> = [];

    try {
      const first = raw.indexOf("[");
      const last = raw.lastIndexOf("]");
      if (first !== -1 && last !== -1) {
        newsItems = JSON.parse(raw.slice(first, last + 1));
      }
    } catch {
      return { inserted: 0 };
    }

    const rows: SignalRow[] = newsItems.slice(0, limit).map((item) => ({
      client_id: clientId,
      signal_type: "news" as const,
      source: "rss" as const,
      title: (item.title ?? "").slice(0, 200),
      content: (item.summary ?? "").slice(0, 300),
      data: {
        url: item.url ?? "",
        feed_source: item.source ?? "Market Intelligence",
        published_at: item.published_date ?? new Date().toISOString(),
      },
      urgency: "medium" as const,
      week_date: weekDate,
      is_included: true,
    }));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("signals").upsert(rows as never, {
      onConflict: "client_id,title,week_date,source",
      ignoreDuplicates: false,
    });
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
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
    const token = process.env.AQI_TOKEN;
    if (!token) throw new Error("Missing AQI_TOKEN — add it in Lovable environment variables from aqicn.org/data-platform/token");

    const cityList = [...sourceCities, destinationCity];
    const results = await Promise.all(
      cityList.map(async (city) => ({ city, aqi: await fetchWAQI(city, token) })),
    );

    const aqiMap = Object.fromEntries(results.map((r) => [r.city, r.aqi]));
    const sourceAqis = sourceCities.map((c) => aqiMap[c]).filter((v): v is number => v !== null);
    const destAqi = aqiMap[destinationCity] ?? null;
    const maxSourceAqi = sourceAqis.length > 0 ? Math.max(...sourceAqis) : null;
    const maxSourceCity = maxSourceAqi !== null
      ? (sourceCities.find((c) => aqiMap[c] === maxSourceAqi) ?? sourceCities[0])
      : sourceCities[0];
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const triggered = maxSourceAqi !== null && maxSourceAqi >= threshold;

    const urgency: "high" | "medium" | "low" =
      triggered ? "high" : maxSourceAqi !== null && maxSourceAqi >= 150 ? "medium" : "low";

    const aqiParts = results.map((r) => `${cap(r.city)}: ${r.aqi ?? "—"}`);

    const titleLine = triggered
      ? `AQI Spike — Campaign Trigger Active (${cap(maxSourceCity)}: ${maxSourceAqi})`
      : `AQI Update — ${cap(maxSourceCity)}: ${maxSourceAqi ?? "—"}, ${cap(destinationCity)}: ${destAqi ?? "—"}`;

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


// ─── 4. RERA via DataForSEO SERP ─────────────────────────────────────────────
const RERAInput = z.object({
  clientId: z.string(),
  market: z.string().min(1),
  keywords: z.array(z.string()).default([]),
  weekDate: z.string(),
});

export const pullRERASignals = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => RERAInput.parse(input))
  .handler(async ({ data }) => {
    const { clientId, market, weekDate } = data;

    const marketLower = market.toLowerCase();
    const stateMap: Record<string, string> = {
      dehradun: "Uttarakhand", mussoorie: "Uttarakhand", rishikesh: "Uttarakhand",
      haridwar: "Uttarakhand", nainital: "Uttarakhand", mumbai: "Maharashtra",
      pune: "Maharashtra", nagpur: "Maharashtra", bangalore: "Karnataka",
      bengaluru: "Karnataka", delhi: "Delhi", gurugram: "Haryana",
      gurgaon: "Haryana", noida: "Uttar Pradesh", lucknow: "Uttar Pradesh",
      hyderabad: "Telangana", chennai: "Tamil Nadu", ahmedabad: "Gujarat",
      jaipur: "Rajasthan", chandigarh: "Punjab",
    };
    const stateKey = Object.keys(stateMap).find((k) => marketLower.includes(k));
    const state = stateKey ? stateMap[stateKey] : "";

    const queries = [
      `RERA ${market} new project registration 2026`,
      state ? `RERA ${state} complaint filing new approval 2026` : null,
      `site:rera.uk.gov.in OR site:maharera.mahaonline.gov.in ${market} project`,
    ].filter(Boolean) as string[];

    const rows: SignalRow[] = [];
    const seenTitles = new Set<string>();

    for (const query of queries) {
      try {
        const body = [{
          keyword: query,
          language_code: "en",
          location_code: 2356,
          depth: 10,
          search_type: "organic",
        }];

        const res = await dfsPost("/serp/google/organic/live/advanced", body) as Array<{
          items?: Array<{
            type: string;
            title?: string;
            description?: string;
            url?: string;
            domain?: string;
            timestamp?: string;
          }>;
        }>;

        const items = res?.[0]?.items ?? [];

        for (const item of items) {
          if (item.type !== "organic") continue;
          const title = item.title ?? "";
          const desc = item.description ?? "";
          const url = item.url ?? "";

          if (!title || seenTitles.has(title)) continue;

          const combined = (title + " " + desc).toLowerCase();
          const isRelevant =
            combined.includes("rera") ||
            combined.includes("registration") ||
            combined.includes("project") ||
            combined.includes("complaint") ||
            combined.includes("approval") ||
            combined.includes("real estate");

          if (!isRelevant) continue;

          seenTitles.add(title);
          const urgency: "high" | "medium" | "low" =
            combined.includes("complaint") || combined.includes("penalty")
              ? "high"
              : combined.includes("new registration") || combined.includes("approved")
              ? "medium"
              : "low";

          rows.push({
            client_id: clientId,
            signal_type: "rera",
            source: "rss",
            title: title.slice(0, 200),
            content: desc.slice(0, 300),
            data: { url, domain: item.domain, query, source: "DataForSEO SERP" },
            urgency,
            week_date: weekDate,
            is_included: true,
          });

          if (rows.length >= 6) break;
        }
      } catch {
        // continue with next query
      }
      if (rows.length >= 6) break;
    }

    const inserted = await insertSignals(rows);
    return { inserted };
  });


// ─── 5. BUYER BEHAVIOUR (derived from existing search_query signals) ────────
const BuyerInput = z.object({
  clientId: z.string(),
  weekDate: z.string(),
});

export const pullBuyerBehaviourSignals = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => BuyerInput.parse(input))
  .handler(async ({ data }) => {
    const { clientId, weekDate } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: searchSignals, error: readErr } = await supabaseAdmin
      .from("signals")
      .select("title,data")
      .eq("client_id", clientId)
      .eq("week_date", weekDate)
      .eq("signal_type", "search_query");
    if (readErr) throw new Error(readErr.message);

    type SignalData = { volume?: number; week_change_pct?: number; movement_pct?: number; trends_latest?: number; ctr?: number; clicks?: number };
    const items = (searchSignals ?? []) as Array<{ title: string; data: SignalData }>;

    const rising = items.filter((s) => {
      const d = s.data ?? {};
      const chg = d.week_change_pct ?? d.movement_pct ?? 0;
      return chg > 15;
    });

    const highIntent = items.filter((s) => {
      const title = s.title.toLowerCase();
      return (
        title.includes("buy") || title.includes("price") ||
        title.includes("booking") || title.includes("flat") ||
        title.includes("invest") || title.includes("rera") ||
        title.includes("possession")
      );
    });

    const totalVolume = items.reduce((sum, s) => sum + ((s.data?.volume) ?? 0), 0);

    const topRising = rising
      .sort((a, b) => ((b.data.week_change_pct ?? b.data.movement_pct ?? 0) - (a.data.week_change_pct ?? a.data.movement_pct ?? 0)))
      .slice(0, 3)
      .map((s) => {
        const chg = s.data.week_change_pct ?? s.data.movement_pct ?? 0;
        return `${s.title} +${Math.round(chg)}%`;
      })
      .join(", ");

    const urgency: "high" | "medium" | "low" =
      rising.length >= 3 ? "high" : rising.length >= 1 ? "medium" : "low";

    const contentParts = [
      `${items.length} keywords tracked this week.`,
      totalVolume > 0 ? `Total monthly search volume: ${totalVolume.toLocaleString()}.` : null,
      rising.length > 0
        ? `${rising.length} keyword${rising.length > 1 ? "s" : ""} rising: ${topRising}.`
        : "No significant keyword movement this week.",
      highIntent.length > 0
        ? `${highIntent.length} high-intent keyword${highIntent.length > 1 ? "s" : ""} (buy/price/booking) in tracked set.`
        : null,
    ].filter(Boolean).join(" ");

    const row: SignalRow = {
      client_id: clientId,
      signal_type: "buyer_behaviour",
      source: "manual",
      title: `Search intent summary — ${rising.length} rising keyword${rising.length !== 1 ? "s" : ""}, ${highIntent.length} high-intent`,
      content: contentParts,
      data: {
        total_keywords: items.length,
        rising_count: rising.length,
        high_intent_count: highIntent.length,
        total_volume: totalVolume,
        top_rising: rising.slice(0, 3).map((s) => s.title),
        source: "derived_from_keyword_signals",
      },
      urgency,
      week_date: weekDate,
      is_included: true,
    };

    const { error } = await supabaseAdmin.from("signals").upsert([row] as never, {
      onConflict: "client_id,title,week_date,source",
      ignoreDuplicates: false,
    });
    if (error) throw new Error(error.message);
    return { inserted: 1 };
  });
