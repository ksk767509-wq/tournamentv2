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
 */
export function initRouter() {
    const navContainer = document.getElementById('app-nav');
    navContainer.addEventListener('click', (e) => {
        const navButton = e.target.closest('.nav-btn');
        if (navButton && navButton.dataset.view) {
            navigateTo(navButton.dataset.view);
        }
    });

    // Admin nav buttons
    document.getElementById('go-to-create-tournament-btn').addEventListener('click', () => navigateTo('tournament-section'));
    document.getElementById('back-to-admin-dash-btn').addEventListener('click', () => navigateTo('admin-dashboard-section'));
    document.getElementById('back-to-admin-dash-btn-2').addEventListener('click', () => navigateTo('admin-dashboard-section'));
}
