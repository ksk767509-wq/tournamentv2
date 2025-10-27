import { 
    doc, 
    collection, 
    query, 
    onSnapshot, 
    orderBy, 
    addDoc, 
    serverTimestamp, 
    getDocs, 
    where, 
    writeBatch,
    updateDoc,
    increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { showLoader, hideLoader, showToast, renderAdminTournaments, renderManageParticipants, renderDeclareWinnerForm } from "./ui.js";
import { navigateTo } from "./router.js";

let adminListeners = [];
let currentManagingTournament = {
    id: null,
    prizePool: 0,
    perKillEnabled: false,
    perKillPrize: 0
};

/**
 * Initializes all admin-specific listeners.
 */
export function initAdminListeners() {
    if (!window.currentUser || !window.currentUser.isAdmin) return;
    
    clearAdminListeners();
    
    // 1. Admin Dashboard Stats Listener
    // We'll use multiple snapshots for real-time stats
    const usersRef = collection(db, "users");
    const tourneysRef = collection(db, "tournaments");
    
    const unsubUsers = onSnapshot(usersRef, (snap) => {
        document.getElementById('admin-stats-users').textContent = snap.size;
    });

    const unsubTourneys = onSnapshot(tourneysRef, (snap) => {
        let prize = 0;
        let revenue = 0;
        const tournaments = [];

        snap.forEach(doc => {
            const t = doc.data();
            tournaments.push({ id: doc.id, ...t });
            
            if (t.status === 'Completed') {
                prize += t.prizePool;
            }
            // Calculate revenue from all tournaments (assuming fee is collected on join)
            // A more complex model would be based on actual participant counts
            // For simplicity, we'll base it on commission * prize (a common model)
            const commission = (t.commissionRate / 100) || 0.2; // Default 20%
            const totalEntry = t.prizePool / (1 - commission); // Back-calculate total entry
            revenue += totalEntry * commission;
        });

        document.getElementById('admin-stats-tournaments').textContent = snap.size;
        document.getElementById('admin-stats-prize').textContent = `₹${prize.toFixed(2)}`;
        document.getElementById('admin-stats-revenue').textContent = `₹${revenue.toFixed(2)}`;
        
        // Render tournament list on dashboard
        tournaments.sort((a, b) => b.createdAt - a.createdAt);
        renderAdminTournaments(tournaments);
    });
    
    adminListeners = [unsubUsers, unsubTourneys];
    
    // Init admin UI button listeners
    initAdminUI();
}

/**
 * Clears all active admin listeners.
 */
export function clearAdminListeners() {
    adminListeners.forEach(unsub => unsub());
    adminListeners = [];
    
    // Also clear specific tournament listeners if any
    if (currentManagingTournament.unsub) {
        currentManagingTournament.unsub();
    }
    if (currentManagingTournament.unsubParts) {
        currentManagingTournament.unsubParts();
    }
    currentManagingTournament = { id: null, prizePool: 0, perKillEnabled: false, perKillPrize: 0 };
}

/**
 * Initializes listeners for admin forms and buttons.
 */
function initAdminUI() {
    // Create Tournament Form
    document.getElementById('create-tournament-form').addEventListener('submit', handleCreateTournament);
    
    // Manage Tournament button listener (delegated)
    document.getElementById('admin-tournaments-list').addEventListener('click', (e) => {
        const manageBtn = e.target.closest('.manage-t-btn');
        if (manageBtn) {
            loadManageTournamentView(manageBtn.dataset.id);
        }
    });

    // Update Room Details Form
    document.getElementById('update-room-form').addEventListener('submit', handleUpdateRoomDetails);
    
    // Declare Winner form submit - delegate to handleDeclareWinner which will detect per-kill mode
    document.getElementById('declare-winner-form').addEventListener('submit', handleDeclareWinner);

    // Input listener inside manage section: enable Distribute button when all kills are entered
    document.getElementById('manage-tournament-section').addEventListener('input', (e) => {
        if (e.target && e.target.matches('.kill-input')) {
            const form = document.getElementById('declare-winner-form');
            if (!form) return;
            const allInputs = Array.from(form.querySelectorAll('.kill-input'));
            const btn = document.getElementById('distribute-per-kill-btn');
            if (!btn) return;
            // All inputs must be present (have value, even zero counts)
            const allFilled = allInputs.length > 0 && allInputs.every(i => i.value !== null && i.value !== undefined && i.value !== '');
            btn.disabled = !allFilled;
        }
    });
}

/**
 * Handles creation of a new tournament.
 * @param {Event} e 
 */
async function handleCreateTournament(e) {
    e.preventDefault();
    showLoader();
    
    try {
        const perKillEnabled = document.getElementById('t-per-kill-toggle').checked;
        const perKillPrize = parseFloat(document.getElementById('t-per-kill-prize').value || 0);

        const formData = {
            title: document.getElementById('t-title').value,
            gameName: document.getElementById('t-game-name').value,
            matchTime: new Date(document.getElementById('t-match-time').value),
            entryFee: parseFloat(document.getElementById('t-entry-fee').value),
            prizePool: parseFloat(document.getElementById('t-prize-pool').value),
            commissionRate: parseFloat(document.getElementById('t-commission').value),
            status: 'Upcoming',
            roomId: '',
            roomPassword: '',
            // NEW: participant limits
            maxParticipants: parseInt(document.getElementById('t-max-participants').value, 10) || 100,
            currentParticipants: 0,
            // NEW: per-kill
            perKillEnabled: !!perKillEnabled,
            perKillPrize: perKillEnabled ? (isNaN(perKillPrize) ? 0 : perKillPrize) : 0,
            createdAt: serverTimestamp()
        };
        
        await addDoc(collection(db, "tournaments"), formData);
        showToast("Tournament created successfully!", false);
        e.target.reset();
        navigateTo('admin-dashboard-section');
    } catch (error) {
        console.error("Create tournament error:", error);
        showToast(error.message, true);
    } finally {
        hideLoader();
    }
}

/**
 * Loads the specific view for managing a single tournament.
 * @param {string} tournamentId 
 */
function loadManageTournamentView(tournamentId) {
    currentManagingTournament.id = tournamentId;
    navigateTo('manage-tournament-section');
    
    // Clear old listeners if any
    if (currentManagingTournament.unsub) currentManagingTournament.unsub();
    if (currentManagingTournament.unsubParts) currentManagingTournament.unsubParts();

    // Listen to tournament details
    const tDocRef = doc(db, "tournaments", tournamentId);
    currentManagingTournament.unsub = onSnapshot(tDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const t = docSnap.data();
            currentManagingTournament.prizePool = t.prizePool; // Store prize for winner logic
            currentManagingTournament.perKillEnabled = !!t.perKillEnabled;
            currentManagingTournament.perKillPrize = t.perKillPrize || 0;
            document.getElementById('manage-t-title').textContent = `Manage: ${t.title}`;
            document.getElementById('manage-t-room-id').value = t.roomId || '';
            document.getElementById('manage-t-room-pass').value = t.roomPassword || '';
            
            // Disable winner form if already completed
            if (t.status === 'Completed') {
                document.getElementById('declare-winner-form').classList.add('opacity-50', 'pointer-events-none');
            } else {
                document.getElementById('declare-winner-form').classList.remove('opacity-50', 'pointer-events-none');
            }
        }
    });

    // Listen to participants
    const pCollRef = collection(db, "participants");
    const q = query(pCollRef, where("tournamentId", "==", tournamentId));
    currentManagingTournament.unsubParts = onSnapshot(q, (querySnapshot) => {
        const participants = [];
        querySnapshot.forEach(doc => {
            participants.push({ id: doc.id, ...doc.data() });
        });
        // Render the participants list (simple list)
        renderManageParticipants(participants);

        // Render the declare/distribute form (per-kill or normal) using ui.js helper
        // We need the latest tournament doc data to decide; read once
        getDocs(query(collection(db, "tournaments"), where("__name__", "==", tournamentId))).then(() => {
            // Instead of making another query, we will use the stored currentManagingTournament details (they are updated by snapshot)
            const tournamentData = {
                id: currentManagingTournament.id,
                title: document.getElementById('manage-t-title').textContent.replace('Manage: ', '') || '',
                perKillEnabled: currentManagingTournament.perKillEnabled,
                perKillPrize: currentManagingTournament.perKillPrize
            };
            renderDeclareWinnerForm(participants, tournamentData);
        }).catch(err => {
            // Fallback: render with defaults
            const tournamentData = {
                id: currentManagingTournament.id,
                title: document.getElementById('manage-t-title').textContent.replace('Manage: ', '') || '',
                perKillEnabled: currentManagingTournament.perKillEnabled,
                perKillPrize: currentManagingTournament.perKillPrize
            };
            renderDeclareWinnerForm(participants, tournamentData);
        });
    });
}

/**
 * Handles updating the Room ID and Password for a tournament.
 * @param {Event} e 
 */
async function handleUpdateRoomDetails(e) {
    e.preventDefault();
    if (!currentManagingTournament.id) return;
    
    const roomId = document.getElementById('manage-t-room-id').value;
    const roomPassword = document.getElementById('manage-t-room-pass').value;
    
    showLoader();
    try {
        const tDocRef = doc(db, "tournaments", currentManagingTournament.id);
        await updateDoc(tDocRef, {
            roomId: roomId,
            roomPassword: roomPassword,
            status: 'Live' // Automatically set to Live when room details are added
        });
        showToast("Room details updated. Tournament is now LIVE.", false);
    } catch (error) {
        console.error("Update room error:", error);
        showToast(error.message, true);
    } finally {
        hideLoader();
    }
}

/**
 * Handles declaring a winner and distributing the prize.
 * Now supports both:
 * - perKillEnabled === true => admin enters kills for each participant; payout = kills * perKillPrize for each participant
 * - perKillEnabled === false => old flow: select winner -> credit prizePool to winner
 * 
 * @param {Event} e 
 */
async function handleDeclareWinner(e) {
    e.preventDefault();
    if (!currentManagingTournament.id) return;

    // Read current tournament meta
    const tDocRef = doc(db, "tournaments", currentManagingTournament.id);
    const tSnap = await (await getDocs(query(collection(db, "tournaments"), where("__name__", "==", currentManagingTournament.id)))).docs[0]?.ref.get?.() 
        .catch(()=>null);

    // We'll rely on the snapshot-stored values instead to avoid complexity
    const perKillEnabled = currentManagingTournament.perKillEnabled;
    const perKillPrize = currentManagingTournament.perKillPrize || 0;

    if (perKillEnabled) {
        // Per-kill distribution path
        // Gather kills inputs
        const form = document.getElementById('declare-winner-form');
        if (!form) {
            showToast('Form not found.', true);
            return;
        }
        const inputs = Array.from(form.querySelectorAll('.kill-input'));
        if (inputs.length === 0) {
            showToast('No participants found.', true);
            return;
        }

        // Validate inputs: all must have a value >= 0
        const killsMap = {}; // participantId -> kills
        for (const inp of inputs) {
            const pid = inp.dataset.participantId;
            const valRaw = inp.value;
            if (valRaw === '' || valRaw === null || valRaw === undefined) {
                showToast('Please enter kills for all participants.', true);
                return;
            }
            const k = parseInt(valRaw, 10);
            if (isNaN(k) || k < 0) {
                showToast('Kills must be a non-negative integer.', true);
                return;
            }
            killsMap[pid] = k;
        }

        // All validated. Build batch updates:
        showLoader();
        try {
            const batch = writeBatch(db);

            // 1) Update tournament status to Completed
            const tournamentRef = doc(db, "tournaments", currentManagingTournament.id);
            batch.update(tournamentRef, { status: 'Completed' });

            // 2) For each participant, update participant doc with kills, status, seenByUser=false
            // Also collect user wallet updates and transaction creation
            // We'll need to query participants docs for this tournament to get userIds.
            const pCollRef = collection(db, "participants");
            const pQuery = query(pCollRef, where("tournamentId", "==", currentManagingTournament.id));
            const pSnap = await getDocs(pQuery);

            // compute maxKills to mark winners
            let maxKills = -1;
            const participantDocs = []; // { docRef, data }
            pSnap.forEach(pDoc => {
                const data = pDoc.data();
                participantDocs.push({ ref: doc(db, "participants", pDoc.id), id: pDoc.id, data });
                const k = killsMap[pDoc.id] || 0;
                if (k > maxKills) maxKills = k;
            });

            // Now, for each participant, set status and money updates
            for (const p of participantDocs) {
                const pid = p.id;
                const pdata = p.data;
                const kills = killsMap[pid] || 0;
                const amount = kills * perKillPrize;

                // Participant status: Winner if kills === maxKills AND maxKills > 0 (if all zeros maybe no winner)
                const newStatus = (maxKills > 0 && kills === maxKills) ? 'Winner' : 'Completed';
                batch.update(p.ref, { status: newStatus, seenByUser: false, kills: kills });

                // If amount > 0, credit user's wallet and create a transaction doc
                if (amount > 0) {
                    const userRef = doc(db, "users", pdata.userId);
                    batch.update(userRef, { walletBalance: increment(amount) });

                    const txRef = doc(collection(db, "transactions"));
                    batch.set(txRef, {
                        userId: pdata.userId,
                        amount: amount,
                        type: 'credit',
                        description: `Per-kill prize (${kills} kills) - ${pdata.username} - ${document.getElementById('manage-t-title').textContent}`,
                        createdAt: serverTimestamp()
                    });
                }
            }

            // Commit batch
            await batch.commit();

            showToast('Per-kill prizes distributed successfully!', false);
            navigateTo('admin-dashboard-section');
        } catch (error) {
            console.error('Per-kill distribution error:', error);
            showToast(error.message || 'Error distributing per-kill prizes.', true);
        } finally {
            hideLoader();
        }

    } else {
        // Old flow: select winner from dropdown and distribute prizePool to winner
        const select = document.getElementById('participant-winner-select');
        if (!select) {
            showToast('Winner select not found.', true);
            return;
        }
        const winnerUserId = select.value;
        const winnerOption = select.options[select.selectedIndex];
        const winnerParticipantId = winnerOption ? winnerOption.dataset.participantId : null;
        if (!winnerUserId) {
            showToast('Please select a winner.', true);
            return;
        }

        // Commit batch: credit winner, create transaction, update tournament status, update participants statuses
        showLoader();
        try {
            const batch = writeBatch(db);

            // 1. Get tournament doc to read prizePool
            const tRef = doc(db, "tournaments", currentManagingTournament.id);
            const tDocSnap = await (await getDocs(query(collection(db, "tournaments"), where("__name__", "==", currentManagingTournament.id)))).docs[0]?.ref.get?.()
                .catch(()=>null);

            // We'll trust stored prizePool on currentManagingTournament or read fresh document
            // For safety, fetch tournament doc
            const tournamentSnap = await (await getDocs(query(collection(db, "tournaments"), where("__name__", "==", currentManagingTournament.id)))).docs[0]?.ref.get?.()
                .catch(()=>null);
            let prizePool = currentManagingTournament.prizePool || 0;
            try {
                const tdoc = await (await getDocs(query(collection(db, "tournaments"), where("__name__", "==", currentManagingTournament.id)))).docs;
                // fallback ignored - prizePool used from currentManagingTournament
            } catch (e) { /* ignore */ }

            // credit winner
            const winnerUserRef = doc(db, "users", winnerUserId);
            batch.update(winnerUserRef, { walletBalance: increment(prizePool) });

            // create transaction
            const transactionRef = doc(collection(db, "transactions"));
            batch.set(transactionRef, {
                userId: winnerUserId,
                amount: prizePool,
                type: 'credit',
                description: `Prize money for ${document.getElementById('manage-t-title').textContent}`,
                createdAt: serverTimestamp()
            });

            // update tournament status
            const tDocRef = doc(db, "tournaments", currentManagingTournament.id);
            batch.update(tDocRef, { status: 'Completed' });

            // update participants: winner -> Winner & seenByUser:false ; others -> Completed & seenByUser:false
            const pCollRef = collection(db, "participants");
            const pQuery = query(pCollRef, where("tournamentId", "==", currentManagingTournament.id));
            const pSnap = await getDocs(pQuery);

            pSnap.forEach(pDoc => {
                const pRef = doc(db, "participants", pDoc.id);
                if (pDoc.data().userId === winnerUserId) {
                    batch.update(pRef, { status: 'Winner', seenByUser: false });
                } else {
                    batch.update(pRef, { status: 'Completed', seenByUser: false });
                }
            });

            await batch.commit();
            showToast('Winner declared and prize distributed!', false);
            navigateTo('admin-dashboard-section');
        } catch (error) {
            console.error("Declare winner error:", error);
            showToast(error.message || 'Error declaring winner.', true);
        } finally {
            hideLoader();
        }
    }
}
