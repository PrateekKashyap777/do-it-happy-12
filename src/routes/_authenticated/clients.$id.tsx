import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { AddSignalModal } from "@/components/AddSignalModal";
import { KeywordDiscoveryModal } from "@/components/KeywordDiscoveryModal";
import { SocialWatchlist } from "@/components/SocialWatchlist";
import { TagInput } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { MapPin, RefreshCw, Sparkles, ChevronLeft, ChevronRight, ChevronDown, Plus, X, Wand2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell,
} from "recharts";
import { generateBrief, generateDefaultSystemPrompt } from "@/lib/anthropic.functions";
import { pullLiveKeywordData } from "@/lib/dataforseo.functions";
import { pullNewsSignals, checkAQISignal, pullYouTubeCompetitors, pullRERASignals, pullBuyerBehaviourSignals, pullMetaAds } from "@/lib/signals.functions";
import { currentWeekMonday, getErrorMessage, formatSignalsForPrompt as _fmt } from "@/lib/terrain-utils";
import type {
  Client, Signal, Brief, SignalType, SocialProfile, BuyerPersona,
} from "@/lib/terrain-types";
import { SIGNAL_TYPE_LABELS, SIGNAL_SOURCE_LABELS } from "@/lib/terrain-types";

export const Route = createFileRoute("/_authenticated/clients/$id")({
  component: ClientDetail,
});

const TYPE_TABS: { key: "all" | SignalType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "search_query", label: "Search" },
  { key: "competitor", label: "Competitor" },
  { key: "news", label: "News" },
  { key: "rera", label: "RERA" },
  { key: "buyer_behaviour", label: "Buyer Behaviour" },
  { key: "market", label: "Market" },
];

const TYPE_BADGE: Record<SignalType, string> = {
  search_query: "bg-info/15 text-info",
  competitor: "bg-[#6E40C9]/20 text-[#C9A6FF]",
  news: "bg-elevated text-muted-foreground",
  rera: "bg-accent/20 text-accent",
  buyer_behaviour: "bg-success/15 text-success",
  market: "bg-primary/25 text-primary-foreground",
};

const URGENCY_CLASS: Record<string, string> = {
  high: "terr-signal-high",
  medium: "terr-signal-medium",
  low: "terr-signal-low",
};

const BRIEF_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  review: "In Review",
  approved: "Approved",
  sent: "Sent",
};

function stepWeek(week: string, delta: number): string {
  const d = new Date(week + "T00:00:00");
  d.setDate(d.getDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

function formatNum(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return null;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function signalMetrics(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  const vol = formatNum(data.volume);
  if (vol) out.push(`Vol: ${vol}`);
  const wow = data.week_change_pct ?? data.movement_pct;
  const wowN = formatNum(wow);
  if (wowN !== null) {
    const num = typeof wow === "number" ? wow : Number(wow);
    out.push(`WoW: ${num > 0 ? "+" : ""}${wowN}%`);
  }
  const pos = formatNum(data.position);
  if (pos) out.push(`Pos: ${pos}`);
  const ctr = formatNum(data.ctr);
  if (ctr) out.push(`CTR: ${ctr}%`);
  const imp = formatNum(data.impressions);
  if (imp) out.push(`Impr: ${imp}`);
  const clicks = formatNum(data.clicks);
  if (clicks) out.push(`Clicks: ${clicks}`);
  return out;
}


function ClientDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const genBrief = useServerFn(generateBrief);
  const pullData = useServerFn(pullLiveKeywordData);
  const pullNews = useServerFn(pullNewsSignals);
  const checkAQI = useServerFn(checkAQISignal);
  const pullYT = useServerFn(pullYouTubeCompetitors);
  const pullRERA = useServerFn(pullRERASignals);
  const pullBuyer = useServerFn(pullBuyerBehaviourSignals);
  const pullMeta = useServerFn(pullMetaAds);
  const [week, setWeek] = useState(currentWeekMonday());
  const [tab, setTab] = useState<"all" | SignalType>("all");
  const [modal, setModal] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullingAll, setPullingAll] = useState(false);
  const [view, setView] = useState<"detail" | "settings">("detail");

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["client-detail", id, week],
    queryFn: async () => {
      const [c, s, b] = await Promise.all([
        supabase.from("clients").select("*").eq("id", id).single(),
        supabase.from("signals").select("*").eq("client_id", id).eq("week_date", week).order("created_at", { ascending: false }),
        supabase.from("briefs").select("*").eq("client_id", id).order("week_date", { ascending: false }),
      ]);
      if (c.error) throw c.error;
      if (s.error) throw s.error;
      if (b.error) throw b.error;
      return {
        client: c.data as unknown as Client,
        signals: (s.data ?? []) as unknown as Signal[],
        briefs: (b.data ?? []) as unknown as Brief[],
      };
    },
  });

  const client = data?.client;
  const signals = data?.signals ?? [];
  const briefs = data?.briefs ?? [];
  const currentBrief = briefs.find((b) => b.week_date === week);
  const includedCount = signals.filter((s) => s.is_included).length;

  const filtered = useMemo(
    () => (tab === "all" ? signals : signals.filter((s) => s.signal_type === tab)),
    [signals, tab],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    signals.forEach((s) => { c[s.signal_type] = (c[s.signal_type] ?? 0) + 1; });
    return c;
  }, [signals]);

  const chartData = (Object.keys(SIGNAL_TYPE_LABELS) as SignalType[]).map((k) => ({
    name: SIGNAL_TYPE_LABELS[k], value: counts[k] ?? 0, key: k,
  })).filter((d) => d.value > 0);

  async function toggleInclude(signalId: string, value: boolean) {
    const { error } = await supabase.from("signals").update({ is_included: value }).eq("id", signalId);
    if (error) toast.error(error.message);
    else refetch();
  }

  async function handleGenerate() {
    if (!client) return;
    if (includedCount < 2) { toast.error("Include at least 2 signals before generating."); return; }
    setGenerating(true);
    try {
      const included = signals.filter((s) => s.is_included);
      const { content, prompt_used } = await genBrief({
        data: { client, signals: included, weekDate: week },
      });
      const { data: brief, error } = await supabase.from("briefs").insert({
        client_id: client.id,
        week_date: week,
        status: "review",
        content: content as never,
        prompt_used,
        signal_count: included.length,
        generated_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      toast.success("Brief generated");
      navigate({ to: "/briefs/$id", params: { id: brief!.id } });
    } catch (err) {
      toast.error(`Brief generation failed — ${getErrorMessage(err)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handlePullLiveData() {
    if (!client) return;
    if (!client.keywords || client.keywords.length === 0) {
      toast.error("Add keywords to this client's config before pulling data.");
      return;
    }
    setPulling(true);
    try {
      const result = await pullData({
        data: {
          clientId: client.id,
          keywords: client.keywords,
          weekDate: week,
          locationCode: 2356,
          languageCode: "en",
        },
      });
      const total = result.volumes + result.trends;
      if (result.errors.length > 0) {
        toast.warning(`Pulled ${total} signals. Errors: ${result.errors.join(", ")}`);
      } else {
        toast.success(`Pulled ${total} signals — ${result.volumes} volume, ${result.trends} trend`);
      }
      refetch();
    } catch (err) {
      toast.error(getErrorMessage(err, "Pull failed"));
    } finally {
      setPulling(false);
    }
  }

  async function handlePullAll() {
    if (!client) return;
    setPullingAll(true);
    try {
      const kws = client.keywords ?? [];
      const comps = client.competitors ?? [];
      const tasks: Array<{ label: string; promise: Promise<{ inserted: number }> }> = [];
      if (kws.length > 0) {
        tasks.push({
          label: "Keywords",
          promise: pullData({ data: { clientId: client.id, keywords: kws, weekDate: week, locationCode: 2356, languageCode: "en" } })
            .then((r) => ({ inserted: r.volumes + r.trends })),
        });
      }
      tasks.push({
        label: "News",
        promise: pullNews({ data: { clientId: client.id, keywords: kws, competitors: comps, market: client.market_geography ?? "", weekDate: week, limit: 10 } }),
      });
      tasks.push({
        label: "AQI",
        promise: checkAQI({ data: { clientId: client.id, weekDate: week, sourceCities: ["delhi", "gurgaon"], destinationCity: "dehradun", threshold: 280 } })
          .then((r) => ({ inserted: r.inserted })),
      });
      if (comps.length > 0) {
        tasks.push({
          label: "YouTube",
          promise: pullYT({ data: { clientId: client.id, competitors: comps, marketGeography: client.market_geography ?? "", weekDate: week, minViews: 200 } })
            .then((r) => ({ inserted: r.inserted })),
        });
        tasks.push({
          label: "Meta Ads",
          promise: pullMeta({ data: { clientId: client.id, competitors: comps, market: client.market_geography ?? "", weekDate: week } })
            .then((r) => ({ inserted: r.inserted })),
        });
      }
      if (client.market_geography) {
        tasks.push({
          label: "RERA",
          promise: pullRERA({ data: { clientId: client.id, market: client.market_geography, keywords: kws, weekDate: week } }),
        });
      }
      // Buyer intent runs last so it can read the freshly-pulled keyword signals
      const earlyResults = await Promise.allSettled(tasks.map((t) => t.promise));
      const buyerTask = { label: "Buyer intent", promise: pullBuyer({ data: { clientId: client.id, weekDate: week } }) };
      const buyerResult = await Promise.allSettled([buyerTask.promise]);
      const allTasks = [...tasks, buyerTask];
      const results = [...earlyResults, ...buyerResult];
      let total = 0;
      const ok: string[] = [];
      const fail: string[] = [];
      results.forEach((r, i) => {
        const label = allTasks[i].label;
        if (r.status === "fulfilled") {
          total += r.value.inserted;
          ok.push(`${label}: ${r.value.inserted}`);
        } else {
          fail.push(`${label}: ${getErrorMessage(r.reason, "failed")}`);
        }
      });
      if (fail.length === 0) toast.success(`Pulled ${total} signals — ${ok.join(", ")}`);
      else toast.warning(`Pulled ${total}. ${ok.join(", ")}${ok.length ? " · " : ""}Failures — ${fail.join("; ")}`);
      refetch();
    } catch (err) {
      toast.error(getErrorMessage(err, "Pull All failed"));
    } finally {
      setPullingAll(false);
    }
  }

  if (isLoading || !client) {
    return <AppShell><div className="text-sm text-muted-foreground">Loading client...</div></AppShell>;
  }

  return (
    <AppShell>
      <div className="mb-6 text-sm text-muted-foreground">
        <Link to="/clients" className="hover:text-foreground">Clients</Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{client.name}</span>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            {client.market_geography}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`terr-badge ${client.status === "active" ? "bg-success/15 text-success" : "bg-elevated text-muted-foreground"}`}>
            {client.status}
          </span>
          {view === "detail" ? (
            <Button variant="ghost" size="sm" onClick={() => setView("settings")}>
              Settings
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setView("detail")}>
              ← Back
            </Button>
          )}
        </div>
      </div>

      {view === "settings" ? (
        <ClientSettingsInline
          client={client}
          clientId={id}
          onSaved={() => { refetch(); }}
        />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        {/* LEFT: feed */}
        <div className="space-y-4">
          <div className="terr-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="terr-label">Week of</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setWeek(stepWeek(week, -1))}
                  aria-label="Previous week"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Input
                  type="date"
                  value={week}
                  onChange={(e) => setWeek(e.target.value)}
                  className="w-44 font-mono"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setWeek(stepWeek(week, 1))}
                  disabled={week >= currentWeekMonday()}
                  aria-label="Next week"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <Button variant="outline" size="sm" onClick={() => setModal(true)}>+ Add Signal</Button>
            </div>
            <div className="mt-4">
              <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | SignalType)}>
                <TabsList className="bg-elevated overflow-x-auto flex-wrap h-auto">
                  {TYPE_TABS.map((t) => (
                    <TabsTrigger key={t.key} value={t.key} className="text-xs">
                      {t.label}
                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                        {t.key === "all" ? signals.length : counts[t.key] ?? 0}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="terr-card p-12 text-center">
              <p className="font-medium">No signals for this week.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add a signal manually or wait for automated ingestion.
              </p>
              <Button className="mt-4 bg-primary hover:bg-primary-hover" onClick={() => setModal(true)}>Add Signal</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((s) => (
                <div key={s.id} className={`terr-card p-4 ${URGENCY_CLASS[s.urgency]}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`terr-badge ${TYPE_BADGE[s.signal_type]}`}>{SIGNAL_TYPE_LABELS[s.signal_type]}</span>
                      <span className="terr-badge bg-elevated text-muted-foreground">{SIGNAL_SOURCE_LABELS[s.source]}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {new Date(s.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="text-sm font-medium">{s.title}</div>
                  {(() => {
                    const metrics = signalMetrics((s.data ?? {}) as Record<string, unknown>);
                    return metrics.length > 0 ? (
                      <div className="mt-1.5 text-[11px] text-muted-foreground font-mono">
                        {metrics.join(" · ")}
                      </div>
                    ) : null;
                  })()}
                  {s.content && (
                    <p className="text-[13px] text-muted-foreground mt-1 line-clamp-2">{s.content}</p>
                  )}

                  <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Include in Brief</span>
                    <Switch
                      checked={s.is_included}
                      onCheckedChange={(v) => toggleInclude(s.id, v)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: summary */}
        <div className="space-y-4">
          <div className="terr-card p-5">
            <div className="terr-label mb-3">Week Summary</div>
            <div className="terr-stat">{signals.length}</div>
            <div className="text-xs text-muted-foreground mt-1">signals total · {includedCount} included</div>
            <div className={`mt-2 text-xs ${includedCount >= 2 ? "text-success" : "text-warning"}`}>
              {includedCount >= 2
                ? `${includedCount} of ${signals.length} signals included — ready to generate`
                : `Add ${2 - includedCount} more included signal${2 - includedCount === 1 ? "" : "s"} to generate`}
            </div>
            {chartData.length > 0 && (
              <div className="mt-4 h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 10, top: 4, bottom: 4 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={80} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                    <Bar dataKey="value" radius={[0, 2, 2, 0]}>
                      {chartData.map((d, i) => <Cell key={i} fill="var(--primary)" />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {client.keywords?.length > 0 && (
            <Collapsible>
              <div className="terr-card p-5">
                <CollapsibleTrigger className="w-full flex items-center justify-between">
                  <div className="terr-label">Tracking {client.keywords.length} keyword{client.keywords.length === 1 ? "" : "s"}</div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3 flex flex-wrap gap-1.5">
                  {client.keywords.map((k) => (
                    <span key={k} className="terr-badge bg-elevated text-muted-foreground text-[11px]">{k}</span>
                  ))}
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}


          <div className="terr-card p-5">
            <div className="terr-label mb-3">Live Data</div>
            <p className="text-xs text-muted-foreground mb-3">
              Pull search volumes and Google Trends for {client.keywords?.length ?? 0} keyword{client.keywords?.length === 1 ? "" : "s"} into this week.
            </p>
            <Button
              variant="outline"
              className="w-full border-primary text-primary hover:bg-primary/10"
              onClick={handlePullLiveData}
              disabled={pulling || !client?.keywords?.length}
            >
              {pulling ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />
                  Pulling live data...
                </>
              ) : (
                <>
                  <span className="mr-2">📡</span>
                  Pull Live Data
                </>
              )}
            </Button>
            <Button
              type="button"
              className="w-full mt-2 bg-primary hover:bg-primary-hover"
              onClick={handlePullAll}
              disabled={pullingAll}
              title="Pull keywords + news + AQI + YouTube in parallel"
            >
              {pullingAll ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />
                  Pulling all sources...
                </>
              ) : (
                <>
                  <span className="mr-2">⚡</span>
                  Pull All
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full mt-2 border-primary text-primary hover:bg-primary/10"
              onClick={() => setDiscoverOpen(true)}
            >
              <Sparkles className="h-3.5 w-3.5 mr-2" />
              Discover Keywords
            </Button>
          </div>

          {((client.social_profiles as SocialProfile[]) ?? []).length > 0 && (
            <div className="terr-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="terr-label">Social Watchlist</div>
                <span className="text-[10px] text-muted-foreground">
                  {((client.social_profiles as SocialProfile[]) ?? []).length} profile{((client.social_profiles as SocialProfile[]) ?? []).length === 1 ? "" : "s"}
                </span>
              </div>
              <SocialWatchlist
                clientId={client.id}
                profiles={(client.social_profiles as SocialProfile[]) ?? []}
                weekDate={week}
                onUpdated={refetch}
              />
            </div>
          )}

          <div className="terr-card p-5">
            <div className="terr-label mb-3">Brief Status</div>
            {currentBrief ? (
              <div>
                <div className={`terr-badge ${currentBrief.status === "sent" ? "bg-primary/25 text-primary-foreground" : currentBrief.status === "approved" ? "bg-success/15 text-success" : currentBrief.status === "review" ? "bg-warning/15 text-warning" : "bg-elevated text-muted-foreground"}`}>
                  {BRIEF_STATUS_LABEL[currentBrief.status] ?? currentBrief.status}
                </div>
                <Link to="/briefs/$id" params={{ id: currentBrief.id }} className="block mt-3">
                  <Button variant="outline" className="w-full">Open Brief</Button>
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No brief generated yet.</p>
            )}
            <Button
              className="w-full mt-3 bg-primary hover:bg-primary-hover"
              disabled={generating || includedCount < 2 || !!currentBrief}
              onClick={handleGenerate}
            >
              {generating ? "Synthesising..." : currentBrief ? "Brief Exists" : "Generate Brief"}
            </Button>
            {includedCount < 2 && !currentBrief && (
              <p className="text-[11px] text-muted-foreground mt-2">Need at least 2 included signals.</p>
            )}
          </div>

          {briefs.length > 0 && (
            <div className="terr-card p-5">
              <div className="terr-label mb-3">Brief History</div>
              <div className="space-y-1">
                {briefs.slice(0, 8).map((b) => {
                  const preview = (b.content as { search_signals?: string } | null)?.search_signals?.slice(0, 60) ?? "";
                  return (
                    <Link
                      key={b.id}
                      to="/briefs/$id"
                      params={{ id: b.id }}
                      className="block py-1.5 px-2 hover:bg-elevated rounded-sm"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-muted-foreground">{b.week_date}</span>
                        <span className={`terr-badge ${b.status === "sent" ? "bg-primary/25 text-primary-foreground" : "bg-elevated text-muted-foreground"}`}>{BRIEF_STATUS_LABEL[b.status] ?? b.status}</span>
                      </div>
                      {preview && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
                          {preview}{preview.length === 60 ? "…" : ""}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

        </div>
      </div>

      <AddSignalModal
        open={modal}
        onOpenChange={setModal}
        clientId={client.id}
        weekDate={week}
        onSaved={refetch}
      />
      <KeywordDiscoveryModal
        open={discoverOpen}
        onOpenChange={setDiscoverOpen}
        client={{
          id: client.id,
          name: client.name,
          market_geography: client.market_geography,
          buyer_personas: client.buyer_personas,
          keywords: client.keywords,
          gsc_property_url: client.gsc_property_url,
        }}
        onSaved={refetch}
      />
    </AppShell>
  );
}
