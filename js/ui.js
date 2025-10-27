const loader = document.getElementById('global-loader');
const toastEl = document.getElementById('toast-notification');
const toastMsg = document.getElementById('toast-message');

/**
 * Shows the global loading spinner.
 */
export function showLoader() {
    loader.classList.remove('hidden');
}

/**
 * Hides the global loading spinner.
 */
export function hideLoader() {
    loader.classList.add('hidden');
}

/**
 * Shows a toast notification.
 * @param {string} message - The message to display.
 * @param {boolean} [isError=false] - True if the toast should be error-styled (red).
 */
export function showToast(message, isError = false) {
    toastMsg.textContent = message;

    // Remove old color classes
    toastEl.classList.remove('bg-green-600', 'bg-red-600');

    // Add new color class
    if (isError) {
        toastEl.classList.add('bg-red-600', 'text-white');
    } else {
        toastEl.classList.add('bg-green-600', 'text-white');
    }

    // Show toast
    toastEl.classList.add('show');

    // Hide after 3 seconds
    setTimeout(() => {
        toastEl.classList.remove('show');
    }, 3000);
}

/**
 * Renders the list of upcoming tournaments on the Home screen.
 * Accepts an optional set of tournamentIds that the current user has joined.
 * Each tournament object should preferably include:
 *  - id, title, gameName, matchTime, entryFee, prizePool
 *  - maxParticipants (number)
 *  - slots (array)
 *  - mode, perKillEnabled, perKillPrize
 */
export function renderHomeTournaments(tournaments, joinedSet = new Set()) {
    const listEl = document.getElementById('tournaments-list');
    if (!tournaments || tournaments.length === 0) {
        listEl.innerHTML = '<p class="text-gray-400 text-center">No upcoming tournaments right now. Check back soon!</p>';
        return;
    }

    listEl.innerHTML = tournaments.map(t => {
        const matchTime = t.matchTime && t.matchTime.toDate ? t.matchTime.toDate().toLocaleString() : (t.matchTime ? new Date(t.matchTime).toLocaleString() : 'TBD');
        const max = t.maxParticipants || (t.slots ? t.slots.length : 100);
        // compute current filled by counting slots with userId
        let current = 0;
        if (Array.isArray(t.slots)) {
            current = t.slots.filter(s => s && s.userId).length;
        } else {
            current = typeof t.currentParticipants === 'number' ? t.currentParticipants : 0;
        }
        const percent = Math.round((current / max) * 100);
        const clampedPercent = Math.min(100, Math.max(0, percent));
        const isFull = current >= max;
        const userJoined = joinedSet.has(t.id);

        // Determine progress color classes
        let progressBgClass = 'bg-purple-500';
        let progressGlow = '';
        if (isFull) {
            progressBgClass = 'bg-red-600';
            progressGlow = 'ring-2 ring-red-400 animate-pulse';
        } else if (clampedPercent >= 90) {
            progressBgClass = 'bg-red-600';
        } else if (clampedPercent >= 50) {
            progressBgClass = 'bg-yellow-400';
        } else {
            progressBgClass = 'bg-purple-500';
        }

        // Join button state
        let joinBtnText = 'Join Now';
        let joinBtnClass = 'bg-indigo-600 hover:bg-indigo-700 text-white';
        let joinBtnDisabled = false;
        if (isFull) {
            joinBtnText = 'Full';
            joinBtnClass = 'bg-red-600 text-white cursor-not-allowed opacity-90';
            joinBtnDisabled = true;
        } else if (userJoined) {
            joinBtnText = 'Joined';
            joinBtnClass = 'bg-yellow-400 text-white';
        }

        // Mode label and per-kill indicator
        const modeLabel = `<span class="inline-block px-2 py-1 text-xs font-semibold rounded bg-gray-700 text-gray-200 mr-2">${(t.mode || 'solo').toUpperCase()}</span>`;
        const perKillLabel = t.perKillEnabled ? `<span class="inline-block px-2 py-1 text-xs font-semibold rounded bg-amber-900 text-amber-300">Per Kill: ₹${t.perKillPrize || 0}</span>` : '';

        // Progress bar markup (thin squaricle box at top of card)
        const progressBar = `
            <div class="w-full squaricle-top bg-gray-700 overflow-hidden">
                <div class="${progressBgClass} ${progressGlow}" style="height:6px; width:${clampedPercent}%;"></div>
            </div>
        `;

        return `
        <div class="bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            ${progressBar}
            <div class="p-5">
                <div class="flex items-center justify-between mb-3">
                    <div>
                        <h3 class="text-xl font-bold text-white mb-1">${t.title}</h3>
                        <p class="text-sm text-gray-400">${t.gameName} • ${matchTime}</p>
                    </div>
                    <div class="text-right">
                        <div>${modeLabel}${perKillLabel}</div>
                        <div class="text-xs text-gray-400 mt-2">${current}/${max} joined</div>
                    </div>
                </div>

                <div class="flex justify-between items-center mb-2">
                    <div>
                        <p class="text-xs text-gray-400">Prize Pool</p>
                        <p class="text-lg font-semibold text-green-400">₹${t.prizePool}</p>
                    </div>
                    <div>
                        <p class="text-xs text-gray-400">Entry Fee</p>
                        <p class="text-lg font-semibold text-white">₹${t.entryFee}</p>
                    </div>
                </div>
            </div>
            <button class="join-btn w-full ${joinBtnClass} font-bold py-3 transition duration-200 ${joinBtnDisabled ? 'pointer-events-none' : ''}"
                    data-id="${t.id}" 
                    data-fee="${t.entryFee}"
                    ${joinBtnDisabled ? 'disabled' : ''}>
                ${joinBtnText}
            </button>
        </div>
        `;
    }).join('');
}

/**
 * Renders the tournaments for the "My Tournaments" page.
 * Each item in joinedTournaments should be { participant, tournament }.
 */
export function renderMyTournaments(joinedTournaments) {
    const liveList = document.getElementById('tab-content-live');
    const completedList = document.getElementById('tab-content-completed');

    const liveHtml = [];
    const completedHtml = [];

    if (!joinedTournaments || joinedTournaments.length === 0) {
        liveList.innerHTML = '<p class="text-gray-400 text-center">You haven\'t joined any tournaments yet.</p>';
        completedList.innerHTML = '<p class="text-gray-400 text-center">No completed tournaments.</p>';
        return;
    }

    joinedTournaments.forEach(item => {
        const t = item.tournament;
        const p = item.participant;
        const matchTime = t.matchTime && t.matchTime.toDate ? t.matchTime.toDate().toLocaleString() : (t.matchTime ? new Date(t.matchTime).toLocaleString() : 'TBD');
        const slotBadge = p && p.slotIndex ? `<span class="inline-block bg-indigo-600 text-xs text-white px-2 py-1 rounded">Your slot: #${p.slotIndex}</span>` : '';

        // Room block with copy buttons (if room details exist)
        const roomBlock = (t.status === 'Live' && t.roomId) ? `
            <div class="bg-gray-700 rounded p-3 mb-3">
                <p class="text-sm text-gray-300">Room ID: <span class="font-bold text-white">${t.roomId}</span>
                    <button class="copy-btn ml-2 text-gray-200 hover:text-white" data-copy="${t.roomId}" title="Copy Room ID">
                        <i class="fas fa-copy"></i>
                    </button>
                </p>
                <p class="text-sm text-gray-300">Password: <span class="font-bold text-white">${t.roomPassword || ''}</span>
                    <button class="copy-btn ml-2 text-gray-200 hover:text-white" data-copy="${t.roomPassword || ''}" title="Copy Password">
                        <i class="fas fa-copy"></i>
                    </button>
                </p>
            </div>
        ` : '';

        const statusColor = p.status === 'Winner' ? 'text-green-400' : (p.status === 'Completed' ? 'text-gray-400' : 'text-yellow-400');

        const cardHtml = `
        <div class="bg-gray-800 rounded-lg shadow-lg p-5">
            <div class="flex items-start justify-between mb-3">
                <div>
                    <h3 class="text-xl font-bold text-white mb-1">${t.title} ${slotBadge}</h3>
                    <p class="text-sm text-gray-400">${t.gameName} • ${matchTime}</p>
                </div>
                <div class="text-right">
                    <div class="text-xs text-gray-400">Prize Pool</div>
                    <div class="text-lg font-semibold text-green-400">₹${t.prizePool}</div>
                </div>
            </div>

            ${roomBlock}

            <div class="flex justify-between items-center">
                <div>
                    <p class="text-xs text-gray-400">Status</p>
                    <p class="text-lg font-semibold ${statusColor}">${p.status}</p>
                </div>
                <div>
                    <p class="text-xs text-gray-400">Mode</p>
                    <p class="text-sm font-medium text-white">${(t.mode || 'solo').toUpperCase()}</p>
                </div>
            </div>

            ${ (t.status === 'Completed') ? `
                <div class="mt-4">
                    ${ p.seenByUser ? '' : `<button class="ok-btn w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded" data-participant-id="${p.id}">OK</button>` }
                </div>
            ` : '' }
        </div>
        `;

        if (p.status === 'Completed' || p.status === 'Winner') {
            completedHtml.push(cardHtml);
        } else {
            liveHtml.push(cardHtml);
        }
    });

    liveList.innerHTML = liveHtml.length > 0 ? liveHtml.join('') : '<p class="text-gray-400 text-center">No live or upcoming tournaments joined.</p>';
    completedList.innerHTML = completedHtml.length > 0 ? completedHtml.join('') : '<p class="text-gray-400 text-center">No completed tournaments.</p>';
}

/**
 * Renders the transaction history in the wallet.
 * @param {Array} transactions - Array of transaction objects.
 */
export function renderTransactionHistory(transactions) {
    const listEl = document.getElementById('transaction-history');
    if (transactions.length === 0) {
        listEl.innerHTML = '<p class="text-gray-400 text-center">No transactions yet.</p>';
        return;
    }

    listEl.innerHTML = transactions.map(tx => {
        const isCredit = tx.type === 'credit';
        const amountColor = isCredit ? 'text-green-400' : 'text-red-400';
        const amountSign = isCredit ? '+' : '-';
        const icon = isCredit ? 'fa-arrow-up' : 'fa-arrow-down';

        return `
        <div class="bg-gray-800 p-4 rounded-lg flex items-center justify-between">
            <div class="flex items-center">
                <div class="mr-3 flex-shrink-0 h-10 w-10 rounded-full bg-gray-700 flex items-center justify-center ${amountColor}">
                    <i class="fas ${icon}"></i>
                </div>
                <div>
                    <p class="text-sm font-medium text-white">${tx.description}</p>
                    <p class="text-xs text-gray-400">${tx.createdAt.toDate().toLocaleString()}</p>
                </div>
            </div>
            <span class="text-lg font-semibold ${amountColor}">${amountSign}₹${tx.amount}</span>
        </div>
        `;
    }).join('');
}

/**
 * Renders the list of all tournaments for the admin panel.
 * @param {Array} tournaments - Array of tournament objects.
 */
export function renderAdminTournaments(tournaments) {
    const listEl = document.getElementById('admin-tournaments-list');
    if (tournaments.length === 0) {
        listEl.innerHTML = '<p class="text-gray-400">No tournaments created yet.</p>';
        return;
    }

    listEl.innerHTML = tournaments.map(t => {
        const perKillBadge = t.perKillEnabled ? `<span class="text-xs text-amber-300">Per-kill: ₹${t.perKillPrize}</span>` : '';
        const modeBadge = `<span class="text-xs text-gray-200 ml-2">${(t.mode || 'solo').toUpperCase()}</span>`;
        return `
        <div class="bg-gray-800 p-4 rounded-lg flex justify-between items-center">
            <div>
                <p class="font-semibold text-white">${t.title} <span class="text-xs font-normal text-gray-400">(${t.gameName})</span></p>
                <p class="text-sm text-yellow-400">${t.status} ${modeBadge} ${perKillBadge}</p>
            </div>
            <button class="manage-t-btn bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold py-2 px-3 rounded" data-id="${t.id}">
                Manage
            </button>
        </div>
        `;
    }).join('');
}

/**
 * Renders the participant list for the "Manage Tournament" view.
 * @param {Array} participants - Array of participant objects.
 */
export function renderManageParticipants(participants) {
    const listEl = document.getElementById('manage-t-participants-list');

    if (participants.length === 0) {
        listEl.innerHTML = '<p class="text-gray-400">No participants have joined yet.</p>';
        return;
    }

    listEl.innerHTML = participants.map(p => {
        return `
        <div class="bg-gray-700 p-3 rounded flex justify-between items-center">
            <div>
                <div class="text-white font-medium">${p.username}</div>
                <div class="text-xs text-gray-400">UserID: ${p.userId}</div>
            </div>
            <div class="text-sm text-gray-300">${p.status || 'Joined'}</div>
        </div>
        `;
    }).join('');
}


/* ---------------------------
   JOIN DIALOG UI helper
   ---------------------------
   showJoinDialog(tournament, onComplete)
   - tournament: full tournament object (must contain slots, mode, maxParticipants)
   - onComplete: function({ ign, slotIndex, teamIndex }) invoked when user confirms join
*/
export function showJoinDialog(tournament, onComplete) {
    const modal = document.getElementById('join-modal');
    const body = document.getElementById('join-modal-body');
    const btnNext = document.getElementById('join-modal-next');
    const btnPrev = document.getElementById('join-modal-prev');
    const btnCancel = document.getElementById('join-modal-cancel');
    const btnConfirm = document.getElementById('join-modal-confirm');

    if (!modal || !body || !btnNext || !btnCancel || !btnConfirm || !btnPrev) return;

    // state
    let step = 1;
    let ignValue = '';
    let selectedSlot = null; // { slotIndex, teamIndex }

    // helper to build step 1
    function renderStep1() {
        body.innerHTML = `
            <h3 class="text-lg font-semibold text-white mb-2">Enter In-game Name</h3>
            <p class="text-xs text-gray-400 mb-3">Enter the name you will use inside the match.</p>
            <input id="join-ign-input" class="w-full bg-gray-700 p-3 rounded-lg text-white focus-ring" placeholder="Your IGN (case-sensitive)" />
        `;
        btnPrev.classList.add('hidden');
        btnNext.classList.remove('hidden');
        btnConfirm.classList.add('hidden');
    }

    // helper to build step 2 (slot selection)
    function renderStep2() {
        body.innerHTML = '';
        const container = document.createElement('div');
        container.className = 'space-y-3';

        const header = document.createElement('div');
        header.innerHTML = `<h3 class="text-lg font-semibold text-white">Select your slot</h3>
            <p class="text-xs text-gray-400">Pick any free slot. Mode: <span class="text-white font-medium">${(tournament.mode || 'solo').toUpperCase()}</span></p>`;
        container.appendChild(header);

        const slotsWrapper = document.createElement('div');
        slotsWrapper.className = 'space-y-2 max-h-64 overflow-y-auto';

        // Build teams/slots in layout B (compact list)
        const mode = tournament.mode || 'solo';
        const teamSize = mode === 'solo' ? 1 : mode === 'duo' ? 2 : 4;
        const max = tournament.maxParticipants || (tournament.slots ? tournament.slots.length : 0);
        const teams = Math.floor(max / teamSize);

        for (let team = 1; team <= teams; team++) {
            // create team line
            const teamLine = document.createElement('div');
            teamLine.className = 'bg-gray-700 p-3 rounded flex items-center justify-between';

            const left = document.createElement('div');
            left.innerHTML = `<div class="text-white font-medium">Team ${team}</div> <div class="text-xs text-gray-400">Slots: ${teamSize}</div>`;

            const right = document.createElement('div');
            right.className = 'flex gap-2 items-center';

            // create slot boxes
            for (let s = 1; s <= teamSize; s++) {
                const globalSlotIndex = (team - 1) * teamSize + s;
                const slotObj = (Array.isArray(tournament.slots) && tournament.slots[globalSlotIndex - 1]) ? tournament.slots[globalSlotIndex - 1] : null;
                const isTaken = slotObj && slotObj.userId;
                const button = document.createElement('button');
                button.className = `w-10 h-10 rounded border ${isTaken ? 'bg-gray-600 text-gray-300 cursor-not-allowed' : 'bg-gray-800 hover:bg-gray-700 text-white'} flex items-center justify-center`;
                button.textContent = `#${globalSlotIndex}`;
                if (!isTaken) {
                    button.dataset.slotIndex = globalSlotIndex;
                    button.dataset.teamIndex = team;
                    button.addEventListener('click', () => {
                        // deselect previous
                        const prev = slotsWrapper.querySelector('.ring-2');
                        if (prev) prev.classList.remove('ring-2', 'ring-indigo-400');
                        // select current
                        button.classList.add('ring-2', 'ring-indigo-400');
                        selectedSlot = { slotIndex: globalSlotIndex, teamIndex: team };
                        btnConfirm.classList.remove('hidden');
                        btnNext.classList.add('hidden');
                    });
                } else {
                    // show occupant initial
                    button.title = `Taken`;
                }
                right.appendChild(button);
            }

            teamLine.appendChild(left);
            teamLine.appendChild(right);
            slotsWrapper.appendChild(teamLine);
        }

        container.appendChild(slotsWrapper);

        // hint
        const hint = document.createElement('p');
        hint.className = 'text-xs text-gray-400 mt-2';
        hint.textContent = 'Select any free slot to join.';
        container.appendChild(hint);

        body.appendChild(container);

        btnPrev.classList.remove('hidden');
        btnNext.classList.add('hidden');
        btnConfirm.classList.add('hidden'); // will show only after slot selected
    }

    // initialize
    renderStep1();
    modal.classList.remove('hidden');

    // event handlers
    const onNext = () => {
        if (step === 1) {
            const ignEl = document.getElementById('join-ign-input');
            if (!ignEl) return;
            const val = ignEl.value.trim();
            if (!val) {
                showToast('Please enter your IGN.', true);
                return;
            }
            ignValue = val;
            step = 2;
            renderStep2();
        }
    };

    const onPrev = () => {
        if (step === 2) {
            step = 1;
            renderStep1();
        }
    };

    const onCancel = () => {
        modal.classList.add('hidden');
        // clean handlers
        btnNext.removeEventListener('click', onNext);
        btnPrev.removeEventListener('click', onPrev);
        btnCancel.removeEventListener('click', onCancel);
        btnConfirm.removeEventListener('click', onConfirm);

        if (typeof onComplete === 'function') {
            onComplete({
                ign: ignValue,
                slotIndex: selectedSlot.slotIndex,
                teamIndex: selectedSlot.teamIndex
            });
        }
    };

    // attach
    btnNext.addEventListener('click', onNext);
    btnPrev.addEventListener('click', onPrev);
    btnCancel.addEventListener('click', onCancel);
    btnConfirm.addEventListener('click', onConfirm);
}

/**
 * Hide join modal (utility)
 */
export function hideJoinDialog() {
    const modal = document.getElementById('join-modal');
    if (modal) modal.classList.add('hidden');
}
