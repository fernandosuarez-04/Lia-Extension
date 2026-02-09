/**
 * Tool Editor Modal
 * Modal for creating and editing private tools
 */

import { useState, useEffect } from 'react';
import {
  UserTool,
  ToolCategory,
  TOOL_CATEGORIES,
  CreateUserToolInput,
  createUserTool,
  updateUserTool,
} from '../services/tools';

interface ToolEditorModalProps {
  isOpen: boolean;
  tool?: UserTool | null; // If provided, we're editing
  initialPromptText?: string; // Pre-fill system prompt with this text (for "Save as Prompt" feature)
  onClose: () => void;
  onSave: (tool: UserTool) => void;
}

// Common emoji icons for tools
const EMOJI_OPTIONS = ['⚙️', '🔧', '💡', '🎯', '📝', '💻', '🎨', '📊', '🔬', '🚀', '⭐', '🎓', '📣', '🤖', '✨', '🧠'];

export function ToolEditorModal({ isOpen, tool, initialPromptText, onClose, onSave }: ToolEditorModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('⚙️');
  const [category, setCategory] = useState<ToolCategory | ''>('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [starterPrompts, setStarterPrompts] = useState('');
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Populate form when editing
  useEffect(() => {
    if (tool) {
      setName(tool.name);
      setDescription(tool.description || '');
      setIcon(tool.icon);
      setCategory(tool.category || '');
      setSystemPrompt(tool.system_prompt);
      setStarterPrompts(tool.starter_prompts?.join('\n') || '');
    } else {
      // Reset form for new tool
      setName('');
      setDescription('');
      setIcon('⚙️');
      setCategory('');
      // Pre-fill system prompt if initialPromptText is provided (from "Save as Prompt")
      setSystemPrompt(initialPromptText || '');
      setStarterPrompts('');
    }
    setError(null);
  }, [tool, isOpen, initialPromptText]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!name.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    if (!systemPrompt.trim()) {
      setError('El prompt del sistema es obligatorio');
      return;
    }

    setSaving(true);

    try {
      const toolData: CreateUserToolInput = {
        name: name.trim(),
        description: description.trim() || undefined,
        icon,
        category: category as ToolCategory || undefined,
        system_prompt: systemPrompt.trim(),
        starter_prompts: starterPrompts
          .split('\n')
          .map(s => s.trim())
          .filter(s => s.length > 0),
      };

      let savedTool: UserTool;

      if (tool) {
        // Update existing
        savedTool = await updateUserTool(tool.id, toolData);
      } else {
        // Create new
        savedTool = await createUserTool(toolData);
      }

      onSave(savedTool);
      onClose();
    } catch (err: any) {
      console.error('Error saving tool:', err);
      setError(err.message || 'Error al guardar la herramienta');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={styles.title}>
          {tool ? '✏️ Editar Prompt' : initialPromptText ? '💾 Guardar Prompt' : '➕ Nuevo Prompt'}
        </h2>

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* Icon & Name Row */}
          <div style={styles.row}>
            <div style={styles.iconWrapper}>
              <button
                type="button"
                style={styles.iconBtn}
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              >
                {icon}
              </button>
              {showEmojiPicker && (
                <div style={styles.emojiPicker}>
                  {EMOJI_OPTIONS.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      style={styles.emojiOption}
                      onClick={() => {
                        setIcon(emoji);
                        setShowEmojiPicker(false);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              type="text"
              placeholder="Nombre de la herramienta"
              value={name}
              onChange={e => setName(e.target.value)}
              style={styles.input}
              maxLength={50}
            />
          </div>

          {/* Description */}
          <input
            type="text"
            placeholder="Descripción breve (opcional)"
            value={description}
            onChange={e => setDescription(e.target.value)}
            style={styles.input}
            maxLength={200}
          />

          {/* Category */}
          <select
            value={category}
            onChange={e => setCategory(e.target.value as ToolCategory)}
            style={styles.select}
          >
            <option value="">Sin categoría</option>
            {TOOL_CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>
                {cat.icon} {cat.label}
              </option>
            ))}
          </select>

          {/* System Prompt */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>
              Instrucciones del Sistema *
            </label>
            <p style={styles.hint}>
              Define cómo debe comportarse la IA cuando uses esta herramienta.
            </p>
            <textarea
              placeholder="Ej: Eres un experto en marketing digital. Ayudas a crear contenido persuasivo..."
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              style={styles.textarea}
              rows={6}
            />
          </div>

          {/* Starter Prompts */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>
              Prompts de Inicio (opcional)
            </label>
            <p style={styles.hint}>
              Sugerencias que aparecerán al usar la herramienta. Una por línea.
            </p>
            <textarea
              placeholder={"¿Cómo puedo mejorar mi copy?\nEscribe un titular para...\nAnaliza esta campaña"}
              value={starterPrompts}
              onChange={e => setStarterPrompts(e.target.value)}
              style={styles.textarea}
              rows={3}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={styles.error}>{error}</div>
          )}

          {/* Actions */}
          <div style={styles.actions}>
            <button
              type="button"
              onClick={onClose}
              style={styles.cancelBtn}
              disabled={saving}
            >
              Cancelar
            </button>
            <button
              type="submit"
              style={styles.saveBtn}
              disabled={saving}
            >
              {saving ? 'Guardando...' : (tool ? 'Guardar Cambios' : 'Guardar Prompt')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// STYLES
// ==========================================

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10001,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: '#1a1f2e',
    borderRadius: '16px',
    width: '90%',
    maxWidth: '500px',
    maxHeight: '90vh',
    overflow: 'auto',
    padding: '24px',
    border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  title: {
    margin: '0 0 20px',
    fontSize: '20px',
    fontWeight: 600,
    color: '#fff',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  row: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  },
  iconWrapper: {
    position: 'relative',
  },
  iconBtn: {
    width: '48px',
    height: '48px',
    fontSize: '24px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiPicker: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: '8px',
    background: '#252b3d',
    borderRadius: '12px',
    padding: '8px',
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '4px',
    zIndex: 100,
    border: '1px solid rgba(255,255,255,0.1)',
    boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
  },
  emojiOption: {
    width: '36px',
    height: '36px',
    fontSize: '20px',
    background: 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.2s',
  },
  input: {
    flex: 1,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    padding: '12px 14px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
  },
  select: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    padding: '12px 14px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    cursor: 'pointer',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#fff',
  },
  hint: {
    fontSize: '12px',
    color: '#888',
    margin: 0,
  },
  textarea: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px',
    padding: '12px 14px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
    lineHeight: 1.5,
  },
  error: {
    background: 'rgba(255, 107, 107, 0.1)',
    border: '1px solid rgba(255, 107, 107, 0.3)',
    borderRadius: '8px',
    padding: '10px 14px',
    color: '#ff6b6b',
    fontSize: '13px',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    marginTop: '8px',
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '10px',
    padding: '10px 20px',
    color: '#888',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  saveBtn: {
    background: '#00d4b3',
    border: 'none',
    borderRadius: '10px',
    padding: '10px 24px',
    color: '#0a2540',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};

export default ToolEditorModal;
