// ── AccessBot: Accessibility Module (v2 — Low Vision) ────────────────
(function () {
    'use strict';

    const PREFS_KEY = 'accessbot_a11y';

    const defaults = {
        // Legacy (kept for backward compat)
        highContrast:  false,
        largeText:     false,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        // Low vision enhancements
        colourTheme:   'default',  // 'default' | 'hc-light' | 'yellow-black' | 'soft-warm'
        fontZoom:      100,        // 100 | 125 | 150 | 175 | 200  (percentage)
        lineSpacing:   'normal',   // 'normal' | 'wide' | 'wider'
        letterSpacing: false,
        enhancedFocus: false,
        largeTargets:  false,
    };

    let prefs = { ...defaults };

    // ── Load / Save ───────────────────────────────────────────────────

    function load() {
        try {
            const saved = JSON.parse(localStorage.getItem(PREFS_KEY));
            if (saved) prefs = { ...defaults, ...saved };
        } catch {}
    }

    function save() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        } catch {}
    }

    // ── Apply all prefs ───────────────────────────────────────────────

    const THEME_CLASSES   = ['theme-hc-light', 'theme-yellow-black', 'theme-soft-warm'];
    const SPACING_CLASSES = ['line-spacing-wide', 'line-spacing-wider'];

    function apply() {
        const b = document.body;
        if (!b) return;
        const r = document.documentElement;

        // Colour theme
        b.classList.remove(...THEME_CLASSES);
        if (prefs.colourTheme && prefs.colourTheme !== 'default') {
            b.classList.add('theme-' + prefs.colourTheme);
        }

        // Legacy toggles
        b.classList.toggle('high-contrast',  !!prefs.highContrast);
        b.classList.toggle('large-text',     !!prefs.largeText);
        b.classList.toggle('reduced-motion', !!prefs.reducedMotion);

        // Font zoom — drives all rem-based sizes via html font-size
        r.style.setProperty('--font-zoom', (prefs.fontZoom || 100) / 100);

        // Line spacing
        b.classList.remove(...SPACING_CLASSES);
        if (prefs.lineSpacing === 'wide')  b.classList.add('line-spacing-wide');
        if (prefs.lineSpacing === 'wider') b.classList.add('line-spacing-wider');

        // Letter spacing / enhanced focus / large targets
        b.classList.toggle('letter-spacing-wide', !!prefs.letterSpacing);
        b.classList.toggle('enhanced-focus',      !!prefs.enhancedFocus);
        b.classList.toggle('large-targets',        !!prefs.largeTargets);

        syncUI();
    }

    function set(key, value) {
        prefs[key] = value;
        save();
        apply();
        announceChange(key, value);
    }

    // ── Screen reader announcement ────────────────────────────────────

    const THEME_NAMES = {
        'default':      'Aurora dark',
        'hc-light':     'High contrast light',
        'yellow-black': 'Yellow on black',
        'soft-warm':    'Soft warm',
    };
    const LABELS = {
        highContrast:   'High contrast dark',
        largeText:      'Large text',
        reducedMotion:  'Reduced motion',
        letterSpacing:  'Wide letter spacing',
        enhancedFocus:  'Bold focus ring',
        largeTargets:   'Large touch targets',
    };

    function announceChange(key, value) {
        let msg;
        if (key === 'fontZoom')     msg = `Text size ${value}%`;
        else if (key === 'lineSpacing')   msg = `Line spacing: ${value}`;
        else if (key === 'colourTheme')   msg = `Colour theme: ${THEME_NAMES[value] || value}`;
        else msg = `${LABELS[key] || key} ${value ? 'enabled' : 'disabled'}`;
        const el = document.getElementById('a11y-announcement');
        if (el) { el.textContent = ''; requestAnimationFrame(() => { el.textContent = msg; }); }
    }

    // ── Sync all UI controls ──────────────────────────────────────────

    function syncUI() {
        // Checkboxes (by ID — same IDs used on both index + settings pages)
        _setCheck('a11y-high-contrast',  prefs.highContrast);
        _setCheck('a11y-large-text',     prefs.largeText);
        _setCheck('a11y-reduced-motion', prefs.reducedMotion);
        _setCheck('a11y-letter-spacing', prefs.letterSpacing);
        _setCheck('a11y-enhanced-focus', prefs.enhancedFocus);
        _setCheck('a11y-large-targets',  prefs.largeTargets);

        // Font zoom slider + label (document-wide by ID)
        const slider = document.getElementById('a11y-font-zoom');
        const label  = document.getElementById('a11y-font-zoom-val');
        if (slider) { slider.value = prefs.fontZoom || 100;
                      slider.setAttribute('aria-valuetext', `${prefs.fontZoom || 100}%`); }
        if (label)  label.textContent = `${prefs.fontZoom || 100}%`;

        // Line spacing stepper buttons (document-wide)
        document.querySelectorAll('.step-btn[data-spacing]').forEach(btn => {
            const on = btn.dataset.spacing === (prefs.lineSpacing || 'normal');
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-checked', String(on));
        });

        // Theme buttons (document-wide)
        document.querySelectorAll('.theme-btn[data-theme]').forEach(btn => {
            const on = btn.dataset.theme === (prefs.colourTheme || 'default');
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-checked', String(on));
        });
    }

    function _setCheck(id, val) {
        const el = document.getElementById(id);
        if (el) el.checked = !!val;
    }

    // ── Toolbar init (index.html panel) ──────────────────────────────

    function initToolbar() {
        const btn   = document.getElementById('a11y-btn');
        const panel = document.getElementById('a11y-panel');

        if (btn && panel) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = panel.classList.contains('open');
                panel.classList.toggle('open', !isOpen);
                btn.setAttribute('aria-expanded', String(!isOpen));
                if (!isOpen) { syncUI(); const first = panel.querySelector('input, button:not(.a11y-btn)'); if (first) first.focus(); }
            });
            document.addEventListener('click', (e) => {
                if (!panel.contains(e.target) && e.target !== btn) {
                    panel.classList.remove('open');
                    btn.setAttribute('aria-expanded', 'false');
                }
            });
            panel.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { panel.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
            });
        }

        // ── Checkbox wiring (works on any page by ID)
        _wireCheck('a11y-high-contrast',  'highContrast');
        _wireCheck('a11y-large-text',     'largeText');
        _wireCheck('a11y-reduced-motion', 'reducedMotion');
        _wireCheck('a11y-letter-spacing', 'letterSpacing');
        _wireCheck('a11y-enhanced-focus', 'enhancedFocus');
        _wireCheck('a11y-large-targets',  'largeTargets');

        // ── Font zoom slider (works on any page by ID)
        const slider = document.getElementById('a11y-font-zoom');
        const label  = document.getElementById('a11y-font-zoom-val');
        if (slider) {
            slider.addEventListener('input', () => {
                const v = parseInt(slider.value);
                if (label) label.textContent = `${v}%`;
                slider.setAttribute('aria-valuetext', `${v}%`);
                set('fontZoom', v);
            });
        }

        // ── Line spacing steppers (document-wide — works on index + settings)
        document.querySelectorAll('.step-btn[data-spacing]').forEach(btn => {
            btn.addEventListener('click', () => set('lineSpacing', btn.dataset.spacing));
        });

        // ── Colour theme buttons (document-wide — works on index + settings)
        document.querySelectorAll('.theme-btn[data-theme]').forEach(btn => {
            btn.addEventListener('click', () => set('colourTheme', btn.dataset.theme));
        });
    }

    function _wireCheck(id, key) {
        const el = document.getElementById(id);
        if (el && !el._a11yWired) { el._a11yWired = true; el.addEventListener('change', (e) => set(key, e.target.checked)); }
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────

    function initKeyboardNav() {
        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.key === 'a') {
                const b = document.getElementById('a11y-btn');
                if (b) b.click();
                e.preventDefault();
            }
        });
    }

    // ── Init ──────────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', () => {
        load();
        apply();
        initToolbar();
        initKeyboardNav();
    });

    // ── Public API ────────────────────────────────────────────────────

    window.a11y = { set, getPrefs: () => ({ ...prefs }), apply, load };

})();

/* ── Page scroll-to-top button (all pages except chat) ──────────────── */
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('page-scroll-top-btn');
        if (!btn) return;   // not present on the chat page

        window.addEventListener('scroll', () => {
            btn.classList.toggle('visible', window.scrollY > 280);
        }, { passive: true });

        btn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
})();
