import { 
    doc, 
    collection, 
    query, 
    where, 
    onSnapshot, 
    orderBy, 
    runTransaction,
    addDoc,
    getDoc,
    getDocs,
    serverTimestamp,
    updateDoc,
    increment,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { showLoader, hideLoader, showToast, renderHomeTournaments, renderMyTournaments, renderTransactionHistory } from "./ui.js";
import { handleChangePassword } from "./auth.js";

// To store unsubscribe functions for real-time listeners
let listeners = [];

// Cache latest tournaments snapshot for coordinated rendering
let latestTournaments = [];
// Set of tournamentIds that current user has joined
let joinedTournamentIds = new Set();

/**
 * Initializes all user-specific listeners when they log in.
 * @param {string} userId - The current user's UID.
 */
export function initUserListeners(userId) {
    // Clear any old listeners
    clearUserListeners();
    
    // Reset caches
    latestTournaments = [];
    joinedTournamentIds = new Set();
    
    // 1. Wallet Balance Listener
    const userDocRef = doc(db, "users", userId);
    const unsubWallet = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const userData = docSnap.data();
            window.currentUser = { uid: userId, ...userData }; // Update global user object
            const balance = userData.walletBalance.toFixed(2);
            document.getElementById('header-wallet-amount').textContent = `₹${balance}`;
            document.getElementById('wallet-page-balance').textContent = `₹${balance}`;
        }
    });
    
    // 2. Home Tournaments Listener (listens to tournaments docs and uses fields currentParticipants/maxParticipants)
    const tourneysRef = collection(db, "tournaments");
    const qTourneys = query(tourneysRef, where("status", "==", "Upcoming"), orderBy("matchTime", "asc"));
    const unsubTourneys = onSnapshot(qTourneys, (querySnapshot) => {
        const tournaments = [];
        querySnapshot.forEach((doc) => {
            tournaments.push({ id: doc.id, ...doc.data() });
        });
        // Update cache and trigger render with joined set
        latestTournaments = tournaments;
        renderHomeTournaments(latestTournaments, joinedTournamentIds);
    }, (error) => {
        console.error("Error loading tournaments:", error);
        showToast("Could not load tournaments.", true);
    });

    // 3. My Tournaments Listener (participants for current user)
    const participantsRef = collection(db, "participants");
    const qMyTournaments = query(participantsRef, where("userId", "==", userId));
    const unsubMyTournaments = onSnapshot(qMyTournaments, async (querySnapshot) => {
        const joinedTournaments = [];
        const promises = [];
        // Reset joined set
        joinedTournamentIds = new Set();

        // Track notification dot states
        let hasUpcomingOrLive = false;
        let hasLiveWithCreds = false;
        let hasCompletedUnseen = false;

        querySnapshot.forEach((pDoc) => {
            const participant = { id: pDoc.id, ...pDoc.data() };
            // Track joined tournament ids
            if (participant.tournamentId) joinedTournamentIds.add(participant.tournamentId);
            const tDocRef = doc(db, "tournaments", participant.tournamentId);
            promises.push(
                getDoc(tDocRef).then((tDoc) => {
                    if (tDoc.exists()) {
                        const tData = tDoc.data();
                        joinedTournaments.push({ participant, tournament: { id: tDoc.id, ...tData } });

                        // Determine notification categories:
                        if (tData.status === 'Upcoming') {
                            hasUpcomingOrLive = true;
                        }
                        if (tData.status === 'Live') {
                            hasUpcomingOrLive = true;
                            if (tData.roomId && tData.roomPassword) {
                                hasLiveWithCreds = true;
                            }
                        }
                        if (tData.status === 'Completed' && !participant.seen) {
                            hasCompletedUnseen = true;
                        }
                    }
                })
            );
        });
        await Promise.all(promises);
        // Sort by match time (newest first)
        joinedTournaments.sort((a, b) => b.tournament.matchTime - a.tournament.matchTime);
        renderMyTournaments(joinedTournaments);

        // After updating joined set, re-render home tournaments (to reflect Joined / Full states)
        renderHomeTournaments(latestTournaments, joinedTournamentIds);

        // Update nav dot (priority: red > yellow > green). If multiple categories, red takes precedence.
        updateMyFightsNavDot({ hasUpcomingOrLive, hasLiveWithCreds, hasCompletedUnseen });
    }, (error) => {
        console.error("Error loading my tournaments:", error);
        showToast("Could not load your tournaments.", true);
    });

    // 4. Transaction History Listener
    const transactionsRef = collection(db, "transactions");
    const qTransactions = query(transactionsRef, where("userId", "==", userId), orderBy("createdAt", "desc"));
    const unsubTransactions = onSnapshot(qTransactions, (querySnapshot) => {
        const transactions = [];
        querySnapshot.forEach((doc) => {
            transactions.push({ id: doc.id, ...doc.data() });
        });
        renderTransactionHistory(transactions);
    }, (error) => {
        console.error("Error loading transactions:", error);
        showToast("Could not load transactions.", true);
    });

    // Store all unsubscribe functions
    listeners = [unsubWallet, unsubTourneys, unsubMyTournaments, unsubTransactions];
}

/**
 * Clears all active real-time listeners.
 */
export function clearUserListeners() {
    listeners.forEach(unsub => unsub());
    listeners = [];
}

/**
 * Sets up the static UI parts for the user (forms, buttons).
 * @param {object} userData - The user data from Firestore.
 */
export function initUserUI(userData) {
    // Profile Page
    document.getElementById('profile-username').value = userData.username;
    document.getElementById('profile-email').value = userData.email;

    // Attach listeners
    initJoinButtonListener();
    initWalletButtons();
    initProfileForms();
    initMyTournamentsTabs();

    // Delegated listeners for copy buttons and OK buttons in My Tournaments
    initMyTournamentsInteractions();
}

/**
 * Adds a single event listener to the tournaments list for joining.
 */
function initJoinButtonListener() {
    document.getElementById('tournaments-list').addEventListener('click', (e) => {
        const joinButton = e.target.closest('.join-btn');
        if (joinButton && !joinButton.disabled) {
            const tId = joinButton.dataset.id;
            const fee = parseFloat(joinButton.dataset.fee);
            if (confirm(`Join this tournament for ₹${fee}?`)) {
                handleJoinTournament(tId, fee);
            }
        }
    });
}

/**
 * Initialize delegated handlers for "copy" and "OK" buttons in My Tournaments
 */
function initMyTournamentsInteractions() {
    const container = document.getElementById('my-tournaments-content');
    if (!container) return;

    container.addEventListener('click', async (e) => {
        const copyBtn = e.target.closest('.copy-btn');
        if (copyBtn) {
            const type = copyBtn.dataset.copyType;
            const value = copyBtn.dataset.copyValue;
            if (value) {
                copyToClipboard(value);
                showToast(`${type === 'room' ? 'Room ID' : 'Password'} copied to clipboard.`, false);
            }
            return;
        }

        const okBtn = e.target.closest('.ok-btn');
        if (okBtn) {
            const participantId = okBtn.dataset.participantId;
            if (!participantId) return;
            // Update participant doc seen:true
            try {
                showLoader();
                const pRef = doc(db, "participants", participantId);
                await updateDoc(pRef, { seen: true });
                showToast("Marked as seen.", false);
            } catch (err) {
                console.error("OK mark error:", err);
                showToast("Could not mark as seen.", true);
            } finally {
                hideLoader();
            }
            return;
        }
    });
}

/**
 * Copy helper — tries navigator.clipboard first, falls back to textarea.
 * @param {string} text 
 */
function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}
function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
    } catch (e) {
        console.error('Copy fallback failed', e);
    }
    document.body.removeChild(ta);
}

/**
 * Handles the logic for a user joining a tournament.
 * Uses a Firestore Transaction for safety and increments currentParticipants on tournament doc.
 * @param {string} tournamentId 
 * @param {number} entryFee 
 */
async function handleJoinTournament(tournamentId, entryFee) {
    showLoader();
    const userId = auth.currentUser.uid;
    const userRef = doc(db, "users", userId);
    const participantRef = doc(collection(db, "participants")); // New doc (DocRef)
    const transactionRef = doc(collection(db, "transactions")); // New doc
    const tournamentRef = doc(db, "tournaments", tournamentId);

    try {
        await runTransaction(db, async (transaction) => {
            // 1. Get user doc
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) throw new Error("User document not found.");

            // 2. Check balance
            const currentBalance = userDoc.data().walletBalance;
            if (currentBalance < entryFee) throw new Error("Insufficient Balance");
            
            // 3. Get tournament doc (to check status and participant limits)
            const tDoc = await transaction.get(tournamentRef);
            if (!tDoc.exists()) throw new Error("Tournament not found.");
            const tData = tDoc.data();
            if (tData.status !== 'Upcoming') throw new Error("Tournament is no longer available.");

            const max = tData.maxParticipants || 100;
            const current = typeof tData.currentParticipants === 'number' ? tData.currentParticipants : 0;
            if (current >= max) throw new Error("Tournament is already full.");

            // 4. Check if already joined (pre-check outside transaction would be ideal; do a quick read)
            // We'll do a doc query - this is not inside transaction, but it's okay because the counter protects us.
            const participantQuery = query(collection(db, "participants"), where("userId", "==", userId), where("tournamentId", "==", tournamentId));
            const existing = await getDocs(participantQuery);
            if (!existing.empty) {
                throw new Error("You have already joined this tournament.");
            }

            // All checks passed, perform writes atomically:
            // - Update user wallet
            transaction.update(userRef, { walletBalance: currentBalance - entryFee });
            
            // - Create participant doc (NEW: include seen:false)
            transaction.set(participantRef, {
                userId: userId,
                username: userDoc.data().username,
                tournamentId: tournamentId,
                status: 'Joined',
                joinedAt: serverTimestamp(),
                seen: false
            });
            
            // - Create transaction doc
            transaction.set(transactionRef, {
                userId: userId,
                amount: entryFee,
                type: 'debit',
                description: `Entry fee for ${tData.title}`,
                createdAt: serverTimestamp()
            });

            // - Increment tournament's currentParticipants by 1
            transaction.update(tournamentRef, { currentParticipants: (current + 1) });
        });

        showToast("Joined tournament successfully!", false);
    } catch (error) {
        console.error("Join tournament error:", error);
        showToast(error.message, true);
    } finally {
        hideLoader();
    }
}

/**
 * Initializes listeners for wallet Add/Withdraw buttons.
 */
function initWalletButtons() {
    document.getElementById('add-money-btn').addEventListener('click', () => {
        handleSimulatedTransaction(100, 'credit', 'Simulated deposit');
    });
    document.getElementById('withdraw-money-btn').addEventListener('click', () => {
        handleSimulatedTransaction(50, 'debit', 'Simulated withdrawal');
    });
}

/**
 * Simulates a wallet transaction (add/withdraw).
 * @param {number} amount 
 * @param {'credit' | 'debit'} type 
 * @param {string} description 
 */
async function handleSimulatedTransaction(amount, type, description) {
    const user = auth.currentUser;
    if (!user) return;
    
    showLoader();
    const userRef = doc(db, "users", user.uid);
    const transactionRef = doc(collection(db, "transactions"));
    
    try {
        const newBalance = type === 'credit' ? increment(amount) : increment(-amount);
        
        // Check for sufficient funds on withdrawal
        if (type === 'debit') {
            if (window.currentUser.walletBalance < amount) {
                throw new Error("Insufficient funds for withdrawal.");
            }
        }
        
        const batch = writeBatch(db);
        
        // Update wallet
        batch.update(userRef, { walletBalance: newBalance });
        
        // Create transaction record
        batch.set(transactionRef, {
            userId: user.uid,
            amount: amount,
            type: type,
            description: description,
            createdAt: serverTimestamp()
        });
        
        await batch.commit();
        showToast("Transaction successful.", false);
    } catch (error) {
        console.error("Simulated transaction error:", error);
        showToast(error.message, true);
    } finally {
        hideLoader();
    }
}

/**
 * Initializes listeners for profile update and password change forms.
 */
function initProfileForms() {
    document.getElementById('profile-update-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newUsername = document.getElementById('profile-username').value;
        if (newUsername === window.currentUser.username) return;
        
        showLoader();
        try {
            const userRef = doc(db, "users", auth.currentUser.uid);
            await updateDoc(userRef, { username: newUsername });
            showToast("Username updated successfully.", false);
        } catch (error) {
            console.error("Profile update error:", error);
            showToast(error.message, true);
        } finally {
            hideLoader();
        }
    });

    document.getElementById('password-change-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const newPassword = document.getElementById('profile-new-password').value;
        handleChangePassword(newPassword);
    });
}

/**
 * Initializes the tab switching for "My Tournaments" page.
 */
function initMyTournamentsTabs() {
    const tabs = document.querySelectorAll('#my-tournaments-tabs .tab-btn');
    const contents = document.querySelectorAll('#my-tournaments-content .tab-content');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Deactivate all tabs
            tabs.forEach(t => {
                t.classList.remove('text-indigo-400', 'border-indigo-400', 'active');
                t.classList.add('text-gray-400', 'border-transparent');
            });
            // Deactivate all content
            contents.forEach(c => c.classList.add('hidden'));
            
            // Activate clicked tab
            tab.classList.add('text-indigo-400', 'border-indigo-400', 'active');
            tab.classList.remove('text-gray-400', 'border-transparent');
            
            // Show corresponding content
            document.getElementById(`tab-content-${tab.dataset.tab}`).classList.remove('hidden');
        });
    });
}

/**
 * Updates the My Fights nav dot based on categories.
 * Priority: red (live with creds) > yellow (upcoming/live) > green (completed unseen)
 * @param {object} flags
 */
function updateMyFightsNavDot(flags) {
    const dot = document.getElementById('my-fights-dot');
    if (!dot) return;
    // Reset
    dot.className = 'nav-dot';
    dot.classList.remove('show', 'yellow', 'red', 'green', 'glow');

    if (flags.hasLiveWithCreds) {
        dot.classList.add('show', 'red');
    } else if (flags.hasUpcomingOrLive) {
        dot.classList.add('show', 'yellow');
    } else if (flags.hasCompletedUnseen) {
        dot.classList.add('show', 'green');
    } else {
        // nothing to show
    }
}
