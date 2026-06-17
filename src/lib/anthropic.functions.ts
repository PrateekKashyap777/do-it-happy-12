import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { formatSignalsForPrompt } from "@/lib/terrain-utils";
import type { Signal, Client, BriefContent, ContentRecommendation, BuyerPersona } from "@/lib/terrain-types";

const MODEL = "claude-sonnet-4-6";
const API_URL = "https://api.anthropic.com/v1/messages";

const BRIEF_KEYS = [
  "search_signals",
  "competitor_activity",
  "rera_watch",
  "buyer_behaviour",
  "content_recommendations",
  "campaign_adjustment",
] as const;

const briefInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    search_signals: { type: "string" },
    competitor_activity: { type: "string" },
    rera_watch: { type: "string" },
    buyer_behaviour: { type: "string" },
    content_recommendations: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          priority: { type: "number" },
          format: { type: "string" },
          platform: { type: "string" },
          hook: { type: "string" },
          topic: { type: "string" },
          persona: { type: "string" },
        },
        required: ["priority", "format", "platform", "hook", "topic", "persona"],
      },
    },
    campaign_adjustment: { type: "string" },
  },
  required: [...BRIEF_KEYS],
} as const;

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasBriefKeys(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && BRIEF_KEYS.every((key) => key in value);
}

function findBriefCandidate(value: unknown, depth = 0): Record<string, unknown> | null {
  if (hasBriefKeys(value)) return value;
  if (!isRecord(value) || depth > 3) return null;

  const likelyWrappers = [
    "content",
    "brief",
    "brief_content",
    "brief_metadata",
    "intelligence_brief",
    "weekly_brief",
    "result",
    "data",
  ];

  for (const key of likelyWrappers) {
    const candidate = findBriefCandidate(value[key], depth + 1);
    if (candidate) return candidate;
  }

  for (const nested of Object.values(value)) {
    const candidate = findBriefCandidate(nested, depth + 1);
    if (candidate) return candidate;
  }

  return null;
}

function toText(value: unknown, fallback = "—"): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

function normalizeBriefContent(value: unknown): BriefContent {
  const candidate = findBriefCandidate(value);
  if (!candidate) throw new Error("missing required brief keys");

  const recommendations = Array.isArray(candidate.content_recommendations)
    ? candidate.content_recommendations
    : [];

  return {
    search_signals: toText(candidate.search_signals),
    competitor_activity: toText(candidate.competitor_activity),
    rera_watch: toText(candidate.rera_watch),
    buyer_behaviour: toText(candidate.buyer_behaviour),
    content_recommendations: recommendations.slice(0, 3).map((item, index) => {
      const rec = isRecord(item) ? item : {};
      return {
        priority: typeof rec.priority === "number" ? rec.priority : index + 1,
        format: toText(rec.format, "Short-form video"),
        platform: toText(rec.platform, "Instagram / YouTube Shorts"),
        hook: toText(rec.hook, "What changed in this market this week?"),
        topic: toText(rec.topic, "Weekly market signal update"),
        persona: toText(rec.persona, "Active property buyer"),
      };
    }),
    campaign_adjustment: toText(candidate.campaign_adjustment),
  };
}

function buildFallbackBrief(client: Client, signals: Signal[]): BriefContent {
  const byType = (type: Signal["signal_type"]) => signals.filter((signal) => signal.signal_type === type);
  const titles = (items: Signal[]) => items.slice(0, 3).map((signal) => signal.title).join("; ") || "no new included signals";
  const primaryKeyword = client.keywords[0] || `${client.market_geography} real estate`;
  const primaryPersona = client.buyer_personas[0]?.name || "priority buyer segment";

  return {
    search_signals: `Review ${signals.length} included signal${signals.length === 1 ? "" : "s"}. Search focus should stay on ${primaryKeyword}; leading items: ${titles(byType("search_query"))}.`,
    competitor_activity: `Competitor movement to monitor: ${titles(byType("competitor"))}. Position ${client.name} against these claims with specific proof points and locality-level comparisons.`,
    rera_watch: `RERA and compliance watch: ${titles(byType("rera"))}. Keep campaign copy conservative where approval or delivery-status language is unclear.`,
    buyer_behaviour: `Buyer behaviour signal: ${titles(byType("buyer_behaviour"))}. Adapt hooks toward ${primaryPersona} and address the most immediate purchase trigger in the first line.`,
    content_recommendations: [
      {
        priority: 1,
        format: "Short-form video",
        platform: "Instagram Reels / YouTube Shorts",
        hook: `${client.market_geography}: what buyers should check this week`,
        topic: `Weekly update around ${primaryKeyword}`,
        persona: primaryPersona,
      },
      {
        priority: 2,
        format: "Carousel",
        platform: "Instagram / LinkedIn",
        hook: "Before you shortlist a project, compare these signals",
        topic: `Competitor and market comparison for ${client.market_geography}`,
        persona: primaryPersona,
      },
      {
        priority: 3,
        format: "WhatsApp note",
        platform: "WhatsApp",
        hook: "This week's property-watch list is ready",
        topic: "Concise advisory using the strongest included signals",
        persona: primaryPersona,
      },
    ],
    campaign_adjustment: `Prioritise campaigns around ${primaryKeyword}, refresh ad copy with this week's strongest signal, and pause claims that are not supported by the included data.`,
  };
}

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

async function callClaudeTool<T>(args: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  inputSchema: typeof briefInputSchema;
  maxTokens?: number;
}): Promise<T> {
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
      max_tokens: args.maxTokens ?? 4000,
      system: args.system,
      tools: [
        {
          name: args.toolName,
          description: args.toolDescription,
          input_schema: args.inputSchema,
        },
      ],
      tool_choice: { type: "tool", name: args.toolName },
      messages: [{ role: "user", content: args.user }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API error ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = (await res.json()) as { content: AnthropicContentBlock[] };
  const toolUse = data.content.find(
    (block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === args.toolName,
  );

  if (toolUse) return toolUse.input as T;

  const text = data.content
    .filter((block): block is Extract<AnthropicContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return JSON.parse(extractJSON(text)) as T;
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

function buildFallbackPrompt(client: Client): string {
  const kw = client.keywords?.length ? client.keywords.join(", ") : "none specified";
  const comp = client.competitors?.length ? client.competitors.join(", ") : "none specified";
  const personas = client.buyer_personas?.length
    ? client.buyer_personas.map((p: BuyerPersona) => `${p.name} (${p.location})`).join(", ")
    : "not defined";
  return (
    `You are a market intelligence analyst for ${client.name}, ` +
    `a real estate operator in ${client.market_geography}. ` +
    `Tracked keywords: ${kw}. Competitors: ${comp}. ` +
    `Key buyer personas: ${personas}. ` +
    `Produce a weekly intelligence brief — concise, specific, and actionable. ` +
    `Tie each section to the actual signal data provided and reference keywords, ` +
    `competitors, and personas by name where relevant.`
  );
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

    const baseSystem = client.system_prompt || buildFallbackPrompt(client);
    const system = `${baseSystem}\n\nSTRICT OUTPUT CONTRACT: Use the provided tool exactly once. The tool input must contain only these six top-level fields: search_signals, competitor_activity, rera_watch, buyer_behaviour, content_recommendations, campaign_adjustment. Do not include week, brand, market, primary_keyword, prepared_by, executive_summary, brief_metadata, intelligence_brief, markdown, or commentary. Keep every narrative field to 2-4 concise sentences.`;


    const user = `Here is this week's intelligence data for ${client.name}. Generate the weekly brief.

WEEK OF: ${data.weekDate}

${signalBlock}

Return the weekly brief by calling the required tool. Keep it compact and do not add wrapper metadata.`;

    let content: BriefContent;
    try {
      const toolInput = await callClaudeTool<unknown>({
        system,
        user,
        toolName: "emit_weekly_brief",
        toolDescription: "Emit the weekly intelligence brief in the exact application schema.",
        inputSchema: briefInputSchema,
        maxTokens: 5000,
      });
      content = normalizeBriefContent(toolInput);
    } catch (error) {
      console.error("Claude brief output could not be normalized; using fallback brief.", error);
      content = buildFallbackBrief(client, signals);
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
    const cleaned = extractJSON(raw);

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
    const cleaned = extractJSON(raw);
    let personas: Array<{ name: string; location: string; trigger: string; hook: string }> = [];
    try {
      personas = JSON.parse(cleaned);
      if (!Array.isArray(personas)) personas = [];
    } catch {
      personas = [];
    }
    if (personas.length === 0) {
      throw new Error(`Persona generation failed — Claude returned: ${raw.slice(0, 200)}`);
    }
    return { personas };

  });
