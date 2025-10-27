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
import { showLoader, hideLoader, showToast, renderHomeTournaments, renderMyTournaments, renderTransactionHistory, showJoinDialog, hideJoinDialog } from "./ui.js";
import { handleChangePassword } from "./auth.js";

// To store unsubscribe functions for real-time listeners
let listeners = [];

// Cache latest tournaments snapshot for coordinated rendering
let latestTournaments = [];
// Set of tournamentIds that current user has joined
let joinedTournamentIds = new Set();
// Cache latest joinedTournaments (array of { participant, tournament })
let latestJoinedTournaments = [];

// Ensure we attach global delegated handlers only once
let handlersAttached = false;

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

    // 2. Home Tournaments Listener
    const tourneysRef = collection(db, "tournaments");
    const qTourneys = query(tourneysRef, where("status", "==", "Upcoming"), orderBy("matchTime", "asc"));
    const unsubTourneys = onSnapshot(qTourneys, (querySnapshot) => {
        const tournaments = [];
        querySnapshot.forEach((docSnap) => {
            tournaments.push({ id: docSnap.id, ...docSnap.data() });
        });
        latestTournaments = tournaments;
        renderHomeTournaments(latestTournaments, joinedTournamentIds);
        updateMyFightsDot();
    }, (error) => {
        console.error("Error loading tournaments:", error);
        showToast("Could not load tournaments.", true);
    });

    // 3. My Tournaments Listener
    const participantsRef = collection(db, "participants");
    const qMyTournaments = query(participantsRef, where("userId", "==", userId));
    const unsubMyTournaments = onSnapshot(qMyTournaments, async (querySnapshot) => {
        const joinedTournaments = [];
        const promises = [];
        joinedTournamentIds = new Set();
        querySnapshot.forEach((pDoc) => {
            const participant = { id: pDoc.id, ...pDoc.data() };
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
        joinedTournaments.sort((a, b) => b.tournament.matchTime - a.tournament.matchTime);
        latestJoinedTournaments = joinedTournaments;
        renderMyTournaments(joinedTournaments);
        renderHomeTournaments(latestTournaments, joinedTournamentIds);
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
        querySnapshot.forEach((docSnap) => {
            transactions.push({ id: docSnap.id, ...docSnap.data() });
        });
        renderTransactionHistory(transactions);
    }, (error) => {
        console.error("Error loading transactions:", error);
        showToast("Could not load transactions.", true);
    });

    listeners = [unsubWallet, unsubTourneys, unsubMyTournaments, unsubTransactions];

    if (!handlersAttached) {
        attachDelegatedHandlers();
        handlersAttached = true;
    }
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
    document.getElementById('profile-username').value = userData.username;
    document.getElementById('profile-email').value = userData.email;

    initWalletButtons();
    initProfileForms();
    initMyTournamentsTabs();
}

/**
 * Attach a single delegated click handler to the document body to handle:
 * - .join-btn (home)
 * - .copy-btn (room id/password copy in My Tournaments)
 * - .ok-btn (mark seen in completed)
 */
function attachDelegatedHandlers() {
    document.body.addEventListener('click', (e) => {
        // JOIN button (home tournament cards)
        const joinButton = e.target.closest('.join-btn');
        if (joinButton && !joinButton.disabled) {
            const tId = joinButton.dataset.id;
            const tournament = latestTournaments.find(t => t.id === tId);
            if (!tournament) {
                showToast('Tournament data not available.', true);
                return;
            }
            // show join modal via UI helper
            showJoinDialog(tournament, ({ ign, slotIndex, teamIndex }) => {
                // perform join transaction with selected slot and ign
                handleJoinTournamentWithSlot(tId, parseFloat(joinButton.dataset.fee), slotIndex, teamIndex, ign);
            });
            return;
        }

        // COPY button (room id / password in My Tournaments)
        const copyBtn = e.target.closest('.copy-btn');
        if (copyBtn) {
            const toCopy = copyBtn.dataset.copy || '';
            if (toCopy) {
                navigator.clipboard.writeText(toCopy).then(() => {
                    showToast('Copied to clipboard.');
                }).catch((err) => {
                    console.error('Clipboard write failed:', err);
                    try {
                        const textarea = document.createElement('textarea');
                        textarea.value = toCopy;
                        textarea.style.position = 'fixed';
                        textarea.style.left = '-9999px';
                        document.body.appendChild(textarea);
                        textarea.select();
                        document.execCommand('copy');
                        document.body.removeChild(textarea);
                        showToast('Copied to clipboard.');
                    } catch (fallbackErr) {
                        console.error('Fallback copy failed:', fallbackErr);
                        showToast('Could not copy to clipboard.', true);
                    }
                });
            } else {
                showToast('Nothing to copy.', true);
            }
            return;
        }

        // OK button (mark seen) inside completed tab
        const okBtn = e.target.closest('.ok-btn');
        if (okBtn) {
            const participantId = okBtn.dataset.participantId;
            if (participantId) {
                markParticipantSeen(participantId);
            }
            return;
        }
    }, { passive: false });
}

/**
 * Marks a participant doc as seenByUser = true when user clicks OK on completed card.
 */
async function markParticipantSeen(participantId) {
    showLoader();
    try {
        const pRef = doc(db, "participants", participantId);
        await updateDoc(pRef, { seenByUser: true });

        // optimistic update locally
        let changed = false;
        latestJoinedTournaments = latestJoinedTournaments.map(item => {
            if (item.participant && item.participant.id === participantId) {
                const newPart = { ...item.participant, seenByUser: true };
                changed = true;
                return { participant: newPart, tournament: item.tournament };
            }
            return item;
        });

        if (changed) {
            renderMyTournaments(latestJoinedTournaments);
            updateMyFightsDot();
        }

        showToast("Marked as seen.", false);
    } catch (error) {
        console.error("Mark seen error:", error);
        showToast("Could not mark as seen.", true);
    } finally {
        hideLoader();
    }
}

/**
 * Handles the logic for a user joining a tournament by selecting a specific slot.
 * Uses a Firestore Transaction to safely claim the slot and create participant & transaction docs.
 *
 * @param {string} tournamentId
 * @param {number} entryFee
 * @param {number} slotIndex
 * @param {number} teamIndex
 * @param {string} ign
 */
async function handleJoinTournamentWithSlot(tournamentId, entryFee, slotIndex, teamIndex, ign) {
    showLoader();
    const user = auth.currentUser;
    if (!user) {
        showToast('Please login first.', true);
        hideJoinDialog();
        hideLoader();
        return;
    }

    const userId = user.uid;
    const userRef = doc(db, "users", userId);
    const participantRef = doc(collection(db, "participants")); // new doc
    const transactionRef = doc(collection(db, "transactions"));
    const tournamentRef = doc(db, "tournaments", tournamentId);

    try {
        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) throw new Error("User document not found.");

            const currentBalance = userDoc.data().walletBalance;
            if (currentBalance < entryFee) throw new Error("Insufficient Balance");

            const tDoc = await transaction.get(tournamentRef);
            if (!tDoc.exists()) throw new Error("Tournament not found.");
            const tData = tDoc.data();
            if (tData.status !== 'Upcoming') throw new Error("Tournament is no longer available.");

            // Ensure slots exist
            if (!Array.isArray(tData.slots)) throw new Error("Tournament slot data missing.");

            // Find slot by slotIndex and check free
            const targetIndex = parseInt(slotIndex, 10);
            if (isNaN(targetIndex) || targetIndex < 1 || targetIndex > tData.slots.length) {
                throw new Error("Invalid slot selected.");
            }
            const slotObj = tData.slots[targetIndex - 1];
            if (!slotObj || slotObj.userId) {
                throw new Error("Selected slot is already taken.");
            }

            // Also ensure user hasn't already joined same tournament
            const existingQ = query(collection(db, "participants"), where("userId", "==", userId), where("tournamentId", "==", tournamentId));
            const existingSnap = await getDocs(existingQ);
            if (!existingSnap.empty) {
                throw new Error("You have already joined this tournament.");
            }

            // All checks passed: perform writes
            // 1) Debit user wallet
            transaction.update(userRef, { walletBalance: currentBalance - entryFee });

            // 2) Create participant doc
            transaction.set(participantRef, {
                userId: userId,
                username: userDoc.data().username,
                ign: ign || '',
                tournamentId: tournamentId,
                status: 'Joined',
                joinedAt: serverTimestamp(),
                slotIndex: targetIndex,
                teamIndex: teamIndex,
                seenByUser: false
            });

            // 3) Create transaction doc
            transaction.set(transactionRef, {
                userId: userId,
                amount: entryFee,
                type: 'debit',
                description: `Entry fee for ${tData.title}`,
                createdAt: serverTimestamp()
            });

            // 4) Update tournament slots: set userId & participantId & ign
            const updatedSlots = Array.isArray(tData.slots) ? tData.slots.map(s => ({ ...s })) : [];
            updatedSlots[targetIndex - 1] = {
                ...updatedSlots[targetIndex - 1],
                userId: userId,
                participantId: participantRef.id,
                ign: ign || ''
            };

            // 5) increment currentParticipants
            const newCount = (typeof tData.currentParticipants === 'number' ? tData.currentParticipants : 0) + 1;
            transaction.update(tournamentRef, {
                slots: updatedSlots,
                currentParticipants: newCount
            });
        });

        showToast("Joined tournament successfully!", false);
        hideJoinDialog();
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
 */
async function handleSimulatedTransaction(amount, type, description) {
    const user = auth.currentUser;
    if (!user) return;

    showLoader();
    const userRef = doc(db, "users", user.uid);
    const transactionRef = doc(collection(db, "transactions"));

    try {
        const newBalance = type === 'credit' ? increment(amount) : increment(-amount);

        if (type === 'debit') {
            if (window.currentUser.walletBalance < amount) {
                throw new Error("Insufficient funds for withdrawal.");
            }
        }

        const batch = writeBatch(db);

        batch.update(userRef, { walletBalance: newBalance });

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
            tabs.forEach(t => {
                t.classList.remove('text-indigo-400', 'border-indigo-400', 'active');
                t.classList.add('text-gray-400', 'border-transparent');
            });
            contents.forEach(c => c.classList.add('hidden'));

            tab.classList.add('text-indigo-400', 'border-indigo-400', 'active');
            tab.classList.remove('text-gray-400', 'border-transparent');

            document.getElementById(`tab-content-${tab.dataset.tab}`).classList.remove('hidden');
        });
    });
}

/**
 * Updates the small notification dot on the "My Fights" nav button.
 * Priority: RED > YELLOW > GREEN
 */
function updateMyFightsDot() {
    const dot = document.getElementById('my-fights-dot');
    if (!dot) return;

    let hasRed = false;
    let hasYellow = false;
    let hasGreen = false;

    for (const item of latestJoinedTournaments) {
        const t = item.tournament || {};
        const p = item.participant || {};
        // RED: credentials released and tournament is Live
        if (t.status === 'Live' && t.roomId && t.roomPassword) {
            hasRed = true;
            break;
        }
        // Yellow: Upcoming or Live (without creds)
        if (t.status === 'Upcoming' || t.status === 'Live') {
            hasYellow = true;
        }
        // Green: completed and not seen by user
        if ((t.status === 'Completed' || p.status === 'Completed' || p.status === 'Winner') && p.seenByUser !== true) {
            hasGreen = true;
        }
    }

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
