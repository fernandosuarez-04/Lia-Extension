-- Create user_ai_settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.user_ai_settings (
    user_id uuid REFERENCES auth.users(id) NOT NULL PRIMARY KEY,
    
    -- Model Preferences
    primary_model text,
    fallback_model text,

    -- Personalization Fields
    nickname text,
    occupation text,
    about_user text,
    tone_style text DEFAULT 'Profesional',
    char_emojis text DEFAULT 'Auto',
    custom_instructions text,
    
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_ai_settings ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own settings" 
ON public.user_ai_settings FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" 
ON public.user_ai_settings FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings update" 
ON public.user_ai_settings FOR UPDATE
USING (auth.uid() = user_id);

-- Add comments
COMMENT ON TABLE public.user_ai_settings IS 'Stores user personalization preferences and model choices for AI interactions';
