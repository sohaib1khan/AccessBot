/* ════════════════════════════════════════════════════════════
   AccessBot — Insights page logic
   Fetches /api/analytics/insights and renders charts/stats.
   ════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    const TOKEN_KEY = 'authToken';
    function getToken() { return localStorage.getItem(TOKEN_KEY); }

    async function apiFetch(url, options = {}) {
        const token = getToken();
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        try {
            const res = await fetch(url, { ...options, headers });
            if (res.status === 401) { window.location.href = '/'; return null; }
            return res;
        } catch {
            return null;
        }
    }

    // ── Colour palette matching aurora dark theme ─────────────────────────────
    const MOOD_COLORS = {
        great:      'rgba(0, 220, 180, 0.85)',
        good:       'rgba(0, 180, 200, 0.80)',
        okay:       'rgba(80, 160, 200, 0.75)',
        tired:      'rgba(100, 120, 180, 0.70)',
        struggling: 'rgba(180, 80, 100, 0.70)',
    };
    const MOOD_SCORE_COLORS = {
        5: MOOD_COLORS.great,
        4: MOOD_COLORS.good,
        3: MOOD_COLORS.okay,
        2: MOOD_COLORS.tired,
        1: MOOD_COLORS.struggling,
    };

    const MOOD_ORDER = ['great', 'good', 'okay', 'tired', 'struggling'];

    // Chart.js global defaults for dark theme
    function setChartDefaults() {
        Chart.defaults.color          = '#7eb5ad';
        Chart.defaults.font.family    = getComputedStyle(document.body).fontFamily || 'sans-serif';
        Chart.defaults.font.size      = 13;
        Chart.defaults.borderColor    = '#1b3650';
        Chart.defaults.backgroundColor = '#7eb5ad';
    }

    // ── Render trend line chart ───────────────────────────────────────────────
    function renderTrend(trend) {
        const canvas = document.getElementById('trendChart');
        const noMsg  = document.getElementById('no-trend-msg');
        if (!trend || trend.length === 0) {
            canvas.closest('.chart-wrap').style.display = 'none';
            noMsg.classList.remove('hidden');
            return;
        }
        noMsg.classList.add('hidden');

        const labels = trend.map(p => p.date.slice(5));   // MM-DD
        const scores = trend.map(p => p.score);
        const bgColors = scores.map(s => MOOD_SCORE_COLORS[s] || MOOD_COLORS.okay);

        new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Mood score',
                    data: scores,
                    borderColor: '#00c4a7',
                    backgroundColor: 'rgba(0,196,167,0.08)',
                    pointBackgroundColor: bgColors,
                    pointBorderColor: bgColors,
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    tension: 0.3,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        min: 0.5,
                        max: 5.5,
                        ticks: {
                            stepSize: 1,
                            callback: v => ['', '😔', '😴', '😐', '🙂', '😊'][v] || ''
                        },
                        grid: { color: '#1b3650' },
                    },
                    x: {
                        grid: { color: '#1b3650' },
                        ticks: { maxTicksLimit: 12 },
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: items => `Date: 2025-${items[0].label}`,
                            label: item => {
                                const p = trend[item.dataIndex];
                                const labels = { 5: 'Great 😊', 4: 'Good 🙂', 3: 'Okay 😐', 2: 'Tired 😴', 1: 'Struggling 😔' };
                                return ` ${labels[item.raw] || item.raw}${p.note ? ' — ' + p.note : ''}`;
                            }
                        }
                    }
                }
            }
        });
    }

    // ── Render distribution bar chart ─────────────────────────────────────────
    function renderDistribution(distribution) {
        const canvas  = document.getElementById('distChart');
        const noMsg   = document.getElementById('no-dist-msg');
        const legend  = document.getElementById('dist-legend');
        if (!distribution || distribution.length === 0) {
            canvas.closest('.chart-wrap').style.display = 'none';
            noMsg.classList.remove('hidden');
            return;
        }
        noMsg.classList.add('hidden');

        const ordered = MOOD_ORDER
            .map(m => distribution.find(d => d.mood === m))
            .filter(Boolean);

        const labels  = ordered.map(d => d.emoji + ' ' + d.mood);
        const counts  = ordered.map(d => d.count);
        const colors  = ordered.map(d => MOOD_COLORS[d.mood] || '#7eb5ad');

        new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Check-ins',
                    data: counts,
                    backgroundColor: colors,
                    borderRadius: 6,
                    borderSkipped: false,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1 },
                        grid: { color: '#1b3650' },
                    },
                    x: { grid: { display: false } }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: item => ` ${item.raw} check-in${item.raw !== 1 ? 's' : ''}`
                        }
                    }
                }
            }
        });

        // Legend list
        legend.innerHTML = '';
        ordered.forEach(d => {
            const li = document.createElement('li');
            li.innerHTML = `
                <span class="legend-swatch" style="background:${MOOD_COLORS[d.mood]}"></span>
                <span>${d.emoji} ${d.mood}</span>
                <span class="legend-pct">${d.percentage}%</span>
            `;
            legend.appendChild(li);
        });
    }

    // ── Render weekly summaries ───────────────────────────────────────────────
    function renderWeekly(weeks) {
        const list  = document.getElementById('weekly-list');
        const noMsg = document.getElementById('no-weeks-msg');
        if (!weeks || weeks.length === 0) {
            noMsg.classList.remove('hidden');
            return;
        }
        noMsg.classList.add('hidden');

        const reversed = [...weeks].reverse();  // most recent first
        list.innerHTML = '';
        reversed.forEach(w => {
            const pct  = Math.round((w.average_score / 5) * 100);
            const li   = document.createElement('li');
            li.setAttribute('role', 'listitem');
            li.innerHTML = `
                <span class="week-date">${fmtDate(w.week_start)}</span>
                <span class="week-emoji" aria-hidden="true">${w.dominant_emoji || '—'}</span>
                <span class="week-label">${w.dominant_mood || 'No data'}</span>
                <span class="week-count" aria-label="${w.checkin_count} check-ins">${w.checkin_count}×</span>
                <span class="week-score-bar" aria-label="Average score ${w.average_score} out of 5">
                    <span class="week-score-fill" style="width:${pct}%"></span>
                </span>
            `;
            list.appendChild(li);
        });
    }

    // ── Date formatter ("2026-02-25" → "Feb 25, 2026") ─────────────────────────
    function fmtDate(str) {
        if (!str) return '—';
        // Parse as local date to avoid UTC-shift (append T00:00)
        const d = new Date(str.includes('T') ? str : str + 'T00:00');
        if (isNaN(d)) return str;
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // ── Populate stat cards ───────────────────────────────────────────────────
    function populateStats(data) {
        document.getElementById('stat-streak').textContent =
            data.streak.current > 0 ? `${data.streak.current} day${data.streak.current !== 1 ? 's' : ''}` : '—';
        document.getElementById('stat-longest').textContent =
            data.streak.longest > 0 ? `${data.streak.longest} day${data.streak.longest !== 1 ? 's' : ''}` : '—';
        document.getElementById('stat-messages').textContent =
            data.total_messages.toLocaleString();
        document.getElementById('stat-since').textContent =
            data.member_since !== 'unknown' ? fmtDate(data.member_since) : '—';

        if (data.streak.last_checkin) {
            document.getElementById('last-checkin-note').textContent =
                `Last check-in: ${fmtDate(data.streak.last_checkin)}`;
        }
    }

    // ── Main load ─────────────────────────────────────────────────────────────
    async function loadInsights() {
        const loadingEl = document.getElementById('insights-loading');
        const errorEl   = document.getElementById('insights-error');
        const contentEl = document.getElementById('insights-content');

        if (!getToken()) { window.location.href = '/'; return; }

        setChartDefaults();

        const res = await apiFetch('/api/analytics/insights?days=30');
        if (!res) {
            loadingEl.classList.add('hidden');
            errorEl.textContent = 'Could not connect to server.';
            errorEl.classList.remove('hidden');
            return;
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            loadingEl.classList.add('hidden');
            errorEl.textContent = `Error loading insights: ${err.detail || res.statusText}`;
            errorEl.classList.remove('hidden');
            return;
        }

        const data = await res.json();
        loadingEl.classList.add('hidden');
        contentEl.classList.remove('hidden');

        populateStats(data);
        renderTrend(data.trend);
        renderDistribution(data.distribution);
        renderWeekly(data.weekly_summaries);
    }

    // ── Logout ────────────────────────────────────────────────────────────────
    document.getElementById('logout-btn')?.addEventListener('click', () => {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = '/';
    });

    // ── Boot ──────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', loadInsights);
})();
