/* AccessBot — Resources page logic */
(function () {
    'use strict';

    const grid    = document.getElementById('resource-grid');
    const search  = document.getElementById('resource-search');
    const empty   = document.getElementById('no-results');
    const chips   = document.querySelectorAll('.chip');

    let activeCategory = 'all';
    let searchText     = '';

    /* ── Category chips ── */
    chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
            chips.forEach(function (c) {
                c.classList.remove('chip-active');
                c.setAttribute('aria-pressed', 'false');
            });
            chip.classList.add('chip-active');
            chip.setAttribute('aria-pressed', 'true');
            activeCategory = chip.dataset.cat;
            applyFilter();
        });
    });

    /* ── Search input ── */
    if (search) {
        search.addEventListener('input', function () {
            searchText = search.value.trim().toLowerCase();
            applyFilter();
        });
    }

    /* ── Filter logic ── */
    function applyFilter() {
        var cards   = grid ? grid.querySelectorAll('.resource-card') : [];
        var visible = 0;

        cards.forEach(function (card) {
            var catMatch     = activeCategory === 'all' || card.dataset.cat === activeCategory;
            var tags         = (card.dataset.tags || '').toLowerCase();
            var title        = (card.querySelector('.resource-title')  || {}).textContent || '';
            var desc         = (card.querySelector('.resource-desc')   || {}).textContent || '';
            var haystack     = (tags + ' ' + title + ' ' + desc).toLowerCase();
            var searchMatch  = !searchText || haystack.includes(searchText);

            var show = catMatch && searchMatch;
            card.setAttribute('aria-hidden', show ? 'false' : 'true');
            if (show) visible++;
        });

        if (empty) {
            empty.hidden = visible > 0;
        }
    }

    /* Set initial aria-pressed state */
    chips.forEach(function (chip) {
        chip.setAttribute('aria-pressed', chip.classList.contains('chip-active') ? 'true' : 'false');
    });
})();
