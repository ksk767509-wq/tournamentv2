import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut,
    updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { navigateTo } from "./router.js";
import { showToast, showLoader, hideLoader } from "./ui.js";
import { initUserListeners, clearUserListeners, initUserUI } from "./user-data.js";
import { initAdminListeners, clearAdminListeners } from "./admin-data.js";

// Keep track of current user data
window.currentUser = null;

/**
 * Initializes the authentication state listener.
 * This is the main entry point for the app's auth logic.
 */
export function initAuthListener() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // User is signed in
            showLoader();
            try {
                // Get user profile from Firestore
                const userRef = doc(db, "users", user.uid);
                const docSnap = await getDoc(userRef);

                if (docSnap.exists()) {
                    window.currentUser = { uid: user.uid, ...docSnap.data() };
                    
                    // Show main app
                    document.getElementById('auth-section').classList.add('hidden');
                    document.getElementById('main-app-content').classList.remove('hidden');
                    
                    // Initialize user-specific UI and listeners
                    initUserUI(window.currentUser);
                    initUserListeners(user.uid);

                    // Check for admin and adjust nav layout properly
                    const adminNav = document.getElementById('admin-nav-btn');

                    // Helper to set each nav button's width class based on admin presence
                    function setNavWidths(isAdmin) {
                        const navButtons = document.querySelectorAll('.nav-btn');
                        navButtons.forEach(btn => {
                            // remove any previous width classes we use
                            btn.classList.remove('w-1/4', 'w-1/5');
                            if (isAdmin) {
                                btn.classList.add('w-1/5');
                            } else {
                                btn.classList.add('w-1/4');
                            }
                        });
                    }

                    if (window.currentUser.isAdmin) {
                        adminNav.classList.remove('hidden');
                        adminNav.classList.add('flex');
                        setNavWidths(true);
                        initAdminListeners();
                    } else {
                        adminNav.classList.add('hidden');
                        adminNav.classList.remove('flex');
                        setNavWidths(false);
                        clearAdminListeners();
                    }

                    navigateTo('home-section');
                } else {
                    // This case shouldn't happen if signup is correct
                    console.error("No user document found!");
                    await handleLogout();
                }
            } catch (error) {
                console.error("Auth listener error:", error);
                showToast("Error loading user data.", true);
                await handleLogout();
            } finally {
                hideLoader();
            }
        } else {
            // User is signed out
            window.currentUser = null;
            
            // Show auth screen, hide main app
            document.getElementById('auth-section').classList.remove('hidden');
            document.getElementById('main-app-content').classList.add('hidden');
            
            // Clear any active listeners
            clearUserListeners();
            clearAdminListeners();

            navigateTo('auth-section');
        }
    });
}

/**
 * Handles user sign-up.
 * @param {string} email 
 * @param {string} password 
 * @param {string} username 
 */
async function handleSignUp(email, password, username) {
    showLoader();
    try {
        // 1. Create user in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // 2. Create user document in Firestore
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, {
            username: username,
            email: user.email,
            walletBalance: 0,
            createdAt: serverTimestamp(),
            isAdmin: false // Default to false
        });

        // onAuthStateChanged will handle the redirect
        showToast("Account created successfully!", false);
    } catch (error) {
        console.error("Sign up error:", error);
        showToast(error.message, true);
    } finally {
        hideLoader();
    }
}

/**
 * Handles user login.
 * @param {string} email 
 * @param {string} password 
 */
async function handleLogin(email, password) {
    showLoader();
    try {
        await signInWithEmailAndPassword(auth, email, password);
        // onAuthStateChanged will handle the redirect
        showToast("Logged in successfully!", false);
    } catch (error) {
        console.error("Login error:", error);
        showToast(error.message, true);
    } finally {
        hideLoader();
    }
}

/**
 * Handles user logout.
 */
export async function handleLogout() {
    showLoader();
    try {
        await signOut(auth);
        // onAuthStateChanged will handle the redirect
    } catch (error) {
        console.error("Logout error:", error);
        showToast(error.message, true);
    } finally {
        hideLoader();
    }
}

/**
 * Handles password change.
 * @param {string} newPassword 
 */
export async function handleChangePassword(newPassword) {
    if (!newPassword || newPassword.length < 6) {
        showToast("Password must be at least 6 characters.", true);
        return;
    }
    
    showLoader();
    try {
        const user = auth.currentUser;
        if (user) {
            await updatePassword(user, newPassword);
            showToast("Password updated successfully.", false);
            document.getElementById('password-change-form').reset();
        }
    } catch (error) {
        console.error("Password change error:", error);
        showToast(error.message, true);
    } finally {
        hideLoader();
    }
}


/**
 * Sets up all event listeners for the authentication forms.
 */
export function initAuthForms() {
    // Form switching
    document.getElementById('show-signup').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-form').classList.add('hidden');
        document.getElementById('signup-form').classList.remove('hidden');
    });
    document.getElementById('show-login').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('signup-form').classList.add('hidden');
        document.getElementById('login-form').classList.remove('hidden');
    });

    // Form submissions
    document.getElementById('login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        handleLogin(email, password);
    });
    
    document.getElementById('signup-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const username = document.getElementById('signup-username').value;
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        if (username && email && password) {
            handleSignUp(email, password, username);
        }
    });

    // Logout button
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
}
