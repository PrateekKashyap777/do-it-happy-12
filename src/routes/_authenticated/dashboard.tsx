import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { currentWeekMonday } from "@/lib/terrain-utils";
import type { Client, Brief, Signal } from "@/lib/terrain-types";
import { toast } from "sonner";
import { generateBrief } from "@/lib/anthropic.functions";
import { seedDemoClient } from "@/lib/seed.functions";
import { useServerFn } from "@tanstack/react-start";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

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
        supabase.from("signals").select("*").eq("week_date", week),
        supabase.from("briefs").select("*").eq("week_date", week),
      ]);
      if (clientsRes.error) throw clientsRes.error;
      if (signalsRes.error) throw signalsRes.error;
      if (briefsRes.error) throw briefsRes.error;
      return {
        clients: (clientsRes.data ?? []) as unknown as Client[],
        signals: (signalsRes.data ?? []) as unknown as Signal[],
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
  const briefsDue = active.filter((c) => {
    const b = briefByClient.get(c.id);
    return !b || (b.status !== "approved" && b.status !== "sent");
  });
  const awaitingReview = briefs.filter((b) => b.status === "review");

  async function handleGenerate(clientId: string) {
    setGeneratingFor(clientId);
    try {
      const client = clients.find((c) => c.id === clientId)!;
      const { data: clientSignals, error } = await supabase
        .from("signals")
        .select("*")
        .eq("client_id", clientId)
        .eq("week_date", week)
        .eq("is_included", true);
      if (error) throw error;
      if (!clientSignals || clientSignals.length < 2) {
        toast.error("Add at least 2 signals before generating a brief.");
        return;
      }
      const { content, prompt_used } = await genBrief({
        data: { client, signals: clientSignals as Signal[], weekDate: week },
      });
      const { data: brief, error: insErr } = await supabase
        .from("briefs")
        .insert({
          client_id: clientId,
          week_date: week,
          status: "review",
          content: content as never,
          prompt_used,
          signal_count: clientSignals.length,
          generated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (insErr) throw insErr;
      toast.success("Brief generated");
      navigate({ to: "/briefs/$id", params: { id: brief!.id } });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Brief generation failed — ${err.message}`
          : "Brief generation failed — try again or add more signals.",
      );
    } finally {
      setGeneratingFor(null);
      refetch();
    }
  }

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Command Center</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">
          Week of {week}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <MetricCard label="Active Clients" value={active.length} loading={isLoading} />
        <MetricCard label="Briefs Due" value={briefsDue.length} loading={isLoading} accent={briefsDue.length > 0} />
        <MetricCard label="Signals This Week" value={signals.length} loading={isLoading} />
        <MetricCard label="Awaiting Review" value={awaitingReview.length} loading={isLoading} accent={awaitingReview.length > 0} />
      </div>

      <div className="terr-card">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold">This Week's Briefing Status</h2>
          <span className="terr-label">{active.length} client{active.length === 1 ? "" : "s"}</span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : active.length === 0 ? (
          <EmptyState
            title="No clients yet"
            description="Add your first client to start collecting signals."
            cta={<Link to="/clients/new"><Button className="bg-primary hover:bg-primary-hover">Add Client</Button></Link>}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="terr-label px-5 py-2 font-normal">Client</th>
                <th className="terr-label px-5 py-2 font-normal">Market</th>
                <th className="terr-label px-5 py-2 font-normal">Signals</th>
                <th className="terr-label px-5 py-2 font-normal">Brief Status</th>
                <th className="terr-label px-5 py-2 font-normal text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {active.map((c, i) => {
                const sigCount = signals.filter((s) => s.client_id === c.id).length;
                const b = briefByClient.get(c.id);
                return (
                  <tr key={c.id} className={i % 2 === 1 ? "bg-elevated/40" : ""}>
                    <td className="px-5 py-3">
                      <Link to="/clients/$id" params={{ id: c.id }} className="font-medium hover:text-accent">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{c.market_geography}</td>
                    <td className="px-5 py-3">
                      <SignalCountBadge count={sigCount} />
                    </td>
                    <td className="px-5 py-3"><BriefStatusBadge brief={b} /></td>
                    <td className="px-5 py-3 text-right">
                      {!b || b.status === "draft" ? (
                        <Button
                          size="sm"
                          className="bg-primary hover:bg-primary-hover"
                          disabled={generatingFor === c.id}
                          onClick={() => handleGenerate(c.id)}
                        >
                          {generatingFor === c.id ? "Synthesising..." : "Generate Brief"}
                        </Button>
                      ) : b.status === "sent" ? (
                        <Link to="/briefs/$id" params={{ id: b.id }}>
                          <Button size="sm" variant="ghost">View</Button>
                        </Link>
                      ) : (
                        <Link to="/briefs/$id" params={{ id: b.id }}>
                          <Button size="sm" variant="outline">Open Brief</Button>
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}

function MetricCard({
  label, value, loading, accent,
}: { label: string; value: number; loading: boolean; accent?: boolean }) {
  return (
    <div className="terr-card p-5">
      <div className="terr-label">{label}</div>
      <div className={`terr-stat mt-3 ${accent ? "text-accent" : ""}`}>
        {loading ? "—" : value}
      </div>
    </div>
  );
}

function SignalCountBadge({ count }: { count: number }) {
  const cls =
    count >= 5
      ? "bg-success/15 text-success"
      : count >= 2
        ? "bg-warning/15 text-warning"
        : "bg-danger/15 text-danger";
  return <span className={`terr-badge font-mono ${cls}`}>{count}</span>;
}

function BriefStatusBadge({ brief }: { brief?: Brief }) {
  if (!brief) return <span className="terr-badge border border-danger text-danger">Not Started</span>;
  const map: Record<string, string> = {
    draft: "bg-elevated text-muted-foreground",
    review: "bg-warning/15 text-warning",
    approved: "bg-success/15 text-success",
    sent: "bg-primary/25 text-primary-foreground",
  };
  return <span className={`terr-badge ${map[brief.status] ?? "bg-elevated"}`}>{brief.status}</span>;
}

function EmptyState({ title, description, cta }: { title: string; description: string; cta?: React.ReactNode }) {
  return (
    <div className="p-12 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{description}</p>
      {cta && <div className="mt-4 flex justify-center">{cta}</div>}
    </div>
  );
}
