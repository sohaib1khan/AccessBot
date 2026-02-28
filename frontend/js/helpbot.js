/* ══════════════════════════════════════════════════════════════
   AccessBot Help Navigator
   Self-contained floating navigation assistant.
   No backend calls — all intent matching is done in the browser.
   ══════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // ── Page directory ──────────────────────────────────────────────────────
    const PAGES = {
        chat: {
            url: '/',
            label: 'Chat',
            emoji: '💬',
            desc: 'Your main AI conversation window — talk to AccessBot about anything.',
        },
        checkin: {
            url: '/checkin.html',
            label: 'Daily Check-in',
            emoji: '📋',
            desc: 'Log how you are feeling today: mood, energy, and any notes.',
        },
        insights: {
            url: '/insights.html',
            label: 'Wellness Insights',
            emoji: '📊',
            desc: 'Charts and stats about your mood trends, streaks, and weekly summaries.',
        },
        resources: {
            url: '/resources.html',
            label: 'Resources',
            emoji: '🗂️',
            desc: 'Coping strategies, tips, and accessibility resources.',
        },
        recharge: {
            url: '/recharge.html',
            label: 'Motivation & Recharge',
            emoji: '⚡',
            desc: 'Motivational articles, videos, audio picks, and quote feed.',
        },
        taskcoach: {
            url: '/task-coach.html',
            label: 'Task Breakdown Coach',
            emoji: '🧩',
            desc: 'Break a large task into tiny actions with gentle pacing.',
        },
        kanban: {
            url: '/goals.html',
            label: 'Kanban Board',
            emoji: '🗂️',
            desc: 'Organize tasks in simple Now, Next, and Done columns.',
        },
        urgent: {
            url: '/urgent.html',
            label: 'Urgent Support Session',
            emoji: '🆘',
            desc: 'Separate support chat for urgent moments and step-by-step calming help.',
        },
        settings: {
            url: '/settings.html',
            label: 'Settings',
            emoji: '⚙️',
            desc: 'Configure your AI model, API key, plugins, and account details.',
        },
    };

    // ── Intent definitions ──────────────────────────────────────────────────
    // Each intent: { patterns: [string], page?: key, reply: string }
    // Patterns are lowercase keywords; any one matching triggers the intent.
    const INTENTS = [
        // ── Navigation intents ────────────────────────────────
        {
            page: 'chat',
            patterns: ['chat', 'talk', 'main', 'home', 'conversation', 'message', 'start', 'back to chat', 'go home'],
            reply: 'The **Chat** page is your main AI conversation with AccessBot. You can talk about anything there.',
        },
        {
            page: 'checkin',
            patterns: ['check in', 'checkin', 'check-in', 'mood', 'feeling', 'energy', 'log', 'daily', 'how am i', 'log my mood', 'track mood', 'log mood', 'today', 'log feeling'],
            reply: 'The **Daily Check-in** page lets you log how you\'re feeling today — your mood, energy, and a note. It takes less than a minute!',
        },
        {
            page: 'insights',
            patterns: ['insight', 'insights', 'stat', 'stats', 'statistics', 'trend', 'trends', 'chart', 'charts', 'graph', 'analytics', 'streak', 'history', 'weekly', 'summary', 'progress', 'data', 'report', 'mood history', 'past'],
            reply: 'The **Wellness Insights** page shows your mood trend charts, current streak, weekly summaries, and check-in history.',
        },
        {
            page: 'resources',
            patterns: ['resource', 'resources', 'tip', 'tips', 'strategy', 'strategies', 'coping', 'breathing', 'exercise', 'help material', 'article', 'guide', 'support material', 'relaxation', 'mindfulness'],
            reply: 'The **Resources** page has coping strategies, breathing exercises, and tips to support your wellbeing.',
        },
        {
            page: 'recharge',
            patterns: ['recharge', 'motivation', 'motivational', 'inspiration', 'inspire', 'quote', 'quotes', 'video', 'videos', 'watch', 'listen', 'audio', 'podcast'],
            reply: 'The **Motivation & Recharge** page gives you quick uplifting content: articles to read, videos to watch, audio picks to listen to, and a live quote feed.',
        },
        {
            page: 'taskcoach',
            patterns: ['task coach', 'task breakdown', 'break down task', 'overwhelmed task', 'adhd task', 'micro steps', 'tiny steps', 'step by step plan'],
            reply: 'The **Task Breakdown Coach** helps turn one overwhelming task into tiny, actionable steps with gentle pacing.',
        },
        {
            page: 'kanban',
            patterns: ['kanban', 'board', 'task board', 'columns', 'now next done', 'organize tasks', 'todo board'],
            reply: 'The **Kanban Board** page helps you organize tasks in clear **Now / Next / Done** columns.',
        },
        {
            page: 'urgent',
            patterns: ['urgent', 'crisis', 'panic', 'i need help now', 'support now', 'overwhelmed now', 'urgent support'],
            reply: 'The **Urgent Support Session** is a separate chat focused on calming and breaking down what feels urgent right now.',
        },
        {
            page: 'settings',
            patterns: ['setting', 'settings', 'configure', 'config', 'model', 'llm', 'api', 'api key', 'account', 'password', 'plugin', 'plugins', 'preference', 'preferences', 'setup', 'change model', 'lm studio', 'ollama', 'openai', 'anthropic', 'key'],
            reply: 'The **Settings** page is where you configure your AI model, API key, plugins, and account preferences.',
        },

        // ── FAQ intents (no navigation, just answer) ──────────
        {
            patterns: ['what is accessbot', 'what does accessbot do', 'about accessbot', 'what is this', 'what is this app', 'what can you do'],
            reply: 'AccessBot is an AI companion designed to support people with disabilities. It offers daily check-ins, mood tracking, wellness insights, a resource library, and a main AI chat — all in one place.',
        },
        {
            patterns: ['suggestion', 'suggestions', 'smart suggestion', 'chip', 'chips', 'recommendation'],
            reply: 'Smart Suggestions appear as pill-shaped buttons just above the message input after an AI reply. They offer proactive tips like logging your mood or trying a breathing exercise. Click one to act on it, or ✕ to dismiss.',
        },
        {
            patterns: ['breathing', 'breath', '4-7-8', 'calm', 'relax', 'stress', 'anxious', 'anxiety', 'panic'],
            reply: 'A 4-7-8 breathing exercise is built right into the chat. If you ever see a **"Try a breathing exercise"** suggestion chip, click it — or just ask AccessBot in the main chat: "I\'d like to do a breathing exercise."',
        },
        {
            patterns: ['voice', 'microphone', 'mic', 'speech', 'speak', 'dictate', 'record'],
            reply: 'Voice input is available in the main Chat page. Look for the 🎙️ microphone button next to the message input. Hold it to record, or click to toggle.',
        },
        {
            patterns: ['image', 'photo', 'picture', 'screenshot', 'attach', 'upload', 'drag', 'paste'],
            reply: 'You can attach images in the main Chat. Click the 📷 button, drag-and-drop a file onto the input area, or paste an image directly from your clipboard (Ctrl+V / Cmd+V).',
        },
        {
            patterns: ['logout', 'log out', 'sign out', 'signout'],
            reply: 'You can log out using the **Logout** button in the top-right of any page.',
        },
        {
            patterns: ['hello', 'hi', 'hey', 'help', 'what can i ask', 'how do i use', 'how do i navigate', 'navigation'],
            reply: 'Hi! I\'m the site navigator. I can take you to any page or answer questions about AccessBot. Try asking:\n• "Where do I log my mood?"\n• "Show me my stats"\n• "How do I change the AI model?"',
        },
        {
            patterns: ['thank', 'thanks', 'cheers', 'cool', 'great', 'awesome', 'perfect', 'nice', 'good'],
            reply: 'You\'re welcome! Let me know if you need anything else. 😊',
        },
    ];

    // Quick-reply chips shown on the welcome message
    const QUICK_CHIPS = [
        { label: '📋 Check in', query: 'where do I log my mood' },
        { label: '📊 View stats', query: 'show me my insights' },
        { label: '🧩 Task coach', query: 'open task breakdown coach' },
        { label: '🗂️ Kanban', query: 'open kanban board' },
        { label: '🆘 Urgent support', query: 'open urgent support' },
        { label: '⚡ Recharge', query: 'open recharge page' },
        { label: '🗂️ Resources', query: 'show resources' },
        { label: '⚙️ Settings', query: 'open settings' },
    ];

    // ── Intent matching ─────────────────────────────────────────────────────
    function matchIntent(input) {
        const lower = input.toLowerCase().trim();
        for (const intent of INTENTS) {
            for (const pattern of intent.patterns) {
                if (lower.includes(pattern)) return intent;
            }
        }
        return null;
    }

    // ── Simple markdown renderer (bold only) ────────────────────────────────
    function renderMarkdown(text) {
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n•/g, '<br>•')
            .replace(/\n/g, '<br>');
    }

    // ── DOM creation ────────────────────────────────────────────────────────
    function buildWidget() {
        // Trigger button
        const trigger = document.createElement('button');
        trigger.id = 'helpbot-trigger';
        trigger.setAttribute('aria-label', 'Open site navigator');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-controls', 'helpbot-panel');
        trigger.setAttribute('title', 'Site Navigator — Ask me where to go!');
        trigger.innerHTML = `
            <span class="hb-icon-open"  aria-hidden="true">?</span>
            <span class="hb-icon-close" aria-hidden="true">✕</span>
        `;

        // Panel
        const panel = document.createElement('div');
        panel.id = 'helpbot-panel';
        panel.setAttribute('hidden', '');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'false');
        panel.setAttribute('aria-label', 'Site navigator');
        panel.innerHTML = `
            <div class="hb-header">
                <div class="hb-avatar" aria-hidden="true">🧭</div>
                <div class="hb-header-text">
                    <strong>Site Navigator</strong>
                    <span>Ask me where to go</span>
                </div>
                <button class="hb-close-btn" id="hb-close-btn" aria-label="Close navigator">✕</button>
            </div>
            <div class="hb-messages" id="hb-messages" role="log" aria-live="polite" aria-label="Chat messages"></div>
            <div class="hb-chips" id="hb-chips"></div>
            <div class="hb-input-row">
                <input
                    class="hb-input"
                    id="hb-input"
                    type="text"
                    placeholder="Where do I find…?"
                    autocomplete="off"
                    aria-label="Ask the site navigator"
                    maxlength="200"
                >
                <button class="hb-send-btn" id="hb-send-btn" aria-label="Send">Go</button>
            </div>
        `;

        document.body.appendChild(trigger);
        document.body.appendChild(panel);
        return { trigger, panel };
    }

    // ── Messaging helpers ───────────────────────────────────────────────────
    function appendMessage(container, text, role, goTo) {
        const div = document.createElement('div');
        div.className = `hb-msg ${role}`;

        if (role === 'bot') {
            div.innerHTML = renderMarkdown(text);
            if (goTo) {
                const page = PAGES[goTo];
                const btn = document.createElement('a');
                btn.className = 'hb-goto-btn';
                btn.href = page.url;
                btn.innerHTML = `${page.emoji} Take me to ${page.label} →`;
                // If already on that page, just close the panel
                if (window.location.pathname === page.url ||
                    window.location.pathname.endsWith(page.url)) {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        closePanel();
                    });
                    btn.innerHTML = `${page.emoji} Already here! (close)`;
                }
                div.appendChild(document.createElement('br'));
                div.appendChild(btn);
            }
        } else {
            div.textContent = text;
        }

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return div;
    }

    function showTyping(container) {
        const typing = document.createElement('div');
        typing.className = 'hb-typing';
        typing.id = 'hb-typing';
        typing.innerHTML = `
            <div class="hb-dot"></div>
            <div class="hb-dot"></div>
            <div class="hb-dot"></div>
        `;
        container.appendChild(typing);
        container.scrollTop = container.scrollHeight;
        return typing;
    }

    // ── Quick chips ─────────────────────────────────────────────────────────
    function renderChips(chipsEl, query, messagesEl) {
        chipsEl.innerHTML = '';
        QUICK_CHIPS.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'hb-chip';
            btn.textContent = c.label;
            btn.addEventListener('click', () => {
                chipsEl.innerHTML = ''; // clear chips after one is used
                handleUserInput(c.query, messagesEl, chipsEl);
            });
            chipsEl.appendChild(btn);
        });
    }

    // ── Core response logic ─────────────────────────────────────────────────
    function handleUserInput(rawInput, messagesEl, chipsEl) {
        const text = rawInput.trim();
        if (!text) return;

        // Show user bubble
        appendMessage(messagesEl, text, 'user');

        // Clear quick chips after first interaction
        chipsEl.innerHTML = '';

        // Show typing indicator, then respond after short delay
        const typing = showTyping(messagesEl);
        setTimeout(() => {
            typing.remove();
            const intent = matchIntent(text);

            if (intent) {
                appendMessage(messagesEl, intent.reply, 'bot', intent.page || null);
            } else {
                // Fallback: list all pages
                appendMessage(
                    messagesEl,
                    'I\'m not sure I understood that. Here\'s what I can help you navigate to:',
                    'bot'
                );
                Object.entries(PAGES).forEach(([key, page]) => {
                    appendMessage(
                        messagesEl,
                        `${page.emoji} **${page.label}** — ${page.desc}`,
                        'bot',
                        key
                    );
                });
            }
        }, 420);
    }

    // ── Open / close ────────────────────────────────────────────────────────
    let panelOpen = false;
    let welcomed = false;

    function openPanel(trigger, panel, messagesEl, chipsEl) {
        panelOpen = true;
        panel.removeAttribute('hidden');
        trigger.setAttribute('aria-expanded', 'true');

        if (!welcomed) {
            welcomed = true;
            appendMessage(
                messagesEl,
                'Hi! 👋 I\'m your **site navigator**. Ask me where to find anything, or pick a shortcut below.',
                'bot'
            );
            renderChips(chipsEl, '', messagesEl);
        }

        // Focus the input
        setTimeout(() => {
            const inp = document.getElementById('hb-input');
            if (inp) inp.focus();
        }, 50);
    }

    function closePanel(trigger, panel) {
        panelOpen = false;
        const t = trigger || document.getElementById('helpbot-trigger');
        const p = panel  || document.getElementById('helpbot-panel');
        if (p) p.setAttribute('hidden', '');
        if (t) t.setAttribute('aria-expanded', 'false');
        if (t) t.focus();
    }

    // ── Wire events ─────────────────────────────────────────────────────────
    let initialized = false;

    function init() {
        if (initialized) return;

        // On index.html: skip when the chat container is still hidden (login screen)
        const chatContainer = document.getElementById('chat-container');
        if (chatContainer && chatContainer.classList.contains('hidden')) return;

        initialized = true;
        const { trigger, panel } = buildWidget();
        const messagesEl = panel.querySelector('#hb-messages');
        const chipsEl    = panel.querySelector('#hb-chips');
        const inputEl    = panel.querySelector('#hb-input');
        const sendBtn    = panel.querySelector('#hb-send-btn');
        const closeBtn   = panel.querySelector('#hb-close-btn');

        // Toggle
        trigger.addEventListener('click', () => {
            if (panelOpen) closePanel(trigger, panel);
            else           openPanel(trigger, panel, messagesEl, chipsEl);
        });

        // Close button
        closeBtn.addEventListener('click', () => closePanel(trigger, panel));

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && panelOpen) closePanel(trigger, panel);
        });

        // Send on Enter or button click
        function submit() {
            const val = inputEl.value.trim();
            if (!val) return;
            inputEl.value = '';
            handleUserInput(val, messagesEl, chipsEl);
        }
        sendBtn.addEventListener('click', submit);
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
    }

    // Boot once the DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Also init after login (app.js dispatches this when chat becomes visible)
    document.addEventListener('accessbot:login', init);

})();
