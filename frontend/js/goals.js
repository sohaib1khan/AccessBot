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
    const d = document.getElementById('kanban-disabled');
    d.textContent = msg || 'Enable plugin please: Kanban Board (Settings → Plugins).';
    d.classList.remove('hidden');
    ['kanban-title', 'kanban-note', 'kanban-column', 'kanban-add'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
    });
}

function showMsg(text, type = 'success') {
    const el = document.getElementById('kanban-msg');
    el.textContent = text;
    el.className = `message ${type}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2500);
}

function esc(text) {
    const d = document.createElement('div');
    d.textContent = String(text || '');
    return d.innerHTML;
}

function columnLabel(col) {
    if (col === 'now') return 'Now';
    if (col === 'done') return 'Done';
    return 'Next';
}

async function loadCards() {
    const nowBox = document.getElementById('kanban-now');
    const nextBox = document.getElementById('kanban-next');
    const doneBox = document.getElementById('kanban-done');
    nowBox.innerHTML = '';
    nextBox.innerHTML = '';
    doneBox.innerHTML = '';

    const res = await apiFetch(`${API_URL}/plugins/kanban/cards`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 403) {
        showDisabled(data?.detail);
        return;
    }
    if (!res.ok) {
        showMsg(data?.detail || 'Could not load board.', 'error');
        return;
    }

    const cards = Array.isArray(data.cards) ? data.cards : [];
    if (!cards.length) {
        nextBox.innerHTML = '<p class="loading-text">No cards yet. Add your first one above.</p>';
        return;
    }

    cards.forEach((card) => {
        const col = card.column === 'now' || card.column === 'done' ? card.column : 'next';
        const container = col === 'now' ? nowBox : (col === 'done' ? doneBox : nextBox);
        const div = document.createElement('article');
        div.className = 'kanban-card';
        div.dataset.id = card.id;
        div.innerHTML = `
            <div class="kanban-card-title">${esc(card.title)}</div>
            ${card.note ? `<div class="kanban-card-note">${esc(card.note)}</div>` : ''}
            <div class="kanban-card-actions">
                <button class="btn btn-secondary btn-sm card-move">Move</button>
                <button class="btn btn-danger btn-sm card-delete">Delete</button>
            </div>
        `;

        div.querySelector('.card-move')?.addEventListener('click', async () => {
            const nextCol = col === 'now' ? 'next' : (col === 'next' ? 'done' : 'now');
            const r = await apiFetch(`${API_URL}/plugins/kanban/cards/${card.id}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ column: nextCol })
            });
            const body = await r.json().catch(() => ({}));
            if (r.status === 403) { showDisabled(body?.detail); return; }
            if (!r.ok) { showMsg(body?.detail || 'Move failed.', 'error'); return; }
            showMsg(`Moved to ${columnLabel(nextCol)}.`);
            await loadCards();
        });

        div.querySelector('.card-delete')?.addEventListener('click', async () => {
            const r = await apiFetch(`${API_URL}/plugins/kanban/cards/${card.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const body = await r.json().catch(() => ({}));
            if (r.status === 403) { showDisabled(body?.detail); return; }
            if (!r.ok) { showMsg(body?.detail || 'Delete failed.', 'error'); return; }
            await loadCards();
        });

        container.appendChild(div);
    });
}

async function addCard() {
    const titleEl = document.getElementById('kanban-title');
    const noteEl = document.getElementById('kanban-note');
    const columnEl = document.getElementById('kanban-column');

    const title = titleEl.value.trim();
    if (!title) return;

    const res = await apiFetch(`${API_URL}/plugins/kanban/cards`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            title,
            note: noteEl.value.trim(),
            column: columnEl.value
        })
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 403) {
        showDisabled(data?.detail);
        return;
    }
    if (!res.ok) {
        showMsg(data?.detail || 'Could not add card.', 'error');
        return;
    }

    titleEl.value = '';
    noteEl.value = '';
    columnEl.value = 'next';
    showMsg('Card added.');
    await loadCards();
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

    document.getElementById('kanban-add')?.addEventListener('click', addCard);
    document.getElementById('kanban-title')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCard();
        }
    });

    await loadCards();
});
