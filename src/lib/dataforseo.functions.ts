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

// ─── KEYWORD DISCOVERY ───────────────────────────────────────────────────────
export interface DiscoveredKeyword {
  keyword: string;
  volume: number | null;
  competition_level: string | null;
  cpc: number | null;
  theme: string;
}

function extractJSON(raw: string): string {
  const s = raw.trim();
  const firstBrace = s.indexOf('{');
  const firstBracket = s.indexOf('[');
  if (firstBrace === -1 && firstBracket === -1) return s;
  let start: number;
  let closeChar: string;
  if (firstBrace === -1) { start = firstBracket; closeChar = ']'; }
  else if (firstBracket === -1) { start = firstBrace; closeChar = '}'; }
  else if (firstBrace < firstBracket) { start = firstBrace; closeChar = '}'; }
  else { start = firstBracket; closeChar = ']'; }
  const end = s.lastIndexOf(closeChar);
  if (end === -1 || end < start) return s;
  return s.slice(start, end + 1);
}


async function claudeJSON(apiKey: string, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`Claude error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { content?: Array<{ text?: string }> };
  return json.content?.[0]?.text ?? "";
}

export const discoverKeywords = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      clientId: z.string(),
      name: z.string(),
      market_geography: z.string(),
      buyer_personas: z.array(z.any()).default([]),
      existing_keywords: z.array(z.string()).default([]),
      website_url: z.string().default(""),
      location_code: z.number().default(2356),
      language_code: z.string().default("en"),
      min_volume: z.number().default(50),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const personaNames = (data.buyer_personas as Array<{ name?: string }>)
      .map((p) => p?.name)
      .filter(Boolean)
      .join(", ");

    // ── STEP 1: Claude generates seed keywords ──────────────────────────────
    const seedRaw = await claudeJSON(
      anthropicKey,
      "You generate real estate search keyword seeds for Google Ads keyword research. " +
        "Return ONLY a JSON array of strings — 12 to 15 short seed terms (2-4 words each). " +
        "No preamble, no markdown, no explanations.",
      `Generate seed keywords for a real estate operator in ${data.market_geography}.\n` +
        `Business: ${data.name}\n` +
        `Buyer types: ${personaNames || "residential and investment buyers"}\n` +
        `Existing keywords to avoid duplicating: ${data.existing_keywords.slice(0, 10).join(", ") || "none"}\n\n` +
        `Focus on: property type terms, location terms, buyer intent terms, comparison terms ` +
        `(e.g. flat vs plot), trust/regulatory terms (RERA, verified), and lifestyle terms relevant to this market.`,
      400,
    );

    let seeds: string[] = [];
    try {
      const parsed = JSON.parse(stripJsonFence(seedRaw));
      if (Array.isArray(parsed)) seeds = parsed.filter((s): s is string => typeof s === "string");
    } catch {
      seeds = [];
    }
    seeds = seeds.slice(0, 15);
    if (seeds.length === 0) return { keywords: [] as DiscoveredKeyword[], themes: [] as string[], seeds: [] as string[] };

    // ── STEP 2: DataForSEO expands seeds into related keywords ──────────────
    const allRelated: string[] = [];
    const batches: string[][] = [];
    for (let i = 0; i < seeds.length; i += 3) batches.push(seeds.slice(i, i + 3));

    for (const batch of batches) {
      try {
        const result = (await dfsPost("/keywords_data/google_ads/keywords_for_keywords/live", [
          {
            keywords: batch,
            location_code: data.location_code,
            language_code: data.language_code,
            limit: 50,
          },
        ])) as Array<{ keyword?: string }>;
        (result ?? []).forEach((item) => {
          if (item?.keyword && !allRelated.includes(item.keyword)) allRelated.push(item.keyword);
        });
      } catch {
        // continue on batch failure
      }
    }
    seeds.forEach((s) => { if (!allRelated.includes(s)) allRelated.push(s); });

    const existingSet = new Set(data.existing_keywords.map((k) => k.toLowerCase()));
    const candidates = allRelated.filter((k) => !existingSet.has(k.toLowerCase())).slice(0, 200);
    if (candidates.length === 0) return { keywords: [], themes: [], seeds };

    // ── STEP 3: Get volumes and filter ──────────────────────────────────────
    let volumeData: Array<{
      keyword: string;
      search_volume: number | null;
      competition_level: string | null;
      cpc: number | null;
    }> = [];
    try {
      volumeData = (await dfsPost("/keywords_data/google_ads/search_volume/live", [
        { keywords: candidates, location_code: data.location_code, language_code: data.language_code },
      ])) as typeof volumeData;
    } catch {
      volumeData = candidates.map((k) => ({ keyword: k, search_volume: null, competition_level: null, cpc: null }));
    }

    const filtered = volumeData.filter(
      (item) => item.search_volume === null || (item.search_volume ?? 0) >= data.min_volume,
    );
    if (filtered.length === 0) return { keywords: [], themes: [], seeds };

    // ── STEP 4: Claude groups into themes ──────────────────────────────────
    const forGrouping = filtered.slice(0, 80);
    const keywordList = forGrouping
      .map((k) => `${k.keyword} (${k.search_volume ?? "unknown"}/mo)`)
      .join("\n");

    const groupRaw = await claudeJSON(
      anthropicKey,
      "You group real estate search keywords into logical themes for a marketing intelligence tool. " +
        "Return ONLY a JSON object where each key is a theme name (3-5 words, title case) and each value is an array of keyword strings from the input list. " +
        "Use 4-8 themes. Every keyword must appear in exactly one theme. No preamble, no markdown.",
      `Group these keywords into themes for a real estate operator in ${data.market_geography}:\n\n${keywordList}`,
      1200,
    );

    let themeMap: Record<string, string[]> = {};
    try {
      const parsed = JSON.parse(stripJsonFence(groupRaw));
      if (parsed && typeof parsed === "object") themeMap = parsed as Record<string, string[]>;
    } catch {
      themeMap = { "All Keywords": forGrouping.map((k) => k.keyword) };
    }

    // Build keyword → theme lookup; assign unmatched to a fallback theme
    const keywordToTheme = new Map<string, string>();
    Object.entries(themeMap).forEach(([theme, kws]) => {
      (kws ?? []).forEach((kw) => { if (typeof kw === "string") keywordToTheme.set(kw.toLowerCase(), theme); });
    });

    const volumeLookup = new Map(filtered.map((v) => [v.keyword.toLowerCase(), v]));
    const keywords: DiscoveredKeyword[] = forGrouping.map((item) => ({
      keyword: item.keyword,
      volume: item.search_volume,
      competition_level: item.competition_level,
      cpc: item.cpc,
      theme: keywordToTheme.get(item.keyword.toLowerCase()) ?? "Other",
    }));

    // Keep theme order from Claude's response, append "Other" if used
    const themes = Object.keys(themeMap);
    if (keywords.some((k) => k.theme === "Other") && !themes.includes("Other")) themes.push("Other");
    // Only include themes that actually have keywords
    const usedThemes = themes.filter((t) => keywords.some((k) => k.theme === t));

    void volumeLookup; // reserved for future enrichment
    return { keywords, themes: usedThemes, seeds };
  });

// ─── SAVE KEYWORDS TO CLIENT ─────────────────────────────────────────────────
export const addKeywordsToClient = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      clientId: z.string(),
      newKeywords: z.array(z.string()).min(1),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: client, error: readErr } = await supabaseAdmin
      .from("clients")
      .select("keywords")
      .eq("id", data.clientId)
      .single();
    if (readErr) throw new Error(readErr.message);

    const existing = (client?.keywords ?? []) as string[];
    const existingLower = new Set(existing.map((k) => k.toLowerCase()));
    const toAdd = data.newKeywords.filter((k) => !existingLower.has(k.toLowerCase()));
    const merged = [...existing, ...toAdd];

    const { error: writeErr } = await supabaseAdmin
      .from("clients")
      .update({ keywords: merged })
      .eq("id", data.clientId);
    if (writeErr) throw new Error(writeErr.message);

    return { added: toAdd.length, total: merged.length };
  });

