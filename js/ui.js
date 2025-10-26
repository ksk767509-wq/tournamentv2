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
 * @param {Array} tournaments - An array of tournament objects from Firestore.
 */
export function renderHomeTournaments(tournaments) {
    const listEl = document.getElementById('tournaments-list');
    if (tournaments.length === 0) {
        listEl.innerHTML = '<p class="text-gray-400 text-center">No upcoming tournaments right now. Check back soon!</p>';
        return;
    }
    
    listEl.innerHTML = tournaments.map(t => {
        const matchTime = t.matchTime.toDate ? t.matchTime.toDate().toLocaleString() : new Date(t.matchTime).toLocaleString();
        return `
        <div class="bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            <div class="p-5">
                <h3 class="text-xl font-bold text-white mb-2">${t.title}</h3>
                <p class="text-sm text-gray-400 mb-4">${t.gameName}</p>
                <div class="flex justify-between items-center mb-4 text-sm">
                    <span class="text-gray-300"><i class="fas fa-calendar-alt mr-1 text-indigo-400"></i> ${matchTime}</span>
                    <span class="text-gray-300"><i class="fas fa-users mr-1 text-indigo-400"></i> 1/100</span>
                </div>
                <div class="flex justify-between items-center">
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
            <button class="join-btn w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 transition duration-200"
                    data-id="${t.id}" 
                    data-fee="${t.entryFee}">
                Join Now
            </button>
        </div>
        `;
    }).join('');
}

/**
 * Renders the tournaments for the "My Tournaments" page.
 * @param {Array} joinedTournaments - Array of combined participant and tournament data.
 */
export function renderMyTournaments(joinedTournaments) {
    const liveList = document.getElementById('tab-content-live');
    const completedList = document.getElementById('tab-content-completed');
    
    const liveHtml = [];
    const completedHtml = [];
    
    if (joinedTournaments.length === 0) {
        liveList.innerHTML = '<p class="text-gray-400 text-center">You haven\'t joined any tournaments yet.</p>';
        completedList.innerHTML = '<p class="text-gray-400 text-center">No completed tournaments.</p>';
        return;
    }

    joinedTournaments.forEach(item => {
        const t = item.tournament;
        const p = item.participant;
        const matchTime = t.matchTime.toDate ? t.matchTime.toDate().toLocaleString() : new Date(t.matchTime).toLocaleString();
        
        const cardHtml = `
        <div class="bg-gray-800 rounded-lg shadow-lg p-5">
            <h3 class="text-xl font-bold text-white mb-2">${t.title}</h3>
            <p class="text-sm text-gray-400 mb-4">${t.gameName} - ${matchTime}</p>
            ${
                (t.status === 'Live' && t.roomId) ? `
                <div class="bg-gray-700 rounded p-3 mb-3">
                    <p class="text-sm text-gray-300">Room ID: <span class="font-bold text-white">${t.roomId}</span></p>
                    <p class="text-sm text-gray-300">Password: <span class="font-bold text-white">${t.roomPassword}</span></p>
                </div>
                ` : ''
            }
            <div class="flex justify-between items-center">
                <div>
                    <p class="text-xs text-gray-400">Status</p>
                    <p class="text-lg font-semibold ${p.status === 'Winner' ? 'text-green-400' : 'text-yellow-400'}">${p.status}</p>
                </div>
                <div>
                    <p class="text-xs text-gray-400">Prize Pool</p>
                    <p class="text-lg font-semibold text-green-400">₹${t.prizePool}</p>
                </div>
            </div>
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
        return `
        <div class="bg-gray-800 p-4 rounded-lg flex justify-between items-center">
            <div>
                <p class="font-semibold text-white">${t.title} <span class="text-xs font-normal text-gray-400">(${t.gameName})</span></p>
                <p class="text-sm text-yellow-400">${t.status}</p>
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
    const selectEl = document.getElementById('participant-winner-select');
    
    if (participants.length === 0) {
        listEl.innerHTML = '<p class="text-gray-400">No participants have joined yet.</p>';
        selectEl.innerHTML = '<option value="">No participants</option>';
        return;
    }
    
    listEl.innerHTML = participants.map(p => {
        return `
        <div class="bg-gray-700 p-3 rounded flex justify-between items-center">
            <span>${p.username}</span>
            <span class="text-sm text-gray-400">${p.userId}</span>
        </div>
        `;
    }).join('');
    
    selectEl.innerHTML = '<option value="">Select a winner...</option>' + participants.map(p => {
        return `<option value="${p.userId}" data-username="${p.username}">${p.username}</option>`;
    }).join('');
}
