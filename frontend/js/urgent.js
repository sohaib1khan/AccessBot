const API_URL = '/api';
let authToken = localStorage.getItem('authToken');
const history = [];

if (!authToken) window.location.href = '/';

async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (res.status === 401) {
        localStorage.removeItem('authToken');
        window.location.href = '/';
    }
    return res;
}

function appendMessage(text, role) {
    const box = document.getElementById('urgent-messages');
    const div = document.createElement('div');
    div.className = `message ${role === 'user' ? 'user' : 'assistant'}`;
    div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function showDisabled(msg) {
    const d = document.getElementById('urgent-disabled');
    d.textContent = msg || 'Enable plugin please: Urgent Support Chat (Settings → Plugins).';
    d.classList.remove('hidden');
    document.getElementById('urgent-input').disabled = true;
    document.getElementById('urgent-send').disabled = true;
}

async function sendUrgentMessage() {
    const input = document.getElementById('urgent-input');
    const text = input.value.trim();
    if (!text) return;

    appendMessage(text, 'user');
    history.push({ role: 'user', content: text });
    input.value = '';

    const btn = document.getElementById('urgent-send');
    btn.disabled = true;
    try {
        const res = await apiFetch(`${API_URL}/plugins/urgent/session`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: text, history })
        });
        const data = await res.json();
        if (res.status === 403) {
            showDisabled(data?.detail);
            return;
        }
        if (!res.ok) throw new Error(data?.detail || 'Request failed');
        const reply = data.message || 'I am here with you. Let us take one small step together.';
        appendMessage(reply, 'assistant');
        history.push({ role: 'assistant', content: reply });
    } catch (e) {
        appendMessage('Sorry — I could not process that. Please try again.', 'assistant');
    } finally {
        btn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
        try {
            await apiFetch(`${API_URL}/auth/logout`, { method: 'POST', headers: { 'Authorization': `Bearer ${authToken}` } });
        } catch {}
        localStorage.removeItem('authToken');
        localStorage.removeItem('activeConversationId');
        window.location.href = '/';
    });

    document.getElementById('urgent-send')?.addEventListener('click', sendUrgentMessage);
    document.getElementById('urgent-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendUrgentMessage();
        }
    });

    appendMessage('You are in a separate urgent support session. Share what feels hardest right now, and I will help break it down into tiny next steps.', 'assistant');

    const res = await apiFetch(`${API_URL}/plugins`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
        const plugins = await res.json();
        const enabled = plugins.find(p => p.name === 'crisis_support')?.enabled;
        if (!enabled) showDisabled();
    }
});
