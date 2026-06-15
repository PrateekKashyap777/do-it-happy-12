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
      });
      if (error) throw error;
      toast.success("Signal added");
      setTitle(""); setContent(""); setUrgency("medium");
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
      <DialogContent className="max-w-lg bg-elevated">
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
