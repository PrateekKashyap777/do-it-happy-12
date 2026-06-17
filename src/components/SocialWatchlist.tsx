import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { SocialProfile } from "@/lib/terrain-types";

interface Props {
  clientId: string;
  profiles: SocialProfile[];
  weekDate: string;
  onUpdated: () => void;
}

const OBSERVATION_TYPES = [
  "New Reel posted",
  "Trending post this week",
  "New paid campaign spotted",
  "Product / project launch",
  "Strong engagement spike",
  "New creative angle",
  "Price / offer promotion",
  "Event or announcement",
  "Other observation",
];

export function SocialWatchlist({ clientId, profiles, weekDate, onUpdated }: Props) {
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [obsType, setObsType] = useState(OBSERVATION_TYPES[0]);
  const [obsNote, setObsNote] = useState("");
  const [urgency, setUrgency] = useState<"high" | "medium" | "low">("medium");
  const [saving, setSaving] = useState(false);

  async function markReviewed(profileId: string) {
    const updated = profiles.map((p) =>
      p.id === profileId ? { ...p, last_reviewed: new Date().toISOString() } : p
    );
    await supabase
      .from("clients")
      .update({ social_profiles: updated })
      .eq("id", clientId);
    onUpdated();
    toast.success("Marked as reviewed");
  }

  async function logObservation(profile: SocialProfile) {
    if (!obsNote.trim()) { toast.error("Add a description of what you observed"); return; }
    setSaving(true);
    try {
      const title = `${profile.name}: ${obsType}`;
      const content = obsNote.trim();
      const { error } = await supabase.from("signals").insert({
        client_id: clientId,
        signal_type: "competitor",
        source: "manual",
        title: title.slice(0, 240),
        content: content.slice(0, 500),
        data: {
          competitor: profile.name,
          observation_type: obsType,
          instagram: profile.instagram ?? null,
          facebook: profile.facebook ?? null,
          platform: "instagram_facebook",
          logged_from: "social_watchlist",
        },
        urgency,
        week_date: weekDate,
        is_included: true,
      });
      if (error) throw error;

      const updated = profiles.map((p) =>
        p.id === profile.id ? { ...p, last_reviewed: new Date().toISOString() } : p
      );
      await supabase
        .from("clients")
        .update({ social_profiles: updated })
        .eq("id", clientId);

      toast.success("Observation logged as competitor signal");
      setAddingFor(null);
      setObsNote("");
      setObsType(OBSERVATION_TYPES[0]);
      setUrgency("medium");
      onUpdated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (profiles.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-4">
        No social profiles added — add competitor Instagram and Facebook accounts in Client Settings.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {profiles.map((profile) => {
        const lastReviewed = profile.last_reviewed
          ? new Date(profile.last_reviewed)
          : null;
        const daysSince = lastReviewed
          ? Math.floor((Date.now() - lastReviewed.getTime()) / 86400000)
          : null;
        const needsReview = daysSince === null || daysSince >= 7;
        const isLogging = addingFor === profile.id;

        return (
          <div
            key={profile.id}
            className={`terr-elevated rounded-sm border p-3 ${
              needsReview ? "border-warning/30" : "border-border"
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="text-sm font-medium text-foreground">{profile.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  {profile.instagram && (
                    <a
                      href={`https://www.instagram.com/${profile.instagram.replace("@", "")}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <span style={{ color: "#C94060" }}>IG</span>
                      <span>@{profile.instagram.replace("@", "")}</span>
                      <span className="text-accent">↗</span>
                    </a>
                  )}
                  {profile.facebook && (
                    <a
                      href={`https://www.facebook.com/search/pages?q=${encodeURIComponent(profile.facebook)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <span style={{ color: "#1877F2" }}>FB</span>
                      <span>{profile.facebook}</span>
                      <span className="text-accent">↗</span>
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {needsReview ? (
                  <span className="text-[9px] font-medium tracking-wider uppercase px-1.5 py-0.5 rounded-sm bg-warning/10 text-warning">
                    {daysSince === null ? "Not reviewed" : `${daysSince}d ago`}
                  </span>
                ) : (
                  <span className="text-[9px] text-muted-foreground">
                    Reviewed {daysSince}d ago
                  </span>
                )}
              </div>
            </div>

            {!isLogging ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setAddingFor(profile.id)}
                >
                  + Log observation
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 text-muted-foreground"
                  onClick={() => markReviewed(profile.id)}
                >
                  Mark reviewed (nothing notable)
                </Button>
              </div>
            ) : (
              <div className="space-y-2 pt-1 border-t border-border mt-2">
                <Select value={obsType} onValueChange={setObsType}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OBSERVATION_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  value={obsNote}
                  onChange={(e) => setObsNote(e.target.value)}
                  placeholder="Describe what you saw — hook, creative angle, CTA, engagement level..."
                  rows={2}
                  className="text-xs"
                />
                <div className="flex items-center gap-2">
                  <Select
                    value={urgency}
                    onValueChange={(v) => setUrgency(v as "high" | "medium" | "low")}
                  >
                    <SelectTrigger className="h-7 text-xs w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="high" className="text-xs">High urgency</SelectItem>
                      <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                      <SelectItem value="low" className="text-xs">Low</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-primary hover:bg-primary-hover flex-1"
                    onClick={() => logObservation(profile)}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save signal"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setAddingFor(null); setObsNote(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
