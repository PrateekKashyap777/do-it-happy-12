import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line,
} from "recharts";
import type { Signal } from "@/lib/terrain-types";

const URGENCY_BORDER: Record<string, string> = {
  high: "border-l-danger",
  medium: "border-l-warning",
  low: "border-l-success",
};

function getD(s: Signal) {
  return (s.data ?? {}) as Record<string, unknown>;
}
function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ─── SEARCH SIGNALS PANEL ───────────────────────────────────────────────
export function SearchSignalsPanel({ signals }: { signals: Signal[] }) {
  const sq = signals.filter((s) => s.signal_type === "search_query").slice(0, 12);
  if (sq.length === 0) return <EmptyPanel label="No search signals this week." />;

  const barData = sq
    .map((s) => {
      const d = getD(s);
      return {
        name: s.title.length > 22 ? s.title.slice(0, 20) + "…" : s.title,
        volume: asNum(d.volume) ?? 0,
        change: asNum(d.week_change_pct) ?? asNum(d.movement_pct) ?? 0,
        urgency: s.urgency,
      };
    })
    .sort((a, b) => b.volume - a.volume);

  const withTrends = sq
    .filter((s) => Array.isArray(getD(s).values_12w))
    .slice(0, 3);

  return (
    <div className="space-y-4">
      {barData.some((d) => d.volume > 0) && (
        <div>
          <div className="terr-label mb-2">Monthly search volume</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={barData} margin={{ top: 0, right: 0, left: -24, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                formatter={(val: number) => [val.toLocaleString(), "searches/mo"]}
              />
              <Bar dataKey="volume" radius={[3, 3, 0, 0]}>
                {barData.map((d, i) => (
                  <Cell key={i} fill={d.change > 15 ? "#2EA043" : d.change < -15 ? "#DA3633" : "#388BFD"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground text-left border-b border-border">
              <th className="pb-2 pr-3 font-normal">Keyword</th>
              <th className="pb-2 pr-3 font-normal text-right">Vol/mo</th>
              <th className="pb-2 pr-3 font-normal text-right">WoW</th>
              <th className="pb-2 font-normal text-right">Trend</th>
            </tr>
          </thead>
          <tbody>
            {barData.map((d, i) => {
              const c = d.change;
              const color = c > 15 ? "text-success" : c < -15 ? "text-danger" : "text-muted-foreground";
              const arrow = c > 5 ? "↑" : c < -5 ? "↓" : "→";
              return (
                <tr key={i} className={i % 2 === 1 ? "bg-elevated/30" : ""}>
                  <td className="py-1.5 pr-3 font-medium text-foreground max-w-[180px] truncate">{d.name}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{d.volume ? d.volume.toLocaleString() : "—"}</td>
                  <td className={`py-1.5 pr-3 text-right font-mono ${color}`}>
                    {c !== 0 ? `${c > 0 ? "+" : ""}${c}%` : "—"}
                  </td>
                  <td className={`py-1.5 text-right font-mono text-lg leading-none ${color}`}>{arrow}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {withTrends.length > 0 && (
        <div>
          <div className="terr-label mb-2">Google Trends — 12 week interest</div>
          <div className="space-y-1.5">
            {withTrends.map((s, i) => {
              const vals = (getD(s).values_12w as number[]).map((v, wi) => ({ w: `W${wi + 1}`, v }));
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-32 truncate shrink-0">{s.title}</span>
                  <div className="flex-1">
                    <ResponsiveContainer width="100%" height={40}>
                      <LineChart data={vals} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                        <Line type="monotone" dataKey="v" stroke="#1A5E45" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground w-10 text-right shrink-0">
                    {vals[vals.length - 1]?.v ?? "—"}/100
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── COMPETITOR ACTIVITY PANEL ───────────────────────────────────────────
export function CompetitorPanel({ signals }: { signals: Signal[] }) {
  const comp = signals.filter((s) => s.signal_type === "competitor");
  if (comp.length === 0) return <EmptyPanel label="No competitor signals this week." />;

  return (
    <div className="space-y-2">
      {comp.map((s) => {
        const d = getD(s);
        return (
          <div key={s.id} className={`terr-elevated p-3 rounded-sm border-l-2 ${URGENCY_BORDER[s.urgency] ?? "border-l-border"}`}>
            <p className="text-sm font-medium">{s.title}</p>
            {s.content && <p className="text-xs text-muted-foreground mt-1">{s.content}</p>}
            <div className="flex items-center gap-3 mt-2">
              {d.views != null && (
                <span className="text-xs font-mono text-foreground">{Number(d.views).toLocaleString()} views</span>
              )}
              {d.published_at && (
                <span className="text-xs text-muted-foreground">
                  {new Date(d.published_at as string).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
              )}
              {d.url && (
                <a href={d.url as string} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                  View →
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── BUYER BEHAVIOUR PANEL ──────────────────────────────────────────────
export function BuyerBehaviourPanel({ signals }: { signals: Signal[] }) {
  const bb = signals.filter((s) => s.signal_type === "buyer_behaviour");
  if (bb.length === 0) return <EmptyPanel label="No buyer behaviour signals this week." />;

  type Stat = { label: string; value: string; color?: string };
  const allStats: Stat[] = [];
  bb.forEach((s) => {
    const d = getD(s);
    if (d.form_fills) allStats.push({ label: "Form fills", value: String(d.form_fills), color: "text-success" });
    if (d.cpl) allStats.push({ label: "CPL", value: `₹${d.cpl}` });
    if (d.whatsapp_response_rate)
      allStats.push({
        label: "WA response",
        value: `${d.whatsapp_response_rate}%`,
        color: Number(d.whatsapp_response_rate) >= 30 ? "text-success" : "text-warning",
      });
    if (d.ctr) allStats.push({ label: "Top CTR", value: `${d.ctr}%` });
    if (d.site_visits) allStats.push({ label: "Site visits", value: String(d.site_visits), color: "text-success" });
  });

  return (
    <div className="space-y-3">
      {allStats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {allStats.slice(0, 6).map((stat, i) => (
            <div key={i} className="terr-elevated p-3 rounded-sm">
              <div className={`text-base font-semibold font-mono ${stat.color ?? "text-foreground"}`}>{stat.value}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {bb.map((s) => (
          <div key={s.id} className={`terr-elevated p-3 rounded-sm border-l-2 ${URGENCY_BORDER[s.urgency] ?? "border-l-border"}`}>
            <p className="text-sm font-medium">{s.title}</p>
            {s.content && <p className="text-xs text-muted-foreground mt-1">{s.content}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── RERA PANEL ──────────────────────────────────────────────────────────
export function RERAPanel({ signals }: { signals: Signal[] }) {
  const rera = signals.filter((s) => s.signal_type === "rera");
  if (rera.length === 0) return <EmptyPanel label="No RERA signals this week — add manually if needed." />;

  return (
    <div className="space-y-2">
      {rera.map((s) => {
        const d = getD(s);
        return (
          <div key={s.id} className={`terr-elevated p-3 rounded-sm border-l-2 ${URGENCY_BORDER[s.urgency] ?? "border-l-border"}`}>
            <p className="text-sm font-medium">{s.title}</p>
            {s.content && <p className="text-xs text-muted-foreground mt-1">{s.content}</p>}
            {d.url && (
              <a href={d.url as string} target="_blank" rel="noopener noreferrer"
                className="text-xs text-accent hover:underline mt-1 inline-block">
                View filing →
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── MARKET PANEL ────────────────────────────────────────────────────────
export function MarketPanel({ signals }: { signals: Signal[] }) {
  const market = signals.filter((s) => s.signal_type === "market");
  if (market.length === 0) return <EmptyPanel label="No market signals this week." />;
  return (
    <div className="space-y-2">
      {market.map((s) => (
        <div key={s.id} className={`terr-elevated p-3 rounded-sm border-l-2 ${URGENCY_BORDER[s.urgency] ?? "border-l-border"}`}>
          <p className="text-sm font-medium">{s.title}</p>
          {s.content && <p className="text-xs text-muted-foreground mt-1">{s.content}</p>}
        </div>
      ))}
    </div>
  );
}

// ─── CONTENT RECOMMENDATION PREVIEW CARD ────────────────────────────────
export function RecommendationPreviewCard({
  rec,
}: {
  rec: { priority: number; format: string; platform: string; hook: string; topic: string; persona: string };
  index?: number;
}) {
  const platformColor: Record<string, string> = {
    Instagram: "bg-[#E1306C]/15 text-[#E1306C]",
    "Meta Ad": "bg-[#1877F2]/15 text-[#1877F2]",
    YouTube: "bg-[#FF0000]/15 text-[#FF0000]",
    WhatsApp: "bg-[#25D366]/15 text-[#25D366]",
  };
  const platformCls =
    Object.entries(platformColor).find(([k]) => rec.platform?.includes(k))?.[1] ??
    "bg-elevated text-muted-foreground";

  return (
    <div className="terr-card p-4 border-l-4 border-l-primary">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="terr-badge bg-accent/20 text-accent font-mono">#{rec.priority}</span>
          <span className="terr-badge bg-elevated text-muted-foreground">{rec.format}</span>
          <span className={`terr-badge ${platformCls}`}>{rec.platform}</span>
        </div>
        {rec.persona && (
          <span className="terr-badge bg-primary/15 text-primary text-[10px] shrink-0">{rec.persona}</span>
        )}
      </div>
      {rec.hook && <p className="text-base italic font-medium leading-snug mb-2">"{rec.hook}"</p>}
      {rec.topic && <p className="text-xs text-muted-foreground">{rec.topic}</p>}
    </div>
  );
}

// ─── EMPTY PANEL ─────────────────────────────────────────────────────────
function EmptyPanel({ label }: { label: string }) {
  return (
    <div className="terr-elevated p-4 rounded-sm text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
