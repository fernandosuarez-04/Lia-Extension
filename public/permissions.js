// Permissions page script for Soflia Agent
const statusDiv = document.getElementById('statusMessage');
const micStatus = document.getElementById('micStatus');
const btn = document.getElementById('requestBtn');
const btnText = document.getElementById('btnText');

async function checkPermissionStatus() {
    try {
        const result = await navigator.permissions.query({ name: 'microphone' });
        updateMicStatus(result.state);
        
        result.addEventListener('change', () => {
            updateMicStatus(result.state);
        });
    } catch (e) {
        console.log('Permission API not supported');
    }
}

function updateMicStatus(state) {
    micStatus.className = 'status-badge';
    
    switch (state) {
        case 'granted':
            micStatus.textContent = 'Permitido';
            micStatus.classList.add('status-granted');
            showMessage('success', 'Permiso concedido correctamente. Puedes cerrar esta pestaña y volver a Soflia.');
            btnText.textContent = 'Permiso concedido';
            btn.disabled = true;
            break;
        case 'denied':
            micStatus.textContent = 'Denegado';
            micStatus.classList.add('status-denied');
            showMessage('error', 'Permiso denegado. Haz clic en el icono de candado en la barra de direcciones para habilitar el micrófono.');
            break;
        case 'prompt':
        default:
            micStatus.textContent = 'Pendiente';
            micStatus.classList.add('status-pending');
            break;
    }
}

function showMessage(type, message) {
    statusDiv.textContent = message;
    statusDiv.className = 'message message-' + type;
    statusDiv.style.display = 'block';
}

btn.addEventListener('click', async () => {
    btn.disabled = true;
    btnText.textContent = 'Solicitando...';
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        stream.getTracks().forEach(track => track.stop());
        updateMicStatus('granted');
        
        if (chrome && chrome.runtime) {
            chrome.runtime.sendMessage({ 
                type: 'MIC_PERMISSION_GRANTED' 
            }).catch(() => {});
        }
        
    } catch (err) {
        console.error('Microphone error:', err);
        
        let errorMessage = 'Error desconocido';
        
        if (err.name === 'NotAllowedError') {
            errorMessage = 'Permiso denegado. Haz clic en el icono de candado en la barra de direcciones, busca "Micrófono" y selecciona "Permitir".';
            updateMicStatus('denied');
        } else if (err.name === 'NotFoundError') {
            errorMessage = 'No se detectó ningún micrófono. Conecta un dispositivo de audio e intenta nuevamente.';
        } else if (err.name === 'NotReadableError') {
            errorMessage = 'El micrófono está en uso por otra aplicación. Cierra otras aplicaciones e intenta nuevamente.';
        } else {
            errorMessage = 'Error: ' + (err.message || err.name);
        }
        
        showMessage('error', errorMessage);
        btnText.textContent = 'Reintentar';
        btn.disabled = false;
    }
});

// Check status on load
checkPermissionStatus();
