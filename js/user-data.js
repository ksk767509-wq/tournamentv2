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

// Ensure we attach global delegated handlers only once
let handlersAttached = false;

// State for join modal flow
let joinFlowState = {
    tournamentId: null,
    entryFee: 0,
    gameMode: 'solo',
    ingameName: '',
    selectedSlot: null // { slotIndex, teamId }
};

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

    // Attach delegated handlers once
    if (!handlersAttached) {
        attachDelegatedHandlers();
        handlersAttached = true;
    }

    // Attach join modal UI handlers (one-time)
    attachJoinModalHandlers();
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
    initWalletButtons();
    initProfileForms();
    initMyTournamentsTabs();
}

/**
 * Attach a single delegated click handler to the document body to handle:
 * - .join-btn (home) -> open join modal flow
 * - .copy-btn (room id/password copy in My Tournaments)
 * - .ok-btn (mark seen in completed)
 *
 * Using a single delegated handler avoids missing buttons placed in different containers.
 */
function attachDelegatedHandlers() {
    document.body.addEventListener('click', (e) => {
        // JOIN button (home tournament cards) -> open modal flow
        const joinButton = e.target.closest('.join-btn');
        if (joinButton && !joinButton.disabled) {
            const tId = joinButton.dataset.id;
            const fee = parseFloat(joinButton.dataset.fee);
            const mode = joinButton.dataset.mode || 'solo';
            startJoinFlow(tId, fee, mode);
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
 * Attach handlers specific to the join modal steps
 * (close/back/next/join).
 */
function attachJoinModalHandlers() {
    // Step1 elements
    const step1 = document.getElementById('join-modal-step1');
    const step1Next = document.getElementById('join-step1-next');
    const step1Cancel = document.getElementById('join-step1-cancel');
    const step1Close = document.getElementById('join-step1-close');
    const ingameInput = document.getElementById('join-ingame-name');

    // Step2 elements
    const step2 = document.getElementById('join-modal-step2');
    const step2Back = document.getElementById('join-step2-back');
    const step2Close = document.getElementById('join-step2-close');
    const step2Join = document.getElementById('join-step2-join');

    if (step1Next) {
        step1Next.addEventListener('click', () => {
            const name = (ingameInput.value || '').trim();
            if (!name) {
                showToast('Please enter your in-game name.', true);
                return;
            }
            joinFlowState.ingameName = name;
            // go to step 2
            hideModal('join-modal-step1');
            buildAndShowSlotSelection();
        });
    }
    if (step1Cancel) {
        step1Cancel.addEventListener('click', () => {
            hideModal('join-modal-step1');
            resetJoinFlowState();
        });
    }
    if (step1Close) {
        step1Close.addEventListener('click', () => {
            hideModal('join-modal-step1');
            resetJoinFlowState();
        });
    }

    if (step2Back) {
        step2Back.addEventListener('click', () => {
            hideModal('join-modal-step2');
            showModal('join-modal-step1');
        });
    }
    if (step2Close) {
        step2Close.addEventListener('click', () => {
            hideModal('join-modal-step2');
            resetJoinFlowState();
        });
    }

    if (step2Join) {
        step2Join.addEventListener('click', async () => {
            if (!joinFlowState.selectedSlot) {
                showToast('Please select a slot.', true);
                return;
            }
            // call join handler with slot info
            await handleJoinTournamentWithSlot(
                joinFlowState.tournamentId,
                joinFlowState.entryFee,
                joinFlowState.ingameName,
                joinFlowState.selectedSlot
            );
            hideModal('join-modal-step2');
            resetJoinFlowState();
        });
    }
}

/**
 * Opens join modal step 1 and sets joinFlow state with tournament basics.
 */
function startJoinFlow(tournamentId, entryFee, gameMode='solo') {
    joinFlowState.tournamentId = tournamentId;
    joinFlowState.entryFee = entryFee;
    joinFlowState.gameMode = gameMode;
    joinFlowState.ingameName = '';
    joinFlowState.selectedSlot = null;

    // clear step1 input
    const ingameInput = document.getElementById('join-ingame-name');
    if (ingameInput) ingameInput.value = '';

    showModal('join-modal-step1');
}

/**
 * Builds slot/team selection UI for the given tournament and shows step 2 modal.
 * Uses latest tournament data and participants to compute occupied slots.
 */
async function buildAndShowSlotSelection() {
    const tournamentId = joinFlowState.tournamentId;
    const gameMode = joinFlowState.gameMode || 'solo';

    const tournament = latestTournaments.find(t => t.id === tournamentId);
    if (!tournament) {
        showToast('Tournament not found.', true);
        hideModal('join-modal-step1');
        return;
    }
    // fetch participants for this tournament (live snapshot may not be available here)
    const pCollRef = collection(db, "participants");
    const q = query(pCollRef, where("tournamentId", "==", tournamentId));
    const pSnap = await getDocs(q);
    const participants = [];
    pSnap.forEach(d => participants.push({ id: d.id, ...d.data() }));

    const max = tournament.maxParticipants || 0;
    const teamSize = (gameMode === 'duo') ? 2 : (gameMode === 'squad') ? 4 : 1;

    const slotsContainer = document.getElementById('join-slot-container');
    const desc = document.getElementById('join-step2-description');
    slotsContainer.innerHTML = '';

    // Build occupied map: slotIndex -> participant
    // We'll treat slots as indices 1..max, and teamId as Math.ceil(slot / teamSize)
    const occupied = {};
    participants.forEach(p => {
        if (typeof p.slotIndex === 'number') {
            occupied[p.slotIndex] = p;
        }
    });

    // Build UI depending on mode
    if (gameMode === 'solo') {
        desc.textContent = `Select any available position (1 to ${max}).`;
        // Show grid of slots
        const grid = document.createElement('div');
        grid.className = 'grid grid-cols-5 gap-2';
        for (let i = 1; i <= max; i++) {
            const isOccupied = !!occupied[i];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `py-2 rounded ${isOccupied ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-gray-700 text-white hover:bg-indigo-600'}`;
            btn.textContent = `#${i}`;
            btn.disabled = isOccupied;
            btn.dataset.slotIndex = i;
            btn.addEventListener('click', () => {
                // clear previous selection highlight
                Array.from(grid.querySelectorAll('button')).forEach(b => b.classList.remove('ring-2', 'ring-indigo-400'));
                btn.classList.add('ring-2', 'ring-indigo-400');
                joinFlowState.selectedSlot = { slotIndex: i, teamId: null };
                document.getElementById('join-step2-join').disabled = false;
            });
            grid.appendChild(btn);
        }
        slotsContainer.appendChild(grid);
    } else {
        // Duo or Squad -> build teams
        const totalTeams = Math.floor(max / teamSize);
        desc.textContent = `Select any available slot inside a team (Team size: ${teamSize}).`;

        for (let team = 1; team <= totalTeams; team++) {
            const teamDiv = document.createElement('div');
            teamDiv.className = 'bg-gray-800 p-3 rounded';
            const header = document.createElement('div');
            header.className = 'flex justify-between items-center mb-2';
            header.innerHTML = `<div class="font-medium text-white">Team ${team}</div><div class="text-xs text-gray-400">${teamSize} slots</div>`;
            teamDiv.appendChild(header);

            const slotRow = document.createElement('div');
            slotRow.className = 'flex gap-2';
            for (let s = 0; s < teamSize; s++) {
                const slotIndex = ((team - 1) * teamSize) + s + 1; // 1-indexed
                const isOccupied = !!occupied[slotIndex];
                const slotBtn = document.createElement('button');
                slotBtn.type = 'button';
                slotBtn.className = `flex-1 py-2 rounded ${isOccupied ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-gray-700 text-white hover:bg-indigo-600'}`;
                slotBtn.textContent = `#${slotIndex}`;
                slotBtn.disabled = isOccupied;
                slotBtn.dataset.slotIndex = slotIndex;
                slotBtn.dataset.teamId = team;
                slotBtn.addEventListener('click', () => {
                    // clear existing highlights
                    slotsContainer.querySelectorAll('button').forEach(b => b.classList.remove('ring-2','ring-indigo-400'));
                    slotBtn.classList.add('ring-2','ring-indigo-400');
                    joinFlowState.selectedSlot = { slotIndex: slotIndex, teamId: team };
                    document.getElementById('join-step2-join').disabled = false;
                });
                slotRow.appendChild(slotBtn);
            }
            teamDiv.appendChild(slotRow);
            slotsContainer.appendChild(teamDiv);
        }
    }

    // Show step2 modal
    hideModal('join-modal-step1');
    showModal('join-modal-step2');
    // Initially disable the final join button until selection made
    document.getElementById('join-step2-join').disabled = true;
}

/**
 * Performs the join operation including slot assignment.
 * Similar to previous handleJoinTournament but includes slot/team and ingameName.
 * Uses a pre-check for slot occupancy and then a transaction to debit wallet and create participant doc + increment tournament currentParticipants.
 *
 * @param {string} tournamentId
 * @param {number} entryFee
 * @param {string} ingameName
 * @param {object} slotInfo { slotIndex: number, teamId: number|null }
 */
async function handleJoinTournamentWithSlot(tournamentId, entryFee, ingameName, slotInfo) {
    showLoader();
    const userId = auth.currentUser.uid;
    if (!userId) {
        showToast('User not authenticated.', true);
        hideLoader();
        return;
    }

    // Pre-check: ensure user hasn't already joined this tournament
    try {
        const existingQuery = query(collection(db, "participants"), where("userId", "==", userId), where("tournamentId", "==", tournamentId));
        const existingSnap = await getDocs(existingQuery);
        if (!existingSnap.empty) {
            showToast('You have already joined this tournament.', true);
            hideLoader();
            return;
        }

        // Pre-check slot not taken
        if (slotInfo && typeof slotInfo.slotIndex === 'number') {
            const slotQuery = query(collection(db, "participants"), where("tournamentId", "==", tournamentId), where("slotIndex", "==", slotInfo.slotIndex));
            const slotSnap = await getDocs(slotQuery);
            if (!slotSnap.empty) {
                showToast('Selected slot is already taken. Please choose another.', true);
                hideLoader();
                return;
            }
        }

        // Transaction: debit wallet, create participant doc, increment tournament currentParticipants
        const userRef = doc(db, "users", userId);
        const tournamentRef = doc(db, "tournaments", tournamentId);
        const participantRef = doc(collection(db, "participants"));
        const transactionRef = doc(collection(db, "transactions"));

        await runTransaction(db, async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) throw new Error("User document not found.");
            const currentBalance = userDoc.data().walletBalance;
            if (currentBalance < entryFee) throw new Error("Insufficient Balance");

            const tDoc = await transaction.get(tournamentRef);
            if (!tDoc.exists()) throw new Error("Tournament not found.");
            const tData = tDoc.data();
            if (tData.status !== 'Upcoming') throw new Error("Tournament is no longer available.");

            const max = tData.maxParticipants || 0;
            const current = typeof tData.currentParticipants === 'number' ? tData.currentParticipants : 0;
            if (current >= max) throw new Error("Tournament is already full.");

             // Final slot check inside transaction is limited — we re-check by querying participants docs (best-effort)
            // (Firestore transactions have limitations reading collection queries, but we'll perform a final read outside transaction and assume uniqueness)
            transaction.update(userRef, { walletBalance: currentBalance - entryFee });

            transaction.set(participantRef, {
                userId: userId,
                username: userDoc.data().username,
                ingameName: ingameName,
                tournamentId: tournamentId,
                status: 'Joined',
                joinedAt: serverTimestamp(),
                slotIndex: slotInfo ? slotInfo.slotIndex : null,
                teamId: slotInfo ? slotInfo.teamId : null
            });

            transaction.set(transactionRef, {
                userId: userId,
                amount: entryFee,
                type: 'debit',
                description: `Entry fee for ${tData.title}`,
                createdAt: serverTimestamp()
            });

            transaction.update(tournamentRef, { currentParticipants: (current + 1) });
        });

        showToast("Joined tournament successfully!", false);
    } catch (error) {
        console.error("Join tournament error:", error);
        showToast(error.message || 'Could not join tournament.', true);
    } finally {
        hideLoader();
    }
}

/**
 * Utility: show modal by id
 */
function showModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('flex');
}

/**
 * Utility: hide modal by id
 */
function hideModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('flex');
}

/**
 * Reset joinFlowState
 */
function resetJoinFlowState() {
    joinFlowState = {
        tournamentId: null,
        entryFee: 0,
        gameMode: 'solo',
        ingameName: '',
        selectedSlot: null
    };
}

/**
 * Marks a participant doc as seenByUser = true when user clicks OK on completed card.
 * Optimistically updates local cache so UI responds immediately.
 * @param {string} participantId 
 */
async function markParticipantSeen(participantId) {
    showLoader();
    try {
        const pRef = doc(db, "participants", participantId);
        await updateDoc(pRef, { seenByUser: true });

        // Optimistically update local cache (so UI updates immediately)
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
            // re-render My Tournaments completed list and update dot right away
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
 * - RED: Any joined tournament is Live AND credentials are present (roomId & password)
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
        // RED: credentials released and tournament is Live
        if (t.status === 'Live' && t.roomId && t.roomPassword) {
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
