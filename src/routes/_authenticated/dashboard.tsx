import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { currentWeekMonday, getErrorMessage } from "@/lib/terrain-utils";
import type { Client, Brief, Signal } from "@/lib/terrain-types";
import { toast } from "sonner";
import { generateBrief } from "@/lib/anthropic.functions";
import { seedDemoClient } from "@/lib/seed.functions";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type ClientState = "sent" | "review" | "approved" | "ready" | "needs_data" | "no_signals";

function Dashboard() {
  const week = currentWeekMonday();
  const navigate = useNavigate();
  const genBrief = useServerFn(generateBrief);
  const seedDemo = useServerFn(seedDemoClient);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["dashboard", week],
    queryFn: async () => {
      const [clientsRes, signalsRes, briefsRes] = await Promise.all([
        supabase.from("clients").select("*").order("created_at", { ascending: false }),
        supabase.from("signals").select("client_id, id").eq("week_date", week),
        supabase.from("briefs").select("*").eq("week_date", week),
      ]);
      return {
        clients: (clientsRes.data ?? []) as unknown as Client[],
        signals: (signalsRes.data ?? []) as { client_id: string; id: string }[],
        briefs: (briefsRes.data ?? []) as unknown as Brief[],
      };
    },
  });

  const clients = data?.clients ?? [];
  const signals = data?.signals ?? [];
  const briefs = data?.briefs ?? [];
  const active = clients.filter((c) => c.status === "active");
  const briefByClient = new Map<string, Brief>();
  briefs.forEach((b) => briefByClient.set(b.client_id, b));
  const sigCountByClient = new Map<string, number>();
  signals.forEach((s) => {
    sigCountByClient.set(s.client_id, (sigCountByClient.get(s.client_id) ?? 0) + 1);
  });

  function getClientState(c: Client): ClientState {
    const b = briefByClient.get(c.id);
    const sigs = sigCountByClient.get(c.id) ?? 0;
    if (b?.status === "sent") return "sent";
    if (b?.status === "approved") return "approved";
    if (b?.status === "review") return "review";
    if (sigs >= 5) return "ready";
    if (sigs > 0) return "needs_data";
    return "no_signals";
  }

  async function handleGenerate(c: Client) {
    setGeneratingFor(c.id);
    try {
      const { data: clientSignals } = await supabase
        .from("signals").select("*")
        .eq("client_id", c.id).eq("week_date", week).eq("is_included", true);
      if (!clientSignals || clientSignals.length < 2) {
        toast.error("Add at least 2 signals before generating.");
        navigate({ to: "/clients/$id", params: { id: c.id } });
        return;
      }
      const { content, prompt_used } = await genBrief({
        data: { client: c, signals: clientSignals as Signal[], weekDate: week },
      });
      const { data: brief, error } = await supabase.from("briefs").insert({
        client_id: c.id, week_date: week, status: "review",
        content: content as never, prompt_used,
        signal_count: clientSignals.length,
        generated_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      toast.success("Brief generated");
      navigate({ to: "/briefs/$id", params: { id: brief!.id } });
    } catch (err) {
      toast.error(getErrorMessage(err, "Brief generation failed"));
    } finally {
      setGeneratingFor(null);
      refetch();
    }
  }

  const doneCount = active.filter((c) => {
    const s = getClientState(c);
    return s === "sent" || s === "approved";
  }).length;

  const dateStr = new Date(week).toLocaleDateString("en-IN", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <AppShell>
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <p className="text-[10px] tracking-[3px] uppercase text-muted-foreground mb-1">
            Terrain Intelligence
          </p>
          <h1 className="text-2xl font-semibold">Week of {dateStr}</h1>
        </div>
        {active.length > 0 && (
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums">
              {doneCount}
              <span className="text-muted-foreground text-lg">/{active.length}</span>
            </div>
            <p className="text-[10px] tracking-[2px] uppercase text-muted-foreground mt-1">
              briefs delivered
            </p>
          </div>
        )}
      </div>

      {/* Empty state */}
      {!isLoading && active.length === 0 && (
        <div className="terr-card p-12 text-center">
          <p className="font-medium">No clients yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Add your first client or explore with demo data.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              variant="outline"
              disabled={seeding}
              onClick={async () => {
                setSeeding(true);
                try {
                  const res = await seedDemo();
                  navigate({ to: "/clients/$id", params: { id: res.clientId } });
                } catch (err) {
                  toast.error(getErrorMessage(err, "Failed"));
                } finally { setSeeding(false); }
              }}
            >
              {seeding ? "Creating..." : "Try demo data"}
            </Button>
            <Link to="/clients/new">
              <Button className="bg-primary hover:bg-primary-hover">Add Client</Button>
            </Link>
          </div>
        </div>
      )}

      {/* Client workflow cards */}
      {active.length > 0 && (
        <div className="space-y-3">
          {isLoading
            ? [1, 2, 3].map((i) => (
                <div key={i} className="terr-card p-5 h-[82px] animate-pulse" />
              ))
            : active.map((c) => {
                const state = getClientState(c);
                const sigCount = sigCountByClient.get(c.id) ?? 0;
                const brief = briefByClient.get(c.id);

                const stateConfig: Record<ClientState, {
                  dot: string; label: string; sublabel: string;
                  action: React.ReactNode;
                }> = {
                  sent: {
                    dot: "bg-success",
                    label: "Brief delivered",
                    sublabel: `${sigCount} signals · sent this week`,
                    action: (
                      <Link to="/briefs/$id" params={{ id: brief!.id }}>
                        <Button variant="ghost" size="sm" className="text-muted-foreground">
                          View →
                        </Button>
                      </Link>
                    ),
                  },
                  approved: {
                    dot: "bg-success",
                    label: "Approved — ready to send",
                    sublabel: `${sigCount} signals`,
                    action: (
                      <Link to="/briefs/$id" params={{ id: brief!.id }}>
                        <Button size="sm" className="bg-primary hover:bg-primary-hover">
                          Send brief →
                        </Button>
                      </Link>
                    ),
                  },
                  review: {
                    dot: "bg-warning animate-pulse",
                    label: "Brief awaiting review",
                    sublabel: `${sigCount} signals · generated, not approved`,
                    action: (
                      <Link to="/briefs/$id" params={{ id: brief!.id }}>
                        <Button size="sm" className="bg-primary hover:bg-primary-hover">
                          Review brief →
                        </Button>
                      </Link>
                    ),
                  },
                  ready: {
                    dot: "bg-accent",
                    label: "Ready to generate",
                    sublabel: `${sigCount} signals pulled · no brief yet`,
                    action: (
                      <Button
                        size="sm"
                        className="bg-primary hover:bg-primary-hover"
                        disabled={generatingFor === c.id}
                        onClick={() => handleGenerate(c)}
                      >
                        {generatingFor === c.id ? "Generating..." : "Generate brief →"}
                      </Button>
                    ),
                  },
                  needs_data: {
                    dot: "bg-warning",
                    label: "More data needed",
                    sublabel: `${sigCount} signal${sigCount !== 1 ? "s" : ""} · pull more before generating`,
                    action: (
                      <Link to="/clients/$id" params={{ id: c.id }}>
                        <Button size="sm" variant="outline">Pull data →</Button>
                      </Link>
                    ),
                  },
                  no_signals: {
                    dot: "bg-danger",
                    label: "No data yet",
                    sublabel: "Pull all sources to start",
                    action: (
                      <Link to="/clients/$id" params={{ id: c.id }}>
                        <Button size="sm" variant="outline">Pull data →</Button>
                      </Link>
                    ),
                  },
                };

                const cfg = stateConfig[state];

                return (
                  <div
                    key={c.id}
                    className="terr-card p-5 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <Link
                            to="/clients/$id"
                            params={{ id: c.id }}
                            className="font-medium hover:text-accent truncate"
                          >
                            {c.name}
                          </Link>
                          {c.market_geography && (
                            <span className="text-xs text-muted-foreground hidden sm:block shrink-0">
                              {c.market_geography}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{cfg.sublabel}</p>
                      </div>
                    </div>
                    <div className="shrink-0">{cfg.action}</div>
                  </div>
                );
              })}
        </div>
      )}
    </AppShell>
  );
}
