-- 1. Re-crear tabla con soporte para propiedad de usuario
DROP TABLE IF EXISTS public.ai_models CASCADE;

CREATE TABLE public.ai_models (
  id text PRIMARY KEY,             
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,             
  description text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

-- 2. Políticas de Seguridad (RLS)
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see public and own models" ON public.ai_models
  FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users can manage own models" ON public.ai_models
  FOR ALL
  USING (user_id = auth.uid());

-- 3. Insertar Modelos Oficiales
INSERT INTO public.ai_models (id, name, description, user_id) VALUES
('gemini-2.0-flash-exp', 'Gemini 2.0 Flash (Experimental)', 'Modelo más rápido y multimodal. (Recomendado)', NULL),
('gemini-1.5-flash', 'Gemini 1.5 Flash', 'Versión estable anterior.', NULL),
('gemini-1.5-pro', 'Gemini 1.5 Pro', 'Mayor capacidad de razonamiento.', NULL),
('gemini-2.0-pro-exp', 'Gemini 2.0 Pro (Experimental)', 'Alta inteligencia experimental.', NULL);

-- 4. Preparar tabla PROFILES
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS preferred_primary_model text DEFAULT 'gemini-2.0-flash-exp',
ADD COLUMN IF NOT EXISTS preferred_fallback_model text DEFAULT 'gemini-1.5-flash';

-- --- CORRECCIÓN CRÍTICA ---
-- Actualizar referencias rotas antes de crear Constraints
UPDATE public.profiles SET preferred_primary_model = 'gemini-2.0-flash-exp' WHERE preferred_primary_model NOT IN (SELECT id FROM public.ai_models);
UPDATE public.profiles SET preferred_fallback_model = 'gemini-1.5-flash' WHERE preferred_fallback_model NOT IN (SELECT id FROM public.ai_models);

-- 5. Crear Llaves Foráneas (Foreign Keys)
ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS fk_primary_model,
DROP CONSTRAINT IF EXISTS fk_fallback_model;

ALTER TABLE public.profiles 
ADD CONSTRAINT fk_primary_model FOREIGN KEY (preferred_primary_model) REFERENCES public.ai_models(id) ON DELETE SET NULL;

ALTER TABLE public.profiles 
ADD CONSTRAINT fk_fallback_model FOREIGN KEY (preferred_fallback_model) REFERENCES public.ai_models(id) ON DELETE SET NULL;
