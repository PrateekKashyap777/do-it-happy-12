import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Copy, ChevronDown, RefreshCw, Check, Send, Sparkles } from "lucide-react";
import { regenerateSection, generateBrief } from "@/lib/anthropic.functions";
import { formatForWhatsApp } from "@/lib/terrain-utils";
import type {
  Brief, BriefContent, Client, Signal, ContentRecommendation,
} from "@/lib/terrain-types";

export const Route = createFileRoute("/_authenticated/briefs/$id")({
  component: BriefStudio,
});

const SECTIONS: { key: keyof BriefContent; label: string; icon: string }[] = [
  { key: "search_signals", label: "Search Signals", icon: "🔍" },
  { key: "competitor_activity", label: "Competitor Activity", icon: "👁️" },
  { key: "rera_watch", label: "RERA Watch", icon: "🏛️" },
  { key: "buyer_behaviour", label: "Buyer Behaviour", icon: "💬" },
  { key: "content_recommendations", label: "Content Recommendations", icon: "🎥" },
  { key: "campaign_adjustment", label: "Campaign Adjustment", icon: "⚡" },
];

const BRIEF_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  review: "In Review",
  approved: "Approved",
  sent: "Sent",
};


function BriefStudio() {
  const { id } = Route.useParams();
  const regen = useServerFn(regenerateSection);
  const genBrief = useServerFn(generateBrief);
  const [content, setContent] = useState<BriefContent | null>(null);
  const [notes, setNotes] = useState("");
  const [regenKey, setRegenKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [regenAll, setRegenAll] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [isDirty, setIsDirty] = useState(false);


  const { data, refetch } = useQuery({
    queryKey: ["brief", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("briefs").select("*").eq("id", id).single();
      if (error) throw error;
      const brief = data as unknown as Brief;
      const [c, s] = await Promise.all([
        supabase.from("clients").select("*").eq("id", brief.client_id).single(),
        supabase.from("signals").select("*").eq("client_id", brief.client_id).eq("week_date", brief.week_date),
      ]);
      if (c.error) throw c.error;
      if (s.error) throw s.error;
      return {
        brief,
        client: c.data as unknown as Client,
        signals: (s.data ?? []) as unknown as Signal[],
      };
    },
  });

  useEffect(() => {
    if (data?.brief) {
      setContent(data.brief.content);
      setNotes(data.brief.reviewer_notes ?? "");
      setIsDirty(false);
    }
  }, [data?.brief]);

  // Warn on tab close / refresh with unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Cmd/Ctrl+S to save (uses ref so it always calls the latest saveDraft)
  const saveDraftRef = useRef<() => void>(() => {});
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveDraftRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!data || !content) {
    return <AppShell><div className="text-sm text-muted-foreground">Loading brief...</div></AppShell>;
  }


  const { brief, client, signals } = data;
  const included = signals.filter((s) => s.is_included);

  function patchSection<K extends keyof BriefContent>(key: K, value: BriefContent[K]) {
    setContent((c) => (c ? { ...c, [key]: value } : c));
    setIsDirty(true);
  }


  async function saveDraft() {
    if (!content) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("briefs").update({
        content: content as never,
        reviewer_notes: notes,
      }).eq("id", id);
      if (error) throw error;
      setIsDirty(false);
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  saveDraftRef.current = () => { if (!saving) saveDraft(); };



  async function updateStatus(status: Brief["status"]) {
    const patch: Record<string, unknown> = { status, reviewer_notes: notes, content };
    if (status === "approved") patch.reviewed_at = new Date().toISOString();
    if (status === "sent") patch.sent_at = new Date().toISOString();
    const { error } = await supabase.from("briefs").update(patch as never).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setIsDirty(false);
    toast.success(`Marked ${BRIEF_STATUS_LABEL[status] ?? status}`);
    refetch();
  }

  async function handleRegenerate(key: keyof BriefContent) {
    setRegenKey(key);
    try {
      const res = await regen({
        data: { client, signals: included, sectionKey: key, weekDate: brief.week_date },
      });
      if (res.kind === "array") {
        patchSection("content_recommendations", res.recommendations);
      } else {
        patchSection(key as keyof BriefContent, res.text as never);
      }
      toast.success("Section regenerated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Regeneration failed");
    } finally { setRegenKey(null); }
  }

  async function handleRegenerateAll() {
    setConfirmRegen(false);
    setRegenAll(true);
    try {
      const { content: newContent, prompt_used } = await genBrief({
        data: { client, signals: included, weekDate: brief.week_date },
      });
      const { error } = await supabase.from("briefs").update({
        content: newContent as never,
        prompt_used,
        signal_count: included.length,
        generated_at: new Date().toISOString(),
        status: "review",
      }).eq("id", id);
      if (error) throw error;
      setContent(newContent);
      setIsDirty(false);
      toast.success("Brief regenerated");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Regeneration failed");
    } finally { setRegenAll(false); }
  }

  // Cmd/Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (!saving) saveDraft();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, notes, saving]);


  function copyWhatsApp() {
    const text = formatForWhatsApp(
      { ...brief, content: content as BriefContent },
      client.name,
      brief.week_date,
      client.is_white_label ? client.agency_name : undefined,
    );
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard for WhatsApp");
  }

  return (
    <AppShell>
      <div className="mb-6 text-sm text-muted-foreground">
        <Link to="/clients" className="hover:text-foreground">Clients</Link>
        <span className="mx-2">/</span>
        <Link to="/clients/$id" params={{ id: client.id }} className="hover:text-foreground">{client.name}</Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Brief · {brief.week_date}</span>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">Brief Studio</h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">Week of {brief.week_date}</p>
        </div>
        <span className={`terr-badge ${brief.status === "sent" ? "bg-primary/25 text-primary-foreground" : brief.status === "approved" ? "bg-success/15 text-success" : brief.status === "review" ? "bg-warning/15 text-warning" : "bg-elevated text-muted-foreground"}`}>
          {brief.status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* LEFT: sections */}
        <div className="space-y-4">
          {SECTIONS.map(({ key, label, icon }) => (
            <div key={key} className="terr-card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <span>{icon}</span>{label}
                </h3>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => handleRegenerate(key)}
                  disabled={regenKey === key}
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1 ${regenKey === key ? "animate-spin" : ""}`} />
                  Regenerate
                </Button>
              </div>
              {key === "content_recommendations" ? (
                <RecommendationsEditor
                  value={content.content_recommendations ?? []}
                  onChange={(v) => patchSection("content_recommendations", v)}
                />
              ) : (
                <Textarea
                  value={(content[key] as string) ?? ""}
                  onChange={(e) => patchSection(key, e.target.value as never)}
                  rows={4}
                  className="text-sm"
                />
              )}
            </div>
          ))}
        </div>

        {/* RIGHT: controls */}
        <div className="space-y-4">
          <div className="terr-card p-5 space-y-2">
            <div className="terr-label">Client</div>
            <div className="text-sm font-medium">{client.name}</div>
            <div className="text-xs text-muted-foreground">{client.market_geography}</div>
            <div className="text-xs font-mono text-muted-foreground">Week of {brief.week_date}</div>
          </div>

          <Collapsible>
            <div className="terr-card p-5">
              <CollapsibleTrigger className="w-full flex items-center justify-between">
                <div>
                  <div className="terr-label">Signals Used</div>
                  <div className="terr-stat mt-2">{brief.signal_count}</div>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-1.5 max-h-60 overflow-y-auto">
                {included.map((s) => (
                  <div key={s.id} className="text-xs py-1 border-b border-border last:border-0">
                    <span className="text-muted-foreground mr-2">[{s.signal_type}]</span>{s.title}
                  </div>
                ))}
              </CollapsibleContent>
            </div>
          </Collapsible>

          <div className="terr-card p-5 space-y-3">
            <div className="terr-label">Reviewer Notes</div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="text-xs" />
            <Button variant="outline" className="w-full" onClick={saveDraft} disabled={saving}>
              {saving ? "Saving..." : "Save Draft"}
            </Button>
          </div>

          <div className="terr-card p-5 space-y-2">
            <div className="terr-label mb-2">Actions</div>
            <Button variant="outline" className="w-full" onClick={copyWhatsApp}>
              <Copy className="h-3.5 w-3.5 mr-2" /> Copy for WhatsApp
            </Button>
            <Button
              className="w-full bg-success hover:bg-success/80"
              onClick={() => updateStatus("approved")}
              disabled={brief.status === "approved" || brief.status === "sent"}
            >
              <Check className="h-3.5 w-3.5 mr-2" /> Approve
            </Button>
            <Button
              className="w-full bg-primary hover:bg-primary-hover"
              onClick={() => updateStatus("sent")}
              disabled={brief.status === "sent"}
            >
              <Send className="h-3.5 w-3.5 mr-2" /> Mark Sent
            </Button>
          </div>

          <div className="terr-card p-5 space-y-2">
            <div className="terr-label">Delivery</div>
            <div className="text-xs">
              <span className="text-muted-foreground">Method:</span> {client.brief_delivery_method}
            </div>
            <div className="text-xs">
              <span className="text-muted-foreground">Contact:</span>{" "}
              <span className="font-mono">{client.brief_delivery_contact || "—"}</span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function RecommendationsEditor({
  value, onChange,
}: { value: ContentRecommendation[]; onChange: (v: ContentRecommendation[]) => void }) {
  function update(i: number, patch: Partial<ContentRecommendation>) {
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  // Ensure 3 slots
  const filled: ContentRecommendation[] = [0, 1, 2].map(
    (i) => value[i] ?? { priority: i + 1, format: "", platform: "", hook: "", topic: "", persona: "" },
  );

  return (
    <div className="space-y-3">
      {filled.map((r, i) => (
        <div key={i} className="terr-elevated p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="terr-badge bg-accent/20 text-accent">#{r.priority}</span>
            <Input placeholder="Format (Reel, Story, Post)" value={r.format} onChange={(e) => update(i, { format: e.target.value })} className="flex-1" />
            <Input placeholder="Platform" value={r.platform} onChange={(e) => update(i, { platform: e.target.value })} className="flex-1" />
          </div>
          <Input placeholder="Hook" value={r.hook} onChange={(e) => update(i, { hook: e.target.value })} className="font-medium" />
          <Textarea placeholder="Topic" value={r.topic} onChange={(e) => update(i, { topic: e.target.value })} rows={2} className="text-sm" />
          <Input placeholder="Persona" value={r.persona} onChange={(e) => update(i, { persona: e.target.value })} />
        </div>
      ))}
    </div>
  );
}
