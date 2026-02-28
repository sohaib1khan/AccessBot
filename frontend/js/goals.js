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
    d.textContent = msg || 'Enable plugin please: Task Board (Settings → Plugins).';
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
    if (col === 'backlog') return 'Backlog';
    if (col === 'inprogress') return 'In Progress';
    if (col === 'completed') return 'Completed';
    return 'Pending';
}

function normalizeColumn(col) {
    const raw = String(col || '').toLowerCase();
    if (raw === 'in_progress') return 'inprogress';
    if (raw === 'now') return 'inprogress';
    if (raw === 'next') return 'pending';
    if (raw === 'done') return 'completed';
    if (['backlog', 'pending', 'inprogress', 'completed'].includes(raw)) return raw;
    return 'pending';
}

let draggedCardId = null;
let draggedFromColumn = null;
let editingCard = null;

async function updateCard(cardId, payload) {
    const r = await apiFetch(`${API_URL}/plugins/task-board/cards/${cardId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    const body = await r.json().catch(() => ({}));
    if (r.status === 403) {
        showDisabled(body?.detail);
        return { ok: false, disabled: true };
    }
    if (!r.ok) {
        showMsg(body?.detail || 'Update failed.', 'error');
        return { ok: false };
    }
    return { ok: true, data: body };
}

function setupDragTargets() {
    const cols = document.querySelectorAll('.kanban-col[data-column]');
    cols.forEach((col) => {
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            col.classList.add('drag-over');
        });

        col.addEventListener('dragleave', () => {
            col.classList.remove('drag-over');
        });

        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            col.classList.remove('drag-over');
            const targetColumn = normalizeColumn(col.dataset.column);
            if (!draggedCardId || !targetColumn || draggedFromColumn === targetColumn) return;

            const updated = await updateCard(draggedCardId, { column: targetColumn });
            if (!updated.ok) return;
            showMsg(`Moved to ${columnLabel(targetColumn)}.`);
            await loadCards();
        });
    });
}

function openEditModal(card) {
    const modal = document.getElementById('edit-modal');
    const titleEl = document.getElementById('edit-title');
    const noteEl = document.getElementById('edit-note');
    const columnEl = document.getElementById('edit-column');

    editingCard = card;
    titleEl.value = card.title || '';
    noteEl.value = card.note || '';
    columnEl.value = normalizeColumn(card.column);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => titleEl.focus(), 0);
}

function closeEditModal() {
    const modal = document.getElementById('edit-modal');
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    editingCard = null;
}

async function saveEditModal() {
    if (!editingCard) return;

    const title = document.getElementById('edit-title').value.trim();
    const note = document.getElementById('edit-note').value.trim();
    const column = normalizeColumn(document.getElementById('edit-column').value);

    if (!title) {
        showMsg('Title cannot be empty.', 'error');
        return;
    }

    const updated = await updateCard(editingCard.id, {
        title,
        note,
        column,
    });
    if (!updated.ok) return;

    closeEditModal();
    showMsg('Card updated.');
    await loadCards();
}

async function loadCards() {
    const backlogBox = document.getElementById('kanban-backlog');
    const pendingBox = document.getElementById('kanban-pending');
    const inprogressBox = document.getElementById('kanban-inprogress');
    const completedBox = document.getElementById('kanban-completed');
    backlogBox.innerHTML = '';
    pendingBox.innerHTML = '';
    inprogressBox.innerHTML = '';
    completedBox.innerHTML = '';

    const res = await apiFetch(`${API_URL}/plugins/task-board/cards`, {
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
        pendingBox.innerHTML = '<p class="loading-text">No cards yet. Add your first one above.</p>';
        return;
    }

    cards.forEach((card) => {
        const col = normalizeColumn(card.column);
        const container = col === 'backlog'
            ? backlogBox
            : col === 'inprogress'
                ? inprogressBox
                : col === 'completed'
                    ? completedBox
                    : pendingBox;
        const div = document.createElement('article');
        div.className = 'kanban-card';
        div.dataset.id = card.id;
        div.dataset.column = col;
        div.draggable = true;
        div.innerHTML = `
            <div class="kanban-card-title">${esc(card.title)}</div>
            ${card.note ? `<div class="kanban-card-note">${esc(card.note)}</div>` : ''}
            <div class="kanban-card-actions">
                <button class="btn btn-secondary btn-sm card-edit">Edit</button>
                <button class="btn btn-danger btn-sm card-delete">Delete</button>
            </div>
        `;

        div.addEventListener('dragstart', (e) => {
            draggedCardId = card.id;
            draggedFromColumn = col;
            div.classList.add('dragging');
            e.dataTransfer.setData('text/plain', card.id);
            e.dataTransfer.effectAllowed = 'move';
        });

        div.addEventListener('dragend', () => {
            div.classList.remove('dragging');
            draggedCardId = null;
            draggedFromColumn = null;
            document.querySelectorAll('.kanban-col.drag-over').forEach((lane) => lane.classList.remove('drag-over'));
        });

        div.querySelector('.card-edit')?.addEventListener('click', async () => {
            openEditModal(card);
        });

        div.querySelector('.card-delete')?.addEventListener('click', async () => {
            const r = await apiFetch(`${API_URL}/plugins/task-board/cards/${card.id}`, {
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

    const res = await apiFetch(`${API_URL}/plugins/task-board/cards`, {
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
    columnEl.value = 'backlog';
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

    document.getElementById('edit-save')?.addEventListener('click', saveEditModal);
    document.getElementById('edit-cancel')?.addEventListener('click', closeEditModal);
    document.getElementById('edit-modal')?.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'edit-modal') closeEditModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeEditModal();
    });

    setupDragTargets();

    await loadCards();
});
