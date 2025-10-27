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
    const winnerUserId = select.value;
    const winnerUsername = select.options[select.selectedIndex].dataset.username;
    
    if (!winnerUserId) {
        showToast("Please select a winner.", true);
        return;
    }
    
    if (!currentManagingTournament.id || currentManagingTournament.prizePool <= 0) {
        showToast("Invalid tournament data. Cannot declare winner.", true);
        return;
    }

    if (!confirm(`Declare ${winnerUsername} as the winner and distribute ₹${currentManagingTournament.prizePool}?`)) {
        return;
    }
    
    showLoader();
    try {
        const batch = writeBatch(db);
        
        // 1. Update winner's wallet
        const winnerUserRef = doc(db, "users", winnerUserId);
        batch.update(winnerUserRef, { walletBalance: increment(currentManagingTournament.prizePool) });
        
        // 2. Create credit transaction for winner
        const transactionRef = doc(collection(db, "transactions"));
        batch.set(transactionRef, {
            userId: winnerUserId,
            amount: currentManagingTournament.prizePool,
            type: 'credit',
            description: `Prize money for ${document.getElementById('manage-t-title').textContent}`,
            createdAt: serverTimestamp()
        });

        // 3. Update tournament status
        const tDocRef = doc(db, "tournaments", currentManagingTournament.id);
        batch.update(tDocRef, { status: 'Completed' });

        // 4. Update participant statuses
        const pCollRef = collection(db, "participants");
        const q = query(pCollRef, where("tournamentId", "==", currentManagingTournament.id));
        const pSnap = await getDocs(q); // Get all participants for this tournament
        
        pSnap.forEach(pDoc => {
            const pRef = doc(db, "participants", pDoc.id);
            if (pDoc.data().userId === winnerUserId) {
                // mark winner and mark unseen for users (so they will see green notification)
                batch.update(pRef, { status: 'Winner', seenByUser: false });
            } else {
                batch.update(pRef, { status: 'Participated', seenByUser: false }); // mark not seen so user can OK it
            }
        });

        // 5. Commit all changes
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
