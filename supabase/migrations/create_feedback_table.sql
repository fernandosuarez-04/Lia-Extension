-- Create Feedback Table
CREATE TABLE IF NOT EXISTS public.message_feedback (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) NOT NULL,
    message_content text,     -- El texto de la respuesta de la IA
    model_used text,          -- El modelo que generó la respuesta (ej. gemini-3.0-flash)
    rating int,               -- 1 a 5 estrellas
    feedback_type text,       -- 'positive' (like) o 'negative' (report)
    reason_category text,     -- Para dislikes: 'inaccurate', 'unsafe', 'incomplete', 'other'
    feedback_text text,       -- Comentario opcional del usuario
    created_at timestamptz DEFAULT now()
);

-- Enable RLS (Row Level Security) so users can insert their own feedback
ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own feedback" 
ON public.message_feedback FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Optional: Comments for clarity
COMMENT ON TABLE public.message_feedback IS 'Stores user ratings and reports for AI responses';
