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
  const [pullProgress, setPullProgress] = useState<Record<string, "pending" | "done" | "failed">>({});
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
        promise: checkAQI({ data: {
          clientId: client.id,
          weekDate: week,
          sourceCities: client.aqi_source_cities && client.aqi_source_cities.length > 0 ? client.aqi_source_cities : ["delhi", "gurgaon"],
          destinationCity: client.aqi_destination_city || client.market_geography?.split(",")[0]?.trim().toLowerCase() || "dehradun",
          threshold: client.aqi_threshold ?? 280,
        } })
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

      const initialProgress: Record<string, "pending" | "done" | "failed"> = {};
      tasks.forEach((t) => { initialProgress[t.label] = "pending"; });
      initialProgress["Buyer intent"] = "pending";
      setPullProgress(initialProgress);

      const trackedTasks = tasks.map((task) => ({
        ...task,
        promise: task.promise.then((r) => {
          setPullProgress((prev) => ({ ...prev, [task.label]: "done" }));
          return r;
        }).catch((e) => {
          setPullProgress((prev) => ({ ...prev, [task.label]: "failed" }));
          throw e;
        }),
      }));

      // Buyer intent runs last so it can read the freshly-pulled keyword signals
      const earlyResults = await Promise.allSettled(trackedTasks.map((t) => t.promise));
      const buyerPromise = pullBuyer({ data: { clientId: client.id, weekDate: week } })
        .then((r) => {
          setPullProgress((prev) => ({ ...prev, "Buyer intent": "done" }));
          return r;
        })
        .catch((e) => {
          setPullProgress((prev) => ({ ...prev, "Buyer intent": "failed" }));
          throw e;
        });
      const buyerTask = { label: "Buyer intent", promise: buyerPromise };
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
      setTimeout(() => setPullProgress({}), 3000);
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
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] text-muted-foreground">
                  Toggle signals on/off to control what Claude reads when generating the brief.
                </p>
                <p className="text-[10px] font-medium text-foreground">
                  {includedCount} of {signals?.length ?? 0} included
                </p>
              </div>

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
            {(!client.keywords || client.keywords.length === 0) && (
              <div className="terr-elevated border border-warning/30 rounded-sm p-3 mb-2 mt-2">
                <p className="text-xs text-warning font-medium">No keywords configured</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Keyword and trends signals will be skipped. Use Discover Keywords
                  in Settings first for full intelligence.
                </p>
              </div>
            )}
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
            {pullingAll && Object.keys(pullProgress).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {Object.entries(pullProgress).map(([label, status]) => (
                  <span
                    key={label}
                    className={`text-[9px] px-1.5 py-0.5 rounded-sm font-medium ${
                      status === "done"
                        ? "bg-success/15 text-success"
                        : status === "failed"
                        ? "bg-danger/15 text-danger"
                        : "bg-elevated text-muted-foreground animate-pulse"
                    }`}
                  >
                    {status === "done" ? "✓" : status === "failed" ? "✗" : "⟳"} {label}
                  </span>
                ))}
              </div>
            )}

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
      )}


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

function ClientSettingsInline({
  client,
  clientId,
  onSaved,
}: {
  client: Client;
  clientId: string;
  onSaved: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Client | null>(null);
  const [socialProfiles, setSocialProfiles] = useState<SocialProfile[]>([]);
  const [newName, setNewName] = useState("");
  const [newIG, setNewIG] = useState("");
  const [newFB, setNewFB] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const genPrompt = useServerFn(generateDefaultSystemPrompt);

  useEffect(() => {
    setForm({
      ...client,
      name: client.name ?? "",
      market_geography: client.market_geography ?? "",
      keywords: client.keywords ?? [],
      competitors: client.competitors ?? [],
      buyer_personas: client.buyer_personas ?? [],
      system_prompt: client.system_prompt ?? "",
      gsc_property_url: client.gsc_property_url ?? "",
      brief_delivery_method: client.brief_delivery_method ?? "whatsapp",
      brief_delivery_contact: client.brief_delivery_contact ?? "",
      agency_name: client.agency_name ?? "",
      status: client.status ?? "active",
      meta_ad_account_id: client.meta_ad_account_id ?? "",
      meta_page_id: client.meta_page_id ?? "",
      aqi_source_cities: client.aqi_source_cities ?? ["delhi", "gurgaon"],
      aqi_destination_city: client.aqi_destination_city ?? "",
      aqi_threshold: client.aqi_threshold ?? 280,
    });
    setSocialProfiles((client.social_profiles as SocialProfile[]) ?? []);
  }, [client]);

  if (!form) return <div className="text-sm text-muted-foreground">Loading...</div>;

  function patch(p: Partial<Client>) {
    setForm((f) => (f ? { ...f, ...p } : f));
    setIsDirty(true);
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("clients").update({
        name: form.name,
        market_geography: form.market_geography,
        keywords: form.keywords,
        competitors: form.competitors,
        buyer_personas: form.buyer_personas as never,
        social_profiles: socialProfiles as never,
        system_prompt: form.system_prompt,
        gsc_property_url: form.gsc_property_url,
        brief_delivery_method: form.brief_delivery_method,
        brief_delivery_contact: form.brief_delivery_contact,
        is_white_label: form.is_white_label,
        agency_name: form.agency_name,
        status: form.status,
        meta_ad_account_id: form.meta_ad_account_id,
        meta_page_id: form.meta_page_id,
        aqi_source_cities: form.aqi_source_cities,
        aqi_destination_city: form.aqi_destination_city,
        aqi_threshold: form.aqi_threshold,
      }).eq("id", clientId);
      if (error) throw error;
      toast.success("Saved");
      setIsDirty(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally { setBusy(false); }
  }

  async function destroy() {
    const { error } = await supabase.from("clients").delete().eq("id", clientId);
    if (error) { toast.error(error.message); return; }
    toast.success("Client deleted");
    navigate({ to: "/clients" });
  }

  function addProfile() {
    if (!newName.trim()) return;
    const updated: SocialProfile[] = [
      ...socialProfiles,
      {
        id: crypto.randomUUID(),
        name: newName.trim(),
        instagram: newIG.trim() || undefined,
        facebook: newFB.trim() || undefined,
        last_reviewed: null,
      },
    ];
    setSocialProfiles(updated);
    supabase.from("clients").update({ social_profiles: updated as never }).eq("id", clientId)
      .then(({ error }) => {
        if (error) toast.error("Failed to save profile");
        else toast.success("Profile added and saved");
      });
    setNewName(""); setNewIG(""); setNewFB("");
  }

  function removeProfile(profileId: string) {
    const remaining = socialProfiles.filter((p) => p.id !== profileId);
    setSocialProfiles(remaining);
    supabase.from("clients").update({ social_profiles: remaining as never }).eq("id", clientId)
      .then(({ error }) => { if (error) toast.error("Failed to remove profile"); });
  }

  async function handleGeneratePrompt() {
    if (!form) return;
    setGenBusy(true);
    try {
      const res = await genPrompt({
        data: {
          name: form.name,
          market_geography: form.market_geography,
          keywords: form.keywords ?? [],
          competitors: form.competitors ?? [],
          buyer_personas: form.buyer_personas ?? [],
        },
      });
      patch({ system_prompt: res.prompt });
      toast.success("System prompt generated — review and save");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-end gap-3">
        {isDirty && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
            Unsaved changes
          </span>
        )}
        <Button className="bg-primary hover:bg-primary-hover" disabled={busy} onClick={save}>
          {busy ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <SettingsSection title="Basics">
        <SettingsField label="Name"><Input value={form.name} onChange={(e) => patch({ name: e.target.value })} /></SettingsField>
        <SettingsField label="Market Geography"><Input value={form.market_geography} onChange={(e) => patch({ market_geography: e.target.value })} /></SettingsField>
        <SettingsField label="Status">
          <Select value={form.status} onValueChange={(v) => patch({ status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </SettingsField>
        <div className="grid grid-cols-2 gap-4">
          <SettingsField label="Brief Delivery Method">
            <Select value={form.brief_delivery_method} onValueChange={(v) => patch({ brief_delivery_method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </SettingsField>
          <SettingsField label="Delivery Contact"><Input value={form.brief_delivery_contact} onChange={(e) => patch({ brief_delivery_contact: e.target.value })} /></SettingsField>
        </div>
        <div className="flex items-center justify-between terr-elevated p-3">
          <div>
            <div className="text-sm font-medium">White-label account</div>
            <div className="text-xs text-muted-foreground">Use agency branding in delivered briefs.</div>
          </div>
          <Switch checked={form.is_white_label} onCheckedChange={(v) => patch({ is_white_label: v })} />
        </div>
        {form.is_white_label && (
          <SettingsField label="Agency Name"><Input value={form.agency_name} onChange={(e) => patch({ agency_name: e.target.value })} /></SettingsField>
        )}
      </SettingsSection>

      <SettingsSection title="Intelligence Config">
        <SettingsField label="Keywords">
          <div className="space-y-2">
            <TagInput value={form.keywords} onChange={(v) => patch({ keywords: v })} placeholder="Add a keyword" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDiscoverOpen(true)}
              className="border-primary text-primary hover:bg-primary/10"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Discover Keywords
            </Button>
          </div>
        </SettingsField>
        <SettingsField label="Competitors"><TagInput value={form.competitors} onChange={(v) => patch({ competitors: v })} placeholder="Add a competitor" /></SettingsField>
        <SettingsField label="GSC Property URL"><Input value={form.gsc_property_url} onChange={(e) => patch({ gsc_property_url: e.target.value })} /></SettingsField>
      </SettingsSection>

      <SettingsSection title="Integrations">
        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium text-foreground mb-0.5">Meta</p>
            <p className="text-xs text-muted-foreground">
              Competitor ad intelligence uses a shared Terrain access token.
              Add your own account details below to enable campaign performance
              data (Phase 2 — requires Meta App approval).
            </p>
          </div>
          <SettingsField
            label="Meta Ad Account ID"
            hint="Your ad account ID from Meta Business Manager (act_XXXXXXXXXX). Used for campaign performance data."
          >
            <Input
              value={form.meta_ad_account_id}
              onChange={(e) => patch({ meta_ad_account_id: e.target.value })}
              placeholder="act_XXXXXXXXXXXXXXXXX"
              className="font-mono text-sm"
            />
          </SettingsField>
          <SettingsField
            label="Facebook Page ID"
            hint="Your brand's Facebook Page ID. Used to track your own ads in the Meta Ads Library."
          >
            <Input
              value={form.meta_page_id}
              onChange={(e) => patch({ meta_page_id: e.target.value })}
              placeholder="e.g. 123456789012345"
              className="font-mono text-sm"
            />
          </SettingsField>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">How to find your Page ID:</span>{" "}
            Go to your Facebook Page → About → scroll to the bottom. The Page ID is a long number.{" "}
            <span className="text-foreground font-medium">How to find your Ad Account ID:</span>{" "}
            Go to business.facebook.com → Ad Accounts. It starts with "act_".
          </p>
        </div>

        <div className="space-y-4 pt-4 border-t border-border">
          <div>
            <p className="text-xs font-medium text-foreground mb-0.5">AQI Watch</p>
            <p className="text-xs text-muted-foreground">
              Configure which cities to compare for the AQI campaign trigger.
              Source cities are where your buyers live — destination is your market.
            </p>
          </div>
          <SettingsField
            label="Source cities (buyer locations)"
            hint="Cities where your buyers currently live. High AQI here triggers a burst campaign. Separate with commas."
          >
            <Input
              value={(form.aqi_source_cities ?? []).join(", ")}
              onChange={(e) =>
                patch({
                  aqi_source_cities: e.target.value
                    .split(",")
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean),
                })
              }
              placeholder="delhi, gurgaon, noida"
              className="text-sm"
            />
          </SettingsField>
          <SettingsField
            label="Destination city (your market)"
            hint="The city where your properties are. Low AQI here is the clean-air advantage."
          >
            <Input
              value={form.aqi_destination_city}
              onChange={(e) => patch({ aqi_destination_city: e.target.value.toLowerCase().trim() })}
              placeholder="e.g. dehradun"
              className="text-sm"
            />
          </SettingsField>
          <SettingsField
            label="AQI trigger threshold"
            hint="When any source city exceeds this AQI level, a HIGH urgency campaign signal is created. Default: 280."
          >
            <div className="flex items-center gap-3">
              <Input
                type="number"
                value={form.aqi_threshold}
                onChange={(e) => patch({ aqi_threshold: Number(e.target.value) })}
                className="w-24 text-sm font-mono"
                min={100}
                max={500}
              />
              <span className="text-xs text-muted-foreground">
                {form.aqi_threshold < 150 ? "Low — triggers often" :
                 form.aqi_threshold < 250 ? "Moderate threshold" :
                 form.aqi_threshold <= 300 ? "Recommended for hill stations" :
                 "High — triggers rarely"}
              </span>
            </div>
          </SettingsField>
        </div>

        <div className="space-y-2 pt-4 border-t border-border">
          <p className="text-xs font-medium text-foreground">Google Search Console</p>
          <p className="text-xs text-muted-foreground">
            The GSC property URL is set in Intelligence Config above. Automated GSC pulls (OAuth) are on the roadmap.
          </p>
          <p className="text-[11px] text-muted-foreground font-mono">
            Current GSC URL: {form.gsc_property_url || "Not set — add in Intelligence Config above"}
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Social Profiles">
        <div className="space-y-3">
          <div>
            <Label className="terr-label">Competitor Social Profiles</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Instagram and Facebook accounts to monitor weekly.
            </p>
          </div>
          {socialProfiles.map((p) => (
            <div key={p.id} className="terr-elevated p-3 rounded-sm flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{p.name}</p>
                <div className="flex gap-3 mt-0.5 text-[10px] text-muted-foreground">
                  {p.instagram && <span style={{ color: "#C94060" }}>IG @{p.instagram}</span>}
                  {p.facebook && <span style={{ color: "#1877F2" }}>FB {p.facebook}</span>}
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-danger"
                onClick={() => removeProfile(p.id)}>Remove</Button>
            </div>
          ))}
          <div className="terr-elevated p-3 rounded-sm space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Add competitor account</p>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Competitor name" className="text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <Input value={newIG} onChange={(e) => setNewIG(e.target.value)}
                placeholder="Instagram handle (without @)" className="text-sm" />
              <Input value={newFB} onChange={(e) => setNewFB(e.target.value)}
                placeholder="Facebook page name" className="text-sm" />
            </div>
            <Button variant="outline" size="sm" onClick={addProfile} disabled={!newName.trim()}
              className="w-full text-xs">+ Add profile</Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Buyer Personas">
        <PersonaEditor value={form.buyer_personas} onChange={(v) => patch({ buyer_personas: v })} />
      </SettingsSection>

      <SettingsSection title="Claude System Prompt">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Claude uses this when generating every brief for this client.
            </p>
            <Button variant="outline" size="sm" onClick={handleGeneratePrompt} disabled={genBusy}>
              <Wand2 className="h-3.5 w-3.5 mr-1.5" />
              {genBusy ? "Generating..." : "Generate"}
            </Button>
          </div>
          <Textarea
            value={form.system_prompt}
            onChange={(e) => patch({ system_prompt: e.target.value })}
            rows={16}
            className="font-mono text-xs"
            placeholder="Click Generate to auto-write a system prompt from this client's config, or write your own..."
          />
          {!form.system_prompt && (
            <p className="text-xs text-amber-400">
              ⚠ No system prompt set — briefs will use a generic fallback.
            </p>
          )}
        </div>
      </SettingsSection>

      <div className="terr-card p-5 border-danger/40">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-danger">Danger Zone</h3>
            <p className="text-xs text-muted-foreground mt-1">Permanently delete this client and all associated signals and briefs.</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="border-danger text-danger hover:bg-danger hover:text-foreground">Delete Client</Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-elevated">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {form.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will delete the client and all associated signals and briefs. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={destroy} className="bg-danger hover:bg-danger/80">Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <KeywordDiscoveryModal
        open={discoverOpen}
        onOpenChange={setDiscoverOpen}
        client={{
          id: form.id,
          name: form.name,
          market_geography: form.market_geography,
          buyer_personas: form.buyer_personas,
          keywords: form.keywords,
          gsc_property_url: form.gsc_property_url,
        }}
        onSaved={onSaved}
      />
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="terr-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function SettingsField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="terr-label">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PersonaEditor({ value, onChange }: { value: BuyerPersona[]; onChange: (v: BuyerPersona[]) => void }) {
  function add() { onChange([...value, { name: "", location: "", trigger: "", hook: "" }]); }
  function update(i: number, patch: Partial<BuyerPersona>) {
    onChange(value.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function remove(i: number) { onChange(value.filter((_, idx) => idx !== i)); }

  return (
    <div className="space-y-3">
      {value.map((p, i) => (
        <div key={i} className="terr-elevated p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="terr-label">Persona #{i + 1}</span>
            <button onClick={() => remove(i)} className="text-muted-foreground hover:text-danger">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name" value={p.name} onChange={(e) => update(i, { name: e.target.value })} />
            <Input placeholder="Location" value={p.location} onChange={(e) => update(i, { location: e.target.value })} />
          </div>
          <Input placeholder="Trigger" value={p.trigger} onChange={(e) => update(i, { trigger: e.target.value })} />
          <Input placeholder="Hook line" value={p.hook} onChange={(e) => update(i, { hook: e.target.value })} />
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}><Plus className="h-3 w-3 mr-1" /> Add Persona</Button>
    </div>
  );
}
