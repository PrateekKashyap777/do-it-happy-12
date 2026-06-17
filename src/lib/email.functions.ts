import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Resend } from "resend";

const recSchema = z.object({
  priority: z.number(),
  format: z.string(),
  platform: z.string(),
  hook: z.string(),
  topic: z.string(),
  persona: z.string(),
});

export const sendBriefEmail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({
      toEmail: z.string().email(),
      clientName: z.string(),
      weekDate: z.string(),
      briefContent: z.object({
        search_signals: z.string(),
        competitor_activity: z.string(),
        rera_watch: z.string(),
        buyer_behaviour: z.string(),
        content_recommendations: z.array(recSchema),
        campaign_adjustment: z.string(),
      }),
      agencyName: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("Missing RESEND_API_KEY");

    const resend = new Resend(apiKey);
    const { briefContent: c, clientName, weekDate, agencyName } = data;

    const header = agencyName
      ? `${agencyName} — Weekly Intelligence`
      : "Terrain Intelligence";

    const dateStr = new Date(weekDate).toLocaleDateString("en-IN", {
      day: "numeric", month: "long", year: "numeric",
    });

    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const recs = (c.content_recommendations ?? []).map((r) => `
      <div style="background:#f3f4f6;border-left:3px solid #1A5E45;padding:12px 16px;margin:8px 0;border-radius:4px">
        <div style="font-size:11px;color:#1A5E45;font-weight:600;margin-bottom:4px">
          #${r.priority} · ${esc(r.format)} · ${esc(r.platform)} · ${esc(r.persona)}
        </div>
        <div style="font-size:15px;font-weight:600;color:#111;margin-bottom:4px">"${esc(r.hook)}"</div>
        <div style="font-size:13px;color:#444">${esc(r.topic)}</div>
      </div>
    `).join("");

    const section = (icon: string, title: string, body: string) => `
      <div style="margin-bottom:20px">
        <div style="font-size:12px;letter-spacing:0.08em;color:#1A5E45;font-weight:700;margin-bottom:6px">
          ${icon} ${title}
        </div>
        <div style="font-size:14px;color:#222;line-height:1.55;white-space:pre-wrap">${esc(body || "—")}</div>
      </div>
    `;

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#fff;color:#111">
        <div style="border-bottom:2px solid #1A5E45;padding-bottom:16px;margin-bottom:24px">
          <div style="font-size:11px;letter-spacing:0.12em;color:#1A5E45;font-weight:700">${esc(header.toUpperCase())}</div>
          <div style="font-size:22px;font-weight:700;margin-top:6px">${esc(clientName)}</div>
          <div style="font-size:13px;color:#666;margin-top:2px">Week of ${dateStr}</div>
        </div>
        ${section("🔍", "SEARCH SIGNALS", c.search_signals)}
        ${section("👁️", "COMPETITOR ACTIVITY", c.competitor_activity)}
        ${section("🏛️", "RERA WATCH", c.rera_watch)}
        ${section("💬", "BUYER BEHAVIOUR", c.buyer_behaviour)}
        <div style="margin-bottom:20px">
          <div style="font-size:12px;letter-spacing:0.08em;color:#1A5E45;font-weight:700;margin-bottom:6px">🎥 CONTENT THIS WEEK</div>
          ${recs || '<div style="font-size:13px;color:#666">No recommendations.</div>'}
        </div>
        ${section("⚡", "CAMPAIGN ADJUSTMENT", c.campaign_adjustment)}
        <div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:12px;font-size:11px;color:#888;text-align:center">
          Terrain Intelligence — act on this week.
        </div>
      </div>
    `;

    const { error } = await resend.emails.send({
      from: "Terrain Intelligence <briefs@resend.dev>",
      to: data.toEmail,
      subject: `${header} — ${clientName} — Week of ${dateStr}`,
      html,
    });

    if (error) throw new Error(`Email failed: ${error.message}`);
    return { sent: true };
  });
