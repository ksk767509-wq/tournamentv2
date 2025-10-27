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
// Cache latest joinedTournaments (array of { participant, tournament })
let latestJoinedTournaments = [];

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
    latestJoinedTournaments = [];
    
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
        // update the My Fights dot as tournaments changed (status/roomId changes can affect dot)
        updateMyFightsDot();
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
        querySnapshot.forEach((pDoc) => {
            const participant = { id: pDoc.id, ...pDoc.data() };
            // Track joined tournament ids
            if (participant.tournamentId) joinedTournamentIds.add(participant.tournamentId);
            const tDocRef = doc(db, "tournaments", participant.tournamentId);
            promises.push(
                getDoc(tDocRef).then((tDoc) => {
                    if (tDoc.exists()) {
                        joinedTournaments.push({ participant, tournament: { id: tDoc.id, ...tDoc.data() } });
                    }
                })
            );
        });
        await Promise.all(promises);
        // Sort by match time (newest first)
        joinedTournaments.sort((a, b) => b.tournament.matchTime - a.tournament.matchTime);
        latestJoinedTournaments = joinedTournaments;
        renderMyTournaments(joinedTournaments);

        // After updating joined set, re-render home tournaments (to reflect Joined / Full states)
        renderHomeTournaments(latestTournaments, joinedTournamentIds);

        // update notification dot (participant statuses might have changed)
        updateMyFightsDot();
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
    initTournamentsListHandlers();
    initWalletButtons();
    initProfileForms();
    initMyTournamentsTabs();
}

/**
 * Adds event delegation to the tournaments list for join, copy, and OK buttons.
 */
function initTournamentsListHandlers() {
    const list = document.getElementById('tournaments-list');
    if (list) {
        list.addEventListener('click', (e) => {
            // Join button
            const joinButton = e.target.closest('.join-btn');
            if (joinButton && !joinButton.disabled) {
                const tId = joinButton.dataset.id;
                const fee = parseFloat(joinButton.dataset.fee);
                if (confirm(`Join this tournament for ₹${fee}?`)) {
                    handleJoinTournament(tId, fee);
                }
                return;
            }

            // Copy button (Room ID / Password copies)
            const copyBtn = e.target.closest('.copy-btn');
            if (copyBtn) {
                const toCopy = copyBtn.dataset.copy || '';
                if (toCopy) {
                    navigator.clipboard.writeText(toCopy).then(() => {
                        showToast('Copied to clipboard.');
                    }).catch((err) => {
                        console.error('Clipboard write failed:', err);
                        showToast('Could not copy to clipboard.', true);
                    });
                } else {
                    showToast('Nothing to copy.', true);
                }
                return;
            }
        });
    }

    // Also handle OK button clicks inside "My Tournaments" completed tab (delegated on the completed container)
    const completedContainer = document.getElementById('tab-content-completed');
    if (completedContainer) {
        completedContainer.addEventListener('click', (e) => {
            const okBtn = e.target.closest('.ok-btn');
            if (okBtn) {
                const participantId = okBtn.dataset.participantId;
                if (participantId) {
                    markParticipantSeen(participantId);
                }
            }
        });
    }
}

/**
 * Marks a participant doc as seenByUser = true when user clicks OK on completed card.
 * @param {string} participantId 
 */
async function markParticipantSeen(participantId) {
    showLoader();
    try {
        const pRef = doc(db, "participants", participantId);
        await updateDoc(pRef, { seenByUser: true });
        showToast("Marked as seen.", false);
        // update dot immediately (snapshot will also refresh and call updateMyFightsDot)
        updateMyFightsDot();
    } catch (error) {
        console.error("Mark seen error:", error);
        showToast("Could not mark as seen.", true);
    } finally {
        hideLoader();
    }
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

            // 4. Check if already joined
            const participantQuery = query(collection(db, "participants"), where("userId", "==", userId), where("tournamentId", "==", tournamentId));
            const existing = await getDocs(participantQuery);
            if (!existing.empty) {
                throw new Error("You have already joined this tournament.");
            }

            // All checks passed, perform writes atomically:
            // - Update user wallet
            transaction.update(userRef, { walletBalance: currentBalance - entryFee });
            
            // - Create participant doc
            transaction.set(participantRef, {
                userId: userId,
                username: userDoc.data().username,
                tournamentId: tournamentId,
                status: 'Joined',
                joinedAt: serverTimestamp()
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
 * Updates the small notification dot on the "My Fights" nav button.
 * Priority (Option A): RED > YELLOW > GREEN
 * - RED: Any joined tournament has roomId & roomPassword (i.e., credentials released)
 * - YELLOW: Any joined tournament in Upcoming or Live (without credentials)
 * - GREEN: Any joined tournament is Completed AND participant.seenByUser !== true
 */
function updateMyFightsDot() {
    const dot = document.getElementById('my-fights-dot');
    if (!dot) return;

    // Evaluate latestJoinedTournaments (array of { participant, tournament })
    let hasRed = false;
    let hasYellow = false;
    let hasGreen = false;

    for (const item of latestJoinedTournaments) {
        const t = item.tournament || {};
        const p = item.participant || {};
        // Red: credentials released
        if (t.roomId && t.roomPassword) {
            hasRed = true;
            break; // highest priority
        }
        // Yellow: Upcoming or Live (only if not already red)
        if (t.status === 'Upcoming' || t.status === 'Live') {
            hasYellow = true;
        }
        // Green: completed and not seen by user
        if ((t.status === 'Completed' || p.status === 'Completed' || p.status === 'Winner') && p.seenByUser !== true) {
            hasGreen = true;
        }
    }

    // Apply priority: RED > YELLOW > GREEN
    dot.classList.remove('bg-red-600', 'bg-yellow-400', 'bg-green-400', 'animate-pulse', 'ring-red-400');
    if (hasRed) {
        dot.classList.add('bg-red-600', 'animate-pulse', 'ring-red-400');
        dot.classList.remove('hidden');
    } else if (hasYellow) {
        dot.classList.add('bg-yellow-400');
        dot.classList.remove('hidden');
    } else if (hasGreen) {
        dot.classList.add('bg-green-400');
        dot.classList.remove('hidden');
    } else {
        dot.classList.add('hidden');
    }
}
