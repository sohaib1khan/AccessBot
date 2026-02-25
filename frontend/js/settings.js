// Settings Page JavaScript
const API_URL = '/api';
let authToken = localStorage.getItem('authToken');

// Redirect if not logged in
if (!authToken) {
    window.location.href = '/';
}

// Global 401 handler — clear stale token and redirect to login
async function apiFetch(url, options = {}) {
    const res = await fetch(url, options);
    if (res.status === 401) {
        localStorage.removeItem('authToken');
        window.location.href = '/';
    }
    return res;
}

// DOM Elements
const templatesContainer = document.getElementById('templates-container');
const settingsForm = document.getElementById('settingsForm');
const testBtn = document.getElementById('test-btn');
const logoutBtn = document.getElementById('logout-btn');
const messageDiv = document.getElementById('settings-message');

// Load everything on page load
document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        loadCurrentUserInfo(),
        loadUsers(),
        loadPlugins(),
        loadVoiceSettings(),
        loadTemplates(),
        loadCurrentSettings(),
    ]);
});

// ── Account ────────────────────────────────────────────────

async function loadCurrentUserInfo() {
    try {
        const res = await apiFetch(`${API_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const user = await res.json();
        const unInput = document.getElementById('acct-username');
        const emInput = document.getElementById('acct-email');
        if (unInput) unInput.value = user.username || '';
        if (emInput) emInput.value = user.email   || '';
    } catch { /* silent */ }
}

document.getElementById('save-account-btn').addEventListener('click', async () => {
    const btn        = document.getElementById('save-account-btn');
    const msgDiv     = document.getElementById('account-message');
    const newUsername = document.getElementById('acct-username').value.trim();
    const newEmail    = document.getElementById('acct-email').value.trim();
    const currentPw   = document.getElementById('acct-current-pw').value;
    const newPw       = document.getElementById('acct-new-pw').value;

    // Build payload — only send what's changing
    const payload = {};
    if (newUsername)  payload.new_username   = newUsername;
    if (newEmail !== undefined) payload.new_email = newEmail || '';
    if (newPw)        { payload.new_password = newPw; payload.current_password = currentPw; }

    if (!Object.keys(payload).length) {
        showAccountMsg('Nothing to update.', 'error'); return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        const res = await apiFetch(`${API_URL}/auth/me`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            showAccountMsg('Account updated successfully!', 'success');
            document.getElementById('acct-current-pw').value = '';
            document.getElementById('acct-new-pw').value     = '';
            document.getElementById('acct-username').value   = data.username;
            document.getElementById('acct-email').value      = data.email || '';
        } else {
            showAccountMsg(data.detail || 'Update failed.', 'error');
        }
    } catch {
        showAccountMsg('Network error — please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Account';
    }
});

function showAccountMsg(text, type) {
    const d = document.getElementById('account-message');
    if (!d) return;
    d.textContent = text;
    d.className   = `message ${type}`;
    d.classList.remove('hidden');
    setTimeout(() => d.classList.add('hidden'), 5000);
}

// ── User Management ────────────────────────────────────────

async function loadUsers() {
    const wrap = document.getElementById('users-list-wrap');
    if (!wrap) return;
    try {
        const res = await apiFetch(`${API_URL}/auth/users`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) { wrap.innerHTML = '<p class="loading-text">Could not load users.</p>'; return; }
        const users = await res.json();
        renderUsers(users);
    } catch {
        wrap.innerHTML = '<p class="loading-text">Error loading users.</p>';
    }
}

function renderUsers(users) {
    const wrap = document.getElementById('users-list-wrap');
    if (!wrap) return;
    if (!users.length) { wrap.innerHTML = '<p class="loading-text">No users found.</p>'; return; }

    // Decode current user id from token
    let currentUserId = null;
    try {
        const payload = JSON.parse(atob(authToken.split('.')[1]));
        currentUserId = parseInt(payload.sub);
    } catch { /* ignore */ }

    wrap.innerHTML = `
        <table class="users-table" role="table" aria-label="User accounts">
            <thead><tr><th>ID</th><th>Username</th><th>Email</th><th></th></tr></thead>
            <tbody>
                ${users.map(u => `
                    <tr data-uid="${u.id}">
                        <td>${u.id}</td>
                        <td>${escHtml(u.username)}${u.id === currentUserId ? ' <span class="you-badge">(you)</span>' : ''}</td>
                        <td>${escHtml(u.email || '—')}</td>
                        <td>${u.id !== currentUserId
                            ? `<button class="btn btn-danger btn-sm delete-user-btn" data-uid="${u.id}" aria-label="Delete ${escHtml(u.username)}">Delete</button>`
                            : ''}</td>
                    </tr>`).join('')}
            </tbody>
        </table>`;

    wrap.querySelectorAll('.delete-user-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteUser(parseInt(btn.dataset.uid), btn));
    });
}

async function deleteUser(uid, btn) {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    btn.disabled = true;
    btn.textContent = '…';
    try {
        const res = await apiFetch(`${API_URL}/auth/users/${uid}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok || res.status === 204) {
            loadUsers();
        } else {
            const d = await res.json().catch(() => ({}));
            alert(d.detail || 'Delete failed.');
            btn.disabled = false;
            btn.textContent = 'Delete';
        }
    } catch {
        alert('Network error.');
        btn.disabled = false;
        btn.textContent = 'Delete';
    }
}

document.getElementById('create-user-btn').addEventListener('click', async () => {
    const btn  = document.getElementById('create-user-btn');
    const msgD = document.getElementById('newuser-message');
    const username = document.getElementById('newuser-username').value.trim();
    const email    = document.getElementById('newuser-email').value.trim();
    const password = document.getElementById('newuser-password').value;

    if (!username || !password) {
        showMsgInEl(msgD, 'Username and password are required.', 'error'); return;
    }

    btn.disabled = true; btn.textContent = 'Creating…';
    try {
        const res = await apiFetch(`${API_URL}/auth/users`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email: email || null, password })
        });
        const data = await res.json();
        if (res.ok) {
            showMsgInEl(msgD, `User "${data.username}" created.`, 'success');
            document.getElementById('newuser-username').value = '';
            document.getElementById('newuser-email').value    = '';
            document.getElementById('newuser-password').value = '';
            loadUsers();
        } else {
            showMsgInEl(msgD, data.detail || 'Creation failed.', 'error');
        }
    } catch {
        showMsgInEl(msgD, 'Network error.', 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Create User';
    }
});

function showMsgInEl(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className   = `message ${type}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 5000);
}

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

// ── Voice ──────────────────────────────────────────────────

async function loadVoiceSettings() {
    try {
        const res = await apiFetch(`${API_URL}/voice/settings`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById('tts_voice').value   = data.tts_voice   || 'nova';
        document.getElementById('voice_enabled').checked = data.voice_enabled || false;

        const keyStatus = document.getElementById('voice-key-status');
        keyStatus.textContent = data.has_voice_key
            ? '✅ Voice API key is configured'
            : 'No voice key set — paste your OpenAI key above';
        keyStatus.style.color = data.has_voice_key ? '#3a3' : '#999';
    } catch {
        /* silent */
    }
}

document.getElementById('save-voice-btn').addEventListener('click', async () => {
    const payload = {
        voice_api_key: document.getElementById('voice_api_key').value.trim() || null,
        tts_voice:     document.getElementById('tts_voice').value,
        voice_enabled: document.getElementById('voice_enabled').checked,
    };

    try {
        const res = await apiFetch(`${API_URL}/voice/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            showMessage('Voice settings saved!', 'success');
            document.getElementById('voice_api_key').value = '';
            await loadVoiceSettings();   // refresh key status
            // Update live voice module if chat is open in another tab
            if (window.voiceModule) {
                window.voiceModule.setVoiceEnabled(payload.voice_enabled);
                window.voiceModule.setTtsVoice(payload.tts_voice);
            }
        } else {
            const err = await res.json();
            showMessage(err.detail || 'Failed to save voice settings.', 'error');
        }
    } catch {
        showMessage('Network error. Please try again.', 'error');
    }
});

// ── Plugins ──────────────────────────────────────────────────

async function loadPlugins() {
    const container = document.getElementById('plugins-container');
    try {
        const res = await apiFetch(`${API_URL}/plugins`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) throw new Error();
        const plugins = await res.json();
        renderPlugins(plugins);
    } catch {
        container.innerHTML = '<p class="loading-text">Could not load plugins.</p>';
    }
}

function renderPlugins(plugins) {
    const container = document.getElementById('plugins-container');
    if (!plugins.length) {
        container.innerHTML = '<p class="loading-text">No plugins available.</p>';
        return;
    }
    container.innerHTML = plugins.map(p => `
        <div class="plugin-row" id="plugin-row-${p.name}">
            <div class="plugin-info">
                <strong>${escapeHtml(p.display_name)}</strong>
                <span>${escapeHtml(p.description)}</span>
            </div>
            <label class="toggle-switch" aria-label="Toggle ${escapeHtml(p.display_name)}">
                <input
                    type="checkbox"
                    data-plugin="${p.name}"
                    ${p.enabled ? 'checked' : ''}
                    onchange="togglePlugin('${p.name}', this)"
                >
                <span class="toggle-slider"></span>
            </label>
        </div>
    `).join('');
}

async function togglePlugin(name, checkbox) {
    checkbox.disabled = true;
    try {
        const res = await apiFetch(`${API_URL}/plugins/${name}/toggle`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        checkbox.checked = data.enabled;   // sync to server truth
        showMessage(`${name.replace('_', ' ')} ${data.enabled ? 'enabled' : 'disabled'}.`, 'success');
    } catch {
        checkbox.checked = !checkbox.checked;  // revert on error
        showMessage('Failed to update plugin. Please try again.', 'error');
    } finally {
        checkbox.disabled = false;
    }
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

// Load provider templates
async function loadTemplates() {
    try {
        const response = await apiFetch(`${API_URL}/admin/templates`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            renderTemplates(data.templates);
        }
    } catch (error) {
        console.error('Failed to load templates:', error);
    }
}

// Render template cards
function renderTemplates(templates) {
    templatesContainer.innerHTML = templates.map(template => `
        <div class="template-card" onclick='selectTemplate(${JSON.stringify(template)})'>
            <h3>${template.name}</h3>
        </div>
    `).join('');
}

// Select a template
function selectTemplate(template) {
    document.getElementById('provider_name').value = template.provider_name;
    document.getElementById('api_format').value = template.api_format;
    document.getElementById('api_endpoint').value = template.api_endpoint;
    document.getElementById('model_name').value = template.model_name || '';
    document.getElementById('auth_type').value = template.auth_type;
    
    // Highlight selected template
    document.querySelectorAll('.template-card').forEach(card => {
        card.classList.remove('active');
    });
    event.target.closest('.template-card').classList.add('active');
}

// Load current settings
async function loadCurrentSettings() {
    try {
        const response = await apiFetch(`${API_URL}/admin/settings`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const settings = await response.json();
            
            document.getElementById('provider_name').value = settings.provider_name;
            document.getElementById('api_format').value = settings.api_format;
            document.getElementById('api_endpoint').value = settings.api_endpoint;
            document.getElementById('model_name').value = settings.model_name || '';
            document.getElementById('temperature').value = settings.temperature;
            document.getElementById('max_tokens').value = settings.max_tokens;
            document.getElementById('auth_type').value = settings.auth_type;
            document.getElementById('vision_enabled').checked = settings.vision_enabled || false;
        }
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

// Save settings
settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const settings = {
        provider_name: document.getElementById('provider_name').value,
        api_format: document.getElementById('api_format').value,
        api_endpoint: document.getElementById('api_endpoint').value,
        api_key: document.getElementById('api_key').value || null,
        model_name: document.getElementById('model_name').value || null,
        temperature: parseFloat(document.getElementById('temperature').value),
        max_tokens: parseInt(document.getElementById('max_tokens').value),
        auth_type: document.getElementById('auth_type').value,
        vision_enabled: document.getElementById('vision_enabled').checked,
        custom_headers: {},
        extra_params: {}
    };
    
    try {
        const response = await apiFetch(`${API_URL}/admin/settings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(settings)
        });
        
        if (response.ok) {
            showMessage('Settings saved successfully!', 'success');
            document.getElementById('api_key').value = '';  // Clear API key field
        } else {
            const error = await response.json();
            showMessage('Failed to save settings: ' + error.detail, 'error');
        }
    } catch (error) {
        showMessage('Network error. Please try again.', 'error');
    }
});

// Test connection
testBtn.addEventListener('click', async () => {
    showMessage('Testing connection...', 'success');
    
    try {
        const response = await apiFetch(`${API_URL}/admin/test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            showMessage('Connection successful! LLM is configured correctly.', 'success');
        } else {
            const error = await response.json().catch(() => ({}));
            showMessage('Connection failed: ' + (error.detail || `HTTP ${response.status}`), 'error');
        }
    } catch (error) {
        showMessage('Connection failed: ' + error.message, 'error');
    }
});

// Logout
logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('activeConversationId');
    window.location.href = '/';
});

// Export data
const exportBtn = document.getElementById('export-btn');
const exportMessage = document.getElementById('export-message');
if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
        exportBtn.disabled = true;
        exportBtn.textContent = 'Preparing export…';
        try {
            const res = await apiFetch(`${API_URL}/admin/export`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Export failed');
            }
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `accessbot_export_${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            if (exportMessage) {
                exportMessage.textContent = 'Export downloaded successfully!';
                exportMessage.className = 'message success';
                exportMessage.classList.remove('hidden');
                setTimeout(() => exportMessage.classList.add('hidden'), 4000);
            }
        } catch (e) {
            if (exportMessage) {
                exportMessage.textContent = `Error: ${e.message}`;
                exportMessage.className = 'message error';
                exportMessage.classList.remove('hidden');
                setTimeout(() => exportMessage.classList.add('hidden'), 5000);
            }
        } finally {
            exportBtn.disabled = false;
            exportBtn.textContent = '⬇ Export My Data';
        }
    });
}

// Show message
function showMessage(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.classList.remove('hidden');
    
    setTimeout(() => {
        messageDiv.classList.add('hidden');
    }, 5000);
}