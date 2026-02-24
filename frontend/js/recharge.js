const API_URL = '/api';
let authToken = localStorage.getItem('authToken');
let feedItems = [];
let activeType = 'all';
let searchTerm = '';

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

    await loadFeed(false);
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

    const filtered = feedItems.filter(item => {
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
                <span class="recharge-source">${escapeHtml(item.source || '')}</span>
            </div>
            <h3 class="recharge-title">${escapeHtml(item.title || '')}</h3>
            <p class="recharge-summary">${escapeHtml(item.summary || '')}</p>
            <a class="recharge-link" href="${escapeAttr(item.url || '#')}" target="_blank" rel="noopener">Open resource →</a>
        </article>
    `).join('');
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
