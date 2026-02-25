// API Configuration
const API_URL = '/api';
let authToken = localStorage.getItem('authToken');
let currentConversationId = parseInt(localStorage.getItem('activeConversationId')) || null;
let isRequestInFlight = false;
let longWaitTimer = null;
let liveSyncTimer = null;
let activeConversationSignature = null;
let isSyncingConversation = false;

// Global fetch wrapper — redirects to login on 401 (expired/invalid token)
async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (res.status === 401 && authToken) {
        // Only redirect if we're currently showing the chat (not during login flow)
        if (!document.getElementById('chat-container').classList.contains('hidden')) {
            authToken = null;
            localStorage.removeItem('authToken');
            showAuth();
        }
    }
    return res;
}

// DOM Elements
const authContainer = document.getElementById('auth-container');
const chatContainer = document.getElementById('chat-container');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authError = document.getElementById('auth-error');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const logoutBtn = document.getElementById('logout-btn');
const usernameDisplay = document.getElementById('username-display');
const conversationsList = document.getElementById('conversations-list');
const newChatBtn = document.getElementById('new-chat-btn');

// Image attach state
let pendingImage = null;

// Bulk select state
let selectMode = false;
const selectedConvIds = new Set();

// Rename-in-progress guard — prevents live sync from wiping the rename input
let isRenaming = false;

// Last sent payload — used by the retry button
let lastSendPayload = null;

// DOM id of the last user message bubble — used to mark it failed on error
let lastUserMsgId = null;

// Smart suggestions — chips dismissed this session won't reappear
const dismissedSuggestions = new Set();

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    // Check whether first-time setup is still needed; hide/show register link
    checkSetupStatus();

    if (authToken) {
        showChat();
        loadUserInfo();
        loadConversations().then(() => {
            const savedId = parseInt(localStorage.getItem('activeConversationId'));
            if (savedId) loadConversation(savedId);
        });
        checkDailyCheckin();
        startLiveSync();
    } else {
        showAuth();
        stopLiveSync();
    }
    
    setupEventListeners();
});

async function checkSetupStatus() {
    try {
        const res = await fetch(`${API_URL}/auth/setup-status`);
        if (!res.ok) return;
        const data = await res.json();
        const row = document.getElementById('register-link-row');
        if (row) row.style.display = data.setup_required ? '' : 'none';
    } catch (e) {
        // silently ignore — worst case the register link stays visible
    }
}

// Setup Event Listeners
function setupEventListeners() {
    // Auth form switching
    document.getElementById('show-register').addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
        authError.classList.add('hidden');
    });
    
    document.getElementById('show-login').addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        authError.classList.add('hidden');
    });
    
    // Login form submission
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    
    // Register form submission
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    
    // Logout
    logoutBtn.addEventListener('click', handleLogout);
    
    // New chat
    newChatBtn.addEventListener('click', startNewChat);

    // Attach image button
    const attachBtn = document.getElementById('attach-image-btn');
    const imageInput = document.getElementById('image-input');
    const previewBar = document.getElementById('image-preview-bar');
    const previewThumb = document.getElementById('image-preview-thumb');
    const previewRemove = document.getElementById('image-preview-remove');
    if (attachBtn && imageInput) {
        attachBtn.addEventListener('click', () => imageInput.click());
        imageInput.addEventListener('change', () => {
            const file = imageInput.files[0];
            if (!file) return;
            attachImageFile(file);
            imageInput.value = '';
        });
        previewRemove.addEventListener('click', () => {
            pendingImage = null;
            previewBar.hidden = true;
            previewThumb.src = '';
            const nameEl = document.getElementById('image-preview-name');
            if (nameEl) nameEl.textContent = '';
        });
    }

    // Drag & drop image onto input area
    const inputContainer = document.querySelector('.input-container');
    if (inputContainer) {
        inputContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            if ([...e.dataTransfer.types].includes('Files')) {
                inputContainer.classList.add('drag-active');
            }
        });
        inputContainer.addEventListener('dragleave', (e) => {
            if (!inputContainer.contains(e.relatedTarget)) {
                inputContainer.classList.remove('drag-active');
            }
        });
        inputContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            inputContainer.classList.remove('drag-active');
            const file = e.dataTransfer.files[0];
            if (file) attachImageFile(file);
        });
    }

    // Paste image from clipboard (Ctrl+V / Cmd+V)
    messageInput.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();         // don't paste binary garbage as text
                const file = item.getAsFile();
                if (file) attachImageFile(file);
                break;
            }
        }
    });

    // Select / bulk-delete
    document.getElementById('select-chats-btn').addEventListener('click', enterSelectMode);
    document.getElementById('cancel-select-btn').addEventListener('click', exitSelectMode);
    document.getElementById('select-all-btn').addEventListener('click', selectAll);
    document.getElementById('bulk-delete-btn').addEventListener('click', bulkDelete);
    const sidebarSearch = document.getElementById('sidebar-search');
    if (sidebarSearch) {
        let searchDebounce = null;
        sidebarSearch.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => searchConversations(sidebarSearch.value.trim()), 280);
        });
        sidebarSearch.addEventListener('search', () => {
            // fires when user clears the search field via the × button
            searchConversations('');
        });
    }
    
    // Send message
    sendBtn.addEventListener('click', sendMessage);

    // Scroll-to-top button
    const scrollTopBtn = document.getElementById('scroll-top-btn');
    messagesContainer.addEventListener('scroll', () => {
        scrollTopBtn.hidden = messagesContainer.scrollTop < 300;
    }, { passive: true });
    scrollTopBtn.addEventListener('click', () => {
        messagesContainer.scrollTo({ top: 0, behavior: 'smooth' });
    });
    
    // Send message on Enter (Shift+Enter for new line)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Help chatbot widget
    setupHelpChatbot();
}

function setupHelpChatbot() {
    const toggle = document.getElementById('help-chat-toggle');
    const panel = document.getElementById('help-chat-panel');
    if (!toggle) return;
    if (toggle.dataset.boundHelp === '1') return;
    toggle.dataset.boundHelp = '1';
    toggle.type = 'button';

    const openExistingHelpbot = () => {
        const hbTrigger = document.getElementById('helpbot-trigger');
        if (!hbTrigger) return false;
        hbTrigger.click();
        return true;
    };

    if (panel) {
        panel.hidden = true;
        panel.style.display = 'none';
    }

    toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (openExistingHelpbot()) return;

        // HelpBot script may not have initialized yet.
        // Retry once shortly after click for reliability.
        setTimeout(() => {
            openExistingHelpbot();
        }, 150);
    });

    toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle.click();
        }
    });
}

function buildSiteHelpPrompt(question) {
    return [
        'Help mode: You are the in-app help assistant for the AccessBot website.',
        'Answer only about using this site and its features (chat, conversations, check-in, insights, resources, settings, accessibility, login/logout).',
        'If the question is unrelated to AccessBot site usage, politely decline and ask the user to ask a site-related question.',
        `User help question: ${question}`
    ].join(' ');
}

// ──────────────────────────────────────────────
// Conversation Sidebar
// ──────────────────────────────────────────────

async function loadConversations() {
    try {
        const response = await apiFetch(`${API_URL}/chat/conversations`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const conversations = await response.json();
            renderConversations(conversations);
            return conversations;
        }
    } catch (error) {
        console.error('Failed to load conversations:', error);
    }
    return [];
}

function renderConversations(conversations) {
    if (conversations.length === 0) {
        conversationsList.innerHTML = '<li class="empty-state">No previous chats</li>';
        return;
    }

    conversationsList.innerHTML = conversations.map(conv => `
        <li
            data-id="${conv.id}"
            class="${conv.id === currentConversationId ? 'active' : ''}${selectedConvIds.has(conv.id) ? ' selected' : ''}"
            tabindex="0"
            role="listitem"
            aria-label="Conversation: ${escapeHtml(conv.title || 'New Chat')}"
        >
            <input type="checkbox" class="conv-checkbox" aria-label="Select conversation" ${selectedConvIds.has(conv.id) ? 'checked' : ''}>
            <span class="conv-title">${escapeHtml(conv.title || 'New Chat')}</span>
            <button class="conv-menu-btn" title="Rename or delete" aria-label="Conversation actions" tabindex="-1">⋮</button>
            <div class="conv-menu" hidden>
                <button class="conv-menu-item" data-action="rename">&#9998; Rename</button>
                <button class="conv-menu-item conv-menu-delete" data-action="delete">&#128465; Delete</button>
            </div>
        </li>
    `).join('');

    conversationsList.classList.toggle('select-mode', selectMode);

    conversationsList.querySelectorAll('li[data-id]').forEach(item => {
        const id = parseInt(item.dataset.id);
        const titleSpan = item.querySelector('.conv-title');
        const menuBtn   = item.querySelector('.conv-menu-btn');
        const menu      = item.querySelector('.conv-menu');
        const cb        = item.querySelector('.conv-checkbox');

        // Title click: load conversation OR toggle selection
        titleSpan.addEventListener('click', () => {
            if (selectMode) {
                cb.checked = !cb.checked;
                if (cb.checked) selectedConvIds.add(id); else selectedConvIds.delete(id);
                item.classList.toggle('selected', cb.checked);
                updateBulkDeleteBar();
            } else {
                loadConversation(id);
            }
        });

        // Direct checkbox change
        cb.addEventListener('change', () => {
            if (cb.checked) selectedConvIds.add(id); else selectedConvIds.delete(id);
            item.classList.toggle('selected', cb.checked);
            updateBulkDeleteBar();
        });

        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (selectMode) { cb.click(); } else { loadConversation(id); }
            }
        });

        // ⋮ button toggles menu
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            conversationsList.querySelectorAll('.conv-menu').forEach(m => { if (m !== menu) m.hidden = true; });
            menu.hidden = !menu.hidden;
        });

        // Menu actions
        menu.querySelectorAll('.conv-menu-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.hidden = true;
                if (btn.dataset.action === 'rename') startRename(item, id, titleSpan);
                if (btn.dataset.action === 'delete') confirmDelete(id);
            });
        });
    });

    // Close menus when clicking elsewhere
    document.addEventListener('click', closeAllConvMenus, { once: false });
}

function closeAllConvMenus() {
    conversationsList.querySelectorAll('.conv-menu').forEach(m => m.hidden = true);
}

function startRename(li, id, titleSpan) {
    if (isRenaming) return; // prevent double-open
    isRenaming = true;

    const current = titleSpan.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.className = 'conv-rename-input';
    input.maxLength = 100;
    titleSpan.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;

    const commit = async (save) => {
        if (committed) return;
        committed = true;
        isRenaming = false;

        const newTitle = (save ? input.value.trim() : '') || current;

        // Restore span regardless of outcome
        if (input.parentNode) input.replaceWith(titleSpan);
        titleSpan.textContent = newTitle;

        if (!save || newTitle === current) return;

        try {
            const res = await apiFetch(`${API_URL}/chat/conversations/${id}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle })
            });
            if (!res.ok) {
                // Revert title in UI if backend rejected it
                titleSpan.textContent = current;
                li.setAttribute('aria-label', `Conversation: ${current}`);
            } else {
                li.setAttribute('aria-label', `Conversation: ${newTitle}`);
            }
        } catch (err) {
            titleSpan.textContent = current;
        }
    };

    input.addEventListener('blur', () => commit(true));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(true); }
        if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
}

async function confirmDelete(id) {
    if (!confirm('Delete this conversation? This cannot be undone.')) return;
    try {
        const res = await apiFetch(`${API_URL}/chat/conversations/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
            if (currentConversationId === id) {
                currentConversationId = null;
                localStorage.removeItem('activeConversationId');
                messagesContainer.innerHTML = '<div class="welcome-message"><h2>Chat deleted</h2><p>Start a new conversation.</p></div>';
            }
            loadConversations();
        }
    } catch (err) { console.error('Delete failed', err); }
}

// ── Bulk select / delete ─────────────────────────────────────────────────────
function enterSelectMode() {
    selectMode = true;
    selectedConvIds.clear();
    conversationsList.classList.add('select-mode');
    document.getElementById('select-chats-btn').style.display = 'none';
    document.getElementById('new-chat-btn').style.display = 'none';
    document.getElementById('bulk-delete-bar').hidden = false;
    updateBulkDeleteBar();
    // Re-render to show checkboxes
    conversationsList.querySelectorAll('li[data-id]').forEach(item => {
        item.querySelector('.conv-checkbox').checked = false;
        item.classList.remove('selected');
    });
}

function exitSelectMode() {
    selectMode = false;
    selectedConvIds.clear();
    conversationsList.classList.remove('select-mode');
    document.getElementById('select-chats-btn').style.display = '';
    document.getElementById('new-chat-btn').style.display = '';
    document.getElementById('bulk-delete-bar').hidden = true;
    conversationsList.querySelectorAll('li[data-id]').forEach(item => {
        item.querySelector('.conv-checkbox').checked = false;
        item.classList.remove('selected');
    });
}

function updateBulkDeleteBar() {
    const count = selectedConvIds.size;
    document.getElementById('selected-count').textContent = `${count} selected`;
    document.getElementById('bulk-delete-btn').disabled = count === 0;
}

function selectAll() {
    const unchecked = conversationsList.querySelectorAll('.conv-checkbox:not(:checked)');
    const shouldCheck = unchecked.length > 0;  // if any unchecked → check all; else uncheck all
    conversationsList.querySelectorAll('li[data-id]').forEach(item => {
        const id = parseInt(item.dataset.id);
        const cb = item.querySelector('.conv-checkbox');
        cb.checked = shouldCheck;
        item.classList.toggle('selected', shouldCheck);
        if (shouldCheck) selectedConvIds.add(id); else selectedConvIds.delete(id);
    });
    updateBulkDeleteBar();
}

async function bulkDelete() {
    const ids = [...selectedConvIds];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} conversation${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
        const res = await apiFetch(`${API_URL}/chat/conversations`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        if (res.ok) {
            if (ids.includes(currentConversationId)) {
                currentConversationId = null;
                localStorage.removeItem('activeConversationId');
                messagesContainer.innerHTML = '<div class="welcome-message"><h2>Chats deleted</h2><p>Start a new conversation.</p></div>';
            }
            exitSelectMode();
            loadConversations();
        }
    } catch (err) { console.error('Bulk delete failed', err); }
}

// ──────────────────────────────────────────────
// Sidebar Search
// ──────────────────────────────────────────────

const searchResultsList = document.getElementById('search-results-list');

async function searchConversations(query) {
    if (!query || query.length < 2) {
        // Clear search, show normal list
        if (searchResultsList) searchResultsList.hidden = true;
        conversationsList.hidden = false;
        return;
    }
    try {
        const res = await apiFetch(`${API_URL}/chat/search?q=${encodeURIComponent(query)}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const results = await res.json();
        renderSearchResults(results, query);
    } catch (err) {
        console.error('Search failed:', err);
    }
}

function renderSearchResults(results, query) {
    if (!searchResultsList) return;
    conversationsList.hidden = true;
    searchResultsList.hidden = false;

    if (!results.length) {
        searchResultsList.innerHTML = '<li class="empty-state">No results found</li>';
        return;
    }

    searchResultsList.innerHTML = results.map(r => {
        const snippet = escapeHtml((r.snippet || '').replace(/\n/g, ' '));
        const title   = escapeHtml(r.conversation_title || 'Untitled');
        return `
            <li data-id="${r.conversation_id}" tabindex="0" role="option"
                aria-label="Result: ${title}">
                <span class="search-result-title">${title}</span>
                <span class="search-result-snippet">${snippet}</span>
            </li>`;
    }).join('');

    searchResultsList.querySelectorAll('li[data-id]').forEach(item => {
        const activate = () => {
            loadConversation(parseInt(item.dataset.id));
            // Clear search after selection
            const inp = document.getElementById('sidebar-search');
            if (inp) inp.value = '';
            searchResultsList.hidden = true;
            conversationsList.hidden = false;
        };
        item.addEventListener('click', activate);
        item.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        });
    });
}

async function loadConversation(conversationId) {
    try {
        const response = await apiFetch(`${API_URL}/chat/conversations/${conversationId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (!response.ok) {
            // Conversation gone (deleted) — clear the saved reference
            if (response.status === 404) localStorage.removeItem('activeConversationId');
            return;
        }
        
        const conversation = await response.json();
        
        currentConversationId = conversationId;
        localStorage.setItem('activeConversationId', conversationId);
        
        // Render messages
        messagesContainer.innerHTML = '';
        conversation.messages.forEach(msg => addMessage(msg.content, msg.role));
        activeConversationSignature = buildConversationSignature(conversation.messages);
        
        // Highlight active in sidebar
        updateActiveSidebarItem(conversationId);
        
        messageInput.focus();
    } catch (error) {
        console.error('Failed to load conversation:', error);
    }
}

function startNewChat() {
    currentConversationId = null;
    localStorage.removeItem('activeConversationId');
    messagesContainer.innerHTML = '';
    activeConversationSignature = null;
    hideSuggestions();
    updateActiveSidebarItem(null);
    messageInput.focus();
}

function updateActiveSidebarItem(conversationId) {
    conversationsList.querySelectorAll('li[data-id]').forEach(item => {
        item.classList.toggle('active', parseInt(item.dataset.id) === conversationId);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Shared helper — load any image File into the pending-image preview bar
function attachImageFile(file) {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5 MB.'); return; }
    const pb = document.getElementById('image-preview-bar');
    const pt = document.getElementById('image-preview-thumb');
    const reader = new FileReader();
    reader.onload = (ev) => {
        pendingImage = ev.target.result;
        if (pt) { pt.src = pendingImage; pt.alt = file.name || 'pasted image'; }
        const nameEl = document.getElementById('image-preview-name');
        if (nameEl) nameEl.textContent = file.name || 'pasted image';
        if (pb) pb.hidden = false;
    };
    reader.readAsDataURL(file);
}


async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const response = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.access_token;
            localStorage.setItem('authToken', authToken);
            showChat();
            loadUserInfo();
            // Restore the last active conversation after the sidebar loads —
            // without this the messages area stays blank until the user clicks
            // a conversation manually (same pattern used in DOMContentLoaded).
            loadConversations().then(() => {
                const savedId = parseInt(localStorage.getItem('activeConversationId'));
                if (savedId) {
                    loadConversation(savedId);
                } else {
                    messagesContainer.innerHTML = '<div class="welcome-message"><h2>Welcome to AccessBot 👋</h2><p>Start a new conversation using the <strong>+ New Chat</strong> button, or just type a message below.</p></div>';
                }
            });
            checkDailyCheckin();
        } else {
            showError(data.detail || 'Login failed');
        }
    } catch (error) {
        showError('Network error. Please try again.');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    
    try {
        const response = await fetch(`${API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                username, 
                email: email || null, 
                password 
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showError('Registration successful! Please login.', false);
            checkSetupStatus();   // hide register link now that a user exists
            document.getElementById('show-login').click();
        } else {
            showError(data.detail || 'Registration failed');
        }
    } catch (error) {
        showError('Network error. Please try again.');
    }
}

function handleLogout() {
    authToken = null;
    currentConversationId = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('activeConversationId');
    messagesContainer.innerHTML = '';
    activeConversationSignature = null;
    stopLiveSync();
    showAuth();
}

async function loadUserInfo() {
    try {
        const response = await apiFetch(`${API_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const user = await response.json();
            usernameDisplay.textContent = user.username;
        }
    } catch (error) {
        console.error('Failed to load user info:', error);
    }
}

// Chat Functions
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message && !pendingImage) return;

    // Local command: /mood
    if (message.toLowerCase() === '/mood') {
        messageInput.value = '';
        await showMoodHistory();
        return;
    }

    // Capture and clear pending image before async work
    const capturedImage = pendingImage;
    pendingImage = null;
    const previewBar = document.getElementById('image-preview-bar');
    if (previewBar) previewBar.hidden = true;

    // Build display content for user bubble
    const userContent = capturedImage
        ? JSON.stringify({ text: message, image: capturedImage })
        : message;
    lastUserMsgId = addMessage(userContent, 'user');
    messageInput.value = '';

    // Hide suggestions when user sends a new message
    hideSuggestions();

    // Save payload so the retry button can replay the request
    lastSendPayload = {
        message,
        capturedImage,
        conversationId: currentConversationId
    };

    // Show loading indicator
    const loadingId = addMessage('Thinking...', 'loading');
    sendBtn.disabled = true;

    await dispatchToLLM(lastSendPayload, loadingId);

    sendBtn.disabled = false;
    messageInput.focus();
}

// Re-run the last request — called by the retry button
async function retrySend() {
    if (!lastSendPayload) return;

    // Remove any existing error bubble
    messagesContainer.querySelectorAll('.message.error-bubble').forEach(el => el.remove());

    // Clear failed state from the user message bubble
    if (lastUserMsgId) {
        const el = messagesContainer.querySelector(`[data-id="${lastUserMsgId}"]`);
        if (el) {
            el.classList.remove('msg-failed');
            el.querySelectorAll('.msg-retry-btn').forEach(b => b.remove());
        }
    }

    const loadingId = addMessage('Thinking...', 'loading');
    sendBtn.disabled = true;
    await dispatchToLLM(lastSendPayload, loadingId);
    sendBtn.disabled = false;
    messageInput.focus();
}

// Core API call — shared by sendMessage and retrySend
async function dispatchToLLM(payload, loadingId) {
    const { message, capturedImage, conversationId } = payload;
    isRequestInFlight = true;
    clearTimeout(longWaitTimer);
    longWaitTimer = setTimeout(() => {
        updateMessageText(
            loadingId,
            'Still working on it... this can take a while on local LLMs. Your conversation will stay in this same chat thread.'
        );
    }, 12000);

    try {
        const response = await apiFetch(`${API_URL}/chat/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                message,
                conversation_id: conversationId,
                image_data: capturedImage || undefined
            })
        });

        let data = null;
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const raw = await response.text();
            data = { detail: raw || `HTTP ${response.status}` };
        }

        if (response.ok) {
            removeMessage(loadingId);
            addMessage(data.message, 'assistant');

            currentConversationId = data.conversation_id;
            localStorage.setItem('activeConversationId', data.conversation_id);
            activeConversationSignature = null;
            await loadConversations();
            updateActiveSidebarItem(currentConversationId);

            // Fetch smart suggestions (fire-and-forget; never blocks chat)
            fetchSuggestions(data.conversation_id);
        } else {
            removeMessage(loadingId);
            const detailValue = data?.detail;
            let detailText = 'Failed to get a response.';
            let erroredConversationId = null;

            if (typeof detailValue === 'string') {
                detailText = detailValue;
            } else if (detailValue && typeof detailValue === 'object') {
                detailText = detailValue.message || detailText;
                erroredConversationId = parseInt(detailValue.conversation_id) || null;
            }

            if (erroredConversationId) {
                currentConversationId = erroredConversationId;
                localStorage.setItem('activeConversationId', erroredConversationId);
                updateActiveSidebarItem(currentConversationId);
                await loadConversations();
            }

            if (response.status === 504) {
                detailText = 'The server timed out waiting for the model. Your message may still be processing. Please stay in this chat and retry shortly.';
            }

            showErrorBubble(detailText);
        }
    } catch (error) {
        removeMessage(loadingId);
        showErrorBubble('Network error — could not reach the server.');
    } finally {
        clearTimeout(longWaitTimer);
        longWaitTimer = null;
        isRequestInFlight = false;
    }
}

function updateMessageText(id, text) {
    const message = messagesContainer.querySelector(`[data-id="${id}"]`);
    if (!message) return;
    message.textContent = text;
}

function showErrorBubble(detail) {
    // Mark the last user message bubble as failed with an inline retry button
    if (lastUserMsgId) {
        const userEl = messagesContainer.querySelector(`[data-id="${lastUserMsgId}"]`);
        if (userEl && !userEl.querySelector('.msg-retry-btn')) {
            userEl.classList.add('msg-failed');
            const retryBtn = document.createElement('button');
            retryBtn.className = 'msg-retry-btn';
            retryBtn.setAttribute('aria-label', 'Retry sending this message');
            retryBtn.innerHTML = '🔄 Retry';
            retryBtn.addEventListener('click', retrySend);
            userEl.appendChild(retryBtn);
        }
    }

    // Show error detail below
    const div = document.createElement('div');
    div.className = 'message error-bubble';
    div.setAttribute('role', 'alert');
    div.innerHTML = `
        <span class="error-bubble-icon" aria-hidden="true">⚠️</span>
        <span class="error-bubble-text">${escapeHtml(detail)}</span>
    `;
    messagesContainer.appendChild(div);
    div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function buildConversationSignature(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return 'empty';
    const last = messages[messages.length - 1] || {};
    const tail = String(last.content || '').slice(-120);
    return `${messages.length}:${last.role || ''}:${tail}`;
}

async function syncActiveConversation() {
    if (!authToken || !currentConversationId || isRequestInFlight || isSyncingConversation) return;

    isSyncingConversation = true;
    try {
        const response = await apiFetch(`${API_URL}/chat/conversations/${currentConversationId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!response.ok) return;

        const conversation = await response.json();
        const nextSignature = buildConversationSignature(conversation.messages);
        if (nextSignature === activeConversationSignature) return;

        const nearBottom = (messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight) < 80;
        messagesContainer.innerHTML = '';
        conversation.messages.forEach(msg => addMessage(msg.content, msg.role));
        activeConversationSignature = nextSignature;
        if (nearBottom) messagesContainer.scrollTop = messagesContainer.scrollHeight;
        updateActiveSidebarItem(currentConversationId);
    } catch (error) {
        console.error('Live sync failed:', error);
    } finally {
        isSyncingConversation = false;
    }
}

function startLiveSync() {
    stopLiveSync();
    liveSyncTimer = setInterval(async () => {
        if (!authToken || document.getElementById('chat-container').classList.contains('hidden')) return;
        // Don't re-render the sidebar while the user is typing a rename — it would destroy the input
        if (isRenaming) return;

        const sidebarSearch = document.getElementById('sidebar-search');
        const searchActive = sidebarSearch && sidebarSearch.value.trim().length >= 2;
        if (!searchActive) await loadConversations();
        await syncActiveConversation();
    }, 6000);
}

function stopLiveSync() {
    if (liveSyncTimer) {
        clearInterval(liveSyncTimer);
        liveSyncTimer = null;
    }
}

// ──────────────────────────────────────────────
// Smart Suggestions
// ──────────────────────────────────────────────

async function fetchSuggestions(conversationId) {
    if (!conversationId || !authToken) return;
    try {
        const res = await apiFetch(`${API_URL}/chat/suggestions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ conversation_id: conversationId })
        });
        if (!res.ok) return;
        const data = await res.json();
        const suggestions = (data.suggestions || []).filter(
            s => !dismissedSuggestions.has(s.text)
        );
        if (suggestions.length > 0) {
            showSuggestions(suggestions);
        } else {
            hideSuggestions();
        }
    } catch (e) {
        // Never break the chat over suggestions
    }
}

function showSuggestions(suggestions) {
    const bar = document.getElementById('suggestions-bar');
    if (!bar) return;
    bar.innerHTML = '';
    suggestions.forEach(s => {
        const chip = document.createElement('button');
        chip.className = 'suggestion-chip';
        chip.setAttribute('aria-label', s.text);
        chip.innerHTML = `
            <span class="chip-label">${escapeHtml(s.text)}</span>
            <button class="chip-dismiss" aria-label="Dismiss suggestion" title="Dismiss">✕</button>
        `;
        // Main click → handle action
        chip.addEventListener('click', (e) => {
            if (e.target.closest('.chip-dismiss')) {
                dismissedSuggestions.add(s.text);
                chip.remove();
                if (bar.children.length === 0) hideSuggestions();
            } else {
                handleSuggestionClick(s.action, s.payload);
            }
        });
        bar.appendChild(chip);
    });
    bar.removeAttribute('hidden');
}

function hideSuggestions() {
    const bar = document.getElementById('suggestions-bar');
    if (bar) {
        bar.setAttribute('hidden', '');
        bar.innerHTML = '';
    }
}

function handleSuggestionClick(action, payload) {
    hideSuggestions();
    switch (action) {
        case 'checkin':
            window.location.href = '/checkin.html';
            break;
        case 'resources':
            window.location.href = '/resources.html';
            break;
        case 'breathing':
            openBreathingModal();
            break;
        case 'message':
            if (payload) {
                messageInput.value = payload;
                messageInput.focus();
                messageInput.setSelectionRange(payload.length, payload.length);
            }
            break;
        default:
            break;
    }
}

// ──────────────────────────────────────────────
// Breathing Exercise Modal (4-7-8 technique)
// ──────────────────────────────────────────────

const BREATHING_PHASES = [
    { name: 'Inhale',  instruction: 'Breathe in slowly through your nose',      seconds: 4 },
    { name: 'Hold',    instruction: 'Hold your breath — stay calm and still',    seconds: 7 },
    { name: 'Exhale',  instruction: 'Breathe out completely through your mouth', seconds: 8 },
];
const MAX_BREATHING_CYCLES = 4;
const RING_CIRCUMFERENCE = 339.3;  // 2π × 54

let _breathTimer = null;
let _breathCycles = 0;

function openBreathingModal() {
    const modal = document.getElementById('breathing-modal');
    if (!modal) return;
    _resetBreathingUI();
    modal.removeAttribute('hidden');
    modal.querySelector('#breathing-start-btn').focus();
}

function _closeBreathingModal() {
    _stopBreathing();
    const modal = document.getElementById('breathing-modal');
    if (modal) modal.setAttribute('hidden', '');
}

function _resetBreathingUI() {
    document.getElementById('breathing-phase').textContent = 'Ready';
    document.getElementById('breathing-count').textContent = '';
    document.getElementById('breathing-instruction').textContent = 'Press Start when you are ready';
    document.getElementById('breathing-cycles-label').textContent = '';
    const progress = document.getElementById('breathing-ring-progress');
    if (progress) {
        progress.style.strokeDashoffset = RING_CIRCUMFERENCE;
        progress.className = 'ring-progress';
    }
    const startBtn = document.getElementById('breathing-start-btn');
    const stopBtn  = document.getElementById('breathing-stop-btn');
    if (startBtn) startBtn.removeAttribute('hidden');
    if (stopBtn)  stopBtn.setAttribute('hidden', '');
}

function _stopBreathing() {
    if (_breathTimer) { clearInterval(_breathTimer); _breathTimer = null; }
    _breathCycles = 0;
}

// Wired up by inline event handlers set below after DOMContentLoaded
function _startBreathing() {
    _stopBreathing();
    _breathCycles = 0;
    const startBtn = document.getElementById('breathing-start-btn');
    const stopBtn  = document.getElementById('breathing-stop-btn');
    if (startBtn) startBtn.setAttribute('hidden', '');
    if (stopBtn)  stopBtn.removeAttribute('hidden');

    let phaseIdx = 0;
    let secondsLeft = BREATHING_PHASES[0].seconds;
    _applyBreathingPhase(phaseIdx, secondsLeft);

    _breathTimer = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) {
            phaseIdx++;
            if (phaseIdx >= BREATHING_PHASES.length) {
                phaseIdx = 0;
                _breathCycles++;
                const label = document.getElementById('breathing-cycles-label');
                if (label) label.textContent = `Cycle ${_breathCycles} of ${MAX_BREATHING_CYCLES} complete`;
                if (_breathCycles >= MAX_BREATHING_CYCLES) {
                    _stopBreathing();
                    document.getElementById('breathing-phase').textContent = '✓ Done';
                    document.getElementById('breathing-count').textContent = '';
                    document.getElementById('breathing-instruction').textContent =
                        'Well done! You have completed 4 breathing cycles.';
                    const progress = document.getElementById('breathing-ring-progress');
                    if (progress) progress.style.strokeDashoffset = 0;
                    if (startBtn) startBtn.removeAttribute('hidden');
                    if (stopBtn)  stopBtn.setAttribute('hidden', '');
                    return;
                }
            }
            secondsLeft = BREATHING_PHASES[phaseIdx].seconds;
            _applyBreathingPhase(phaseIdx, secondsLeft);
        } else {
            _applyBreathingPhase(phaseIdx, secondsLeft);
        }
    }, 1000);
}

function _applyBreathingPhase(phaseIdx, secondsLeft) {
    const phase = BREATHING_PHASES[phaseIdx];
    const elapsed = phase.seconds - secondsLeft;
    const fraction = elapsed / phase.seconds;  // 0→1 as time passes

    document.getElementById('breathing-phase').textContent = phase.name;
    document.getElementById('breathing-count').textContent = secondsLeft;
    document.getElementById('breathing-instruction').textContent = phase.instruction;

    const progress = document.getElementById('breathing-ring-progress');
    if (progress) {
        progress.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - fraction);
        progress.className = 'ring-progress' +
            (phase.name === 'Hold'   ? ' hold'   : '') +
            (phase.name === 'Exhale' ? ' exhale' : '');
    }
}

// Wire up modal buttons after DOM ready (avoids inline onclick issues)
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('breathing-close-btn');
    const startBtn = document.getElementById('breathing-start-btn');
    const stopBtn  = document.getElementById('breathing-stop-btn');
    const modal    = document.getElementById('breathing-modal');
    if (closeBtn) closeBtn.addEventListener('click', _closeBreathingModal);
    if (startBtn) startBtn.addEventListener('click', _startBreathing);
    if (stopBtn)  stopBtn.addEventListener('click', () => {
        _stopBreathing();
        _resetBreathingUI();
    });
    // Close on backdrop click
    if (modal) modal.addEventListener('click', (e) => {
        if (e.target === modal) _closeBreathingModal();
    });
    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.hasAttribute('hidden')) {
            _closeBreathingModal();
        }
    });
});

function addMessage(text, role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    // Parse JSON content (image + text) stored by backend
    let displayText = text;
    let imageData = null;
    if (role !== 'loading') {
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object' && 'text' in parsed) {
                displayText = parsed.text || '';
                imageData = parsed.image || null;
            }
        } catch (e) { /* plain text */ }
    }

    if (imageData) {
        const img = document.createElement('img');
        img.src = imageData;
        img.className = 'msg-image';
        img.alt = 'Attached image';
        // Click to open full-size lightbox
        img.addEventListener('click', () => {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
            const full = document.createElement('img');
            full.src = imageData;
            full.style.cssText = 'max-width:95vw;max-height:92vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.6)';
            overlay.appendChild(full);
            overlay.addEventListener('click', () => overlay.remove());
            document.body.appendChild(overlay);
        });
        messageDiv.appendChild(img);
    }
    if (displayText) {
        const span = document.createElement('span');
        if (role === 'assistant') {
            span.innerHTML = formatAssistantMessage(displayText);
        } else {
            span.textContent = displayText;
        }
        messageDiv.appendChild(span);
    }
    if (!imageData && !displayText) {
        messageDiv.textContent = text; // safe fallback
    }

    const messageId = Date.now();
    messageDiv.dataset.id = messageId;

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    return messageId;
}

function formatAssistantMessage(text) {
    let raw = String(text ?? '');

    // Normalize line endings
    raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Convert literal <br> / <br/> the AI might emit → real newlines (before escaping)
    raw = raw.replace(/<br\s*\/?>/gi, '\n');

    // --- Detect markdown tables (lines that are mostly | pipe chars) ---
    // Replace them with a <pre> block so they render cleanly
    raw = raw.replace(
        /((?:^[ \t]*\|.+\|[ \t]*\n?)+)/gm,
        (match) => `\x00TABLE\x00${match}\x00ENDTABLE\x00`
    );

    // Now safe-escape everything
    let safe = escapeHtml(raw);

    // Restore pre-formatted table blocks (escapeHtml encoded the markers too, so re-encode markers)
    // Actually escapeHtml won't touch \x00, so we can replace directly
    safe = safe.replace(/\x00TABLE\x00([\s\S]*?)\x00ENDTABLE\x00/g, (_, tableText) => {
        return `<pre class="md-table">${tableText.trim()}</pre>`;
    });

    // Headings (##, ###, etc.) — full line
    safe = safe.replace(/^#{1,6}\s+(.+)$/gm, '<strong class="md-heading">$1</strong>');

    // Bold: **text**
    safe = safe.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

    // Italic: *text* (single, not double)
    safe = safe.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '<em>$1</em>');

    // Inline code: `code`
    safe = safe.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // Markdown links: [label](https://...)
    safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Ensure numbered list items start on their own line
    safe = safe.replace(/(\n)(\d+\.\s)/g, '\n$2');
    safe = safe.replace(/([^\n])(\d+\.\s)/g, '$1\n$2');

    // Ensure bullet items start on their own line
    safe = safe.replace(/([^\n])([•\-]\s)/g, '$1\n$2');

    // Convert remaining newlines to <br>
    safe = safe.replace(/\n/g, '<br>');

    // Collapse 3+ consecutive <br> to 2
    safe = safe.replace(/(<br>){3,}/g, '<br><br>');

    return safe;
}

function removeMessage(id) {
    const message = messagesContainer.querySelector(`[data-id="${id}"]`);
    if (message) message.remove();
}

// UI Functions
function showAuth() {
    // Keep the FOUC guard class in sync so CSS hides the right container immediately
    document.documentElement.classList.remove('is-authed');
    document.documentElement.classList.add('not-authed');
    authContainer.classList.remove('hidden');
    chatContainer.classList.add('hidden');
    stopLiveSync();
    // Hide HelpBot if it was already built (e.g. stale token → 401 → back to login)
    const hbt = document.getElementById('helpbot-trigger');
    const hbp = document.getElementById('helpbot-panel');
    if (hbt) hbt.style.display = 'none';
    if (hbp) hbp.hidden = true;
}

function showChat() {
    // Keep the FOUC guard class in sync so CSS hides the right container immediately
    document.documentElement.classList.remove('not-authed');
    document.documentElement.classList.add('is-authed');
    authContainer.classList.add('hidden');
    chatContainer.classList.remove('hidden');
    startLiveSync();
    // Restore HelpBot visibility (in case it was hidden by showAuth)
    const hbt = document.getElementById('helpbot-trigger');
    if (hbt) hbt.style.display = '';
    // Let helpbot know the app is ready (needed when user logs in from login screen)
    document.dispatchEvent(new Event('accessbot:login'));
}

function showError(message, isError = true) {
    authError.textContent = message;
    authError.classList.remove('hidden');
    authError.style.background = isError ? '#fee' : '#efe';
    authError.style.color = isError ? '#c33' : '#3c3';
    authError.style.borderColor = isError ? '#fcc' : '#cfc';
}

// ──────────────────────────────────────────────
// Daily Check-in & Mood Tracker
// ──────────────────────────────────────────────

const MOOD_OPTIONS = [
    { mood: 'great',      label: '😊 Great' },
    { mood: 'good',       label: '🙂 Good' },
    { mood: 'okay',       label: '😐 Okay' },
    { mood: 'tired',      label: '😴 Tired' },
    { mood: 'struggling', label: '😔 Struggling' },
];

async function checkDailyCheckin() {
    try {
        const res = await apiFetch(`${API_URL}/plugins/checkin/status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.checked_in_today) {
            showCheckinCard();
        }
    } catch (e) {
        // silently fail — check-in is optional
    }
}

function showCheckinCard() {
    const card = document.createElement('div');
    card.className = 'checkin-card';
    card.id = 'checkin-card';
    card.innerHTML = `
        <p class="checkin-title">👋 Hey! How are you feeling today?</p>
        <div class="mood-buttons">
            ${MOOD_OPTIONS.map(o =>
                `<button class="mood-btn" data-mood="${o.mood}" type="button">${o.label}</button>`
            ).join('')}
        </div>
        <textarea class="checkin-note-input" id="checkin-note"
            placeholder="Want to add a note? (optional)" rows="2"></textarea>
        <div class="checkin-submit-row">
            <button class="btn btn-primary" id="checkin-submit-btn" type="button">Save check-in</button>
            <button class="btn btn-secondary" id="checkin-skip-btn" type="button">Skip</button>
        </div>
    `;

    messagesContainer.appendChild(card);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    let selectedMood = null;

    // Mood button selection
    card.querySelectorAll('.mood-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            card.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedMood = btn.dataset.mood;
            card.querySelector('.checkin-note-input').style.display = 'block';
            card.querySelector('.checkin-submit-row').style.display = 'flex';
        });
    });

    // Submit
    card.querySelector('#checkin-submit-btn').addEventListener('click', async () => {
        if (!selectedMood) return;
        const note = card.querySelector('#checkin-note').value.trim();
        await submitCheckin(selectedMood, note, card);
    });

    // Skip
    card.querySelector('#checkin-skip-btn').addEventListener('click', () => {
        card.remove();
    });
}

async function submitCheckin(mood, note, card) {
    try {
        const res = await apiFetch(`${API_URL}/plugins/checkin`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ mood, note: note || null })
        });

        if (res.ok) {
            const data = await res.json();
            // Replace card with a friendly confirmation message
            const label = data.label || mood;
            card.innerHTML = `
                <p class="checkin-title">✅ Check-in saved! You said you're feeling <strong>${escapeHtml(label)}</strong>.</p>
                ${note ? `<p style="color:#666;font-size:.9rem;margin-top:8px">"${escapeHtml(note)}"</p>` : ''}
            `;
            card.style.border = '2px solid #b2f0b2';
            card.style.background = '#f0fff0';
            setTimeout(() => card.remove(), 4000);
        } else {
            card.querySelector('#checkin-submit-btn').textContent = 'Error — try again';
        }
    } catch (e) {
        console.error('Check-in failed:', e);
    }
}

async function showMoodHistory() {
    addMessage('📊 Loading your mood history...', 'loading-mood');
    try {
        const res = await apiFetch(`${API_URL}/plugins/mood/history?days=14`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        // Remove loading
        const loading = messagesContainer.querySelector('.message.loading-mood');
        if (loading) loading.remove();

        if (!res.ok) {
            addMessage('Could not load mood history.', 'assistant');
            return;
        }

        const { entries, summary } = await res.json();

        const card = document.createElement('div');
        card.className = 'mood-history-card message';
        card.innerHTML = `
            <h3>📊 Mood History (last 14 days)</h3>
            ${ entries.length === 0
                ? '<p style="color:#999">No entries yet. Do a check-in to start tracking!</p>'
                : `<ul class="mood-history-list">
                    ${entries.slice(-14).reverse().map(e =>
                        `<li>
                            <span class="mood-date">${e.date}</span>
                            <span>${e.emoji} ${e.mood}${e.note ? ` — <em>${escapeHtml(e.note)}</em>` : ''}</span>
                        </li>`
                    ).join('')}
                   </ul>
                   <p style="margin-top:12px;color:#888;font-size:.85rem">Total check-ins: ${summary.total}</p>`
            }
        `;
        messagesContainer.appendChild(card);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (e) {
        addMessage('Could not load mood history.', 'assistant');
    }
}