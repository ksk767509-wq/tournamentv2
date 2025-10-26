import { initAuthListener, initAuthForms } from './auth.js';
import { initRouter } from './router.js';

/**
 * Main application entry point.
 * This function is called when the DOM is fully loaded.
 */
function main() {
    // 1. Initialize the router (attaches nav button listeners)
    initRouter();
    
    // 2. Initialize the auth forms (login/signup submit)
    initAuthForms();

    // 3. Initialize the Firebase auth state listener
    // This listener is the core of the SPA. It will
    // - Show auth or app based on login state
    // - Call initUserListeners() or initAdminListeners() on successful login
    initAuthListener();
}

// Wait for the DOM to be fully loaded before running the app
document.addEventListener('DOMContentLoaded', main);
