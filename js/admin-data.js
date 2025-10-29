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
import { showLoader, hideLoader, showToast, renderAdminTournaments, renderManageParticipants } from "./ui.js";
import { navigateTo } from "./router.js";

let adminListeners = [];
let currentManagingTournament = {
    id: null,
    prizePool: 0
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
    currentManagingTournament = { id: null, prizePool: 0 };
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
    
    // Declare Winner Form
    document.getElementById('declare-winner-form').addEventListener('submit', handleDeclareWinner);
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
        const mode = document.getElementById('t-mode').value || 'solo';
        const description = document.getElementById('t-description').value || '';
        const map = document.getElementById('t-map').value || '';

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
            maxParticipants: parseInt(document.getElementById('t-max-participants').value, 10) || 100,
            currentParticipants: 0,
            perKillEnabled: !!perKillEnabled,
            perKillPrize: perKillEnabled ? (isNaN(perKillPrize) ? 0 : perKillPrize) : 0,
            mode,
            description,
            map,
            createdAt: serverTimestamp()
        };
        
        // Validate for duo/squad divisibility
        if (formData.mode === 'duo' && (formData.maxParticipants % 2 !== 0)) {
            const remainder = formData.maxParticipants % 2;
            showToast(`Duo requires max participants divisible by 2. Remainder: ${remainder}`, true);
            hideLoader();
            return;
        }
        if (formData.mode === 'squad' && (formData.maxParticipants % 4 !== 0)) {
            const remainder = formData.maxParticipants % 4;
            showToast(`Squad requires max participants divisible by 4. Remainder: ${remainder}`, true);
            hideLoader();
            return;
        }

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
        renderManageParticipants(participants);
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
 * @param {Event} e 
 */
async function handleDeclareWinner(e) {
    e.preventDefault();
    const select = document.getElementById('participant-winner-select');
    // Determine if per-kill UI is present
    const killInputs = document.querySelectorAll('.kill-input');
    if (killInputs && killInputs.length > 0) {
        // per-kill flow (handled earlier versions) - this file retains that logic
        // Now support distribution even if tournament not full
        const killsMap = {};
        for (const inp of killInputs) {
            const pid = inp.dataset.participantId;
            if (!pid) { showToast('Invalid participant input.', true); return; }
            if (inp.value === '' || inp.value === null || inp.value === undefined) { showToast('Enter kills for all participants.', true); return; }
            const k = parseInt(inp.value, 10);
            if (isNaN(k) || k < 0) { showToast('Kills must be non-negative integers.', true); return; }
            killsMap[pid] = k;
        }

        showLoader();
        try {
            const batch = writeBatch(db);

            const tournamentRef = doc(db, "tournaments", currentManagingTournament.id);
            batch.update(tournamentRef, { status: 'Completed' });

            const pCollRef = collection(db, "participants");
            const pSnap = await getDocs(query(pCollRef, where("tournamentId", "==", currentManagingTournament.id)));

            let maxKills = -1;
            const participantDocs = [];
            pSnap.forEach(pDoc => {
                participantDocs.push({ id: pDoc.id, ref: doc(db, "participants", pDoc.id), data: pDoc.data() });
                const k = killsMap[pDoc.id] || 0;
                if (k > maxKills) maxKills = k;
            });

            for (const p of participantDocs) {
                const pid = p.id;
                const pdata = p.data;
                const kills = killsMap[pid] || 0;
                const amount = kills * (currentManagingTournament.perKillPrize || 0);

                const newStatus = (maxKills > 0 && kills === maxKills) ? 'Winner' : 'Completed';
                batch.update(p.ref, { status: newStatus, seenByUser: false, kills: kills });

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

            await batch.commit();
            
            showToast("Per-kill prizes distributed successfully!", false);
            navigateTo('admin-dashboard-section');
        } catch (error) {
            console.error("Per-kill distribution error:", error);
            showToast(error.message, true);
        } finally {
            hideLoader();
        }
        return;
    }

    if (!select) { showToast("Winner select not found.", true); return; }
    const winnerUserId = select.value;
    if (!winnerUserId) { showToast("Please select a winner.", true); return; }

    showLoader();
    try {
        const batch = writeBatch(db);

        const prizePool = currentManagingTournament.prizePool || 0;

        const winnerUserRef = doc(db, "users", winnerUserId);
        batch.update(winnerUserRef, { walletBalance: increment(prizePool) });

        const transactionRef = doc(collection(db, "transactions"));
        batch.set(transactionRef, {
            userId: winnerUserId,
            amount: prizePool,
            type: 'credit',
            description: `Prize money for ${document.getElementById('manage-t-title').textContent}`,
            createdAt: serverTimestamp()
        });

        const tDocRef = doc(db, "tournaments", currentManagingTournament.id);
        batch.update(tDocRef, { status: 'Completed' });

        const pCollRef = collection(db, "participants");
        const pSnap = await getDocs(query(pCollRef, where("tournamentId", "==", currentManagingTournament.id)));
        
        pSnap.forEach(pDoc => {
            const pRef = doc(db, "participants", pDoc.id);
            if (pDoc.data().userId === winnerUserId) {
                batch.update(pRef, { status: 'Winner', seenByUser: false });
            } else {
                batch.update(pRef, { status: 'Completed', seenByUser: false });
            }
        });

        await batch.commit();
        showToast("Winner declared and prize distributed!", false);
        navigateTo('admin-dashboard-section');

    } catch (error) {
        console.error("Declare winner error:", error);
        showToast(error.message, true);
    } finally {
        hideLoader();
    }
}
