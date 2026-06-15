export type SignalType =
  | "search_query"
  | "competitor"
  | "news"
  | "rera"
  | "buyer_behaviour"
  | "market";

export type SignalSource =
  | "gsc"
  | "semrush"
  | "rss"
  | "rera_portal"
  | "manual"
  | "n8n";

export type Urgency = "high" | "medium" | "low";

export type BriefStatus = "draft" | "review" | "approved" | "sent";

export interface BuyerPersona {
  name: string;
  location: string;
  trigger: string;
  hook: string;
}

export interface Client {
  id: string;
  name: string;
  market_geography: string;
  keywords: string[];
  competitors: string[];
  buyer_personas: BuyerPersona[];
  system_prompt: string;
  gsc_property_url: string;
  brief_delivery_method: string;
  brief_delivery_contact: string;
  is_white_label: boolean;
  agency_name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Signal {
  id: string;
  client_id: string;
  signal_type: SignalType;
  source: SignalSource;
  title: string;
  content: string;
  data: Record<string, unknown>;
  urgency: Urgency;
  week_date: string;
  is_included: boolean;
  created_at: string;
}

export interface ContentRecommendation {
  priority: number;
  format: string;
  platform: string;
  hook: string;
  topic: string;
  persona: string;
}

export interface BriefContent {
  search_signals: string;
  competitor_activity: string;
  rera_watch: string;
  buyer_behaviour: string;
  content_recommendations: ContentRecommendation[];
  campaign_adjustment: string;
}

export interface Brief {
  id: string;
  client_id: string;
  week_date: string;
  status: BriefStatus;
  content: BriefContent;
  prompt_used: string;
  signal_count: number;
  generated_at: string | null;
  reviewed_at: string | null;
  sent_at: string | null;
  reviewer_notes: string;
  created_at: string;
  updated_at: string;
}

export const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  search_query: "Search",
  competitor: "Competitor",
  news: "News",
  rera: "RERA",
  buyer_behaviour: "Buyer Behaviour",
  market: "Market",
};

export const SIGNAL_SOURCE_LABELS: Record<SignalSource, string> = {
  gsc: "GSC",
  semrush: "SEMrush",
  rss: "RSS",
  rera_portal: "RERA Portal",
  manual: "Manual",
  n8n: "n8n",
};
