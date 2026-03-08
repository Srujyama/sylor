-- SimWorld Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- SIMULATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.simulations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('startup', 'pricing', 'policy', 'marketing', 'product', 'custom')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'completed', 'failed')),
  results JSONB,
  run_count INTEGER DEFAULT 0,
  template_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on user_id for fast queries
CREATE INDEX IF NOT EXISTS idx_simulations_user_id ON public.simulations(user_id);
CREATE INDEX IF NOT EXISTS idx_simulations_status ON public.simulations(status);
CREATE INDEX IF NOT EXISTS idx_simulations_category ON public.simulations(category);

-- Row Level Security
ALTER TABLE public.simulations ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own simulations
CREATE POLICY "Users can view own simulations"
  ON public.simulations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own simulations"
  ON public.simulations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own simulations"
  ON public.simulations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own simulations"
  ON public.simulations FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- USER PROFILES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  simulation_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- SIMULATION RUNS TABLE (for detailed run history)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.simulation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  simulation_id UUID NOT NULL REFERENCES public.simulations(id) ON DELETE CASCADE,
  run_number INTEGER NOT NULL,
  num_runs INTEGER NOT NULL,
  variable_overrides JSONB DEFAULT '{}'::jsonb,
  results_summary JSONB,
  duration_seconds FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_simulation_id ON public.simulation_runs(simulation_id);

ALTER TABLE public.simulation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view runs for own simulations"
  ON public.simulation_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.simulations
      WHERE simulations.id = simulation_runs.simulation_id
        AND simulations.user_id = auth.uid()
    )
  );

-- ============================================================
-- TRIGGER: Update updated_at automatically
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_simulations_updated_at
  BEFORE UPDATE ON public.simulations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- REALTIME: Enable for simulations table
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.simulations;
