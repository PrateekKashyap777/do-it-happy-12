import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import type { Client, Brief } from "@/lib/terrain-types";

export const Route = createFileRoute("/_authenticated/clients/")({
  component: ClientsList,
});

function ClientsList() {
  const { data, isLoading } = useQuery({
    queryKey: ["clients-list"],
    queryFn: async () => {
      const [c, b] = await Promise.all([
        supabase.from("clients").select("*").order("created_at", { ascending: false }),
        supabase.from("briefs").select("client_id, week_date, sent_at").order("week_date", { ascending: false }),
      ]);
      if (c.error) throw c.error;
      if (b.error) throw b.error;
      return { clients: (c.data ?? []) as unknown as Client[], briefs: (b.data ?? []) as unknown as Brief[] };
    },
  });

  const clients = data?.clients ?? [];
  const lastBrief = new Map<string, string>();
  data?.briefs.forEach((b) => {
    if (!lastBrief.has(b.client_id)) lastBrief.set(b.client_id, b.week_date);
  });

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Link to="/clients/new">
          <Button className="bg-primary hover:bg-primary-hover">Add Client</Button>
        </Link>
      </div>

      <div className="terr-card">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : clients.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-medium">No clients yet</p>
            <p className="text-sm text-muted-foreground mt-1">Add your first client to start collecting signals.</p>
            <Link to="/clients/new" className="mt-4 inline-block">
              <Button className="bg-primary hover:bg-primary-hover mt-4">Add Client</Button>
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="terr-label px-5 py-2 font-normal">Name</th>
                <th className="terr-label px-5 py-2 font-normal">Market</th>
                <th className="terr-label px-5 py-2 font-normal">Keywords</th>
                <th className="terr-label px-5 py-2 font-normal">Status</th>
                <th className="terr-label px-5 py-2 font-normal">Last Brief</th>
                <th className="terr-label px-5 py-2 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c, i) => (
                <tr key={c.id} className={i % 2 === 1 ? "bg-elevated/40" : ""}>
                  <td className="px-5 py-3">
                    <Link to="/clients/$id" params={{ id: c.id }} className="font-medium hover:text-accent">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{c.market_geography}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.keywords.slice(0, 3).map((k) => (
                        <span key={k} className="terr-badge bg-elevated text-muted-foreground">{k}</span>
                      ))}
                      {c.keywords.length > 3 && (
                        <span className="terr-badge text-muted-foreground">+{c.keywords.length - 3} more</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`terr-badge ${c.status === "active" ? "bg-success/15 text-success" : "bg-elevated text-muted-foreground"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                    {lastBrief.get(c.id) ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-right space-x-2">
                    <Link to="/clients/$id" params={{ id: c.id }}>
                      <Button size="sm" variant="ghost">View</Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { window.location.href = `/clients/${c.id}/settings`; }}
                    >
                      Settings
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppShell>
  );
}
