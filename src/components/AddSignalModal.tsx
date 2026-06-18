import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { SignalType, Urgency } from "@/lib/terrain-types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  weekDate: string;
  onSaved: () => void;
}

export function AddSignalModal({ open, onOpenChange, clientId, weekDate, onSaved }: Props) {
  const [type, setType] = useState<SignalType>("search_query");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [urgency, setUrgency] = useState<Urgency>("medium");
  const [busy, setBusy] = useState(false);

  // Search-query quantitative fields
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [ctr, setCtr] = useState("");
  const [position, setPosition] = useState("");
  const [weekChange, setWeekChange] = useState("");

  // Market / SEMrush quantitative fields
  const [volume, setVolume] = useState("");
  const [movement, setMovement] = useState("");

  // Buyer behaviour quantitative fields
  const [formFills, setFormFills] = useState("");
  const [cpl, setCpl] = useState("");
  const [waResponseRate, setWaResponseRate] = useState("");
  const [siteVisits, setSiteVisits] = useState("");
  const [adSpend, setAdSpend] = useState("");

  function resetFields() {
    setTitle(""); setContent(""); setUrgency("medium");
    setImpressions(""); setClicks(""); setCtr(""); setPosition(""); setWeekChange("");
    setVolume(""); setMovement("");
    setFormFills(""); setCpl(""); setWaResponseRate("");
    setSiteVisits(""); setAdSpend("");
  }

  function buildData(): Record<string, number> {
    const data: Record<string, number> = {};
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    if (type === "search_query") {
      const map = { impressions, clicks, ctr, position, week_change_pct: weekChange };
      for (const [k, v] of Object.entries(map)) {
        const n = num(v);
        if (n !== null && !Number.isNaN(n)) data[k] = n;
      }
    } else if (type === "market") {
      const map = { volume, movement_pct: movement };
      for (const [k, v] of Object.entries(map)) {
        const n = num(v);
        if (n !== null && !Number.isNaN(n)) data[k] = n;
      }
    } else if (type === "buyer_behaviour") {
      const map = {
        form_fills: formFills,
        cpl,
        whatsapp_response_rate: waResponseRate,
        site_visits: siteVisits,
        spend: adSpend,
      };
      for (const [k, v] of Object.entries(map)) {
        const n = num(v);
        if (n !== null && !Number.isNaN(n)) data[k] = n;
      }
    }
    return data;
  }


  async function save() {
    if (!title.trim()) { toast.error("Title is required"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from("signals").insert({
        client_id: clientId,
        signal_type: type,
        source: "manual",
        title: title.trim(),
        content: content.trim(),
        urgency,
        week_date: weekDate,
        is_included: true,
        data: buildData(),
      });
      if (error) throw error;
      toast.success("Signal added");
      resetFields();
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-elevated max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Intelligence Signal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="terr-label">Signal Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as SignalType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="search_query">Search Query</SelectItem>
                <SelectItem value="competitor">Competitor Activity</SelectItem>
                <SelectItem value="news">News</SelectItem>
                <SelectItem value="rera">RERA Update</SelectItem>
                <SelectItem value="buyer_behaviour">Buyer Behaviour</SelectItem>
                <SelectItem value="market">Market Data</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="terr-label">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Headline, keyword, account..." />
          </div>
          <div className="space-y-2">
            <Label className="terr-label">Content / Notes</Label>
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder="Context Claude should know" />
          </div>

          {type === "search_query" && (
            <div className="space-y-2 border border-border rounded-md p-3">
              <Label className="terr-label">Quantitative Data (optional)</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" placeholder="Impressions" value={impressions} onChange={(e) => setImpressions(e.target.value)} />
                <Input type="number" placeholder="Clicks" value={clicks} onChange={(e) => setClicks(e.target.value)} />
                <Input type="number" step="0.01" placeholder="CTR (%)" value={ctr} onChange={(e) => setCtr(e.target.value)} />
                <Input type="number" step="0.1" placeholder="Position" value={position} onChange={(e) => setPosition(e.target.value)} />
                <Input type="number" step="0.01" placeholder="Week Change (%)" value={weekChange} onChange={(e) => setWeekChange(e.target.value)} className="col-span-2" />
              </div>
            </div>
          )}

          {type === "market" && (
            <div className="space-y-2 border border-border rounded-md p-3">
              <Label className="terr-label">Quantitative Data (optional)</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" placeholder="Volume" value={volume} onChange={(e) => setVolume(e.target.value)} />
                <Input type="number" step="0.01" placeholder="Movement (%)" value={movement} onChange={(e) => setMovement(e.target.value)} />
              </div>
            </div>
          )}

          {type === "buyer_behaviour" && (
            <div className="space-y-2 border border-border rounded-md p-3">
              <Label className="terr-label">Campaign Data (optional)</Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Form fills</p>
                  <Input type="number" placeholder="e.g. 47" value={formFills} onChange={(e) => setFormFills(e.target.value)} />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">CPL (₹)</p>
                  <Input type="number" placeholder="e.g. 340" value={cpl} onChange={(e) => setCpl(e.target.value)} />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">WA response rate (%)</p>
                  <Input type="number" placeholder="e.g. 34" value={waResponseRate} onChange={(e) => setWaResponseRate(e.target.value)} />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1">Site visits</p>
                  <Input type="number" placeholder="e.g. 240" value={siteVisits} onChange={(e) => setSiteVisits(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <p className="text-[10px] text-muted-foreground mb-1">Ad spend (₹)</p>
                  <Input type="number" placeholder="e.g. 16000" value={adSpend} onChange={(e) => setAdSpend(e.target.value)} />
                </div>
              </div>
            </div>
          )}


          <div className="space-y-2">
            <Label className="terr-label">Urgency</Label>
            <Select value={urgency} onValueChange={(v) => setUrgency(v as Urgency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="bg-primary hover:bg-primary-hover" onClick={save} disabled={busy}>
            {busy ? "Saving..." : "Add Signal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
