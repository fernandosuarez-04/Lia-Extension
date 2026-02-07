import { useState, useEffect } from 'react';
import { sendMessageStream } from '../services/gemini';
import { TabService } from '../services/tabs';

function App() {
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  
  const [messages, setMessages] = useState<Array<{role: string, content: string}>>([
    { role: 'assistant', content: 'Hola, soy Lia. Para empezar, necesito tu API Key de Google Gemini.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingImages, setPendingImages] = useState<string[]>([]);

  useEffect(() => {
    // Check if key is saved
    chrome.storage.local.get(['geminiApiKey'], (result) => {
      if (result.geminiApiKey) {
        setApiKey(result.geminiApiKey);
        setHasKey(true);
        setMessages(prev => [...prev, { role: 'assistant', content: '¡Conectado! Lia ahora puede leer la página que estás viendo y ver las imágenes que pegues.' }]);
      }
    });
  }, []);

  const handleSaveKey = () => {
    if (!apiKey.trim()) return;
    chrome.storage.local.set({ geminiApiKey: apiKey }, () => {
      setHasKey(true);
      setMessages(prev => [...prev, { role: 'assistant', content: '¡Conectado! Lia ahora puede leer la página que estás viendo y ver las imágenes que pegues.' }]);
    });
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const base64 = event.target?.result as string;
            setPendingImages(prev => [...prev, base64]);
          };
          reader.readAsDataURL(blob);
        }
      }
    }
  };

  const removeImage = (index: number) => {
    setPendingImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && pendingImages.length === 0) return;

    const userMsg = input;
    const currentImages = [...pendingImages];
    
    // Add user message to UI immediately
    setMessages(prev => [...prev, { 
        role: 'user', 
        content: userMsg + (currentImages.length > 0 ? `\n[${currentImages.length} imagen(es) adjunta(s)]` : '') 
    }]);
    
    setInput('');
    setPendingImages([]);
    setLoading(true);

    try {
      // 1. Get Page Context
      let pageContext = { title: 'Desconocido', url: 'Desconocido', content: '' };
      try {
          pageContext = await TabService.getCurrentTabAsString();
      } catch (err) {
          console.warn("No se pudo leer el contexto:", err);
      }

      // 2. Prepare context string with metadata
      const contextString = `
TÍTULO: ${pageContext.title}
URL: ${pageContext.url}
CONTENIDO:
${pageContext.content}
      `.trim();
      
      // 3. Send to Gemini using the advanced stream function
      const result = await sendMessageStream(
        userMsg,
        contextString,
        undefined, // overrides
        undefined, // personalization
        undefined, // projectContext
        undefined, // thinking
        currentImages // images
      );
      
      // For now, valid response waiting (non-streaming UI)
      const response = await result.response;
      const text = response.text();
      
      setMessages(prev => [...prev, { role: 'assistant', content: text }]);
    } catch (error: any) {
      console.error("Chat error:", error);
      let errorMsg = 'Error al conectar. Verifica tu API Key.';
      if (error.message?.includes('API key')) errorMsg = 'API Key inválida o no configurada.';
      setMessages(prev => [...prev, { role: 'assistant', content: errorMsg }]);
    } finally {
      setLoading(false);
    }
  };

  if (!hasKey) {
     return (
        <div className="container" style={{justifyContent: 'center', padding: '20px'}}>
            <h2>Configuración</h2>
            <p>Introduce tu API Key de Gemini:</p>
            <input 
                type="password" 
                value={apiKey} 
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Pegar API Key aquí..."
                style={{marginBottom: '10px', width: '100%', boxSizing: 'border-box'}}
            />
            <button onClick={handleSaveKey}>Guardar y Conectar</button>
            <p style={{fontSize: '12px', color: '#666', marginTop: '10px'}}>
                Puedes obtenerla en <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>.
            </p>
        </div>
     );
  }

  return (
    <div className="container">
      <header className="header">
        <h1>Lia AI</h1>
        <button onClick={() => {
            chrome.storage.local.remove('geminiApiKey'); 
            setHasKey(false); 
            setApiKey('');
            setMessages([{ role: 'assistant', content: 'Hola, soy Lia. Para empezar, necesito tu API Key de Google Gemini.' }]);
        }} style={{fontSize: '10px', padding: '4px 8px', marginLeft: 'auto'}}>Desconectar</button>
      </header>
      
      <div className="chat-window">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.role}`}>
            <div className="bubble" style={{whiteSpace: 'pre-wrap'}}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && <div className="message assistant"><div className="bubble">Analizando...</div></div>}
      </div>

      {pendingImages.length > 0 && (
        <div style={{display: 'flex', gap: '8px', padding: '8px', overflowX: 'auto', background: '#f8f8f8', borderTop: '1px solid #ddd'}}>
          {pendingImages.map((img, idx) => (
             <div key={idx} style={{position: 'relative', flexShrink: 0}}>
                <img src={img} alt="preview" style={{height: '60px', width: 'auto', borderRadius: '4px', border: '1px solid #ccc'}} />
                <button 
                  onClick={() => removeImage(idx)}
                  style={{
                    position: 'absolute', top: -6, right: -6, 
                    background: '#ff4444', color: 'white', borderRadius: '50%', 
                    width: '18px', height: '18px', border: 'none', 
                    fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                  }}
                >x</button>
             </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          placeholder="Escribe o pega imagen con Ctrl+V..."
          disabled={loading}
          autoFocus
        />
        <button type="submit" disabled={loading || (!input.trim() && pendingImages.length === 0)}>Enviar</button>
      </form>
    </div>
  );
}

export default App;
