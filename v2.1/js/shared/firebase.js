/**
 * js/shared/firebase.js
 * Core Firebase initialization and database export.
 */

// Initialize Firebase only if it hasn't been initialized yet
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig); 
}

// Export the database reference for use in other modules
export const db = firebase.database();
