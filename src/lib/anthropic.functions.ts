import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { formatSignalsForPrompt } from "@/lib/terrain-utils";
import type { Signal, Client, BriefContent, ContentRecommendation } from "@/lib/terrain-types";

const MODEL = "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";

async function callClaude(args: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: args.maxTokens ?? 2000,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = (await res.json()) as { content: Array<{ text: string }> };
  return data.content[0]?.text ?? "";
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


/** Generate a full weekly brief using Claude. */
export const generateBrief = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        client: z.any(),
        signals: z.array(z.any()),
        weekDate: z.string(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const client = data.client as Client;
    const signals = data.signals as Signal[];
    const signalBlock = formatSignalsForPrompt(signals);

    const system =
      client.system_prompt ||
      `You are a market intelligence analyst for ${client.name}, a real estate operator in ${client.market_geography}. Produce a weekly intelligence brief — concise, specific, and actionable. Respond ONLY with a valid JSON object containing exactly these 6 keys: search_signals (string), competitor_activity (string), rera_watch (string), buyer_behaviour (string), content_recommendations (array of exactly 3 objects with priority, format, platform, hook, topic, persona), campaign_adjustment (string). No preamble, no markdown.`;

    const user = `Here is this week's intelligence data for ${client.name}. Generate the weekly brief.

WEEK OF: ${data.weekDate}

${signalBlock}

Respond ONLY with the JSON object. No code fences. No commentary.`;

    const raw = await callClaude({ system, user, maxTokens: 2500 });
    const cleaned = stripFences(raw);
    let content: BriefContent;
    try {
      content = JSON.parse(cleaned) as BriefContent;
    } catch (e) {
      throw new Error("Claude returned invalid JSON. Try again or add more signals.");
    }
    return { content, prompt_used: user };
  });

/** Regenerate a single section of an existing brief. */
export const regenerateSection = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        client: z.any(),
        signals: z.array(z.any()),
        sectionKey: z.string(),
        weekDate: z.string(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const client = data.client as Client;
    const signals = data.signals as Signal[];
    const signalBlock = formatSignalsForPrompt(signals);

    const sectionNames: Record<string, string> = {
      search_signals: "Search Signals",
      competitor_activity: "Competitor Activity",
      rera_watch: "RERA Watch",
      buyer_behaviour: "Buyer Behaviour",
      content_recommendations: "Content Recommendations",
      campaign_adjustment: "Campaign Adjustment",
    };

    const sectionName = sectionNames[data.sectionKey] || data.sectionKey;

    const isArray = data.sectionKey === "content_recommendations";
    const shape = isArray
      ? `an array of exactly 3 objects, each with: priority (number), format (string), platform (string), hook (string), topic (string), persona (string)`
      : `a single string (2-4 sentences ending in one specific action)`;

    const system = client.system_prompt || `You are a market intelligence analyst for ${client.name}.`;
    const user = `Regenerate ONLY the "${sectionName}" section of this week's intelligence brief for ${client.name}.

WEEK OF: ${data.weekDate}

${signalBlock}

Respond ONLY with raw JSON: ${shape}. No code fences. No commentary.`;

    const raw = await callClaude({ system, user, maxTokens: 1200 });
    const cleaned = stripFences(raw);
    if (isArray) {
      try {
        const parsed = JSON.parse(cleaned) as ContentRecommendation[];
        return { kind: "array" as const, recommendations: parsed };
      } catch {
        throw new Error("Claude returned invalid JSON for this section.");
      }
    }
    return { kind: "string" as const, text: cleaned };
  });

/** Generate a default system prompt for a new client. */
export const generateDefaultSystemPrompt = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string(),
        market_geography: z.string(),
        keywords: z.array(z.string()).default([]),
        competitors: z.array(z.string()).default([]),
        buyer_personas: z.array(z.any()).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const user = `Generate a system prompt for an AI intelligence analyst working for the following real estate client. The prompt should instruct the model to produce a weekly intelligence brief and to output ONLY a JSON object with keys: search_signals, competitor_activity, rera_watch, buyer_behaviour, content_recommendations (array of 3 objects with priority/format/platform/hook/topic/persona), campaign_adjustment.

CLIENT NAME: ${data.name}
MARKET: ${data.market_geography}
KEYWORDS: ${data.keywords.join(", ") || "(none yet)"}
COMPETITORS: ${data.competitors.join(", ") || "(none yet)"}
BUYER PERSONAS: ${JSON.stringify(data.buyer_personas)}

Return only the system prompt text. No preamble.`;

    const text = await callClaude({
      system: "You write precise, concise system prompts for market intelligence AI analysts.",
      user,
      maxTokens: 800,
    });
    return { prompt: text.trim() };
  });

/** Generate buyer persona suggestions from client context. */
export const generatePersonaSuggestions = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string(),
        market_geography: z.string(),
        keywords: z.array(z.string()).default([]),
        competitors: z.array(z.string()).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const keywordContext =
      data.keywords.length > 0
        ? `Tracked keywords: ${data.keywords.slice(0, 20).join(", ")}`
        : "";
    const competitorContext =
      data.competitors.length > 0
        ? `Known competitors: ${data.competitors.join(", ")}`
        : "";

    const user =
      `Generate 6 distinct buyer personas for a real estate operator in the following market.\n\n` +
      `Business: ${data.name}\n` +
      `Market: ${data.market_geography}\n` +
      `${keywordContext}\n` +
      `${competitorContext}\n\n` +
      `Requirements:\n` +
      `- Cover diverse buyer types: investors, end-users, NRI buyers, local upgraders, retirees, remote workers\n` +
      `- Each persona must be specific to this market geography and real buyer motivations\n` +
      `- Hook lines should be punchy, specific, and in Hinglish where appropriate\n` +
      `- Make each persona genuinely distinct — different city of origin, different trigger, different life stage\n\n` +
      `Return ONLY a JSON array of exactly 6 objects. Each object must have exactly these 4 keys:\n` +
      `{\n` +
      `  "name": "Short label like 'The Delhi NCR Upgrader' or 'The Chandigarh Investor'",\n` +
      `  "location": "Primary city or region this buyer comes from",\n` +
      `  "trigger": "Their main purchase motivation in one sentence",\n` +
      `  "hook": "A compelling hook line that resonates with this buyer — in their language"\n` +
      `}\n\n` +
      `No preamble. No markdown. Raw JSON array only.`;

    const raw = await callClaude({
      system:
        "You generate precise, specific buyer persona profiles for real estate market intelligence systems. You return only valid JSON arrays. No commentary, no markdown fences.",
      user,
      maxTokens: 1200,
    });
    const cleaned = stripFences(raw);
    let personas: Array<{ name: string; location: string; trigger: string; hook: string }> = [];
    try {
      personas = JSON.parse(cleaned);
      if (!Array.isArray(personas)) personas = [];
    } catch {
      personas = [];
    }
    return { personas };
  });
