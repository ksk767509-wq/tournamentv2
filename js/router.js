// Store the active view
let currentView = 'auth-section';

/**
 * Hides all main views and shows the one with the specified ID.
 * @param {string} viewId - The ID of the section to show.
 */
export function navigateTo(viewId) {
    // Hide the current view
    const currentViewEl = document.getElementById(currentView);
    if (currentViewEl) {
        currentViewEl.classList.add('hidden');
    }
    
    // Show the new view
    const newViewEl = document.getElementById(viewId);
    if (newViewEl) {
        newViewEl.classList.remove('hidden');
        currentView = viewId;
    } else {
        console.error(`View with ID "${viewId}" not found.`);
        // Fallback to home if view not found (and not auth)
        if (currentView !== 'auth-section') {
            navigateTo('home-section');
        }
    }

    // Update active state in bottom nav
    updateNavActiveState(viewId);
}

/**
 * Updates the visual active state of the bottom navigation.
 * @param {string} activeViewId - The view ID that is now active.
 */
function updateNavActiveState(activeViewId) {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        if (btn.dataset.view === activeViewId) {
            btn.classList.remove('text-gray-400');
            btn.classList.add('text-indigo-400');
        } else {
            btn.classList.remove('text-indigo-400');
            btn.classList.add('text-gray-400');
        }
    });
}

/**
 * Initializes the router logic, attaching listeners to nav buttons.
 * Uses per-button listeners with pointer events to improve responsiveness on touch devices.
 */
export function initRouter() {
    // Attach reliable event listeners to each nav button (better than delegated click for touch responsiveness)
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        // Pointer events work across mouse/touch/stylus
        btn.addEventListener('pointerup', (e) => {
            // Only respond to primary button
            if (e.button && e.button !== 0) return;
            const view = btn.dataset.view;
            if (view) navigateTo(view);
        });

        // Keyboard accessibility (Enter / Space)
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const view = btn.dataset.view;
                if (view) navigateTo(view);
            }
        });

        // Ensure the button is focusable for keyboard users
        if (!btn.hasAttribute('tabindex')) {
            btn.setAttribute('tabindex', '0');
        }
    });

    // Admin nav buttons and other special buttons (unchanged behavior)
    const createBtn = document.getElementById('go-to-create-tournament-btn');
    if (createBtn) createBtn.addEventListener('click', () => navigateTo('tournament-section'));

    const backBtn = document.getElementById('back-to-admin-dash-btn');
    if (backBtn) backBtn.addEventListener('click', () => navigateTo('admin-dashboard-section'));

    const backBtn2 = document.getElementById('back-to-admin-dash-btn-2');
    if (backBtn2) backBtn2.addEventListener('click', () => navigateTo('admin-dashboard-section'));
}
