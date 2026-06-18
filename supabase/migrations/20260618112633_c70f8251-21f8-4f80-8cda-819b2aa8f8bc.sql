ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS meta_ad_account_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS meta_page_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS aqi_source_cities text[] NOT NULL DEFAULT ARRAY['delhi','gurgaon'],
  ADD COLUMN IF NOT EXISTS aqi_destination_city text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS aqi_threshold integer NOT NULL DEFAULT 280;