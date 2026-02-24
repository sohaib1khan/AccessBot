const API_URL = '/api';
let authToken = localStorage.getItem('authToken');
let feedItems = [];
let customItems = [];
let activeType = 'all';
let searchTerm = '';
let editingCustomId = null;

if (!authToken) {
    window.location.href = '/';
}

async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (res.status === 401) {
        localStorage.removeItem('authToken');
        window.location.href = '/';
    }
    return res;
}

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('logout-btn')?.addEventListener('click', () => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('activeConversationId');
        window.location.href = '/';
    });

    document.getElementById('refresh-quote-btn')?.addEventListener('click', async () => {
        await loadFeed(true);
    });

    document.getElementById('custom-item-form')?.addEventListener('submit', submitCustomItem);
    document.getElementById('custom-item-cancel')?.addEventListener('click', resetCustomForm);

    document.getElementById('recharge-search')?.addEventListener('input', (e) => {
        searchTerm = (e.target.value || '').trim().toLowerCase();
        renderFeed();
    });

    document.querySelectorAll('.rf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.rf-btn').forEach(x => x.classList.remove('active'));
            btn.classList.add('active');
            activeType = btn.dataset.type;
            renderFeed();
        });
    });

    await Promise.all([loadFeed(false), loadCustomItems()]);
});

async function loadFeed(refreshOnlyQuote) {
    try {
        const res = await apiFetch(`${API_URL}/plugins/recharge/feed`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const data = await res.json();
        if (!res.ok) {
            const msg = typeof data.detail === 'string' ? data.detail : 'Failed to load recharge feed.';
            renderError(msg);
            return;
        }

        renderQuote(data.quote, data.updated_at);

        if (!refreshOnlyQuote) {
            feedItems = [
                ...(data.articles || []).map(i => ({ ...i, type: 'article' })),
                ...(data.videos || []).map(i => ({ ...i, type: 'video' })),
                ...(data.audio || []).map(i => ({ ...i, type: 'audio' })),
            ];
            renderFeed();
        }
    } catch (e) {
        renderError('Network error while loading recharge feed.');
    }
}

function renderQuote(quote, updatedAt) {
    const textEl = document.getElementById('quote-text');
    const authorEl = document.getElementById('quote-author');
    const updatedEl = document.getElementById('quote-updated');
    if (!textEl || !authorEl || !updatedEl) return;

    textEl.textContent = quote?.text ? `“${quote.text}”` : 'No quote available right now.';
    authorEl.textContent = quote?.author ? `— ${quote.author}` : '';

    if (updatedAt) {
        const dt = new Date(updatedAt);
        updatedEl.textContent = `Updated ${dt.toLocaleString()}`;
    } else {
        updatedEl.textContent = '';
    }
}

function renderFeed() {
    const grid = document.getElementById('recharge-grid');
    const empty = document.getElementById('recharge-empty');
    if (!grid || !empty) return;

    const allItems = [
        ...customItems.map(x => ({ ...x, isCustom: true })),
        ...feedItems,
    ];

    const filtered = allItems.filter(item => {
        const typeMatch = activeType === 'all' || item.type === activeType;
        const haystack = `${item.title || ''} ${item.summary || ''} ${item.source || ''}`.toLowerCase();
        const searchMatch = !searchTerm || haystack.includes(searchTerm);
        return typeMatch && searchMatch;
    });

    if (!filtered.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    grid.innerHTML = filtered.map(item => `
        <article class="recharge-item" role="listitem">
            <div class="recharge-item-head">
                <span class="recharge-type">${escapeHtml(item.type)}</span>
                <span class="recharge-source">${escapeHtml(item.source || '')}${item.isCustom ? ' • You' : ''}</span>
            </div>
            <h3 class="recharge-title">${escapeHtml(item.title || '')}</h3>
            <p class="recharge-summary">${escapeHtml(item.summary || '')}</p>
            <a class="recharge-link" href="${escapeAttr(item.url || '#')}" target="_blank" rel="noopener">Open resource →</a>
        </article>
    `).join('');
}

async function loadCustomItems() {
    try {
        const res = await apiFetch(`${API_URL}/plugins/recharge/custom-items`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (!res.ok) {
            showCustomMessage(typeof data.detail === 'string' ? data.detail : 'Failed to load custom items.', true);
            return;
        }
        customItems = Array.isArray(data.items) ? data.items : [];
        renderCustomItems();
        renderFeed();
    } catch (e) {
        showCustomMessage('Network error while loading custom items.', true);
    }
}

function renderCustomItems() {
    const list = document.getElementById('custom-items-list');
    const empty = document.getElementById('custom-items-empty');
    if (!list || !empty) return;

    if (!customItems.length) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    list.innerHTML = customItems.map(item => `
        <article class="custom-item" role="listitem">
            <div class="custom-item-head">
                <span class="recharge-type">${escapeHtml(item.type)}</span>
                <span class="recharge-source">${escapeHtml(item.source || 'Custom')}</span>
            </div>
            <h3 class="recharge-title">${escapeHtml(item.title || '')}</h3>
            <p class="recharge-summary">${escapeHtml(item.summary || '')}</p>
            <a class="recharge-link" href="${escapeAttr(item.url || '#')}" target="_blank" rel="noopener">Open resource →</a>
            <div class="custom-item-actions">
                <button class="btn btn-secondary btn-sm" data-edit="${escapeAttr(item.id)}" type="button">Edit</button>
                <button class="btn btn-secondary btn-sm custom-del-btn" data-del="${escapeAttr(item.id)}" type="button">Remove</button>
            </div>
        </article>
    `).join('');

    list.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => startEditCustomItem(btn.dataset.edit));
    });
    list.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
            await deleteCustomItem(btn.dataset.del);
        });
    });
}

function startEditCustomItem(itemId) {
    const item = customItems.find(x => x.id === itemId);
    if (!item) return;

    editingCustomId = item.id;
    document.getElementById('custom-item-id').value = item.id;
    document.getElementById('custom-item-type').value = item.type;
    document.getElementById('custom-item-title').value = item.title || '';
    document.getElementById('custom-item-url').value = item.url || '';
    document.getElementById('custom-item-source').value = item.source || '';
    document.getElementById('custom-item-summary').value = item.summary || '';
    document.getElementById('custom-item-save').textContent = 'Save changes';
    document.getElementById('custom-item-cancel').classList.remove('hidden');
    showCustomMessage('Editing item…', false);
}

function resetCustomForm() {
    editingCustomId = null;
    document.getElementById('custom-item-id').value = '';
    document.getElementById('custom-item-form').reset();
    document.getElementById('custom-item-type').value = 'article';
    document.getElementById('custom-item-save').textContent = 'Add item';
    document.getElementById('custom-item-cancel').classList.add('hidden');
    showCustomMessage('', false);
}

async function submitCustomItem(e) {
    e.preventDefault();
    const type = (document.getElementById('custom-item-type').value || 'article').trim().toLowerCase();
    const title = document.getElementById('custom-item-title').value.trim();
    const url = document.getElementById('custom-item-url').value.trim();
    const source = document.getElementById('custom-item-source').value.trim();
    const summary = document.getElementById('custom-item-summary').value.trim();

    if (!title || !url) {
        showCustomMessage('Title and URL are required.', true);
        return;
    }

    const payload = {
        type,
        title,
        url,
        source: source || 'Custom',
        summary,
    };

    const isEdit = !!editingCustomId;
    const endpoint = isEdit
        ? `${API_URL}/plugins/recharge/custom-items/${encodeURIComponent(editingCustomId)}`
        : `${API_URL}/plugins/recharge/custom-items`;
    const method = isEdit ? 'PATCH' : 'POST';

    try {
        const res = await apiFetch(endpoint, {
            method,
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
            showCustomMessage(typeof data.detail === 'string' ? data.detail : 'Failed to save item.', true);
            return;
        }

        showCustomMessage(isEdit ? 'Item updated.' : 'Item added.', false);
        resetCustomForm();
        await loadCustomItems();
    } catch (err) {
        showCustomMessage('Network error while saving item.', true);
    }
}

async function deleteCustomItem(itemId) {
    if (!itemId) return;
    if (!confirm('Remove this custom recharge item?')) return;

    try {
        const res = await apiFetch(`${API_URL}/plugins/recharge/custom-items/${encodeURIComponent(itemId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (!res.ok) {
            showCustomMessage(typeof data.detail === 'string' ? data.detail : 'Failed to remove item.', true);
            return;
        }

        if (editingCustomId === itemId) resetCustomForm();
        showCustomMessage('Item removed.', false);
        await loadCustomItems();
    } catch (err) {
        showCustomMessage('Network error while removing item.', true);
    }
}

function showCustomMessage(text, isError) {
    const msg = document.getElementById('custom-item-message');
    if (!msg) return;
    msg.textContent = text || '';
    msg.classList.toggle('error', !!isError);
}

function renderError(message) {
    const grid = document.getElementById('recharge-grid');
    if (grid) {
        grid.innerHTML = `<p class="recharge-empty">${escapeHtml(message)}</p>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

function escapeAttr(text) {
    return String(text ?? '').replace(/"/g, '&quot;');
}
