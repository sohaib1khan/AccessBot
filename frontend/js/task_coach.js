const API_URL = '/api';
let authToken = localStorage.getItem('authToken');
if (!authToken) window.location.href = '/';

async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (res.status === 401) {
        localStorage.removeItem('authToken');
        window.location.href = '/';
    }
    return res;
}

function showDisabled(msg) {
    const d = document.getElementById('coach-disabled');
    d.textContent = msg || 'Enable plugin please: Task Breakdown Coach (Settings → Plugins).';
    d.classList.remove('hidden');
    document.getElementById('coach-task').disabled = true;
    document.getElementById('coach-generate').disabled = true;
}

function showMsg(text, type = 'success') {
    const el = document.getElementById('coach-msg');
    el.textContent = text;
    el.className = `message ${type}`;
    el.classList.remove('hidden');
}

function esc(text) {
    const d = document.createElement('div');
    d.textContent = String(text || '');
    return d.innerHTML;
}

async function loadHistory() {
    const wrap = document.getElementById('coach-history');
    const res = await apiFetch(`${API_URL}/plugins/task-breakdown/history`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) {
        showDisabled(data?.detail);
        wrap.innerHTML = '';
        return;
    }
    if (!res.ok) {
        wrap.innerHTML = '<p class="loading-text">Could not load history.</p>';
        return;
    }
    const history = data.history || [];
    if (!history.length) {
        wrap.innerHTML = '<p class="loading-text">No saved plans yet.</p>';
        return;
    }
    wrap.innerHTML = history.map(h => `
        <article class="plugin-row" data-id="${h.id}">
            <div class="plugin-info">
                <strong>${esc(h.task)}</strong>
                <span>${new Date(h.created_at).toLocaleString()}</span>
                <pre style="white-space:pre-wrap;margin-top:8px;background:var(--bg-base);padding:8px;border-radius:8px;border:1px solid var(--border);">${esc(h.plan)}</pre>
            </div>
            <button class="btn btn-danger btn-sm coach-delete">Delete</button>
        </article>
    `).join('');

    wrap.querySelectorAll('.coach-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.closest('[data-id]')?.dataset?.id;
            if (!id) return;
            const del = await apiFetch(`${API_URL}/plugins/task-breakdown/history/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (del.ok) await loadHistory();
        });
    });
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

    const resPlugins = await apiFetch(`${API_URL}/plugins`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (resPlugins.ok) {
        const plugins = await resPlugins.json();
        if (!plugins.find(p => p.name === 'task_breakdown')?.enabled) {
            showDisabled();
        }
    }

    document.getElementById('coach-generate')?.addEventListener('click', async () => {
        const task = document.getElementById('coach-task').value.trim();
        if (!task) {
            showMsg('Please describe the task first.', 'error');
            return;
        }
        const btn = document.getElementById('coach-generate');
        btn.disabled = true;
        btn.textContent = 'Generating...';

        try {
            const res = await apiFetch(`${API_URL}/plugins/task-breakdown/plan`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ task })
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 403) {
                showDisabled(data?.detail);
                return;
            }
            if (!res.ok) {
                showMsg(data?.detail || 'Failed to generate plan.', 'error');
                return;
            }

            document.getElementById('coach-plan').textContent = data.plan || '';
            showMsg('Plan ready. Start with step 1 only.', 'success');
            await loadHistory();
        } finally {
            btn.disabled = false;
            btn.textContent = 'Generate Plan';
        }
    });

    await loadHistory();
});
