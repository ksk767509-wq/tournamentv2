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

let listeners = [];
let latestTournaments = [];
let joinedTournamentIds = new Set();
let latestJoinedTournaments = [];
let handlersAttached = false;

export function initUserListeners(userId) {
    clearUserListeners();
    latestTournaments = [];
    joinedTournamentIds = new Set();
    latestJoinedTournaments = [];

    const userDocRef = doc(db, "users", userId);
    const unsubWallet = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const userData = docSnap.data();
            window.currentUser = { uid: userId, ...userData };
            const balance = userData.walletBalance.toFixed(2);
            document.getElementById('header-wallet-amount').textContent = `₹${balance}`;
            document.getElementById('wallet-page-balance').textContent = `₹${balance}`;
        }
    });

    const tourneysRef = collection(db, "tournaments");
    const qTourneys = query(tourneysRef, where("status", "==", "Upcoming"), orderBy("matchTime", "asc"));
    const unsubTourneys = onSnapshot(qTourneys, (querySnapshot) => {
        const tournaments = [];
        querySnapshot.forEach(docSnap => tournaments.push({ id: docSnap.id, ...docSnap.data() }));
        latestTournaments = tournaments;
        renderHomeTournaments(latestTournaments, joinedTournamentIds);
        updateMyFightsDot();
    }, (error) => { console.error("Error loading tournaments:", error); showToast("Could not load tournaments.", true); });

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
            promises.push(getDoc(tDocRef).then(tDoc => { if (tDoc.exists()) joinedTournaments.push({ participant, tournament: { id: tDoc.id, ...tDoc.data() } }); }));
        });
        await Promise.all(promises);
        joinedTournaments.sort((a,b) => b.tournament.matchTime - a.tournament.matchTime);
        latestJoinedTournaments = joinedTournaments;
        renderMyTournaments(joinedTournaments);
        renderHomeTournaments(latestTournaments, joinedTournamentIds);
        updateMyFightsDot();
    }, (error) => { console.error("Error loading my tournaments:", error); showToast("Could not load your tournaments.", true); });

    const transactionsRef = collection(db, "transactions");
    const qTransactions = query(transactionsRef, where("userId", "==", userId), orderBy("createdAt", "desc"));
    const unsubTransactions = onSnapshot(qTransactions, (querySnapshot) => {
        const transactions = [];
        querySnapshot.forEach(docSnap => transactions.push({ id: docSnap.id, ...docSnap.data() }));
        renderTransactionHistory(transactions);
    }, (error) => { console.error("Error loading transactions:", error); showToast("Could not load transactions.", true); });

    listeners = [unsubWallet, unsubTourneys, unsubMyTournaments, unsubTransactions];

    if (!handlersAttached) {
        attachDelegatedHandlers();
        handlersAttached = true;
    }
}

export function clearUserListeners() {
    listeners.forEach(unsub => unsub());
    listeners = [];
}

/* UI initialization */
export function initUserUI(userData) {
    document.getElementById('profile-username').value = userData.username;
    document.getElementById('profile-email').value = userData.email;
    initWalletButtons();
    initProfileForms();
    initMyTournamentsTabs();
}

/* Delegated handlers: handle join flow via modals, copy, ok */
function attachDelegatedHandlers() {
    document.body.addEventListener('click', async (e) => {
        // JOIN button clicked -> open IGN modal
        const joinButton = e.target.closest('.join-btn');
        if (joinButton && !joinButton.disabled) {
            const tId = joinButton.dataset.id;
            const fee = parseFloat(joinButton.dataset.fee);
            const mode = joinButton.dataset.mode || 'solo';
            const max = parseInt(joinButton.dataset.max || '0', 10);
            openJoinIGNModal({ tournamentId: tId, entryFee: fee, mode, max });
            return;
        }

        // COPY button
        const copyBtn = e.target.closest('.copy-btn');
        if (copyBtn) {
            const toCopy = copyBtn.dataset.copy || '';
            if (toCopy) {
                navigator.clipboard.writeText(toCopy).then(()=> showToast('Copied to clipboard.')).catch(()=> {
                    try {
                        const ta = document.createElement('textarea'); ta.value = toCopy; ta.style.position='fixed'; ta.style.left='-9999px';
                        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                        showToast('Copied to clipboard.');
                    } catch (err) { console.error('Copy fail', err); showToast('Could not copy.', true); }
                });
            } else showToast('Nothing to copy.', true);
            return;
        }

        // OK button (mark seen)
        const okBtn = e.target.closest('.ok-btn');
        if (okBtn) {
            const pid = okBtn.dataset.participantId;
            if (pid) markParticipantSeen(pid);
            return;
        }
    }, { passive: false });

    // JOIN modal button handlers
    document.getElementById('join-ign-next').addEventListener('click', () => {
        const ign = document.getElementById('join-ign-input').value.trim();
        const payloadStr = document.getElementById('join-ign-modal').dataset.payload;
        if (!payloadStr) { showToast('Missing tournament info', true); closeJoinIGNModal(); return; }
        const payload = JSON.parse(payloadStr);
        if (!ign) { showToast('Enter In-game name', true); return; }
        payload.ign = ign;
        closeJoinIGNModal();
        openJoinSlotModal(payload);
    });
    document.getElementById('join-ign-cancel').addEventListener('click', closeJoinIGNModal);

    // Slot modal handlers
    document.getElementById('join-slot-cancel').addEventListener('click', closeJoinSlotModal);
    document.getElementById('join-confirm-btn').addEventListener('click', async () => {
        const payloadStr = document.getElementById('join-slot-modal').dataset.payload;
        if (!payloadStr) { showToast('Missing data', true); closeJoinSlotModal(); return; }
        const payload = JSON.parse(payloadStr);
        const selected = document.querySelector('#join-slot-container input[name="slot-select"]:checked');
        if (!selected) { showToast('Select a slot', true); return; }
        const slotIndex = parseInt(selected.value, 10);
        closeJoinSlotModal();
        // call join with slot and ign
        await handleJoinTournament(payload.tournamentId, payload.entryFee, { ign: payload.ign, slot: slotIndex });
    });
}

/* Modal helpers */
function openJoinIGNModal(payload) {
    document.getElementById('join-ign-input').value = '';
    const m = document.getElementById('join-ign-modal');
    m.dataset.payload = JSON.stringify(payload);
    document.getElementById('join-ign-title').textContent = 'Join Tournament';
    document.getElementById('join-ign-sub').textContent = 'Enter your In-game Name';
    m.classList.remove('hidden');
}
function closeJoinIGNModal() { document.getElementById('join-ign-modal').classList.add('hidden'); document.getElementById('join-ign-modal').removeAttribute('data-payload'); }

async function openJoinSlotModal(payload) {
    // payload: { tournamentId, entryFee, mode, max, ign }
    const container = document.getElementById('join-slot-container');
    container.innerHTML = '<p class="text-gray-400">Loading slots...</p>';
    const modal = document.getElementById('join-slot-modal');
    modal.dataset.payload = JSON.stringify(payload);
    document.getElementById('join-slot-title').textContent = 'Choose Slot';
    document.getElementById('join-slot-sub').textContent = 'Pick an available slot / team position';

    // fetch participants for this tournament to see taken slots
    try {
        const pColl = collection(db, "participants");
        const pSnap = await getDocs(query(pColl, where("tournamentId", "==", payload.tournamentId)));
        const takenSlots = new Set();
        pSnap.forEach(snap => { const data = snap.data(); if (data.slot) takenSlots.add(data.slot); });

        // Build slot UI depending on mode
        const max = parseInt(payload.max || 0, 10) || 0;
        container.innerHTML = ''; // clear
        const mode = payload.mode || 'solo';

        if (mode === 'solo') {
            // Show slots 1..max as selectable items
            for (let i = 1; i <= max; i++) {
                const isTaken = takenSlots.has(i);
                const color = isTaken ? 'bg-gray-600 text-gray-400' : 'bg-gray-700 text-white';
                const el = document.createElement('label');
                el.className = `flex items-center justify-between p-3 rounded ${isTaken ? 'opacity-60' : 'hover:bg-gray-600 cursor-pointer'} `;
                el.innerHTML = `<div class="text-sm">Slot #${i}</div>
                    <input type="radio" name="slot-select" value="${i}" ${isTaken ? 'disabled' : ''} />`;
                container.appendChild(el);
            }
        } else {
            // duo -> teams (max/2 teams) each with 2 slots, squad -> teams (max/4) each with 4 slots
            const teamSize = mode === 'duo' ? 2 : 4;
            const teams = Math.floor(max / teamSize);
            for (let t=1; t<=teams; t++) {
                const teamDiv = document.createElement('div');
                teamDiv.className = 'bg-gray-800 p-2 rounded mb-2';
                const header = document.createElement('div');
                header.className = 'text-sm text-gray-300 mb-2';
                header.textContent = `Team ${t}`;
                teamDiv.appendChild(header);

                const slotsWrap = document.createElement('div');
                slotsWrap.className = 'grid grid-cols-2 gap-2';
                for (let s=1; s<=teamSize; s++) {
                    const slotIndex = (t-1)*teamSize + s;
                    const isTaken = takenSlots.has(slotIndex);
                    const el = document.createElement('label');
                    el.className = `flex items-center justify-between p-2 rounded ${isTaken ? 'opacity-60' : 'hover:bg-gray-600 cursor-pointer'}`;
                    el.innerHTML = `<div class="text-sm">#${slotIndex}</div><input type="radio" name="slot-select" value="${slotIndex}" ${isTaken ? 'disabled' : ''} />`;
                    slotsWrap.appendChild(el);
                }
                teamDiv.appendChild(slotsWrap);
                container.appendChild(teamDiv);
            }
        }

        // enable/disable confirm button based on radio selection
        const confirmBtn = document.getElementById('join-confirm-btn');
        confirmBtn.disabled = true;
        modal.classList.remove('hidden');

        // delegate change
        container.querySelectorAll('input[name="slot-select"]').forEach(i => {
            i.addEventListener('change', () => {
                confirmBtn.disabled = false;
            });
        });

    } catch (err) {
        console.error('Error loading slots', err);
        container.innerHTML = '<p class="text-red-400">Could not load slots.</p>';
    }
}

function closeJoinSlotModal() {
    const modal = document.getElementById('join-slot-modal');
    modal.classList.add('hidden');
    modal.removeAttribute('data-payload');
    document.getElementById('join-slot-container').innerHTML = '';
    document.getElementById('join-confirm-btn').disabled = true;
}

/* mark participant seen (ok button) */
async function markParticipantSeen(participantId) {
    showLoader();
    try {
        const pRef = doc(db, "participants", participantId);
        await updateDoc(pRef, { seenByUser: true });
        // optimistic UI update: rerender local cache
        latestJoinedTournaments = latestJoinedTournaments.map(item => {
            if (item.participant && item.participant.id === participantId) {
                return { participant: { ...item.participant, seenByUser: true }, tournament: item.tournament };
            }
            return item;
        });
        renderMyTournaments(latestJoinedTournaments);
        updateMyFightsDot();
        showToast('Marked as seen.', false);
    } catch (err) {
        console.error('Mark seen failed', err);
        showToast('Could not mark as seen.', true);
    } finally { hideLoader(); }
}

/**
 * JOIN tournament with optional slot & ign
 * - pre-check slot availability
 * - then transaction to debit and create participant with slot and username
 */
async function handleJoinTournament(tournamentId, entryFee, options = {}) {
    showLoader();
    const user = auth.currentUser;
    if (!user) { showToast('Login required.', true); hideLoader(); return; }
    const userId = user.uid;
    const ign = (options.ign || user.displayName || '').trim() || '';
    const slot = options.slot || null;

    try {
        // pre-check: participant duplicate
        const alreadyQ = query(collection(db, "participants"), where("userId","==",userId), where("tournamentId","==",tournamentId));
        const alreadySnap = await getDocs(alreadyQ);
        if (!alreadySnap.empty) { showToast('You have already joined this tournament.', true); hideLoader(); return; }

        // pre-check slot if slot provided
        if (slot) {
            const slotQ = query(collection(db, "participants"), where("tournamentId","==",tournamentId), where("slot","==",slot));
            const slotSnap = await getDocs(slotQ);
            if (!slotSnap.empty) { showToast('Selected slot already taken. Please choose another.', true); hideLoader(); return; }
        }

        // fetch tournament doc
        const tRef = doc(db, "tournaments", tournamentId);
        const tSnap = await getDoc(tRef);
        if (!tSnap.exists()) { showToast('Tournament not found.', true); hideLoader(); return; }
        const tData = tSnap.data();
        if (tData.status !== 'Upcoming') { showToast('Tournament is no longer available.', true); hideLoader(); return; }

        const userRef = doc(db, "users", userId);
        // run transaction to debit and create participant and increment currentParticipants
        await runTransaction(db, async (transaction) => {
            const uDoc = await transaction.get(userRef);
            if (!uDoc.exists()) throw new Error('User doc missing');

            const wallet = uDoc.data().walletBalance;
            if (wallet < entryFee) throw new Error('Insufficient Balance');

            // double-check tournament doc within transaction
            const tDocTx = await transaction.get(tRef);
            if (!tDocTx.exists()) throw new Error('Tournament not found in tx');
            if (tDocTx.data().status !== 'Upcoming') throw new Error('Tournament is not open');
            const max = tDocTx.data().maxParticipants || 0;
            const current = typeof tDocTx.data().currentParticipants === 'number' ? tDocTx.data().currentParticipants : 0;
            if (current >= max) throw new Error('Tournament is full');

            // if slot specified, ensure slot still free by doing a getDocs (not ideal in tx) — do a last-minute pre-check by reading participants collection outside transaction earlier, we already did that.
            // perform writes
            transaction.update(userRef, { walletBalance: wallet - entryFee });

            // create participant doc with slot and ign
            const partRef = doc(collection(db, "participants"));
            transaction.set(partRef, {
                userId,
                username: ign || (uDoc.data().username || 'Player'),
                tournamentId,
                status: 'Joined',
                joinedAt: serverTimestamp(),
                slot: slot || null
            });

            // create transaction doc
            const txRef = doc(collection(db, "transactions"));
            transaction.set(txRef, {
                userId,
                amount: entryFee,
                type: 'debit',
                description: `Entry fee for ${tDocTx.data().title}`,
                createdAt: serverTimestamp()
            });

            // increment tournament currentParticipants
            transaction.update(tRef, { currentParticipants: (current + 1) });
        });

        showToast('Joined tournament successfully!', false);
    } catch (err) {
        console.error('Join error', err);
        showToast(err.message || 'Could not join tournament', true);
    } finally { hideLoader(); }
}

/* Wallet, profile forms, tabs (unchanged) */
function initWalletButtons() {
    document.getElementById('add-money-btn').addEventListener('click', () => handleSimulatedTransaction(100, 'credit', 'Simulated deposit'));
    document.getElementById('withdraw-money-btn').addEventListener('click', () => handleSimulatedTransaction(50, 'debit', 'Simulated withdrawal'));
}

async function handleSimulatedTransaction(amount, type, description) {
    const user = auth.currentUser;
    if (!user) return;
    showLoader();
    const userRef = doc(db, "users", user.uid);
    const transactionRef = doc(collection(db, "transactions"));
    try {
        const newBalance = type === 'credit' ? increment(amount) : increment(-amount);
        if (type === 'debit' && window.currentUser.walletBalance < amount) throw new Error('Insufficient funds for withdrawal.');
        const batch = writeBatch(db);
        batch.update(userRef, { walletBalance: newBalance });
        batch.set(transactionRef, { userId: user.uid, amount, type, description, createdAt: serverTimestamp() });
        await batch.commit();
        showToast('Transaction successful.', false);
    } catch (err) { console.error(err); showToast(err.message || 'Transaction failed', true); } finally { hideLoader(); }
}

function initProfileForms() {
    document.getElementById('profile-update-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const newUsername = document.getElementById('profile-username').value;
        if (newUsername === window.currentUser.username) return;
        showLoader();
        try { await updateDoc(doc(db, "users", auth.currentUser.uid), { username: newUsername }); showToast('Username updated successfully.', false); }
        catch (err) { console.error(err); showToast(err.message || 'Could not update username', true); } finally { hideLoader(); }
    });

    document.getElementById('password-change-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const newPassword = document.getElementById('profile-new-password').value;
        handleChangePassword(newPassword);
    });
}

function initMyTournamentsTabs() {
    const tabs = document.querySelectorAll('#my-tournaments-tabs .tab-btn');
    const contents = document.querySelectorAll('#my-tournaments-content .tab-content');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => { t.classList.remove('text-indigo-400','border-indigo-400','active'); t.classList.add('text-gray-400','border-transparent'); });
            contents.forEach(c => c.classList.add('hidden'));
            tab.classList.add('text-indigo-400','border-indigo-400','active'); tab.classList.remove('text-gray-400','border-transparent');
            document.getElementById(`tab-content-${tab.dataset.tab}`).classList.remove('hidden');
        });
    });
}

/* My Fights dot logic unchanged but respects status/roomId/seenByUser */
function updateMyFightsDot() {
    const dot = document.getElementById('my-fights-dot');
    if (!dot) return;
    let hasRed=false, hasYellow=false, hasGreen=false;
    for (const item of latestJoinedTournaments) {
        const t = item.tournament||{};
        const p = item.participant||{};
        if (t.status === 'Live' && t.roomId && t.roomPassword) { hasRed = true; break; }
        if (t.status === 'Upcoming' || t.status === 'Live') hasYellow = true;
        if ((t.status === 'Completed' || p.status === 'Completed' || p.status === 'Winner') && p.seenByUser !== true) hasGreen = true;
    }
    dot.classList.remove('bg-red-600','bg-yellow-400','bg-green-400','animate-pulse','ring-red-400');
    if (hasRed) { dot.classList.add('bg-red-600','animate-pulse','ring-red-400'); dot.classList.remove('hidden'); }
    else if (hasYellow) { dot.classList.add('bg-yellow-400'); dot.classList.remove('hidden'); }
    else if (hasGreen) { dot.classList.add('bg-green-400'); dot.classList.remove('hidden'); }
    else dot.classList.add('hidden');
}
