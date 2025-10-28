import {
    doc,
    collection,
    query,
    onSnapshot,
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
let currentManagingTournament = { id: null, prizePool: 0, perKillEnabled: false, perKillPrize: 0, mode: 'solo' };

/**
 * Initializes all admin-specific listeners.
 */
export function initAdminListeners() {
    if (!window.currentUser || !window.currentUser.isAdmin) return;

    clearAdminListeners();

    const usersRef = collection(db, "users");
    const tourneysRef = collection(db, "tournaments");

    const unsubUsers = onSnapshot(usersRef, (snap) => {
        document.getElementById('admin-stats-users').textContent = snap.size;
    });

    const unsubTourneys = onSnapshot(tourneysRef, (snap) => {
        let prize = 0;
        let revenue = 0;
        const tournaments = [];

        snap.forEach(docSnap => {
            const t = docSnap.data();
            tournaments.push({ id: docSnap.id, ...t });

            if (t.status === 'Completed') prize += t.prizePool;
            const commission = (t.commissionRate / 100) || 0.2;
            const totalEntry = t.prizePool / (1 - commission);
            revenue += totalEntry * commission;
        });

        document.getElementById('admin-stats-tournaments').textContent = snap.size;
        document.getElementById('admin-stats-prize').textContent = `₹${prize.toFixed(2)}`;
        document.getElementById('admin-stats-revenue').textContent = `₹${revenue.toFixed(2)}`;

        tournaments.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        renderAdminTournaments(tournaments);
    });

    adminListeners = [unsubUsers, unsubTourneys];

    initAdminUI();
}

/**
 * Clears all active admin listeners.
 */
export function clearAdminListeners() {
    adminListeners.forEach(unsub => unsub());
    adminListeners = [];
    if (currentManagingTournament.unsub) currentManagingTournament.unsub();
    if (currentManagingTournament.unsubParts) currentManagingTournament.unsubParts();
    currentManagingTournament = { id: null, prizePool: 0, perKillEnabled: false, perKillPrize: 0, mode: 'solo' };
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

    // Declare Winner Form (submit delegated)
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
            mode,
            // NEW: description
            description,
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
        showToast(error.message || 'Error creating tournament', true);
    } finally {
        hideLoader();
    }
}

/* ... remaining functions unchanged (loadManageTournamentView, handleUpdateRoomDetails, handleDeclareWinner) ... */

/* NOTE: rest of file retains same behavior as previous version (unchanged) */
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
            currentManagingTournament.mode = t.mode || 'solo';
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
    currentManagingTournament.unsubParts = onSnapshot(q, async (querySnapshot) => {
        const participants = [];
        querySnapshot.forEach(docSnap => {
            participants.push({ id: docSnap.id, ...docSnap.data() });
        });
        renderManageParticipants(participants);

        // Build the declare/distribute UI depending on perKillEnabled
        const form = document.getElementById('declare-winner-form');
        if (!form) return;
        form.innerHTML = '';

        // header
        const header = document.createElement('div');
        header.className = 'p-2';
        header.innerHTML = `<h3 class="text-lg font-semibold text-white">${currentManagingTournament.perKillEnabled ? 'Enter Kills & Distribute Per-Kill Prizes' : 'Declare Winner'}</h3>`;
        form.appendChild(header);

        if (currentManagingTournament.perKillEnabled) {
            const info = document.createElement('p');
            info.className = 'text-sm text-gray-400 mb-2 px-2';
            info.textContent = `Per Kill Prize: ₹${currentManagingTournament.perKillPrize}`;
            form.appendChild(info);

            const list = document.createElement('div');
            list.id = 'per-kill-participants';
            list.className = 'space-y-2 max-h-64 overflow-y-auto mb-3 p-2';
            participants.forEach(p => {
                const row = document.createElement('div');
                row.className = 'bg-gray-700 p-3 rounded flex items-center justify-between';
                row.innerHTML = `
                    <div class="flex items-center gap-3">
                        <div class="h-8 w-8 rounded-full bg-gray-600 flex items-center justify-center text-sm text-white">${(p.username || 'U').charAt(0).toUpperCase()}</div>
                        <div><div class="text-white font-medium">${p.username}</div><div class="text-xs text-gray-400">UserID: ${p.userId}</div></div>
                    </div>
                    <div class="flex items-center gap-2">
                        <label class="text-xs text-gray-400">Kills</label>
                        <input type="number" min="0" value="${p.kills || 0}" data-participant-id="${p.id}" class="kill-input w-20 bg-gray-600 p-2 rounded text-white text-sm" />
                    </div>
                `;
                list.appendChild(row);
            });
            form.appendChild(list);

            const btnRow = document.createElement('div');
            btnRow.className = 'p-2';
            btnRow.innerHTML = `<button id="distribute-per-kill-btn" type="submit" class="w-full bg-indigo-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3 rounded" disabled>Distribute Prize</button>`;
            form.appendChild(btnRow);

            // --- NEW: attach input listeners to enable the distribute button when all kill inputs have valid values ---
            const distributeBtn = form.querySelector('#distribute-per-kill-btn');
            const killInputs = Array.from(form.querySelectorAll('.kill-input'));

            const validateKillInputs = () => {
                if (!distributeBtn) return;
                if (killInputs.length === 0) {
                    distributeBtn.disabled = true;
                    return;
                }
                const allValid = killInputs.every(inp => {
                    // treat empty string as invalid; zeros are valid
                    const v = inp.value;
                    if (v === '' || v === null || v === undefined) return false;
                    const n = parseInt(v, 10);
                    return !isNaN(n) && n >= 0;
                });
                distributeBtn.disabled = !allValid;
            };

            // attach listeners
            killInputs.forEach(inp => inp.addEventListener('input', validateKillInputs));
            // initial validation (in case inputs had defaults)
            validateKillInputs();

        } else {
            const label = document.createElement('label');
            label.className = 'block text-sm text-gray-300 mb-1 px-2';
            label.textContent = 'Select Winner';
            form.appendChild(label);

            const select = document.createElement('select');
            select.id = 'participant-winner-select';
            select.className = 'w-full bg-gray-700 p-3 rounded-lg mb-3';
            select.innerHTML = `<option value="">Select a winner...</option>` + participants.map(p => `<option value="${p.userId}" data-participant-id="${p.id}">${p.username}</option>`).join('');
            form.appendChild(select);

            const btnDiv = document.createElement('div');
            btnDiv.className = 'p-2';
            btnDiv.innerHTML = `<button id="declare-winner-btn" type="submit" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded">Declare Winner & Distribute Prize</button>`;
            form.appendChild(btnDiv);
        }
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
            status: 'Live'
        });
        showToast("Room details updated. Tournament is now LIVE.", false);
    } catch (error) {
        console.error("Update room error:", error);
        showToast(error.message || 'Error updating room', true);
    } finally {
        hideLoader();
    }
}

/**
 * Handles declaring a winner and distributing the prize.
 * Supports both per-kill and normal flow.
 * @param {Event} e 
 */
async function handleDeclareWinner(e) {
    e.preventDefault();
    if (!currentManagingTournament.id) return;

    const form = document.getElementById('declare-winner-form');
    if (!form) return;

    // PER-KILL FLOW (if kill inputs exist & perKillEnabled)
    const killInputs = form.querySelectorAll('.kill-input');
    if (killInputs && killInputs.length > 0 && currentManagingTournament.perKillEnabled) {
        // validate inputs
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

            // update tournament status
            const tournamentRef = doc(db, "tournaments", currentManagingTournament.id);
            batch.update(tournamentRef, { status: 'Completed' });

            // get participants
            const pCollRef = collection(db, "participants");
            const pSnap = await getDocs(query(pCollRef, where("tournamentId", "==", currentManagingTournament.id)));

            // compute max kills
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
            showToast('Per-kill prizes distributed successfully!', false);
            navigateTo('admin-dashboard-section');
        } catch (error) {
            console.error('Per-kill distribution error:', error);
            showToast(error.message || 'Error distributing per-kill prizes.', true);
        } finally {
            hideLoader();
        }

        return;
    }

    // NORMAL WINNER SELECTION FLOW
    const select = document.getElementById('participant-winner-select');
    if (!select) { showToast('Winner select not found.', true); return; }
    const winnerUserId = select.value;
    if (!winnerUserId) { showToast('Please select a winner.', true); return; }

    showLoader();
    try {
        const batch = writeBatch(db);

        // read prizePool (fallback to stored)
        const prizePool = currentManagingTournament.prizePool || 0;

        // credit winner
        const winnerUserRef = doc(db, "users", winnerUserId);
        batch.update(winnerUserRef, { walletBalance: increment(prizePool) });

        // transaction
        const transactionRef = doc(collection(db, "transactions"));
        batch.set(transactionRef, {
            userId: winnerUserId,
            amount: prizePool,
            type: 'credit',
            description: `Prize money for ${document.getElementById('manage-t-title').textContent}`,
            createdAt: serverTimestamp()
        });

        // update tournament & participants
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
        showToast('Winner declared and prize distributed!', false);
        navigateTo('admin-dashboard-section');
    } catch (error) {
        console.error("Declare winner error:", error);
        showToast(error.message || 'Error declaring winner', true);
    } finally {
        hideLoader();
    }
            }
