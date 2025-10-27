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
    updateDoc
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

            if (t.status === 'Completed') {
                prize += t.prizePool || 0;
            }
            const commission = (t.commissionRate / 100) || 0.2;
            const totalEntry = (t.prizePool || 0) / (1 - commission || 1);
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
    document.getElementById('create-tournament-form').addEventListener('submit', handleCreateTournament);

    document.getElementById('admin-tournaments-list').addEventListener('click', (e) => {
        const manageBtn = e.target.closest('.manage-t-btn');
        if (manageBtn) {
            loadManageTournamentView(manageBtn.dataset.id);
        }
    });

    document.getElementById('update-room-form').addEventListener('submit', handleUpdateRoomDetails);
    document.getElementById('declare-winner-form').addEventListener('submit', handleDeclareWinner);

    // input for kill inputs to enable/disable distribute button etc handled in ui.js previously
}

/**
 * Handles creation of a new tournament.
 */
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
        const maxParticipants = parseInt(document.getElementById('t-max-participants').value, 10);
        const mode = document.getElementById('t-mode').value || 'solo';
        const perKillEnabled = document.getElementById('t-per-kill-toggle').checked;
        const perKillPrize = perKillEnabled ? parseFloat(document.getElementById('t-per-kill-prize').value || 0) : 0;

        if (!title || !gameName || isNaN(matchTime.getTime())) {
            showToast('Please fill required fields.', true);
            hideLoader();
            return;
        }

        // Validate mode constraints
        let teamSize = 1;
        if (mode === 'duo') teamSize = 2;
        else if (mode === 'squad') teamSize = 4;

        if (mode === 'duo' && (maxParticipants % 2 !== 0)) {
            showToast('For Duo, max participants must be divisible by 2.', true);
            hideLoader();
            return;
        }
        if (mode === 'squad' && (maxParticipants % 4 !== 0)) {
            showToast('For Squad, max participants must be divisible by 4.', true);
            hideLoader();
            return;
        }

        // Build slots array: layout B -> teams as list with numbered slots
        const teams = Math.floor(maxParticipants / teamSize);
        const slots = [];
        let slotCounter = 1;
        for (let team = 1; team <= teams; team++) {
            for (let s = 1; s <= teamSize; s++) {
                slots.push({
                    slotIndex: slotCounter,
                    teamIndex: team,
                    userId: null,
                    participantId: null,
                    ign: null
                });
                slotCounter++;
            }
        }

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
            perKillPrize: perKillPrize || 0,
            mode,
            teamSize,
            slots,
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
 * Loads manage view and listens for updates.
 */
function loadManageTournamentView(tournamentId) {
    currentManagingTournament.id = tournamentId;
    navigateTo('manage-tournament-section');

    if (currentManagingTournament.unsub) currentManagingTournament.unsub();
    if (currentManagingTournament.unsubParts) currentManagingTournament.unsubParts();

    const tDocRef = doc(db, "tournaments", tournamentId);
    currentManagingTournament.unsub = onSnapshot(tDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const t = docSnap.data();
            currentManagingTournament.prizePool = t.prizePool;
            currentManagingTournament.perKillEnabled = !!t.perKillEnabled;
            currentManagingTournament.perKillPrize = t.perKillPrize || 0;
            document.getElementById('manage-t-title').textContent = `Manage: ${t.title}`;
            document.getElementById('manage-t-room-id').value = t.roomId || '';
            document.getElementById('manage-t-room-pass').value = t.roomPassword || '';

            if (t.status === 'Completed') {
                document.getElementById('declare-winner-form').classList.add('opacity-50', 'pointer-events-none');
            } else {
                document.getElementById('declare-winner-form').classList.remove('opacity-50', 'pointer-events-none');
            }
        }
    });

    const pCollRef = collection(db, "participants");
    const q = query(pCollRef, where("tournamentId", "==", tournamentId));
    currentManagingTournament.unsubParts = onSnapshot(q, (querySnapshot) => {
        const participants = [];
        querySnapshot.forEach(docSnap => {
            participants.push({ id: docSnap.id, ...docSnap.data() });
        });
        renderManageParticipants(participants);

        // Use latest snapshot values to render declare form (participants + tournament meta)
        // get latest tournament data:
        getDocs(query(collection(db, "tournaments"), where("__name__", "==", tournamentId))).then(() => {
            // Use currentManagingTournament values (populated by snapshot)
            const tournamentData = {
                id: currentManagingTournament.id,
                title: document.getElementById('manage-t-title').textContent.replace('Manage: ', '') || '',
                perKillEnabled: currentManagingTournament.perKillEnabled,
                perKillPrize: currentManagingTournament.perKillPrize || 0
            };
            renderDeclareWinnerForm(participants, tournamentData);
        }).catch(() => {
            const tournamentData = {
                id: currentManagingTournament.id,
                title: document.getElementById('manage-t-title').textContent.replace('Manage: ', '') || '',
                perKillEnabled: currentManagingTournament.perKillEnabled,
                perKillPrize: currentManagingTournament.perKillPrize || 0
            };
            renderDeclareWinnerForm(participants, tournamentData);
        });
    });
}

/**
 * Update room details -> set LIVE
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
        showToast(error.message, true);
    } finally {
        hideLoader();
    }
}

/**
 * Handles declare winner or per-kill distribution.
 * (This function intentionally supports both modes and mirrors earlier behavior.)
 */
async function handleDeclareWinner(e) {
    e.preventDefault();
    if (!currentManagingTournament.id) return;

    // fetch tournament doc snapshot to know mode/perKill etc
    const tRef = doc(db, "tournaments", currentManagingTournament.id);
    try {
        const tSnap = await tRef.get?.();
    } catch (err) {
        // ignore - we'll read via getDocs fallback below where needed
    }

    // Determine if perKill mode using stored snapshot
    const perKillEnabled = currentManagingTournament.perKillEnabled;
    const perKillPrize = currentManagingTournament.perKillPrize || 0;

    if (perKillEnabled) {
        // per-kill distribution handled earlier in previous version of admin-data.js
        // We'll reuse existing flow by calling a helper: the form UI will contain kill inputs and distribute button
        // But we will gather values from DOM and perform batched writes similar to previous implementation.

        const form = document.getElementById('declare-winner-form');
        if (!form) {
            showToast('Declare form not available.', true);
            return;
        }
        const inputs = Array.from(form.querySelectorAll('.kill-input'));
        if (inputs.length === 0) {
            showToast('No participants found for distribution.', true);
            return;
        }

        // collect kills - ensure filled
        const killsMap = {};
        for (const inp of inputs) {
            const pid = inp.dataset.participantId;
            const raw = inp.value;
            if (raw === '' || raw === null || raw === undefined) {
                showToast('Please enter kills for every participant.', true);
                return;
            }
            const kv = parseInt(raw, 10);
            if (isNaN(kv) || kv < 0) {
                showToast('Kills must be non-negative integer.', true);
                return;
            }
            killsMap[pid] = kv;
        }

        showLoader();
        try {
            const batch = writeBatch(db);

            // update tournament -> status Completed
            const tDocRef = doc(db, "tournaments", currentManagingTournament.id);
            batch.update(tDocRef, { status: 'Completed' });

            // gather participants for tournament
            const pCollRef = collection(db, "participants");
            const pSnap = await getDocs(query(pCollRef, where("tournamentId", "==", currentManagingTournament.id)));

            // compute maxKills
            let maxKills = -1;
            const participantDocs = [];
            pSnap.forEach(pDoc => {
                participantDocs.push({ id: pDoc.id, ref: doc(db, "participants", pDoc.id), data: pDoc.data() });
                const k = killsMap[pDoc.id] || 0;
                if (k > maxKills) maxKills = k;
            });

            // process each participant
            for (const p of participantDocs) {
                const pid = p.id;
                const pdata = p.data;
                const kills = killsMap[pid] || 0;
                const amount = kills * perKillPrize;
                const newStatus = (maxKills > 0 && kills === maxKills) ? 'Winner' : 'Completed';
                batch.update(p.ref, { status: newStatus, seenByUser: false, kills });

                // credit user if amount > 0
                if (amount > 0) {
                    const userRef = doc(db, "users", pdata.userId);
                    batch.update(userRef, { walletBalance: increment(amount) });

                    const txRef = doc(collection(db, "transactions"));
                    batch.set(txRef, {
                        userId: pdata.userId,
                        amount,
                        type: 'credit',
                        description: `Per-kill prize (${kills} kills) - ${pdata.username} - ${document.getElementById('manage-t-title').textContent}`,
                        createdAt: serverTimestamp()
                    });
                }
            }

            await batch.commit();
            showToast('Per-kill prizes distributed!', false);
            navigateTo('admin-dashboard-section');
        } catch (err) {
            console.error('Per-kill distribution error:', err);
            showToast(err.message || 'Error distributing per-kill prizes.', true);
        } finally {
            hideLoader();
        }
    } else {
        // old workflow: select winner from dropdown
        const select = document.getElementById('participant-winner-select');
        if (!select) {
            showToast('Winner select not found.', true);
            return;
        }
        const winnerUserId = select.value;
        if (!winnerUserId) {
            showToast('Please select a winner.', true);
            return;
        }

        showLoader();
        try {
            const batch = writeBatch(db);

            const tournamentRef = doc(db, "tournaments", currentManagingTournament.id);
            // read prizePool from doc
            const tDocs = await getDocs(query(collection(db, "tournaments"), where("__name__", "==", currentManagingTournament.id)));
            // fallback to stored
            const prizePool = currentManagingTournament.prizePool || (tDocs.docs[0] ? (tDocs.docs[0].data().prizePool || 0) : 0);

            // credit winner
            const winnerUserRef = doc(db, "users", winnerUserId);
            batch.update(winnerUserRef, { walletBalance: increment(prizePool) });

            // transaction
            const txRef = doc(collection(db, "transactions"));
            batch.set(txRef, {
                userId: winnerUserId,
                amount: prizePool,
                type: 'credit',
                description: `Prize money for ${document.getElementById('manage-t-title').textContent}`,
                createdAt: serverTimestamp()
            });

            // update tournament status and participants
            batch.update(tournamentRef, { status: 'Completed' });

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
        } catch (err) {
            console.error('Declare winner error:', err);
            showToast(err.message || 'Error declaring winner.', true);
        } finally {
            hideLoader();
        }
    }
        }
