import type { Brief, BriefContent, Signal } from "./terrain-types";

/** Extract a human-readable message from any thrown / rejected value. */
export function getErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string" && e.message) return e.message;
    const data = e.data as Record<string, unknown> | undefined;
    if (data && typeof data.message === "string" && data.message) return data.message;
    if (typeof e.error === "string" && e.error) return e.error;
    if (typeof e.statusText === "string" && e.statusText) return e.statusText;
  }
  return fallback;
}

/** Returns this week's Monday as YYYY-MM-DD. */
export function currentWeekMonday(d: Date = new Date()): string {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}

export function formatSignalsForPrompt(signals: Signal[]): string {
  const byType = {
    search_query: signals.filter((s) => s.signal_type === "search_query"),
    competitor: signals.filter((s) => s.signal_type === "competitor"),
    news: signals.filter((s) => s.signal_type === "news"),
    rera: signals.filter((s) => s.signal_type === "rera"),
    buyer_behaviour: signals.filter((s) => s.signal_type === "buyer_behaviour"),
    market: signals.filter((s) => s.signal_type === "market"),
  };

  let block = "";

  if (byType.search_query.length > 0) {
    block += "--- SEARCH SIGNALS ---\n";
    byType.search_query.forEach((s) => {
      const d = s.data as Record<string, unknown>;
      block += `Query: ${s.title}\n`;
      if (s.source) block += `Source: ${s.source}\n`;
      const fields = [
        d.impressions !== undefined ? `Impressions: ${d.impressions}` : null,
        d.clicks !== undefined ? `Clicks: ${d.clicks}` : null,
        d.ctr !== undefined ? `CTR: ${d.ctr}` : null,
        d.position !== undefined ? `Position: ${d.position}` : null,
        d.week_change_pct !== undefined ? `WoW change: ${d.week_change_pct}%` : null,
        d.volume !== undefined ? `Volume: ${d.volume}` : null,
        d.difficulty !== undefined ? `Difficulty: ${d.difficulty}` : null,
        d.movement_pct !== undefined ? `Movement: ${d.movement_pct}%` : null,
      ].filter(Boolean);
      if (fields.length) block += fields.join(" | ") + "\n";
      if (s.content) block += `Note: ${s.content}\n`;
      block += "\n";
    });
  }

  if (byType.competitor.length > 0) {
    block += "--- COMPETITOR ACTIVITY ---\n";
    byType.competitor.forEach((s) => {
      block += `Account: ${s.title}\n`;
      if (s.content) block += `Activity: ${s.content}\n`;
      block += "\n";
    });
  }

  if (byType.news.length > 0) {
    block += "--- MARKET INTELLIGENCE (recent trends and context) ---\n";
    byType.news.forEach((s) => {
      block += `Headline: ${s.title}\n`;
      if (s.content) block += `Summary: ${s.content}\n`;
      block += "\n";
    });
  }

  if (byType.rera.length > 0) {
    block += "--- RERA / GOVERNMENT WATCH ---\n";
    byType.rera.forEach((s) => {
      block += `Update: ${s.title}\n`;
      if (s.content) block += `Detail: ${s.content}\n`;
      block += "\n";
    });
  }

  if (byType.buyer_behaviour.length > 0) {
    block += "--- BUYER BEHAVIOUR ---\n";
    byType.buyer_behaviour.forEach((s) => {
      block += `${s.title}\n`;
      if (s.content) block += `${s.content}\n`;
      block += "\n";
    });
  }

  if (byType.market.length > 0) {
    block += "--- MARKET DATA ---\n";
    byType.market.forEach((s) => {
      block += `${s.title}: ${s.content}\n`;
    });
    block += "\n";
  }

  return block || "(no signals)";
}

export function formatForWhatsApp(
  brief: Brief,
  clientName: string,
  weekDate: string,
  agencyName?: string,
): string {
  const c = brief.content as BriefContent;
  const dateStr = new Date(weekDate).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const header = agencyName
    ? `🗺️ *${agencyName.toUpperCase()} — WEEKLY INTELLIGENCE*`
    : `🗺️ *TERRAIN INTELLIGENCE*`;

  let text = `${header}\n`;
  text += `_${clientName} — Week of ${dateStr}_\n\n`;
  text += `━━━━━━━━━━━━━━━\n\n`;

  text += `🔍 *SEARCH SIGNALS*\n${c.search_signals || "—"}\n\n`;
  text += `👁️ *COMPETITOR ACTIVITY*\n${c.competitor_activity || "—"}\n\n`;
  text += `🏛️ *RERA WATCH*\n${c.rera_watch || "—"}\n\n`;
  text += `💬 *BUYER BEHAVIOUR*\n${c.buyer_behaviour || "—"}\n\n`;

  text += `🎥 *CONTENT THIS WEEK*\n\n`;
  (c.content_recommendations || []).forEach((r) => {
    text += `*#${r.priority} — ${r.format} (${r.platform})*\n`;
    text += `Hook: "${r.hook}"\n`;
    text += `Topic: ${r.topic}\n`;
    text += `Persona: ${r.persona}\n\n`;
  });

  text += `⚡ *CAMPAIGN ADJUSTMENT*\n${c.campaign_adjustment || "—"}\n\n`;
  text += `━━━━━━━━━━━━━━━\n`;
  text += `_Intelligence brief — act on this week._`;

  return text;
}

export const URGENCY_COLOR: Record<string, string> = {
  high: "text-danger",
  medium: "text-warning",
  low: "text-success",
};
