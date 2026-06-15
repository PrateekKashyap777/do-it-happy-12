import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { discoverKeywords, addKeywordsToClient } from "@/lib/dataforseo.functions";
import type { DiscoveredKeyword } from "@/lib/dataforseo.functions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: {
    id: string;
    name: string;
    market_geography: string;
    buyer_personas: unknown[];
    keywords: string[];
    gsc_property_url: string;
  };
  onSaved: () => void;
}

type Step = "idle" | "discovering" | "reviewing" | "saving";

export function KeywordDiscoveryModal({ open, onOpenChange, client, onSaved }: Props) {
  const discover = useServerFn(discoverKeywords);
  const addKw = useServerFn(addKeywordsToClient);

  const [step, setStep] = useState<Step>("idle");
  const [results, setResults] = useState<DiscoveredKeyword[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [seeds, setSeeds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeTheme, setActiveTheme] = useState<string>("all");

  async function handleDiscover() {
    setStep("discovering");
    setResults([]);
    setSelected(new Set());
    try {
      const res = await discover({
        data: {
          clientId: client.id,
          name: client.name,
          market_geography: client.market_geography,
          buyer_personas: client.buyer_personas,
          existing_keywords: client.keywords,
          website_url: client.gsc_property_url,
          min_volume: 50,
        },
      });
      setResults(res.keywords);
      setThemes(res.themes);
      setSeeds(res.seeds);
      setSelected(new Set(res.keywords.map((k) => k.keyword)));
      setActiveTheme("all");
      setStep("reviewing");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Discovery failed");
      setStep("idle");
    }
  }

  function toggleKeyword(keyword: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  }

  function toggleTheme(theme: string) {
    const inTheme = results.filter((k) => k.theme === theme).map((k) => k.keyword);
    const allSelected = inTheme.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      inTheme.forEach((k) => (allSelected ? next.delete(k) : next.add(k)));
      return next;
    });
  }

  async function handleSave() {
    if (selected.size === 0) { toast.error("Select at least one keyword"); return; }
    setStep("saving");
    try {
      const res = await addKw({ data: { clientId: client.id, newKeywords: Array.from(selected) } });
      toast.success(`Added ${res.added} keywords. Client now tracking ${res.total} total.`);
      onSaved();
      onOpenChange(false);
      setStep("idle");
      setResults([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
      setStep("reviewing");
    }
  }

  const displayed = activeTheme === "all" ? results : results.filter((k) => k.theme === activeTheme);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-elevated max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>📡</span> Keyword Discovery — {client.name}
          </DialogTitle>
        </DialogHeader>

        {step === "idle" && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Terrain will use Claude to generate seed keywords from this client's context,
              then DataForSEO to discover related terms and filter by search volume.
              Takes about 20–30 seconds.
            </p>
            {client.keywords.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {client.keywords.length} keywords already tracked — duplicates will be excluded.
              </p>
            )}
            <Button className="bg-primary hover:bg-primary-hover" onClick={handleDiscover}>
              Start Discovery
            </Button>
          </div>
        )}

        {step === "discovering" && (
          <div className="py-12 text-center space-y-2">
            <div className="text-3xl">📡</div>
            <p className="text-sm font-medium">Generating seeds with Claude...</p>
            <p className="text-xs text-muted-foreground">Then expanding with DataForSEO...</p>
          </div>
        )}

        {(step === "reviewing" || step === "saving") && results.length > 0 && (
          <>
            <div className="text-xs text-muted-foreground border-b border-border pb-2">
              <span className="font-medium text-foreground">Seeds used: </span>
              {seeds.join(" · ")}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActiveTheme("all")}
                className={`text-xs px-2.5 py-1 rounded-sm border transition-colors ${
                  activeTheme === "all"
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({results.length})
              </button>
              {themes.map((theme) => {
                const count = results.filter((k) => k.theme === theme).length;
                const allChecked = results.filter((k) => k.theme === theme).every((k) => selected.has(k.keyword));
                return (
                  <button
                    key={theme}
                    onClick={() => setActiveTheme(theme)}
                    className={`text-xs px-2.5 py-1 rounded-sm border transition-colors ${
                      activeTheme === theme
                        ? "border-primary text-primary bg-primary/10"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {theme} ({count}){allChecked ? " ✓" : ""}
                  </button>
                );
              })}
            </div>

            {activeTheme !== "all" && (
              <button
                onClick={() => toggleTheme(activeTheme)}
                className="text-xs text-primary hover:underline text-left"
              >
                {displayed.every((k) => selected.has(k.keyword))
                  ? "Deselect all in this theme"
                  : "Select all in this theme"}
              </button>
            )}

            <div className="flex-1 overflow-y-auto space-y-1 -mx-1 px-1">
              {displayed.map((kw) => (
                <label
                  key={kw.keyword}
                  className={`flex items-center gap-3 p-2.5 rounded-sm cursor-pointer transition-colors hover:bg-surface ${
                    selected.has(kw.keyword) ? "bg-surface" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(kw.keyword)}
                    onChange={() => toggleKeyword(kw.keyword)}
                    className="accent-primary"
                  />
                  <span className="flex-1 text-sm text-foreground">{kw.keyword}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {kw.volume !== null && (
                      <span className="text-xs font-mono text-muted-foreground">
                        {kw.volume.toLocaleString()}/mo
                      </span>
                    )}
                    {kw.competition_level && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 ${
                          kw.competition_level === "HIGH"
                            ? "border-danger/40 text-danger"
                            : kw.competition_level === "MEDIUM"
                              ? "border-warning/40 text-warning"
                              : "border-success/40 text-success"
                        }`}
                      >
                        {kw.competition_level}
                      </Badge>
                    )}
                  </span>
                </label>
              ))}
            </div>

            <DialogFooter className="border-t border-border pt-4 flex items-center justify-between sm:justify-between">
              <span className="text-sm text-muted-foreground">
                {selected.size} of {results.length} selected
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={() => setStep("idle")}>Start Over</Button>
                <Button
                  className="bg-primary hover:bg-primary-hover"
                  onClick={handleSave}
                  disabled={selected.size === 0 || step === "saving"}
                >
                  {step === "saving" ? "Saving..." : `Add ${selected.size} Keywords`}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}

        {step === "reviewing" && results.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No new keywords found above the volume threshold. Try lowering the minimum volume
            or adding more specific terms manually.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
