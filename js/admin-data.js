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
let currentManagingTournament = { id: null, prizePool: 0, perKillEnabled: false, perKillPrize: 0 };

/**
 * Initialize admin listeners (same as before)
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

export function clearAdminListeners() {
    adminListeners.forEach(u => u());
    adminListeners = [];
    if (currentManagingTournament.unsub) currentManagingTournament.unsub();
    if (currentManagingTournament.unsubParts) currentManagingTournament.unsubParts();
    currentManagingTournament = { id: null, prizePool: 0, perKillEnabled: false, perKillPrize: 0 };
}

function initAdminUI() {
    document.getElementById('create-tournament-form').addEventListener('submit', handleCreateTournament);
    document.getElementById('admin-tournaments-list').addEventListener('click', (e) => {
        const manageBtn = e.target.closest('.manage-t-btn');
        if (manageBtn) loadManageTournamentView(manageBtn.dataset.id);
    });
    document.getElementById('update-room-form').addEventListener('submit', handleUpdateRoomDetails);
    document.getElementById('declare-winner-form').addEventListener('submit', handleDeclareWinner);

    // enable distribute button when kills inputs filled handled previously in a listener in earlier version
}

async function handleCreateTournament(e) {
    e.preventDefault();
    showLoader();
    try {
        const title = document.getElementById('t-title').value;
        const gameName = document.getElementById('t-game-name').value;
        const matchTime = new Date(document.getElementById('t-match-time').value);
        const entryFee = parseFloat(document.getElementById('t-entry-fee').value);
        const prizePool = parseFloat(document.getElementById('t-prize-pool').value);
        const commissionRate = parseFloat(document.getElementById('t-commission').value);
        const maxParticipants = parseInt(document.getElementById('t-max-participants').value, 10) || 0;
        const perKillEnabled = document.getElementById('t-per-kill-toggle').checked;
        const perKillPrize = parseFloat(document.getElementById('t-per-kill-prize').value || 0);
        const mode = document.getElementById('t-mode').value || 'solo';

        // Validate "mode" vs maxParticipants:
        if (mode === 'duo' && (maxParticipants % 2 !== 0)) {
            const remainder = maxParticipants % 2;
            showToast(`Duo requires max participants divisible by 2. Remainder: ${remainder}`, true);
            hideLoader();
            return;
        }
        if (mode === 'squad' && (maxParticipants % 4 !== 0)) {
            const remainder = maxParticipants % 4;
            showToast(`Squad requires max participants divisible by 4. Remainder: ${remainder}`, true);
            hideLoader();
            return;
        }
        // All good — create tournament
        const formData = {
            title,
            gameName,
            matchTime,
            entryFee,
            prizePool,
            commissionRate,
            status: 'Upcoming',
            roomId: '',
            roomPassword: '',
            maxParticipants,
            currentParticipants: 0,
            perKillEnabled: !!perKillEnabled,
            perKillPrize: perKillEnabled ? (isNaN(perKillPrize) ? 0 : perKillPrize) : 0,
            mode,
            createdAt: serverTimestamp()
        };

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

function loadManageTournamentView(tournamentId) {
    currentManagingTournament.id = tournamentId;
    navigateTo('manage-tournament-section');

    if (currentManagingTournament.unsub) currentManagingTournament.unsub();
    if (currentManagingTournament.unsubParts) currentManagingTournament.unsubParts();

    // Listen to tournament details
    const tDocRef = doc(db, "tournaments", tournamentId);
    currentManagingTournament.unsub = onSnapshot(tDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const t = docSnap.data();
            currentManagingTournament.prizePool = t.prizePool;
            currentManagingTournament.perKillEnabled = !!t.perKillEnabled;
            currentManagingTournament.perKillPrize = t.perKillPrize || 0;
            currentManagingTournament.mode = t.mode || 'solo';
            document.getElementById('manage-t-title').textContent = `Manage: ${t.title}`;
            document.getElementById('manage-t-room-id').value = t.roomId || '';
            document.getElementById('manage-t-room-pass').value = t.roomPassword || '';
            if (t.status === 'Completed') document.getElementById('declare-winner-form').classList.add('opacity-50', 'pointer-events-none');
            else document.getElementById('declare-winner-form').classList.remove('opacity-50', 'pointer-events-none');
        }
    });

    // Listen to participants
    const pCollRef = collection(db, "participants");
    const q = query(pCollRef, where("tournamentId", "==", tournamentId));
    currentManagingTournament.unsubParts = onSnapshot(q, (querySnapshot) => {
        const participants = [];
        querySnapshot.forEach(docSnap => participants.push({ id: docSnap.id, ...docSnap.data() }));
        renderManageParticipants(participants);

        // Build the declare/distribute UI depending on perKillEnabled
        // We'll build dynamic HTML directly here so admin can input kills per participant for per-kill mode,
        // or select a winner for normal mode.
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

async function handleUpdateRoomDetails(e) {
    e.preventDefault();
    if (!currentManagingTournament.id) return;
    const roomId = document.getElementById('manage-t-room-id').value;
    const roomPassword = document.getElementById('manage-t-room-pass').value;
    showLoader();
    try {
        const tDocRef = doc(db, "tournaments", currentManagingTournament.id);
        await updateDoc(tDocRef, { roomId, roomPassword, status: 'Live' });
        showToast("Room details updated. Tournament is now LIVE.", false);
    } catch (error) {
        console.error("Update room error:", error);
        showToast(error.message || 'Error updating room', true);
    } finally { hideLoader(); }
}

/**
 * Declare winner (supports per-kill or normal)
 */
async function handleDeclareWinner(e) {
    e.preventDefault();
    if (!currentManagingTournament.id) return;

    // Detect mode by form contents
    const form = document.getElementById('declare-winner-form');
    if (!form) return;

    // If per-kill: inputs with class kill-input exist
    const killInputs = form.querySelectorAll('.kill-input');
    if (killInputs && killInputs.length > 0 && currentManagingTournament.perKillEnabled) {
        // Same per-kill implementation as before — collect kills and commit batch
        // Validate inputs
        const killsMap = {};
        for (const inp of killInputs) {
            const pid = inp.dataset.participantId;
            if (!pid) { showToast('Invalid participant input.', true); return; }
            if (inp.value === '') { showToast('Enter kills for all participants.', true); return; }
            const k = parseInt(inp.value, 10);
            if (isNaN(k) || k < 0) { showToast('Kills must be non-negative integers.', true); return; }
            killsMap[pid] = k;
        }

        showLoader();
        try {
            const batch = writeBatch(db);
            const tRef = doc(db, "tournaments", currentManagingTournament.id);
            batch.update(tRef, { status: 'Completed' });

            // get participants
            const pColl = collection(db, "participants");
            const pSnap = await getDocs(query(pColl, where("tournamentId", "==", currentManagingTournament.id)));
            let maxKills = -1;
            const parts = [];
            pSnap.forEach(docSnap => {
                const data = docSnap.data();
                parts.push({ id: docSnap.id, ref: doc(db, "participants", docSnap.id), data });
                const k = killsMap[docSnap.id] || 0;
                if (k > maxKills) maxKills = k;
            });

            for (const p of parts) {
                const kills = killsMap[p.id] || 0;
                const amount = kills * (currentManagingTournament.perKillPrize || 0);
                const newStatus = (maxKills > 0 && kills === maxKills) ? 'Winner' : 'Completed';
                batch.update(p.ref, { status: newStatus, seenByUser: false, kills });
                if (amount > 0) {
                    const userRef = doc(db, "users", p.data.userId);
                    batch.update(userRef, { walletBalance: increment(amount) });
                    const txRef = doc(collection(db, "transactions"));
                    batch.set(txRef, {
                        userId: p.data.userId,
                        amount,
                        type: 'credit',
                        description: `Per-kill prize (${kills} kills) - ${p.data.username} - ${document.getElementById('manage-t-title').textContent}`,
                        createdAt: serverTimestamp()
                    });
                }
            }

            await batch.commit();
            showToast('Per-kill prizes distributed!', false);
            navigateTo('admin-dashboard-section');
        } catch (err) {
            console.error('Per-kill distribution error', err);
            showToast(err.message || 'Error distributing per-kill prizes', true);
        } finally { hideLoader(); }
        return;
    }

    // otherwise old winner selection flow
    const select = document.getElementById('participant-winner-select');
    if (!select) { showToast('No winner select found.', true); return; }
    const winnerUserId = select.value;
    if (!winnerUserId) { showToast('Please select a winner.', true); return; }

    showLoader();
    try {
        const batch = writeBatch(db);
        const tRef = doc(db, "tournaments", currentManagingTournament.id);

        // fetch prizePool from tournament
        const tSnap = await getDocs(query(collection(db, "tournaments"), where("__name__", "==", currentManagingTournament.id)));
        let prizePool = currentManagingTournament.prizePool || 0;
        // update winner wallet
        batch.update(doc(db, "users", winnerUserId), { walletBalance: increment(prizePool) });
        // transaction
        const txRef = doc(collection(db, "transactions"));
        batch.set(txRef, {
            userId: winnerUserId,
            amount: prizePool,
            type: 'credit',
            description: `Prize money for ${document.getElementById('manage-t-title').textContent}`,
            createdAt: serverTimestamp()
        });
        batch.update(tRef, { status: 'Completed' });

        // update participants statuses
        const pColl = collection(db, "participants");
        const pSnap = await getDocs(query(pColl, where("tournamentId", "==", currentManagingTournament.id)));
        pSnap.forEach(docSnap => {
            const pRef = doc(db, "participants", docSnap.id);
            if (docSnap.data().userId === winnerUserId) batch.update(pRef, { status: 'Winner', seenByUser: false });
            else batch.update(pRef, { status: 'Completed', seenByUser: false });
        });

        await batch.commit();
        showToast('Winner declared and prize distributed!', false);
        navigateTo('admin-dashboard-section');

    } catch (err) {
        console.error('Declare winner error', err);
        showToast(err.message || 'Error declaring winner', true);
    } finally { hideLoader(); }
}

export { initAdminUI }; // not strictly necessary but ok
