import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DFS_BASE = "https://api.dataforseo.com/v3";

function dfsHeaders(): HeadersInit {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error("Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD");
  const encoded = Buffer.from(`${login}:${password}`).toString("base64");
  return {
    "Content-Type": "application/json",
    Authorization: `Basic ${encoded}`,
  };
}

async function dfsPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${DFS_BASE}${path}`, {
    method: "POST",
    headers: dfsHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DataForSEO error ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    status_code: number;
    status_message: string;
    tasks?: Array<{ result?: unknown[] }>;
  };
  if (json.status_code !== 20000) {
    throw new Error(`DataForSEO: ${json.status_message}`);
  }
  return json.tasks?.[0]?.result ?? [];
}

const PullInput = z.object({
  clientId: z.string(),
  keywords: z.array(z.string()).min(1),
  weekDate: z.string(),
  locationCode: z.number().default(2356),
  languageCode: z.string().default("en"),
});

// ─── KEYWORD VOLUME PULL ─────────────────────────────────────────────────────
export const pullKeywordVolumes = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => PullInput.extend({ keywords: z.array(z.string()).min(1).max(700) }).parse(input))
  .handler(async ({ data }) => {
    const { clientId, keywords, weekDate, locationCode, languageCode } = data;

    const result = (await dfsPost("/keywords_data/google_ads/search_volume/live", [
      { keywords, location_code: locationCode, language_code: languageCode },
    ])) as Array<{
      keyword: string;
      search_volume: number | null;
      competition: number | null;
      competition_level: string | null;
      cpc: number | null;
      monthly_searches: Array<{ year: number; month: number; search_volume: number }> | null;
    }>;

    if (!result || result.length === 0) return { inserted: 0 };

    const signals = result.map((item) => {
      const monthly = item.monthly_searches ?? [];
      const sorted = [...monthly].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
      const len = sorted.length;
      let movementPct: number | null = null;
      if (len >= 2) {
        const prev = sorted[len - 2].search_volume;
        const curr = sorted[len - 1].search_volume;
        if (prev > 0) movementPct = Math.round(((curr - prev) / prev) * 100);
      }

      const urgency =
        movementPct !== null && Math.abs(movementPct) >= 25
          ? "high"
          : movementPct !== null && Math.abs(movementPct) >= 10
          ? "medium"
          : "low";

      return {
        client_id: clientId,
        signal_type: "search_query",
        source: "semrush",
        title: item.keyword,
        content: [
          item.search_volume !== null ? `Monthly volume: ${item.search_volume.toLocaleString()}` : null,
          movementPct !== null ? `MoM change: ${movementPct > 0 ? "+" : ""}${movementPct}%` : null,
          item.competition_level ? `Competition: ${item.competition_level}` : null,
        ]
          .filter(Boolean)
          .join(" | "),
        data: {
          volume: item.search_volume,
          competition: item.competition,
          competition_level: item.competition_level,
          cpc: item.cpc,
          movement_pct: movementPct,
          source_api: "dataforseo_volume",
        },
        urgency,
        week_date: weekDate,
        is_included: true,
      };
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("signals").upsert(signals, {
      onConflict: "client_id,title,week_date,source",
      ignoreDuplicates: false,
    });
    if (error) throw new Error(error.message);
    return { inserted: signals.length };
  });

// ─── GOOGLE TRENDS PULL ──────────────────────────────────────────────────────
export const pullGoogleTrends = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => PullInput.extend({ keywords: z.array(z.string()).min(1).max(50) }).parse(input))
  .handler(async ({ data }) => {
    const { clientId, keywords, weekDate, locationCode, languageCode } = data;

    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 84);
    const dateFrom = fromDate.toISOString().slice(0, 10);
    const dateTo = toDate.toISOString().slice(0, 10);

    const batches: string[][] = [];
    for (let i = 0; i < keywords.length; i += 5) batches.push(keywords.slice(i, i + 5));

    type TrendItem = {
      keyword: string;
      average_value: number;
      values: Array<{ date_from: string; date_to: string; value: number }>;
    };

    const allItems: TrendItem[] = [];
    for (const batch of batches) {
      const result = (await dfsPost("/keywords_data/google_trends/explore/live", [
        {
          keywords: batch,
          location_code: locationCode,
          language_code: languageCode,
          date_from: dateFrom,
          date_to: dateTo,
          type: "web_search",
        },
      ])) as Array<{ keywords_data: TrendItem[] }>;
      const items = result?.[0]?.keywords_data ?? [];
      allItems.push(...items);
    }

    if (allItems.length === 0) return { inserted: 0 };

    const signals = allItems.map((item) => {
      const values = item.values ?? [];
      const len = values.length;
      let weekChangePct: number | null = null;
      if (len >= 2) {
        const prev = values[len - 2].value;
        const curr = values[len - 1].value;
        if (prev > 0) weekChangePct = Math.round(((curr - prev) / prev) * 100);
      }
      const latest = values[len - 1]?.value ?? item.average_value;
      const direction =
        weekChangePct !== null && weekChangePct >= 15
          ? "↑ Rising"
          : weekChangePct !== null && weekChangePct <= -15
          ? "↓ Falling"
          : "→ Stable";
      const urgency =
        weekChangePct !== null && Math.abs(weekChangePct) >= 30
          ? "high"
          : weekChangePct !== null && Math.abs(weekChangePct) >= 15
          ? "medium"
          : "low";

      return {
        client_id: clientId,
        signal_type: "search_query",
        source: "gsc",
        title: item.keyword,
        content: [
          `Google Trends interest: ${latest}/100 (avg ${item.average_value}/100)`,
          direction,
          weekChangePct !== null ? `WoW: ${weekChangePct > 0 ? "+" : ""}${weekChangePct}%` : null,
        ]
          .filter(Boolean)
          .join(" | "),
        data: {
          trends_average: item.average_value,
          trends_latest: latest,
          week_change_pct: weekChangePct,
          direction,
          values_12w: values.slice(-12).map((v) => v.value),
          source_api: "dataforseo_trends",
        },
        urgency,
        week_date: weekDate,
        is_included: true,
      };
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("signals").upsert(signals, {
      onConflict: "client_id,title,week_date,source",
      ignoreDuplicates: false,
    });
    if (error) throw new Error(error.message);
    return { inserted: signals.length };
  });

// ─── COMBINED PULL ───────────────────────────────────────────────────────────
export const pullLiveKeywordData = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => PullInput.parse(input))
  .handler(async ({ data }) => {
    const [volResult, trendResult] = await Promise.allSettled([
      pullKeywordVolumes({ data }),
      pullGoogleTrends({ data: { ...data, keywords: data.keywords.slice(0, 50) } }),
    ]);

    const volumes = volResult.status === "fulfilled" ? volResult.value.inserted : 0;
    const trends = trendResult.status === "fulfilled" ? trendResult.value.inserted : 0;

    const errors: string[] = [];
    if (volResult.status === "rejected") errors.push(`Volumes: ${volResult.reason?.message ?? "failed"}`);
    if (trendResult.status === "rejected") errors.push(`Trends: ${trendResult.reason?.message ?? "failed"}`);

    return { volumes, trends, errors };
  });
