-- Create folders table
CREATE TABLE IF NOT EXISTS public.folders (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Add folder_id to conversations
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL;

-- Enable RLS for folders
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;

-- Policies for folders
CREATE POLICY "Users can view own folders" 
ON public.folders FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own folders" 
ON public.folders FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own folders" 
ON public.folders FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own folders" 
ON public.folders FOR DELETE 
USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversations_folder_id ON public.conversations(folder_id);
CREATE INDEX IF NOT EXISTS idx_folders_user_id ON public.folders(user_id);

-- Add comments
COMMENT ON TABLE public.folders IS 'Organizes conversations into projects/folders';
COMMENT ON COLUMN public.conversations.folder_id IS 'Links conversation to a project folder for shared context';
