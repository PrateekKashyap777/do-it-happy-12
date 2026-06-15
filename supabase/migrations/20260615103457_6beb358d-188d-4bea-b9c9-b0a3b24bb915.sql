
-- 1. Add owner_id to clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Backfill: assign existing rows to the seeded user if any
UPDATE public.clients SET owner_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE owner_id IS NULL;

ALTER TABLE public.clients ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.clients ALTER COLUMN owner_id SET DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS clients_owner_id_idx ON public.clients(owner_id);

-- 2. Replace permissive policies on clients
DROP POLICY IF EXISTS "Authenticated can view clients" ON public.clients;
DROP POLICY IF EXISTS "Authenticated can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Authenticated can update clients" ON public.clients;
DROP POLICY IF EXISTS "Authenticated can delete clients" ON public.clients;

CREATE POLICY "Owners can view their clients" ON public.clients FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Owners can insert their clients" ON public.clients FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners can update their clients" ON public.clients FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners can delete their clients" ON public.clients FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- 3. Replace permissive policies on briefs (scoped via client ownership)
DROP POLICY IF EXISTS "Authenticated can view briefs" ON public.briefs;
DROP POLICY IF EXISTS "Authenticated can insert briefs" ON public.briefs;
DROP POLICY IF EXISTS "Authenticated can update briefs" ON public.briefs;
DROP POLICY IF EXISTS "Authenticated can delete briefs" ON public.briefs;

CREATE POLICY "Owners can view briefs" ON public.briefs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = briefs.client_id AND c.owner_id = auth.uid()));
CREATE POLICY "Owners can insert briefs" ON public.briefs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = briefs.client_id AND c.owner_id = auth.uid()));
CREATE POLICY "Owners can update briefs" ON public.briefs FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = briefs.client_id AND c.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = briefs.client_id AND c.owner_id = auth.uid()));
CREATE POLICY "Owners can delete briefs" ON public.briefs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = briefs.client_id AND c.owner_id = auth.uid()));

-- 4. Replace permissive policies on signals (scoped via client ownership)
DROP POLICY IF EXISTS "Authenticated can view signals" ON public.signals;
DROP POLICY IF EXISTS "Authenticated can insert signals" ON public.signals;
DROP POLICY IF EXISTS "Authenticated can update signals" ON public.signals;
DROP POLICY IF EXISTS "Authenticated can delete signals" ON public.signals;

CREATE POLICY "Owners can view signals" ON public.signals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = signals.client_id AND c.owner_id = auth.uid()));
CREATE POLICY "Owners can insert signals" ON public.signals FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = signals.client_id AND c.owner_id = auth.uid()));
CREATE POLICY "Owners can update signals" ON public.signals FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = signals.client_id AND c.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = signals.client_id AND c.owner_id = auth.uid()));
CREATE POLICY "Owners can delete signals" ON public.signals FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = signals.client_id AND c.owner_id = auth.uid()));
