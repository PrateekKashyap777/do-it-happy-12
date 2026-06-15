
-- CLIENTS
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  market_geography text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  competitors text[] NOT NULL DEFAULT '{}',
  buyer_personas jsonb NOT NULL DEFAULT '[]'::jsonb,
  system_prompt text NOT NULL DEFAULT '',
  gsc_property_url text NOT NULL DEFAULT '',
  brief_delivery_method text NOT NULL DEFAULT 'whatsapp',
  brief_delivery_contact text NOT NULL DEFAULT '',
  is_white_label boolean NOT NULL DEFAULT false,
  agency_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view clients" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update clients" ON public.clients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete clients" ON public.clients FOR DELETE TO authenticated USING (true);

-- SIGNALS
CREATE TABLE public.signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  source text NOT NULL,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  urgency text NOT NULL DEFAULT 'medium',
  week_date date NOT NULL,
  is_included boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signals_client_week_idx ON public.signals(client_id, week_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signals TO authenticated;
GRANT ALL ON public.signals TO service_role;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view signals" ON public.signals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert signals" ON public.signals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update signals" ON public.signals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete signals" ON public.signals FOR DELETE TO authenticated USING (true);

-- BRIEFS
CREATE TABLE public.briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt_used text NOT NULL DEFAULT '',
  signal_count integer NOT NULL DEFAULT 0,
  generated_at timestamptz,
  reviewed_at timestamptz,
  sent_at timestamptz,
  reviewer_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX briefs_client_week_idx ON public.briefs(client_id, week_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.briefs TO authenticated;
GRANT ALL ON public.briefs TO service_role;
ALTER TABLE public.briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view briefs" ON public.briefs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert briefs" ON public.briefs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update briefs" ON public.briefs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete briefs" ON public.briefs FOR DELETE TO authenticated USING (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER clients_touch BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER briefs_touch BEFORE UPDATE ON public.briefs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
