 // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
  import { getDatabase } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-database.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyBXMBE5G8WW6g94uOJXmCDHIdOtNBP-utM",
    authDomain: "phoenix-a4bcb.firebaseapp.com",
    databaseURL: "https://phoenix-a4bcb-default-rtdb.firebaseio.com",
    projectId: "phoenix-a4bcb",
    storageBucket: "phoenix-a4bcb.firebasestorage.app",
    messagingSenderId: "165847423607",
    appId: "1:165847423607:web:f0eca1e58c54906d640472",
    measurementId: "G-RR5EFTWSBE"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);

  // Initialize Realtime Database
  const Database = getDatabase(app);

  // Export the functions for use in other modules
  export { app, analytics, Database };