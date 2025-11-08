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
import { showLoader, hideLoader, showToast, renderHomeTournaments, renderMyTournaments, renderTransactionHistory, showTournamentDetailScreen, hideTournamentDetailScreen, renderMySlotPopup, hideMySlotPopup, formatDateTime12 } from "./ui.js";
import { handleChangePassword } from "./auth.js";

let listeners = [];
let latestTournaments = [];
let joinedTournamentIds = new Set();
let latestJoinedTournaments = [];
let handlersAttached = false;

/* Initialize listeners (wallet, tournaments, participants, transactions) */
export function initUserListeners(userId) {
    clearUserListeners();
    latestTournaments = [];
    latestJoinedTournaments = [];
    joinedTournamentIds = new Set();

    const userDocRef = doc(db, "users", userId);
    const unsubWallet = onSnapshot(userDocRef, (docSnap) => {
        if (docSnap.exists()) {
            const userData = docSnap.data();
            window.currentUser = { uid: userId, ...userData };
            const balance = (userData.walletBalance || 0).toFixed(2);
            document.getElementById('header-wallet-amount').textContent = `₹${balance}`;
            document.getElementById('wallet-page-balance').textContent = `₹${balance}`;
        }
    });

    const tourneysRef = collection(db, "tournaments");
    const qTourneys = query(tourneysRef, orderBy("matchTime", "asc"));
    const unsubTourneys = onSnapshot(qTourneys, (querySnapshot) => {
        const tournaments = [];
        querySnapshot.forEach(docSnap => tournaments.push({ id: docSnap.id, ...docSnap.data() }));
        latestTournaments = tournaments.filter(t => t.status === 'Upcoming' || t.status === 'Live' || t.status === 'Completed');
        const upcoming = latestTournaments.filter(t => t.status === 'Upcoming');
        renderHomeTournaments(upcoming, joinedTournamentIds);
        updateMyFightsDot();
    }, (error) => {
        console.error("Error loading tournaments:", error);
        showToast("Could not load tournaments.", true);
    });

    const participantsRef = collection(db, "participants");
    const qMyTournaments = query(participantsRef, where("userId", "==", userId));
    const unsubMyTournaments = onSnapshot(qMyTournaments, async (querySnapshot) => {
        const joined = [];
        const promises = [];
        joinedTournamentIds = new Set();
        querySnapshot.forEach((pDoc) => {
            const participant = { id: pDoc.id, ...pDoc.data() };
            if (participant.tournamentId) joinedTournamentIds.add(participant.tournamentId);
            const tDocRef = doc(db, "tournaments", participant.tournamentId);
            promises.push(getDoc(tDocRef).then(tDoc => { if (tDoc.exists()) joined.push({ participant, tournament: { id: tDoc.id, ...tDoc.data() } }); }));
        });
        await Promise.all(promises);
        // sort by matchTime desc
        joined.sort((a,b) => {
            const at = a.tournament.matchTime ? (a.tournament.matchTime.toDate ? a.tournament.matchTime.toDate().getTime() : new Date(a.tournament.matchTime).getTime()) : 0;
            const bt = b.tournament.matchTime ? (b.tournament.matchTime.toDate ? b.tournament.matchTime.toDate().getTime() : new Date(b.tournament.matchTime).getTime()) : 0;
            return bt - at;
        });
        latestJoinedTournaments = joined;
        renderMyTournaments(joined);
        const upcoming = latestTournaments.filter(t => t.status === 'Upcoming');
        renderHomeTournaments(upcoming, joinedTournamentIds);
        updateMyFightsDot();
    }, (error) => {
        console.error("Error loading my tournaments:", error);
        showToast("Could not load your tournaments.", true);
    });

    const transactionsRef = collection(db, "transactions");
    const qTransactions = query(transactionsRef, where("userId", "==", userId), orderBy("createdAt", "desc"));
    const unsubTransactions = onSnapshot(qTransactions, (querySnapshot) => {
        const transactions = [];
        querySnapshot.forEach(docSnap => transactions.push({ id: docSnap.id, ...docSnap.data() }));
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

/* Clear all listeners */
export function clearUserListeners() {
    listeners.forEach(unsub => unsub());
    listeners = [];
}

/* UI init for profile and others */
export function initUserUI(userData) {
    document.getElementById('profile-username').value = userData.username;
    document.getElementById('profile-email').value = userData.email;
    initWalletButtons();
    initProfileForms();
    initMyTournamentsTabs();
}

/* Delegated event handler for page - join, copy, ok, tourney-card click, detail-screen controls */
function attachDelegatedHandlers() {
    document.body.addEventListener('click', async (e) => {
        // Join button clicked (outside cards)
        const joinButton = e.target.closest('.join-btn');
        if (joinButton && !joinButton.disabled) {
            const tId = joinButton.dataset.id;
            const fee = parseFloat(joinButton.dataset.fee);
            const mode = joinButton.dataset.mode || 'solo';
            const max = parseInt(joinButton.dataset.max || '0', 10);
            openJoinIGNModal({ tournamentId: tId, entryFee: fee, mode, max });
            return;
        }

        // Copy buttons
        const copyBtn = e.target.closest('.copy-btn');
        if (copyBtn) {
            const toCopy = copyBtn.dataset.copy || '';
            if (toCopy) {
                // Primary: navigator.clipboard
                navigator.clipboard.writeText(toCopy).then(()=> showToast('Copied to clipboard.')).catch(()=> {
                    // Fallback: create textarea with allow-select so global select blocker won't block programmatic selection
                    try {
                        const ta = document.createElement('textarea');
                        ta.value = toCopy;
                        ta.classList.add('allow-select');
                        ta.style.position = 'fixed';
                        ta.style.left = '-9999px';
                        ta.style.top = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        showToast('Copied to clipboard.');
                    } catch (err) {
                        console.error('Copy fail', err);
                        showToast('Could not copy.', true);
                    }
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

        // Click on a tournament card (open full-screen detail)
        const card = e.target.closest('.tourney-card');
        if (card) {
            const tid = card.dataset.tid;
            if (tid) {
                openTournamentDetailScreen(tid);
            }
            return;
        }
    }, { passive: false });

    /* Join modal handlers */
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

    document.getElementById('join-slot-cancel').addEventListener('click', closeJoinSlotModal);
    document.getElementById('join-confirm-btn').addEventListener('click', async () => {
        const payloadStr = document.getElementById('join-slot-modal').dataset.payload;
        if (!payloadStr) { showToast('Missing data', true); closeJoinSlotModal(); return; }
        const payload = JSON.parse(payloadStr);
        const selected = document.querySelector('#join-slot-container input[name="slot-select"]:checked');
        if (!selected) { showToast('Select a slot', true); return; }
        const slotIndex = parseInt(selected.value, 10);
        closeJoinSlotModal();
        await handleJoinTournament(payload.tournamentId, payload.entryFee, { ign: payload.ign, slot: slotIndex });
    });

    /* Detail screen controls: back, show participants, my-slot, join, my-slot popup close */
    document.getElementById('detail-back').addEventListener('click', () => {
        hideTournamentDetailScreen();
    });

    document.getElementById('detail-show-participants').addEventListener('click', (e) => {
        const list = document.getElementById('detail-participants-list');
        const btn = document.getElementById('detail-show-participants');
        if (list.classList.contains('hidden')) {
            list.classList.remove('hidden');
            btn.textContent = 'Hide Participants';
        } else {
            list.classList.add('hidden');
            btn.textContent = 'Show Participants';
        }
    });

    document.getElementById('detail-my-slot-btn').addEventListener('click', () => {
        const screen = document.getElementById('tournament-detail-screen');
        const participantsJson = screen.dataset.participants || '[]';
        const participants = JSON.parse(participantsJson);
        const curUser = auth.currentUser ? auth.currentUser.uid : null;
        const myPart = participants.find(p => p.userId === curUser);
        if (!myPart) {
            renderMySlotPopup(null, []);
            return;
        }
        const tournamentMode = screen.dataset.mode || 'solo';
        const slotNum = myPart.slot ? parseInt(myPart.slot, 10) : null;
        let teammates = [];
        if (slotNum) {
            if (tournamentMode === 'solo') {
                teammates = [];
            } else {
                const teamSize = tournamentMode === 'duo' ? 2 : 4;
                const teamNo = Math.ceil(slotNum / teamSize);
                teammates = participants.filter(p => {
                    if (!p.slot) return false;
                    const s = parseInt(p.slot, 10);
                    return Math.ceil(s / teamSize) === teamNo && p.userId !== curUser;
                });
            }
        }
        renderMySlotPopup(myPart, teammates);
    });

    document.getElementById('my-slot-close').addEventListener('click', () => {
        hideMySlotPopup();
    });

    // Join button inside detail screen should open the IGN -> slot flow
    document.getElementById('detail-join-btn').addEventListener('click', () => {
        const screen = document.getElementById('tournament-detail-screen');
        const tid = screen.dataset.tid;
        const tournament = latestTournaments.find(t => t.id === tid) || null;
        const fee = tournament ? (tournament.entryFee || 0) : 0;
        const max = tournament ? (tournament.maxParticipants || 0) : 0;
        openJoinIGNModal({ tournamentId: tid, entryFee: fee, mode: tournament ? (tournament.mode || 'solo') : 'solo', max });
    });
}

/* ---------------- Modal helpers for Join (unchanged) ---------------- */
function openJoinIGNModal(payload) {
    document.getElementById('join-ign-input').value = '';
    const m = document.getElementById('join-ign-modal');
    m.dataset.payload = JSON.stringify(payload);
    document.getElementById('join-ign-title').textContent = 'Join Tournament';
    document.getElementById('join-ign-sub').textContent = 'Enter your In-game Name';
    m.classList.remove('hidden');
}
function closeJoinIGNModal() { const m = document.getElementById('join-ign-modal'); m.classList.add('hidden'); m.removeAttribute('data-payload'); }

async function openJoinSlotModal(payload) {
    const container = document.getElementById('join-slot-container');
    container.innerHTML = '<p class="text-gray-400">Loading slots...</p>';
    const modal = document.getElementById('join-slot-modal');
    modal.dataset.payload = JSON.stringify(payload);
    document.getElementById('join-slot-title').textContent = 'Choose Slot';
    document.getElementById('join-slot-sub').textContent = 'Pick an available slot / team position';

    try {
        const pColl = collection(db, "participants");
        const pSnap = await getDocs(query(pColl, where("tournamentId", "==", payload.tournamentId)));
        const takenSlots = new Set();
        pSnap.forEach(snap => { const data = snap.data(); if (data.slot) takenSlots.add(String(data.slot)); });

        const max = parseInt(payload.max || 0, 10) || 0;
        container.innerHTML = '';
        const mode = payload.mode || 'solo';

        if (mode === 'solo') {
            for (let i = 1; i <= max; i++) {
                const isTaken = takenSlots.has(String(i));
                const el = document.createElement('label');
                el.className = `flex items-center justify-between p-3 rounded ${isTaken ? 'opacity-60' : 'hover:bg-gray-600 cursor-pointer'}`;
                el.innerHTML = `<div class="text-sm">Slot #${i}</div><input type="radio" name="slot-select" value="${i}" ${isTaken ? 'disabled' : ''} />`;
                container.appendChild(el);
            }
        } else {
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
                    const isTaken = takenSlots.has(String(slotIndex));
                    const el = document.createElement('label');
                    el.className = `flex items-center justify-between p-2 rounded ${isTaken ? 'opacity-60' : 'hover:bg-gray-600 cursor-pointer'}`;
                    el.innerHTML = `<div class="text-sm">#${slotIndex}</div><input type="radio" name="slot-select" value="${slotIndex}" ${isTaken ? 'disabled' : ''} />`;
                    slotsWrap.appendChild(el);
                }
                teamDiv.appendChild(slotsWrap);
                container.appendChild(teamDiv);
            }
        }

        const confirmBtn = document.getElementById('join-confirm-btn');
        confirmBtn.disabled = true;
        modal.classList.remove('hidden');

        container.querySelectorAll('input[name="slot-select"]').forEach(i => {
            i.addEventListener('change', () => { confirmBtn.disabled = false; });
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

/* mark participant seen */
async function markParticipantSeen(participantId) {
    showLoader();
    try {
        const pRef = doc(db, "participants", participantId);
        await updateDoc(pRef, { seenByUser: true });
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

/* JOIN flow using transaction - updated to accept slot & ign */
async function handleJoinTournament(tournamentId, entryFee, options = {}) {
    showLoader();
    const user = auth.currentUser;
    if (!user) { showToast('Login required.', true); hideLoader(); return; }
    const userId = user.uid;
    const ign = (options.ign || user.displayName || '').trim() || '';
    const slot = options.slot || null;

    try {
        // check duplicate
        const alreadyQ = query(collection(db, "participants"), where("userId","==",userId), where("tournamentId","==",tournamentId));
        const alreadySnap = await getDocs(alreadyQ);
        if (!alreadySnap.empty) { showToast('You have already joined this tournament.', true); hideLoader(); return; }

        if (slot) {
            const slotQ = query(collection(db, "participants"), where("tournamentId","==",tournamentId), where("slot","==",slot));
            const slotSnap = await getDocs(slotQ);
            if (!slotSnap.empty) { showToast('Selected slot already taken. Please choose another.', true); hideLoader(); return; }
        }

        const tRef = doc(db, "tournaments", tournamentId);
        const tSnap = await getDoc(tRef);
        if (!tSnap.exists()) { showToast('Tournament not found.', true); hideLoader(); return; }
        const tData = tSnap.data();
        if (tData.status !== 'Upcoming') { showToast('Tournament is no longer available.', true); hideLoader(); return; }

        const userRef = doc(db, "users", userId);

        await runTransaction(db, async (transaction) => {
            const uDoc = await transaction.get(userRef);
            if (!uDoc.exists()) throw new Error('User doc missing');

            const wallet = uDoc.data().walletBalance;
            if (wallet < entryFee) throw new Error('Insufficient Balance');

            const tDocTx = await transaction.get(tRef);
            if (!tDocTx.exists()) throw new Error('Tournament not found in tx');
            if (tDocTx.data().status !== 'Upcoming') throw new Error('Tournament is not open');
            const max = tDocTx.data().maxParticipants || 0;
            const current = typeof tDocTx.data().currentParticipants === 'number' ? tDocTx.data().currentParticipants : 0;
            if (current >= max) throw new Error('Tournament is full');

            transaction.update(userRef, { walletBalance: wallet - entryFee });

            const partRef = doc(collection(db, "participants"));
            transaction.set(partRef, {
                userId,
                username: ign || (uDoc.data().username || 'Player'),
                tournamentId,
                status: 'Joined',
                joinedAt: serverTimestamp(),
                slot: slot || null,
                seenByUser: false
            });

            const txRef = doc(collection(db, "transactions"));
            transaction.set(txRef, {
                userId,
                amount: entryFee,
                type: 'debit',
                description: `Entry fee for ${tDocTx.data().title}`,
                createdAt: serverTimestamp()
            });

            transaction.update(tRef, { currentParticipants: (current + 1) });
        });

        showToast('Joined tournament successfully!', false);
    } catch (err) {
        console.error('Join error', err);
        showToast(err.message || 'Could not join tournament', true);
    } finally { hideLoader(); }
}

/* Wallet / profile / tabs (updated deposit/withdraw handlers) */
function initWalletButtons() {
    document.getElementById('add-money-btn').addEventListener('click', async () => {
        const val = parseFloat(document.getElementById('deposit-amount').value || '0');
        if (isNaN(val) || val < 10) { showToast('Minimum deposit is ₹10', true); return; }
        await handleSimulatedTransaction(val, 'credit', 'User deposit');
    });

    document.getElementById('withdraw-money-btn').addEventListener('click', async () => {
        const val = parseFloat(document.getElementById('withdraw-amount').value || '0');
        if (isNaN(val) || val < 30) { showToast('Minimum withdrawal is ₹30', true); return; }
        if (window.currentUser && window.currentUser.walletBalance < val) { showToast('Insufficient funds.', true); return; }
        await handleSimulatedTransaction(val, 'debit', 'User withdrawal');
    });
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

/* My Fights dot logic */
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

/* ---------- Full-screen tournament detail open/close ---------- */
async function openTournamentDetailScreen(tournamentId) {
    showLoader();
    try {
        let tournament = latestTournaments.find(t => t.id === tournamentId) || null;
        if (!tournament) {
            const tRef = doc(db, "tournaments", tournamentId);
            const tSnap = await getDoc(tRef);
            if (tSnap.exists()) tournament = { id: tSnap.id, ...tSnap.data() };
        }
        if (!tournament) { showToast('Tournament not found.', true); hideLoader(); return; }

        const pColl = collection(db, "participants");
        const pSnap = await getDocs(query(pColl, where("tournamentId", "==", tournamentId)));
        const participants = [];
        pSnap.forEach(s => participants.push({ id: s.id, ...s.data() }));

        const userIsAdmin = window.currentUser && window.currentUser.isAdmin;
        const currentUserId = auth.currentUser ? auth.currentUser.uid : null;
        const currentUserParticipant = participants.find(p => p.userId === currentUserId) || null;

        // update currentManagingTournament? Not needed here; just show screen
        showTournamentDetailScreen(tournament, participants, userIsAdmin, currentUserParticipant);

        // Now set the join button state (mirror outside button)
        const detailJoinBtn = document.getElementById('detail-join-btn');
        if (detailJoinBtn) {
            // If user already joined -> show Joined (disabled)
            if (currentUserParticipant) {
                detailJoinBtn.textContent = 'Joined';
                detailJoinBtn.classList.remove('bg-green-600');
                detailJoinBtn.classList.add('bg-yellow-400','text-black');
                detailJoinBtn.disabled = true;
            } else {
                const current = tournament.currentParticipants || 0;
                const max = tournament.maxParticipants || 0;
                if (current >= max) {
                    detailJoinBtn.textContent = 'Full';
                    detailJoinBtn.classList.remove('bg-green-600');
                    detailJoinBtn.classList.add('bg-red-600');
                    detailJoinBtn.disabled = true;
                } else {
                    detailJoinBtn.textContent = 'Join Now';
                    detailJoinBtn.classList.remove('bg-red-600','bg-yellow-400','text-black');
                    detailJoinBtn.classList.add('bg-green-600');
                    detailJoinBtn.disabled = false;
                }
            }
        }

    } catch (err) {
        console.error('Open detail error', err);
        showToast('Could not open tournament details.', true);
    } finally { hideLoader(); }
}

/* Expose small helpers for other modules */
export { openTournamentDetailScreen };

/* ---------------- end of file ---------------- */
