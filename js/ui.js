const loader = document.getElementById('global-loader');
const toastEl = document.getElementById('toast-notification');
const toastMsg = document.getElementById('toast-message');

export function showLoader() { loader.classList.remove('hidden'); }
export function hideLoader() { loader.classList.add('hidden'); }

export function showToast(message, isError = false) {
    toastMsg.textContent = message;
    toastEl.classList.remove('bg-green-600', 'bg-red-600');
    if (isError) toastEl.classList.add('bg-red-600', 'text-white');
    else toastEl.classList.add('bg-green-600', 'text-white');
    toastEl.classList.add('show');
    setTimeout(()=> toastEl.classList.remove('show'), 3000);
}

/**
 * Render tournaments on Home. Adds Mode display, per-kill golden badge,
 * and keeps dynamic thin progress bar and join button logic.
 * - tournaments: array of tournament objects (include id, title, gameName, matchTime, entryFee, prizePool, mode, perKillEnabled, perKillPrize, maxParticipants, currentParticipants)
 * - joinedSet: Set of tournament ids that the current user has joined (used to show "Joined").
 */
export function renderHomeTournaments(tournaments, joinedSet = new Set()) {
    const listEl = document.getElementById('tournaments-list');
    if (!tournaments || tournaments.length === 0) {
        listEl.innerHTML = '<p class="text-gray-400 text-center">No upcoming tournaments right now. Check back soon!</p>';
        return;
    }

    listEl.innerHTML = tournaments.map(t => {
        const matchTime = t.matchTime && t.matchTime.toDate ? t.matchTime.toDate().toLocaleString() : (t.matchTime ? new Date(t.matchTime).toLocaleString() : 'TBD');
        const max = t.maxParticipants || 100;
        const current = typeof t.currentParticipants === 'number' ? t.currentParticipants : 0;
        const percent = Math.round((current / max) * 100);
        const clampedPercent = Math.min(100, Math.max(0, percent));
        const isFull = current >= max;
        const userJoined = joinedSet.has(t.id);

        // Progress color logic
        let progressBgClass = 'bg-purple-500';
        let progressGlow = '';
        if (isFull) { progressBgClass = 'bg-red-600'; progressGlow = 'ring-2 ring-red-400 animate-pulse'; }
        else if (clampedPercent >= 90) progressBgClass = 'bg-red-600';
        else if (clampedPercent >= 50) progressBgClass = 'bg-yellow-400';

        // Join button state
        let joinBtnText = 'Join Now';
        let joinBtnClass = 'bg-indigo-600 hover:bg-indigo-700 text-white';
        let joinBtnDisabled = false;
        if (isFull) { joinBtnText = 'Full'; joinBtnClass = 'bg-red-600 text-white cursor-not-allowed opacity-90'; joinBtnDisabled = true; }
        else if (userJoined) { joinBtnText = 'Joined'; joinBtnClass = 'bg-yellow-400 text-white'; }

        // Mode label (capitalized) - kept small
        const modeLabel = `<span class="inline-block text-xs px-2 py-0.5 rounded text-gray-300 bg-gray-700 mr-2">${(t.mode || 'solo').toUpperCase()}</span>`;

        // Per-Kill label (gold) — moved to middle area between Prize and Entry Fee.
        const perKillLabel = t.perKillEnabled ? `<div class="text-sm font-semibold" style="color:#FBBF24;">Per Kill ₹${t.perKillPrize}</div>` : `<div class="text-sm text-gray-400">&nbsp;</div>`;

        // Progress bar markup
        const progressBar = `
            <div class="w-full h-1 rounded-t-lg bg-gray-700 overflow-hidden">
                <div class="h-full ${progressBgClass} ${progressGlow}" style="width: ${clampedPercent}%; border-top-left-radius: 8px; border-top-right-radius: ${clampedPercent === 100 ? '8px' : '0'};"></div>
            </div>
        `;

        return `
        <div class="bg-gray-800 rounded-lg shadow-lg overflow-hidden tourney-card" data-tid="${t.id}">
            ${progressBar}
            <div class="p-5">
                <div class="flex items-start justify-between mb-3">
                    <div>
                        <h3 class="text-xl font-bold text-white mb-1">${t.title}</h3>
                        <div class="text-sm text-gray-400">${t.gameName} • ${matchTime}</div>
                    </div>
                    <div class="text-right">
                        ${modeLabel}
                    </div>
                </div>

                <div class="flex justify-between items-center mb-4 text-sm">
                    <span class="text-gray-300"><i class="fas fa-calendar-alt mr-1 text-indigo-400"></i> ${matchTime}</span>
                    <span class="text-gray-300"><i class="fas fa-users mr-1 text-indigo-400"></i> ${current}/${max}</span>
                </div>

                <div class="flex items-center justify-between gap-4">
                    <div class="flex-1 text-left">
                        <p class="text-xs text-gray-400">Prize Pool</p>
                        <p class="text-lg font-semibold text-green-400">₹${t.prizePool}</p>
                    </div>

                    <div class="flex-1 text-center">
                        ${perKillLabel}
                    </div>

                    <div class="flex-1 text-right">
                        <p class="text-xs text-gray-400">Entry Fee</p>
                        <p class="text-lg font-semibold text-white">₹${t.entryFee}</p>
                    </div>
                </div>
            </div>

            <button class="join-btn w-full ${joinBtnClass} font-bold py-3 transition duration-200 ${joinBtnDisabled ? 'pointer-events-none' : ''}"
                    data-id="${t.id}"
                    data-fee="${t.entryFee}"
                    data-mode="${t.mode || 'solo'}"
                    data-max="${max}"
                    ${joinBtnDisabled ? 'disabled' : ''}>
                ${joinBtnText}
            </button>
        </div>
        `;
    }).join('');
}

/**
 * Renders My Tournaments. Adds "Your slot" badge:
 * - solo: "Your slot: #n"
 * - duo: "Your slot: T{teamNo}#{slotInTeam}" where teamSize = 2
 * - squad: teamSize = 4.
 *
 * Also for completed tournaments, shows amount user earned (per-kill or winner prize).
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

        // compute earned amount if tournament completed / per kill values exist
        let earnedAmount = 0;
        if (t.perKillEnabled) {
            const kills = (p && typeof p.kills === 'number') ? p.kills : 0;
            earnedAmount = kills * (t.perKillPrize || 0);
        } else {
            if (p && p.status === 'Winner') earnedAmount = t.prizePool || 0;
            else earnedAmount = 0;
        }

        // slot badge formatting
        let slotBadge = '';
        if (p && p.slot) {
            const slotNum = parseInt(p.slot, 10);
            const mode = (t.mode || 'solo').toLowerCase();
            if (mode === 'duo') {
                const teamSize = 2;
                const teamNo = Math.ceil(slotNum / teamSize);
                const slotInTeam = slotNum - (teamNo - 1) * teamSize;
                slotBadge = `<span class="slot-badge inline-block px-2 py-1 text-xs rounded text-white border border-gray-700">Your slot: T${teamNo}#${slotInTeam}</span>`;
            } else if (mode === 'squad') {
                const teamSize = 4;
                const teamNo = Math.ceil(slotNum / teamSize);
                const slotInTeam = slotNum - (teamNo - 1) * teamSize;
                slotBadge = `<span class="slot-badge inline-block px-2 py-1 text-xs rounded text-white border border-gray-700">Your slot: T${teamNo}#${slotInTeam}</span>`;
            } else {
                slotBadge = `<span class="slot-badge inline-block px-2 py-1 text-xs rounded text-white border border-gray-700">Your slot: #${slotNum}</span>`;
            }
        }

        // Room block with copy buttons (if room details exist)
        const roomBlock = (t.status === 'Live' && t.roomId) ? `
            <div class="bg-gray-700 rounded p-3 mb-3">
                <p class="text-sm text-gray-300">Room ID: <span class="font-bold text-white">${t.roomId}</span>
                    <button class="copy-btn ml-2 text-gray-200 hover:text-white" data-copy="${t.roomId}" title="Copy Room ID"><i class="fas fa-copy"></i></button>
                </p>
                <p class="text-sm text-gray-300">Password: <span class="font-bold text-white">${t.roomPassword || ''}</span>
                    <button class="copy-btn ml-2 text-gray-200 hover:text-white" data-copy="${t.roomPassword || ''}" title="Copy Password"><i class="fas fa-copy"></i></button>
                </p>
            </div>
        ` : '';

        // Earned badge html (eye catching)
        const earnedBadge = (t.status === 'Completed') ? `
            <div class="absolute left-4 top-4">
                <div class="bg-gray-900 px-3 py-1 rounded text-sm font-semibold text-yellow-300 border border-yellow-600 shadow">${earnedAmount > 0 ? `₹${earnedAmount}` : '₹0'}</div>
            </div>
        ` : '';

        const cardHtml = `
        <div class="bg-gray-800 rounded-lg shadow-lg p-5 relative tourney-card" data-tid="${t.id}">
            ${earnedBadge}
            <div class="absolute top-4 right-4">${slotBadge}</div>
            <h3 class="text-xl font-bold text-white mb-2">${t.title}</h3>
            <p class="text-sm text-gray-400 mb-3">${t.gameName} • ${matchTime}</p>
            ${roomBlock}
            <div class="flex justify-between items-center">
                <div>
                    <p class="text-xs text-gray-400">Status</p>
                    <p class="text-lg font-semibold ${p.status === 'Winner' ? 'text-green-400' : (p.status === 'Completed' ? 'text-gray-400' : 'text-yellow-400')}">${p.status}</p>
                </div>
                <div>
                    <p class="text-xs text-gray-400">Prize Pool</p>
                    <p class="text-lg font-semibold text-green-400">₹${t.prizePool}</p>
                </div>
            </div>
            ${ (t.status === 'Completed') ? `<div class="mt-4">${ p.seenByUser ? '' : `<button class="ok-btn w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 rounded" data-participant-id="${p.id}">OK</button>` }</div>` : '' }
        </div>
        `;

        if (p.status === 'Completed' || p.status === 'Winner') completedHtml.push(cardHtml);
        else liveHtml.push(cardHtml);
    });

    liveList.innerHTML = liveHtml.length > 0 ? liveHtml.join('') : '<p class="text-gray-400 text-center">No live or upcoming tournaments joined.</p>';
    completedList.innerHTML = completedHtml.length > 0 ? completedHtml.join('') : '<p class="text-gray-400 text-center">No completed tournaments.</p>';
}

/* Remaining UI functions kept intact (transaction render, admin lists, manage participants, etc.) */

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

export function renderAdminTournaments(tournaments) {
    const listEl = document.getElementById('admin-tournaments-list');
    if (tournaments.length === 0) { listEl.innerHTML = '<p class="text-gray-400">No tournaments created yet.</p>'; return; }
    listEl.innerHTML = tournaments.map(t => {
        const modeLabel = `<span class="inline-block text-xs px-2 py-0.5 rounded text-gray-300 bg-gray-700 mr-2">${(t.mode || 'solo').toUpperCase()}</span>`;
        return `
        <div class="bg-gray-800 p-4 rounded-lg flex justify-between items-center">
            <div>
                <p class="font-semibold text-white">${t.title} ${modeLabel} <span class="text-xs font-normal text-gray-400">(${t.gameName})</span></p>
                <p class="text-sm text-yellow-400">${t.status}</p>
            </div>
            <button class="manage-t-btn bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold py-2 px-3 rounded" data-id="${t.id}">Manage</button>
        </div>
        `;
    }).join('');
}

export function renderManageParticipants(participants) {
    const listEl = document.getElementById('manage-t-participants-list');
    if (participants.length === 0) { listEl.innerHTML = '<p class="text-gray-400">No participants have joined yet.</p>'; return; }
    listEl.innerHTML = participants.map(p => {
        const slot = p.slot ? `<div class="text-xs text-gray-300">Slot: #${p.slot}</div>` : '';
        return `
        <div class="bg-gray-700 p-3 rounded flex justify-between items-center">
            <div>
                <div class="text-white font-medium">${p.username}</div>
                <div class="text-xs text-gray-400">UserID: ${p.userId}</div>
            </div>
            <div class="text-sm text-gray-300">${p.status || 'Joined'}${slot}</div>
        </div>
        `;
    }).join('');
}
