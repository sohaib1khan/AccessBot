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
    const d = document.getElementById('goals-disabled');
    d.textContent = msg || 'Enable plugin please: Goal Streaks (Settings → Plugins).';
    d.classList.remove('hidden');
    document.getElementById('goal-title').disabled = true;
    document.getElementById('goal-add').disabled = true;
}

function showMsg(text, type = 'success') {
    const el = document.getElementById('goals-msg');
    el.textContent = text;
    el.className = `message ${type}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

function esc(text) {
    const d = document.createElement('div');
    d.textContent = String(text || '');
    return d.innerHTML;
}

async function loadGoals() {
    const list = document.getElementById('goals-list');
    const res = await apiFetch(`${API_URL}/plugins/goals`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) {
        showDisabled(data?.detail);
        list.innerHTML = '';
        return;
    }
    if (!res.ok) {
        list.innerHTML = '<p class="loading-text">Could not load goals.</p>';
        return;
    }

    const goals = data.goals || [];
    if (!goals.length) {
        list.innerHTML = '<p class="loading-text">No goals yet. Add one small goal to get started.</p>';
        return;
    }

    list.innerHTML = goals.map(g => `
        <div class="plugin-row" data-id="${g.id}">
            <div class="plugin-info">
                <strong>${esc(g.title)}</strong>
                <span>Streak: ${g.streak || 0} day(s) ${g.completed_today ? '• ✅ done today' : ''}</span>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm goal-toggle">${g.completed_today ? 'Undo today' : 'Done today'}</button>
                <button class="btn btn-danger btn-sm goal-delete">Delete</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.goal-toggle').forEach(btn => {
        btn.addEventListener('click', async () => {
            const row = btn.closest('[data-id]');
            const id = row.dataset.id;
            const isDone = btn.textContent.toLowerCase().includes('undo');
            const method = isDone ? 'DELETE' : 'POST';
            const r = await apiFetch(`${API_URL}/plugins/goals/${id}/complete`, {
                method,
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const body = await r.json().catch(() => ({}));
            if (r.status === 403) { showDisabled(body?.detail); return; }
            if (!r.ok) { showMsg(body?.detail || 'Failed to update goal.', 'error'); return; }
            await loadGoals();
        });
    });

    list.querySelectorAll('.goal-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const row = btn.closest('[data-id]');
            const id = row.dataset.id;
            const r = await apiFetch(`${API_URL}/plugins/goals/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const body = await r.json().catch(() => ({}));
            if (r.status === 403) { showDisabled(body?.detail); return; }
            if (!r.ok) { showMsg(body?.detail || 'Failed to delete goal.', 'error'); return; }
            await loadGoals();
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

    document.getElementById('goal-add')?.addEventListener('click', async () => {
        const input = document.getElementById('goal-title');
        const title = input.value.trim();
        if (!title) return;
        const res = await apiFetch(`${API_URL}/plugins/goals`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 403) { showDisabled(data?.detail); return; }
        if (!res.ok) { showMsg(data?.detail || 'Could not add goal.', 'error'); return; }
        input.value = '';
        showMsg('Goal added. Nice progress.');
        await loadGoals();
    });

    document.getElementById('goal-title')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('goal-add')?.click();
        }
    });

    await loadGoals();
});
