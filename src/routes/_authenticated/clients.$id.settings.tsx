import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { TagInput } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import type { Client, BuyerPersona, SocialProfile } from "@/lib/terrain-types";
import { Plus, X, Sparkles } from "lucide-react";
import { KeywordDiscoveryModal } from "@/components/KeywordDiscoveryModal";
import { SocialWatchlist } from "@/components/SocialWatchlist";

export const Route = createFileRoute("/_authenticated/clients/$id/settings")({
  component: ClientSettings,
});

function ClientSettings() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Client | null>(null);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [socialProfiles, setSocialProfiles] = useState<SocialProfile[]>([]);
  const [newName, setNewName] = useState("");
  const [newIG, setNewIG] = useState("");
  const [newFB, setNewFB] = useState("");

  const { data } = useQuery({
    queryKey: ["client", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id).single();
      if (error) throw error;
      return data as unknown as Client;
    },
  });

  useEffect(() => {
    if (data) {
      setForm(data);
      setSocialProfiles((data.social_profiles as SocialProfile[]) ?? []);
    }
  }, [data]);

  if (!form) {
    return <AppShell><div className="text-sm text-muted-foreground">Loading...</div></AppShell>;
  }

  function patch(p: Partial<Client>) { setForm((f) => f ? { ...f, ...p } : f); }

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
      }).eq("id", id);
      if (error) throw error;
      toast.success("Saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally { setBusy(false); }
  }

  async function destroy() {
    const { error } = await supabase.from("clients").delete().eq("id", id);
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
    setNewName(""); setNewIG(""); setNewFB("");
  }

  function removeProfile(profileId: string) {
    setSocialProfiles((prev) => prev.filter((p) => p.id !== profileId));
  }

  return (
    <AppShell>
      <div className="mb-6 text-sm text-muted-foreground">
        <Link to="/clients" className="hover:text-foreground">Clients</Link>
        <span className="mx-2">/</span>
        <Link to="/clients/$id" params={{ id }} className="hover:text-foreground">{form.name}</Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Settings</span>
      </div>

      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold">Client Settings</h1>
        <Button className="bg-primary hover:bg-primary-hover" disabled={busy} onClick={save}>
          {busy ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <div className="space-y-6 max-w-3xl">
        <Section title="Basics">
          <Field label="Name"><Input value={form.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
          <Field label="Market Geography"><Input value={form.market_geography} onChange={(e) => patch({ market_geography: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => patch({ status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Brief Delivery Method">
              <Select value={form.brief_delivery_method} onValueChange={(v) => patch({ brief_delivery_method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Delivery Contact"><Input value={form.brief_delivery_contact} onChange={(e) => patch({ brief_delivery_contact: e.target.value })} /></Field>
          </div>
          <div className="flex items-center justify-between terr-elevated p-3">
            <div>
              <div className="text-sm font-medium">White-label account</div>
              <div className="text-xs text-muted-foreground">Use agency branding in delivered briefs.</div>
            </div>
            <Switch checked={form.is_white_label} onCheckedChange={(v) => patch({ is_white_label: v })} />
          </div>
          {form.is_white_label && (
            <Field label="Agency Name"><Input value={form.agency_name} onChange={(e) => patch({ agency_name: e.target.value })} /></Field>
          )}
        </Section>

        <Section title="Intelligence Config">
          <Field label="Keywords">
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
          </Field>
          <Field label="Competitors"><TagInput value={form.competitors} onChange={(v) => patch({ competitors: v })} placeholder="Add a competitor" /></Field>
          <Field label="GSC Property URL"><Input value={form.gsc_property_url} onChange={(e) => patch({ gsc_property_url: e.target.value })} /></Field>
        </Section>

        <Section title="Buyer Personas">
          <PersonaEditor value={form.buyer_personas} onChange={(v) => patch({ buyer_personas: v })} />
        </Section>

        <Section title="Claude System Prompt">
          <Textarea
            value={form.system_prompt}
            onChange={(e) => patch({ system_prompt: e.target.value })}
            rows={16}
            className="font-mono text-xs"
          />
        </Section>

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
        onSaved={() => {
          // Reload client to pick up newly added keywords
          void supabase.from("clients").select("*").eq("id", id).single().then(({ data: fresh }) => {
            if (fresh) setForm(fresh as unknown as Client);
          });
        }}
      />
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="terr-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="terr-label">{label}</Label>
      {children}
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
