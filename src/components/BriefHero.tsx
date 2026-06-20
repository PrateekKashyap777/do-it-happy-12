import type { Signal, BriefContent, Client, BuyerPersona } from "@/lib/terrain-types";

interface BriefHeroProps {
  content: BriefContent;
  signals: Signal[];
  clientName: string;
  weekDate: string;
  status: string;
  client: Client;
}

export function BriefHero({ content, signals, clientName, weekDate, status, client }: BriefHeroProps) {
  const searchSignals = signals.filter((s) => s.signal_type === "search_query").slice(0, 6);
  const competitorSignals = signals.filter((s) => s.signal_type === "competitor").slice(0, 6);
  const reraSignals = signals.filter((s) => s.signal_type === "rera").slice(0, 2);
  const buyerSignals = signals.filter((s) => s.signal_type === "buyer_behaviour");
  const aqiSignal = signals.find((s) => s.source === "aqi");
  const newsSignals = signals.filter((s) => s.signal_type === "news").slice(0, 3);
  const recs = content.content_recommendations ?? [];

  const aqiData = aqiSignal?.data as Record<string, unknown> | undefined;
  const toAqi = (value: unknown) => {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const formatCity = (city: string) => city.charAt(0).toUpperCase() + city.slice(1);
  const sourceCities = Array.isArray(aqiData?.source_cities)
    ? aqiData.source_cities.filter((city): city is string => typeof city === "string")
    : ["delhi", "gurgaon"];
  const sourceReadings = sourceCities
    .map((city) => ({ city, aqi: toAqi(aqiData?.[`${city}_aqi`]) }))
    .filter((reading): reading is { city: string; aqi: number } => reading.aqi !== undefined);
  const maxSourceReading = sourceReadings.reduce<{ city: string; aqi: number } | undefined>(
    (max, reading) => (!max || reading.aqi > max.aqi ? reading : max),
    undefined,
  );
  const maxSourceAqi = maxSourceReading?.aqi ?? toAqi(aqiData?.max_source_aqi);
  const maxSourceCity = maxSourceReading?.city ?? "Source";
  const destAqi = toAqi(aqiData?.destination_aqi);
  const destCity = (aqiData?.destination_city as string | undefined) ?? "Dehradun";
  const aqiTriggered = aqiData?.triggered as boolean | undefined;

  type BuyerStat = { label: string; value: string; positive?: boolean };
  const buyerStats: BuyerStat[] = [];
  buyerSignals.forEach((s) => {
    const d = s.data as Record<string, unknown>;
    if (d.form_fills) buyerStats.push({ label: "Form fills", value: String(d.form_fills), positive: true });
    if (d.cpl) buyerStats.push({ label: "CPL", value: `₹${d.cpl}` });
    if (d.whatsapp_response_rate) buyerStats.push({ label: "WA response", value: `${d.whatsapp_response_rate}%`, positive: Number(d.whatsapp_response_rate) >= 30 });
    if (d.ctr) buyerStats.push({ label: "Top CTR", value: `${d.ctr}%` });
    if (d.site_visits) buyerStats.push({ label: "Site visits", value: String(d.site_visits), positive: true });
    if (d.rising_count !== undefined)
      buyerStats.push({ label: "Rising KWs", value: String(d.rising_count), positive: Number(d.rising_count) > 0 });
    if (d.high_intent_count !== undefined)
      buyerStats.push({ label: "High intent", value: String(d.high_intent_count), positive: Number(d.high_intent_count) > 0 });
    if (d.total_volume && Number(d.total_volume) > 0)
      buyerStats.push({ label: "Total searches", value: Number(d.total_volume).toLocaleString() });
    if (d.top_rising && Array.isArray(d.top_rising) && (d.top_rising as unknown[]).length > 0)
      buyerStats.push({ label: "Top rising", value: String((d.top_rising as unknown[])[0] ?? "") });
  });

  const maxVol = Math.max(
    ...searchSignals.map((s) => ((s.data as Record<string, unknown>).volume as number) ?? 0),
    1
  );

  const statusCls: Record<string, string> = {
    sent: "bg-primary/20 text-primary",
    approved: "bg-success/15 text-success",
    review: "bg-warning/15 text-warning",
    draft: "bg-elevated text-muted-foreground",
  };
  const statusLabel: Record<string, string> = {
    sent: "Sent", approved: "Approved", review: "In Review", draft: "Draft",
  };

  const dateStr = new Date(weekDate).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="mb-0">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-[10px] font-medium tracking-[3px] uppercase text-muted-foreground mb-1">
            Terrain Intelligence
          </p>
          <h1 className="text-xl font-semibold text-foreground leading-tight">
            {clientName}
            <span className="text-base font-normal text-muted-foreground ml-2">
              · Week of {dateStr}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {aqiTriggered && (
            <span className="text-[10px] font-medium tracking-wider uppercase px-2.5 py-1 rounded-sm bg-danger/10 text-danger">
              🔴 AQI trigger
            </span>
          )}
          <span className={`text-[10px] font-medium tracking-wider uppercase px-2.5 py-1 rounded-sm ${statusCls[status] ?? "bg-elevated text-muted-foreground"}`}>
            {statusLabel[status] ?? status}
          </span>
        </div>
      </div>

      {/* ── THIS WEEK'S ACTION — pinned to top ──────────────────────────────── */}
      {content.campaign_adjustment && (
        <div
          className="rounded-sm p-5 mb-4 relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, #1A1A1A 0%, #1A2A1A 100%)", border: "1px solid #2A3A2A" }}
        >
          {/* Accent bar */}
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-sm" style={{ background: "#F58A6C" }} />

          <div className="pl-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">⚡</span>
              <p className="text-[10px] font-medium tracking-[3px] uppercase" style={{ color: "#F58A6C" }}>
                This week's action
              </p>
              {aqiTriggered && (
                <span className="ml-auto text-[9px] font-medium tracking-wider uppercase px-2 py-0.5 rounded-sm bg-danger/20 text-danger animate-pulse">
                  AQI trigger active
                </span>
              )}
            </div>
            <p className="text-base font-medium text-white leading-relaxed">
              {content.campaign_adjustment}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div className="md:col-span-2 terr-card p-4">
          <p className="text-[10px] font-medium tracking-[2px] uppercase text-muted-foreground mb-3">
            🔍 Search signals
          </p>
          {searchSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No search signals — pull live data to populate.
            </p>
          ) : (
            <>
              <div className="space-y-2.5 mb-3">
                {searchSignals.map((s, i) => {
                  const d = s.data as Record<string, unknown>;
                  const vol = (d.volume as number) ?? 0;
                  const chg = ((d.week_change_pct ?? d.movement_pct) as number) ?? 0;
                  const pct = Math.max((vol / maxVol) * 100, 4);
                  const barColor = chg > 10 ? "#2EA043" : chg < -10 ? "#DA3633" : "#388BFD";
                  const chgColor = chg > 10 ? "text-success" : chg < -10 ? "text-danger" : "text-muted-foreground";
                  const arrow = chg > 5 ? "↑" : chg < -5 ? "↓" : "→";
                  return (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className="text-muted-foreground w-36 shrink-0 truncate">{s.title}</span>
                      <div className="flex-1 h-1.5 bg-border/40 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                      <span className="font-mono text-muted-foreground w-20 text-right shrink-0">
                        {vol ? vol.toLocaleString() + "/mo" : "—"}
                      </span>
                      <span className={`font-mono w-14 text-right shrink-0 ${chgColor}`}>
                        {chg !== 0 ? `${chg > 0 ? "+" : ""}${chg}% ${arrow}` : `→`}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground border-t border-border pt-2">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-success inline-block" />Rising</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-info inline-block" />Stable</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-danger inline-block" />Falling</span>
                <span className="ml-auto">{searchSignals.length} keywords this week</span>
              </div>
            </>
          )}
        </div>

        <div className="terr-card p-4">
          <p className="text-[10px] font-medium tracking-[2px] uppercase text-muted-foreground mb-3">
            🌫 AQI watch
          </p>
          {!aqiSignal ? (
            <div className="flex flex-col items-center justify-center h-[120px] text-center gap-2">
              <p className="text-xs text-muted-foreground">No AQI data</p>
              <p className="text-[10px] text-muted-foreground">Pull all sources to check</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1 rounded-md p-2.5 text-center" style={{ background: "rgba(218,54,51,0.08)" }}>
                  <p className="text-2xl font-mono font-medium text-danger leading-none">{maxSourceAqi ?? "—"}</p>
                  <p className="text-[9px] tracking-wider uppercase text-danger mt-1">
                    {formatCity(maxSourceCity)}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">vs</span>
                <div className="flex-1 rounded-md p-2.5 text-center" style={{ background: "rgba(46,160,67,0.08)" }}>
                  <p className="text-2xl font-mono font-medium text-success leading-none">{destAqi ?? "—"}</p>
                  <p className="text-[9px] tracking-wider uppercase text-success mt-1">{destCity}</p>
                </div>
              </div>
              {aqiTriggered ? (
                <div className="rounded-sm px-2.5 py-2 text-center text-[10px] font-medium tracking-wider uppercase bg-danger/10 text-danger">
                  Campaign trigger active
                </div>
              ) : (
                <div className="rounded-sm px-2.5 py-2 text-center text-[10px] text-muted-foreground bg-elevated">
                  Below threshold (280)
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-2 text-center leading-relaxed">
                {aqiSignal.content}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div className="terr-card p-4">
          <p className="text-[10px] font-medium tracking-[2px] uppercase text-muted-foreground mb-3">
            👁 Competitor activity
          </p>
          {competitorSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No competitor signals</p>
          ) : (
            <div className="space-y-2">
              {competitorSignals.map((s, i) => {
                const d = s.data as Record<string, unknown>;
                const views = d.views as number | undefined;
                const isMeta = d.platform === "meta";
                const daysRunning = Number(d.days_running ?? 0);
                const snapshotUrl = d.snapshot_url as string | undefined;
                const urgencyDot = s.urgency === "high" ? "bg-danger" : s.urgency === "medium" ? "bg-warning" : "bg-muted-foreground/40";
                return (
                  <div key={i} className="border-b border-border pb-2 last:border-none last:pb-0">
                    <div className="flex items-start gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${urgencyDot}`} />
                      <p className="text-xs font-medium text-foreground leading-snug line-clamp-2">{s.title}</p>
                    </div>
                    {isMeta ? (
                      <div className="flex items-center gap-1.5 mt-1 pl-3 flex-wrap">
                        <span
                          className="text-[9px] font-medium tracking-wider uppercase px-1.5 py-0.5 rounded-sm"
                          style={{ background: "rgba(24,119,242,0.1)", color: "#1877F2" }}
                        >
                          Meta ad
                        </span>
                        {daysRunning > 0 && (
                          <span className={`text-[10px] font-mono ${daysRunning > 45 ? "text-warning" : "text-muted-foreground"}`}>
                            {daysRunning}d{daysRunning > 45 ? " ★ proven" : ""}
                          </span>
                        )}
                        {snapshotUrl && (
                          <a
                            href={snapshotUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent text-[10px] hover:underline ml-auto"
                          >
                            View ad ↗
                          </a>
                        )}
                      </div>
                    ) : views ? (
                      <p className="text-[10px] font-mono text-muted-foreground mt-0.5 pl-3">
                        {views.toLocaleString()} views
                        {d.url ? (
                          <a href={d.url as string} target="_blank" rel="noopener noreferrer"
                            className="text-accent ml-2 hover:underline">↗</a>
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground mt-0.5 pl-3 truncate">{s.content.slice(0, 60)}</p>
                    )}
                  </div>
                );
              })}
              <p className="text-[10px] text-muted-foreground pt-1">{competitorSignals.length} signal{competitorSignals.length !== 1 ? "s" : ""} this week</p>
            </div>
          )}
        </div>

        <div className="terr-card p-4">
          <p className="text-[10px] font-medium tracking-[2px] uppercase text-muted-foreground mb-3">
            🏛 RERA watch
          </p>
          {reraSignals.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">No RERA signals — manual check recommended</p>
          ) : (
            <div className="space-y-2">
              {reraSignals.map((s, i) => {
                const urgencyDot = s.urgency === "high" ? "bg-danger" : s.urgency === "medium" ? "bg-warning" : "bg-muted-foreground/40";
                return (
                  <div key={i} className="border-b border-border pb-2 last:border-none last:pb-0">
                    <div className="flex items-start gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${urgencyDot}`} />
                      <p className="text-xs font-medium text-foreground leading-snug line-clamp-2">{s.title}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 pl-3 line-clamp-1">{s.content.slice(0, 70)}</p>
                  </div>
                );
              })}
              <p className="text-[10px] text-muted-foreground pt-1">{reraSignals.length} signal{reraSignals.length !== 1 ? "s" : ""} this week</p>
            </div>
          )}
        </div>

        <div className="terr-card p-4">
          <p className="text-[10px] font-medium tracking-[2px] uppercase text-muted-foreground mb-3">
            💬 Buyer behaviour
          </p>
          {buyerStats.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">Add buyer behaviour signals with data fields</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {buyerStats.slice(0, 4).map((stat, i) => (
                <div key={i} className="terr-elevated rounded-md p-2.5 text-center">
                  <p className={`text-lg font-mono font-medium leading-none ${stat.positive ? "text-success" : "text-foreground"}`}>
                    {stat.value}
                  </p>
                  <p className="text-[9px] tracking-wider uppercase text-muted-foreground mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── ROW 2.5: News this week ─────────────────────────────────────────── */}
      {newsSignals.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2 px-0.5">
            <p className="text-[10px] font-medium tracking-[2px] uppercase text-muted-foreground">
              📰 News this week
            </p>
            <span className="text-[10px] text-muted-foreground">
              — what Claude read to write this brief
            </span>
            <span className="ml-auto flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {newsSignals.length} article{newsSignals.length !== 1 ? "s" : ""}
              </span>
              <span className="text-[9px] text-muted-foreground/60 italic">
                AI-synthesised market context
              </span>
            </span>

          </div>
          <div className="grid grid-cols-3 gap-3">
            {newsSignals.map((s, i) => {
              const d = s.data as Record<string, unknown>;
              const feedName = d.feed_source as string | undefined;
              const url = d.url as string | undefined;
              const publishedAt = d.published_at as string | undefined;
              const dateStr = publishedAt
                ? new Date(publishedAt).toLocaleDateString("en-IN", {
                    day: "numeric", month: "short",
                  })
                : "";
              // Feed source colour coding
              const feedStyles: Record<string, { bg: string; color: string }> = {
                "ET Real Estate": { bg: "rgba(255,102,0,0.1)", color: "#CC5500" },
                "MagicBricks": { bg: "rgba(220,53,69,0.1)", color: "#CC1A2B" },
                "Housing.com": { bg: "rgba(0,122,255,0.1)", color: "#0066CC" },
                "99acres": { bg: "rgba(46,160,67,0.1)", color: "#1A7A35" },
              };
              const feedStyle = feedStyles[feedName ?? ""] ?? {
                bg: "rgba(128,128,128,0.08)",
                color: "var(--muted-foreground)",
              };
              return (
                <div key={i} className="terr-elevated rounded-md p-3 border border-border flex flex-col">
                  {/* Header: feed badge + date */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    {feedName && (
                      <span
                        className="text-[9px] font-medium tracking-wider uppercase px-1.5 py-0.5 rounded-sm shrink-0"
                        style={{ background: feedStyle.bg, color: feedStyle.color }}
                      >
                        {feedName}
                      </span>
                    )}
                    {dateStr && (
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {dateStr}
                      </span>
                    )}
                  </div>
                  {/* Headline */}
                  <p className="text-xs font-medium text-foreground leading-snug line-clamp-2 mb-1.5 flex-1">
                    {s.title}
                  </p>
                  {/* Summary */}
                  {s.content && (
                    <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2 mb-2">
                      {s.content}
                    </p>
                  )}
                  {/* Read link */}
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-accent hover:underline mt-auto"
                    >
                      Read full article ↗
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── BUYER PERSONAS ROW ─────────────────────────────────────────────── */}
      {client?.buyer_personas && (client.buyer_personas as BuyerPersona[]).length > 0 && (
        <div className="terr-card p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-medium tracking-[2px] uppercase text-muted-foreground">
              👤 Buyer personas — {(client.buyer_personas as BuyerPersona[]).length} active
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(client.buyer_personas as BuyerPersona[]).map((persona, i) => (
              <div key={i} className="terr-elevated rounded-sm p-3 border border-border">
                <p className="text-xs font-medium text-foreground">{persona.name}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{persona.location}</p>
                {persona.trigger && (
                  <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1 italic">
                    {persona.trigger}
                  </p>
                )}
                {persona.hook && (
                  <p className="text-[10px] text-accent mt-1 line-clamp-1">
                    "{persona.hook}"
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="terr-card p-4 mb-3">
        <p className="text-[10px] font-medium tracking-[2px] uppercase text-muted-foreground mb-3">
          🎥 Content this week
        </p>
        {recs.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            Generate a brief to see content recommendations.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {recs.slice(0, 3).map((r, i) => {
              const platformColors: Record<string, string> = {
                "Instagram": "rgba(232,30,96,0.1)",
                "Meta": "rgba(24,119,242,0.1)",
                "YouTube": "rgba(255,0,0,0.08)",
                "WhatsApp": "rgba(37,211,102,0.1)",
              };
              const platformTextColors: Record<string, string> = {
                "Instagram": "#C94060",
                "Meta": "#1877F2",
                "YouTube": "#CC0000",
                "WhatsApp": "#1A8A47",
              };
              const platformKey = Object.keys(platformColors).find((k) => r.platform?.includes(k)) ?? "";
              return (
                <div key={i} className="border border-border border-l-2 rounded-md p-3" style={{ borderLeftColor: "#1A5E45" }}>
                  <div className="flex items-center gap-1.5 flex-wrap mb-2">
                    <span className="text-[9px] font-medium tracking-wider uppercase px-1.5 py-0.5 rounded-sm" style={{ background: "rgba(245,138,108,0.15)", color: "#C96742" }}>
                      #{r.priority}
                    </span>
                    <span className="text-[9px] font-medium tracking-wider uppercase px-1.5 py-0.5 rounded-sm bg-elevated text-muted-foreground">
                      {r.format}
                    </span>
                    {r.platform && (
                      <span className="text-[9px] font-medium tracking-wider uppercase px-1.5 py-0.5 rounded-sm"
                        style={{ background: platformColors[platformKey] ?? "rgba(0,0,0,0.05)", color: platformTextColors[platformKey] ?? "var(--muted-foreground)" }}>
                        {r.platform}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-medium italic text-foreground mb-1.5 leading-snug line-clamp-2">
                    "{r.hook}"
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{r.topic}</p>
                  {r.persona && (
                    <p className="text-[9px] text-muted-foreground mt-1.5 tracking-wide">→ {r.persona}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>


      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-border" />
        <p className="text-[10px] tracking-[3px] uppercase text-muted-foreground">↓ Review and edit below</p>
        <div className="flex-1 h-px bg-border" />
      </div>
    </div>
  );
}
