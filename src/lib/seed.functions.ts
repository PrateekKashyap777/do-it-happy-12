import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { currentWeekMonday } from "@/lib/terrain-utils";

const DEMO_PERSONAS = [
  { name: "The Delhi NCR Upgrader", location: "South Delhi", trigger: "Outgrown a 2BHK in Saket; wants a 3BHK with better amenities", hook: "Apna ghar, bada karne ka time aa gaya" },
  { name: "The Gurgaon NRI Investor", location: "Dubai / London", trigger: "Looking for a rental-yield asset in Golf Course Road extension", hook: "NRI-friendly RERA listings, weekly verified" },
  { name: "The First-Time Buyer", location: "Faridabad / Noida", trigger: "Saved enough for down payment, scared of project delays", hook: "RERA-approved, delivery-on-time projects only" },
];

const DEMO_SIGNALS = [
  { signal_type: "search_query", source: "dataforseo", title: "flats in gurgaon", urgency: "high", content: "Search volume up 34% WoW — strong upgrader intent.", data: { volume: 3600, week_change_pct: 34, position: 8.2, ctr: 3.5 } },
  { signal_type: "search_query", source: "dataforseo", title: "3 bhk in gurgaon under 2 crore", urgency: "medium", content: "Mid-budget 3BHK queries climbing.", data: { volume: 1900, week_change_pct: 18, position: 12.4, ctr: 1.8 } },
  { signal_type: "competitor", source: "manual", title: "DLF launches Privana North phase 2", urgency: "high", content: "Pre-launch pricing aggressive vs market. Position against delivery timeline.", data: {} },
  { signal_type: "rera", source: "manual", title: "HRERA tightens advertising rules", urgency: "medium", content: "All campaign copy must show RERA number prominently. Update ad creatives this week.", data: {} },
  { signal_type: "buyer_behaviour", source: "manual", title: "Site-visit drop on weekday afternoons", urgency: "low", content: "Shift WhatsApp follow-ups to weekend mornings — open rates 2x higher.", data: {} },
  { signal_type: "market", source: "manual", title: "Delhi AQI crosses 320 — campaign trigger", urgency: "high", content: "Activate Pincode Bharat 'clean air' creative for Gurgaon Sector 84+ projects.", data: { aqi: 322 } },
];

export const seedDemoClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const week = currentWeekMonday();

    const { data: client, error: cErr } = await supabase
      .from("clients")
      .insert({
        owner_id: userId,
        name: "Pincode Bharat (Demo)",
        market_geography: "Gurgaon",
        keywords: ["flats in gurgaon", "3 bhk in gurgaon", "dlf privana", "golf course road extension"],
        competitors: ["DLF", "M3M", "Sobha", "Smart World"],
        buyer_personas: DEMO_PERSONAS,
        status: "active",
        brief_delivery_method: "whatsapp",
      })
      .select()
      .single();
    if (cErr) throw cErr;

    const rows = DEMO_SIGNALS.map((s) => ({
      ...s,
      client_id: client.id,
      week_date: week,
      is_included: true,
    }));
    const { error: sErr } = await supabase.from("signals").insert(rows);
    if (sErr) throw sErr;

    return { clientId: client.id };
  });
