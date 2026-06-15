import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
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
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  generateDefaultSystemPrompt,
  generatePersonaSuggestions,
} from "@/lib/anthropic.functions";
import type { BuyerPersona } from "@/lib/terrain-types";
import { Plus, X, Check, Pencil, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/clients/new")({
  component: NewClient,
});

function NewClient() {
  const navigate = useNavigate();
  const genPrompt = useServerFn(generateDefaultSystemPrompt);
  const genPersonas = useServerFn(generatePersonaSuggestions);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [market, setMarket] = useState("");
  const [delivery, setDelivery] = useState("whatsapp");
  const [contact, setContact] = useState("");
  const [whiteLabel, setWhiteLabel] = useState(false);
  const [agency, setAgency] = useState("");

  const [keywords, setKeywords] = useState<string[]>([]);
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [gscUrl, setGscUrl] = useState("");

  // Step 3 — persona suggestions
  const [suggestions, setSuggestions] = useState<BuyerPersona[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<BuyerPersona | null>(null);
  const [customPersonas, setCustomPersonas] = useState<BuyerPersona[]>([]);
  const [loadingPersonas, setLoadingPersonas] = useState(false);

  const [systemPrompt, setSystemPrompt] = useState("");
  const [genBusy, setGenBusy] = useState(false);

  // Auto-generate personas when entering Step 3
  useEffect(() => {
    if (step !== 3) return;
    if (suggestions.length > 0 || loadingPersonas) return;
    void loadPersonaSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function loadPersonaSuggestions() {
    setLoadingPersonas(true);
    try {
      const res = await genPersonas({
        data: { name, market_geography: market, keywords, competitors },
      });
      setSuggestions(res.personas);
      setSelectedIndices(new Set(res.personas.map((_, i) => i)));
    } catch {
      toast.error("Could not generate persona suggestions. Add your own below.");
    } finally {
      setLoadingPersonas(false);
    }
  }

  function toggleSuggestion(i: number) {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function startEdit(i: number, persona: BuyerPersona) {
    setEditingIndex(i);
    setEditDraft({ ...persona });
  }

  function cancelEdit() {
    setEditingIndex(null);
    setEditDraft(null);
  }

  function saveEdit() {
    if (editDraft === null || editingIndex === null) return;
    if (editingIndex < suggestions.length) {
      setSuggestions((prev) => prev.map((p, idx) => (idx === editingIndex ? editDraft : p)));
    } else {
      const ci = editingIndex - suggestions.length;
      setCustomPersonas((prev) => prev.map((p, idx) => (idx === ci ? editDraft : p)));
    }
    setEditingIndex(null);
    setEditDraft(null);
  }

  function addCustomPersona() {
    const blank: BuyerPersona = { name: "", location: "", trigger: "", hook: "" };
    setCustomPersonas((prev) => [...prev, blank]);
    setEditingIndex(suggestions.length + customPersonas.length);
    setEditDraft(blank);
  }

  function removeCustomPersona(ci: number) {
    setCustomPersonas((prev) => prev.filter((_, idx) => idx !== ci));
    if (editingIndex === suggestions.length + ci) cancelEdit();
  }

  // Final personas (selected suggestions + non-empty customs)
  const personas: BuyerPersona[] = [
    ...suggestions.filter((_, i) => selectedIndices.has(i)),
    ...customPersonas.filter((p) => p.name.trim().length > 0),
  ];


  async function handleGenPrompt() {
    if (!name || !market) { toast.error("Fill name and market first"); return; }
    setGenBusy(true);
    try {
      const res = await genPrompt({
        data: { name, market_geography: market, keywords, competitors, buyer_personas: personas },
      });
      setSystemPrompt(res.prompt);
      toast.success("System prompt generated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate");
    } finally {
      setGenBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("clients")
        .insert({
          name,
          market_geography: market,
          keywords,
          competitors,
          buyer_personas: personas as never,
          system_prompt: systemPrompt,
          gsc_property_url: gscUrl,
          brief_delivery_method: delivery,
          brief_delivery_contact: contact,
          is_white_label: whiteLabel,
          agency_name: agency,
          status: "active",
        })
        .select()
        .single();
      if (error) throw error;
      toast.success("Client created");
      navigate({ to: "/clients/$id", params: { id: data!.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setBusy(false);
    }
  }

  const canNext1 = name.trim() && market.trim();
  const canNext2 = true;

  return (
    <AppShell>
      <div className="mb-6 text-sm text-muted-foreground">
        <Link to="/clients" className="hover:text-foreground">Clients</Link>
        <span className="mx-2">/</span>
        <span>New Client</span>
      </div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold">Add Client</h1>
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <Step n={1} active={step === 1} done={step > 1}>Basics</Step>
          <Step n={2} active={step === 2} done={step > 2}>Intelligence</Step>
          <Step n={3} active={step === 3} done={step > 3}>Personas</Step>
          <Step n={4} active={step === 4} done={false}>Prompt</Step>
        </div>
      </div>

      <div className="terr-card p-6 max-w-3xl">
        {step === 1 && (
          <div className="space-y-5">
            <Field label="Client Name *">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pincode Bharat" />
            </Field>
            <Field label="Market Geography *">
              <Input value={market} onChange={(e) => setMarket(e.target.value)} placeholder="e.g. Dehradun, Mussoorie Road corridor" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Brief Delivery Method">
                <Select value={delivery} onValueChange={setDelivery}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Delivery Contact">
                <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="+91 98xxx or email@domain.com" />
              </Field>
            </div>
            <div className="flex items-center justify-between terr-elevated p-3">
              <div>
                <div className="text-sm font-medium">White-label account</div>
                <div className="text-xs text-muted-foreground">Brief headers will use the agency name.</div>
              </div>
              <Switch checked={whiteLabel} onCheckedChange={setWhiteLabel} />
            </div>
            {whiteLabel && (
              <Field label="Agency Name">
                <Input value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="BarnE Consulting" />
              </Field>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <Field label="Keywords to track" hint="Optional — auto-discover keywords after creating the client using the Discover Keywords button on the client page.">
              <TagInput value={keywords} onChange={setKeywords} placeholder="e.g. flats in Dehradun" />
            </Field>
            <Field label="Competitors to monitor">
              <TagInput value={competitors} onChange={setCompetitors} placeholder="e.g. Pacific Golf Estate" />
            </Field>
            <Field label="Google Search Console property URL (optional)">
              <Input value={gscUrl} onChange={(e) => setGscUrl(e.target.value)} placeholder="https://example.com/" />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Add key buyer personas — Claude uses these to target content recommendations.</p>
              <Button variant="outline" size="sm" onClick={addPersona}>
                <Plus className="h-3 w-3 mr-1" /> Add Persona
              </Button>
            </div>
            {personas.length === 0 ? (
              <div className="terr-elevated p-8 text-center text-sm text-muted-foreground">No personas yet.</div>
            ) : personas.map((p, i) => (
              <div key={i} className="terr-elevated p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="terr-label">Persona #{i + 1}</span>
                  <button onClick={() => removePersona(i)} className="text-muted-foreground hover:text-danger">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="Name (e.g. Chandigarh Investor)" value={p.name} onChange={(e) => updatePersona(i, { name: e.target.value })} />
                  <Input placeholder="Location" value={p.location} onChange={(e) => updatePersona(i, { location: e.target.value })} />
                </div>
                <Input placeholder="Trigger (e.g. Delhi AQI spike)" value={p.trigger} onChange={(e) => updatePersona(i, { trigger: e.target.value })} />
                <Input placeholder="Hook line" value={p.hook} onChange={(e) => updatePersona(i, { hook: e.target.value })} />
              </div>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="terr-label">System Prompt</Label>
                <p className="text-xs text-muted-foreground mt-1">Claude uses this for every brief. Generate a starting draft or write your own.</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleGenPrompt} disabled={genBusy}>
                {genBusy ? "Generating..." : "Generate with Claude"}
              </Button>
            </div>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={18}
              className="font-mono text-xs"
              placeholder="You are a market intelligence analyst for..."
            />
          </div>
        )}

        <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
          <Button variant="ghost" disabled={step === 1} onClick={() => setStep(step - 1)}>Back</Button>
          {step < 4 ? (
            <Button
              className="bg-primary hover:bg-primary-hover"
              disabled={(step === 1 && !canNext1) || (step === 2 && !canNext2)}
              onClick={() => setStep(step + 1)}
            >
              Continue
            </Button>
          ) : (
            <Button className="bg-primary hover:bg-primary-hover" disabled={busy} onClick={submit}>
              {busy ? "Saving..." : "Create Client"}
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="terr-label">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Step({ n, active, done, children }: { n: number; active: boolean; done: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-1.5 ${active ? "text-foreground" : done ? "text-primary" : ""}`}>
      <span className={`w-5 h-5 rounded-sm flex items-center justify-center text-[10px] ${active ? "bg-accent text-background" : done ? "bg-primary text-primary-foreground" : "bg-elevated"}`}>{n}</span>
      <span className="uppercase tracking-wider">{children}</span>
    </div>
  );
}
