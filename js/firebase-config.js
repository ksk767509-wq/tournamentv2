// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// TODO: Add your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCK0pS7HaT_Y7Z5Y97QM0LqAkNXEO8VEb0",
    authDomain: "tournamentv2-713ab.firebaseapp.com",
    projectId: "tournamentv2-713ab",
    storageBucket: "tournamentv2-713ab.firebasestorage.app",
    messagingSenderId: "546759434595",
    appId: "1:546759434595:web:21218cfe145508a518b356"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export instances
export const auth = getAuth(app);
export const db = getFirestore(app);
