// Check-in Dashboard
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

// ── Constants ────────────────────────────────────────────────────────────────

const MOODS = [
    { key: 'great',      emoji: '😊', label: 'Great' },
    { key: 'good',       emoji: '🙂', label: 'Good' },
    { key: 'okay',       emoji: '😐', label: 'Okay' },
    { key: 'tired',      emoji: '😴', label: 'Tired' },
    { key: 'struggling', emoji: '😔', label: 'Struggling' },
];

const MOOD_EMOJI = { great: '😊', good: '🙂', okay: '😐', tired: '😴', struggling: '😔' };

// ── State ────────────────────────────────────────────────────────────────────

let selectedMood    = '';
let editingEntryId  = null;  // null = new check-in, number = edit existing

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('today-date').textContent = new Date().toLocaleDateString('en-GB', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    buildMoodSelector();
    setupFormListeners();
    loadPage();

    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('activeConversationId');
        window.location.href = '/';
    });
});

async function loadPage() {
    await loadTodayStatus();
    await loadHistory();
}

// ── Mood selector ─────────────────────────────────────────────────────────────

function buildMoodSelector() {
    const container = document.querySelector('.mood-selector');
    container.innerHTML = MOODS.map(m => `
        <button type="button" class="mood-btn" data-mood="${m.key}"
                aria-pressed="false" title="${m.label}">
            <span class="mood-emoji" aria-hidden="true">${m.emoji}</span>
            <span class="mood-label">${m.label}</span>
        </button>
    `).join('');

    container.querySelectorAll('.mood-btn').forEach(btn => {
        btn.addEventListener('click', () => selectMoodBtn(btn.dataset.mood));
    });
}

function selectMoodBtn(mood) {
    selectedMood = mood;
    document.getElementById('selected-mood').value = mood;
    document.querySelector('.mood-selector').querySelectorAll('.mood-btn').forEach(btn => {
        const active = btn.dataset.mood === mood;
        btn.classList.toggle('selected', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.getElementById('form-submit-btn').disabled = false;
}

// ── Today status ──────────────────────────────────────────────────────────────

async function loadTodayStatus() {
    const statusEl = document.getElementById('today-status');
    try {
        const res = await apiFetch(`${API_URL}/plugins/checkin/status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) { statusEl.innerHTML = '<p class="ci-muted">Could not load status.</p>'; return; }
        const data = await res.json();

        if (data.checked_in_today) {
            const noteHtml = data.todays_note
                ? `<p class="today-note">"${escHtml(data.todays_note)}"</p>`
                : '';
            statusEl.innerHTML = `
                <div class="today-done">
                    <span class="today-mood-badge">
                        ${MOOD_EMOJI[data.todays_mood] || ''} ${escHtml(data.todays_label || '')}
                    </span>
                    ${noteHtml}
                    <button class="btn btn-secondary btn-sm" id="edit-today-btn">✏️ Edit today's check-in</button>
                </div>`;
            document.getElementById('edit-today-btn').addEventListener('click', () => {
                startEdit(data.todays_id, data.todays_mood, data.todays_note || '', "today's check-in");
            });
            // Already checked in — hide form by default
            document.getElementById('form-card').classList.add('hidden');
        } else {
            statusEl.innerHTML = `
                <p class="ci-muted">You haven't checked in yet today.</p>
                <button class="btn btn-primary btn-sm" id="open-form-btn" style="margin-top:10px;">
                    ＋ Check in now
                </button>`;
            document.getElementById('open-form-btn').addEventListener('click', () => {
                resetForm();
                document.getElementById('form-card').classList.remove('hidden');
                document.getElementById('form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            document.getElementById('form-card').classList.remove('hidden');
        }
    } catch (e) {
        statusEl.innerHTML = '<p class="ci-muted">Could not load status.</p>';
    }
}

// ── Form ──────────────────────────────────────────────────────────────────────

function startEdit(entryId, mood, note, label) {
    editingEntryId = entryId || null;
    document.getElementById('form-title').textContent = `Edit check-in${label ? ' — ' + label : ''}`;
    document.getElementById('form-icon').textContent  = '✏️';
    document.getElementById('checkin-note').value     = note;
    if (mood) selectMoodBtn(mood);
    document.getElementById('form-cancel-btn').classList.remove('hidden');
    document.getElementById('form-submit-btn').textContent = 'Update Check-in';
    document.getElementById('form-card').classList.remove('hidden');
    document.getElementById('form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupFormListeners() {
    document.getElementById('checkin-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitCheckin();
    });

    document.getElementById('form-cancel-btn').addEventListener('click', () => {
        resetForm();
        document.getElementById('form-card').classList.add('hidden');
    });

    document.getElementById('ai-help-btn').addEventListener('click', () => {
        document.getElementById('ai-help-panel').classList.toggle('hidden');
    });

    document.getElementById('ai-generate-btn').addEventListener('click', getAISuggestion);

    document.getElementById('ai-use-btn').addEventListener('click', () => {
        const text = document.getElementById('ai-suggestion-text').textContent;
        document.getElementById('checkin-note').value = text;
        document.getElementById('ai-suggestion-box').classList.add('hidden');
        document.getElementById('ai-help-panel').classList.add('hidden');
    });

    document.getElementById('ai-dismiss-btn').addEventListener('click', () => {
        document.getElementById('ai-suggestion-box').classList.add('hidden');
    });
}

function resetForm() {
    selectedMood   = '';
    editingEntryId = null;
    document.querySelector('.mood-selector').querySelectorAll('.mood-btn').forEach(b => {
        b.classList.remove('selected');
        b.setAttribute('aria-pressed', 'false');
    });
    document.getElementById('selected-mood').value             = '';
    document.getElementById('checkin-note').value              = '';
    document.getElementById('form-submit-btn').disabled        = true;
    document.getElementById('form-submit-btn').textContent     = 'Submit Check-in';
    document.getElementById('form-cancel-btn').classList.add('hidden');
    document.getElementById('form-title').textContent          = 'Check in now';
    document.getElementById('form-icon').textContent           = '✏️';
    document.getElementById('ai-help-panel').classList.add('hidden');
    document.getElementById('ai-suggestion-box').classList.add('hidden');
    document.getElementById('ai-context').value                = '';
    hideFormMessage();
}

async function submitCheckin() {
    if (!selectedMood) return;
    const note = document.getElementById('checkin-note').value.trim();
    const btn  = document.getElementById('form-submit-btn');
    const isEdit = editingEntryId !== null;

    btn.disabled     = true;
    btn.textContent  = 'Saving…';

    try {
        let res;
        if (isEdit) {
            res = await apiFetch(`${API_URL}/plugins/checkin/${editingEntryId}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ mood: selectedMood, note })
            });
        } else {
            res = await apiFetch(`${API_URL}/plugins/checkin`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ mood: selectedMood, note })
            });
        }

        if (res.ok) {
            showFormMessage(isEdit ? 'Updated!' : 'Checked in!', 'success');
            resetForm();
            document.getElementById('form-card').classList.add('hidden');
            await loadTodayStatus();
            await loadHistory();
        } else {
            const err = await res.json();
            showFormMessage(err.detail || 'Failed to save.', 'error');
        }
    } catch (e) {
        showFormMessage('Network error. Please try again.', 'error');
    } finally {
        btn.disabled    = false;
        btn.textContent = isEdit ? 'Update Check-in' : 'Submit Check-in';
    }
}

// ── AI suggestion ──────────────────────────────────────────────────────────────

async function getAISuggestion() {
    if (!selectedMood) {
        alert('Please select a mood first.');
        return;
    }
    const context = document.getElementById('ai-context').value.trim();
    const btn     = document.getElementById('ai-generate-btn');

    btn.disabled    = true;
    btn.textContent = 'Generating…';

    try {
        const res = await apiFetch(`${API_URL}/plugins/checkin/ai-suggest`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ mood: selectedMood, context })
        });

        if (res.ok) {
            const data = await res.json();
            document.getElementById('ai-suggestion-text').textContent = data.suggestion;
            document.getElementById('ai-suggestion-box').classList.remove('hidden');
        } else {
            const err = await res.json();
            alert('AI error: ' + (err.detail || 'Unknown error'));
        }
    } catch (e) {
        alert('Network error: ' + e.message);
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Generate';
    }
}

// ── History ───────────────────────────────────────────────────────────────────

let _entries = {};

async function loadHistory() {
    const loadingEl  = document.getElementById('history-loading');
    const emptyEl    = document.getElementById('history-empty');
    const tableWrap  = document.getElementById('history-table-wrap');
    const tbody      = document.getElementById('history-body');

    loadingEl.classList.remove('hidden');
    emptyEl.classList.add('hidden');
    tableWrap.classList.add('hidden');

    try {
        const res = await apiFetch(`${API_URL}/plugins/checkin/history?days=365`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) { loadingEl.textContent = 'Failed to load history.'; return; }
        const data = await res.json();

        loadingEl.classList.add('hidden');
        _entries = {};
        data.entries.forEach(e => _entries[e.id] = e);

        if (!data.entries.length) {
            emptyEl.classList.remove('hidden');
            return;
        }

        tbody.innerHTML = data.entries.map(e => `
            <tr data-id="${e.id}">
                <td class="ci-date-col">${formatDate(e.date)}</td>
                <td class="ci-mood-col">${escHtml(e.emoji)} <span>${escHtml(e.label)}</span></td>
                <td class="ci-note-col">${e.note ? escHtml(e.note) : '<span class="ci-muted">—</span>'}</td>
                <td class="ci-actions-col">
                    <button class="btn btn-sm btn-secondary edit-btn" data-id="${e.id}"
                            aria-label="Edit this check-in" title="Edit">✏️</button>
                    <button class="btn btn-sm btn-danger delete-btn" data-id="${e.id}"
                            aria-label="Delete this check-in" title="Delete">🗑️</button>
                </td>
            </tr>
        `).join('');

        tableWrap.classList.remove('hidden');

        tbody.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const e = _entries[parseInt(btn.dataset.id)];
                if (e) startEdit(e.id, e.mood, e.note || '', formatDate(e.date));
            });
        });

        tbody.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteEntry(parseInt(btn.dataset.id)));
        });

    } catch (e) {
        loadingEl.textContent = 'Failed to load history.';
        console.error(e);
    }
}

async function deleteEntry(id) {
    if (!confirm('Delete this check-in? This cannot be undone.')) return;
    try {
        const res = await apiFetch(`${API_URL}/plugins/checkin/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
            await loadHistory();
            await loadTodayStatus();
        } else {
            alert('Failed to delete.');
        }
    } catch (e) {
        alert('Network error.');
    }
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
    // YYYY-MM-DD → "Mon 23 Feb 2026"
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
}

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

function showFormMessage(msg, type) {
    const el = document.getElementById('form-message');
    el.textContent = msg;
    el.className   = 'form-message ' + (type === 'success' ? 'form-msg-success' : 'form-msg-error');
    el.classList.remove('hidden');
    if (type === 'success') setTimeout(hideFormMessage, 3000);
}

function hideFormMessage() {
    document.getElementById('form-message').classList.add('hidden');
}
