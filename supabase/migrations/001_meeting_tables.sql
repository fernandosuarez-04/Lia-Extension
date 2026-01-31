-- =====================================================
-- MIGRATION: Meeting Tables for Lia Extension
-- Version: 1.0.0
-- Description: Creates tables for meeting sessions, transcripts, and exports
-- =====================================================

-- =====================================================
-- TABLA: meeting_sessions
-- Almacena información de cada sesión de reunión
-- =====================================================
CREATE TABLE IF NOT EXISTS meeting_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Información de la reunión
  platform TEXT NOT NULL CHECK (platform IN ('google-meet', 'zoom')),
  title TEXT,
  meeting_url TEXT,

  -- Tiempos
  start_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  duration_seconds INTEGER,

  -- Participantes
  participants JSONB DEFAULT '[]',
  participant_count INTEGER DEFAULT 1,

  -- Resumen generado
  summary TEXT,
  summary_type TEXT CHECK (summary_type IN ('short', 'detailed', 'action_items', 'executive')),

  -- Idioma detectado
  detected_language TEXT DEFAULT 'es' CHECK (detected_language IN ('es', 'en', 'pt')),

  -- Metadatos adicionales
  metadata JSONB DEFAULT '{}',

  -- Timestamps de auditoría
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TABLA: transcript_segments
-- Almacena cada segmento de transcripción
-- =====================================================
CREATE TABLE IF NOT EXISTS transcript_segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES meeting_sessions(id) ON DELETE CASCADE NOT NULL,

  -- Contenido del segmento
  timestamp TIMESTAMPTZ NOT NULL,
  relative_time_ms INTEGER,
  speaker TEXT,
  text TEXT NOT NULL,

  -- Tipo de segmento
  is_lia_response BOOLEAN DEFAULT FALSE,
  is_lia_invocation BOOLEAN DEFAULT FALSE,

  -- Idioma del segmento
  language TEXT DEFAULT 'es',

  -- Confianza de transcripción (0-1)
  confidence FLOAT,

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TABLA: meeting_action_items
-- Almacena tareas/acciones extraídas de la reunión
-- =====================================================
CREATE TABLE IF NOT EXISTS meeting_action_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES meeting_sessions(id) ON DELETE CASCADE NOT NULL,

  -- Contenido de la acción
  description TEXT NOT NULL,
  assignee TEXT,
  due_date DATE,

  -- Estado
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),

  -- Referencia al segmento donde se mencionó
  source_segment_id UUID REFERENCES transcript_segments(id),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TABLA: meeting_exports
-- Registro de exportaciones PDF generadas
-- =====================================================
CREATE TABLE IF NOT EXISTS meeting_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES meeting_sessions(id) ON DELETE CASCADE NOT NULL,

  -- Información del export
  export_type TEXT DEFAULT 'pdf' CHECK (export_type IN ('pdf', 'txt', 'docx')),
  include_transcript BOOLEAN DEFAULT TRUE,
  include_summary BOOLEAN DEFAULT TRUE,
  include_action_items BOOLEAN DEFAULT TRUE,

  -- Archivo generado
  file_url TEXT,
  file_size_bytes INTEGER,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ÍNDICES para rendimiento
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_meeting_sessions_user_id ON meeting_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_sessions_start_time ON meeting_sessions(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_meeting_sessions_platform ON meeting_sessions(platform);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_session_id ON transcript_segments(session_id);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_timestamp ON transcript_segments(timestamp);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_speaker ON transcript_segments(speaker);

CREATE INDEX IF NOT EXISTS idx_meeting_action_items_session_id ON meeting_action_items(session_id);
CREATE INDEX IF NOT EXISTS idx_meeting_action_items_status ON meeting_action_items(status);
CREATE INDEX IF NOT EXISTS idx_meeting_action_items_assignee ON meeting_action_items(assignee);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE meeting_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_exports ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for clean migration)
DROP POLICY IF EXISTS "Users can CRUD own meeting sessions" ON meeting_sessions;
DROP POLICY IF EXISTS "Users can CRUD own transcripts" ON transcript_segments;
DROP POLICY IF EXISTS "Users can CRUD own action items" ON meeting_action_items;
DROP POLICY IF EXISTS "Users can CRUD own exports" ON meeting_exports;

-- Create policies
CREATE POLICY "Users can CRUD own meeting sessions"
  ON meeting_sessions FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can CRUD own transcripts"
  ON transcript_segments FOR ALL
  USING (session_id IN (SELECT id FROM meeting_sessions WHERE user_id = auth.uid()));

CREATE POLICY "Users can CRUD own action items"
  ON meeting_action_items FOR ALL
  USING (session_id IN (SELECT id FROM meeting_sessions WHERE user_id = auth.uid()));

CREATE POLICY "Users can CRUD own exports"
  ON meeting_exports FOR ALL
  USING (session_id IN (SELECT id FROM meeting_sessions WHERE user_id = auth.uid()));

-- =====================================================
-- FUNCIONES auxiliares
-- =====================================================

-- Función para actualizar duration al cerrar sesión
CREATE OR REPLACE FUNCTION update_meeting_duration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.end_time IS NOT NULL AND OLD.end_time IS NULL THEN
    NEW.duration_seconds = EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time))::INTEGER;
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_update_meeting_duration ON meeting_sessions;
CREATE TRIGGER trigger_update_meeting_duration
  BEFORE UPDATE ON meeting_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_meeting_duration();

-- Función para obtener estadísticas del usuario
CREATE OR REPLACE FUNCTION get_user_meeting_stats(p_user_id UUID)
RETURNS TABLE (
  total_meetings BIGINT,
  total_duration_hours FLOAT,
  avg_duration_minutes FLOAT,
  meetings_this_month BIGINT,
  most_used_platform TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_meetings,
    COALESCE(SUM(ms.duration_seconds) / 3600.0, 0)::FLOAT as total_duration_hours,
    COALESCE(AVG(ms.duration_seconds) / 60.0, 0)::FLOAT as avg_duration_minutes,
    COUNT(*) FILTER (WHERE ms.start_time >= DATE_TRUNC('month', NOW()))::BIGINT as meetings_this_month,
    MODE() WITHIN GROUP (ORDER BY ms.platform)::TEXT as most_used_platform
  FROM meeting_sessions ms
  WHERE ms.user_id = p_user_id AND ms.end_time IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- GRANT permissions for authenticated users
-- =====================================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON meeting_sessions TO authenticated;
GRANT ALL ON transcript_segments TO authenticated;
GRANT ALL ON meeting_action_items TO authenticated;
GRANT ALL ON meeting_exports TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_meeting_stats(UUID) TO authenticated;
