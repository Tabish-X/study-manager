import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDZJ9XseeGuBVkmhb5-HrcwRSVAChXs8WI",
  authDomain:        "study-manager-f9333.firebaseapp.com",
  projectId:         "study-manager-f9333",
  storageBucket:     "study-manager-f9333.firebasestorage.app",
  messagingSenderId: "169786797073",
  appId:             "1:169786797073:web:6254390c0d98f7f7f355b0",
  measurementId:     "G-V802KRGFYM"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

function showMessage(message, divId) {
  const messageDiv = document.getElementById(divId);
  if (!messageDiv) return;
  messageDiv.style.display = "block";
  messageDiv.innerHTML     = message;
  messageDiv.style.opacity = "1";
  setTimeout(() => { messageDiv.style.opacity = "0"; }, 5000);
}

// SIGNUP
const signUpBtn = document.getElementById("submitSignUp");
if (signUpBtn) {
  signUpBtn.addEventListener("click", function(event) {
    event.preventDefault();
    const fullName = document.getElementById("signup-name").value;
    const email    = document.getElementById("signup-email").value;
    const password = document.getElementById("signup-password").value;

    if (!fullName || !email || !password) {
      showMessage("Please fill all fields", "signUpMessage");
      return;
    }

    createUserWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        const user = userCredential.user;
        // Send verification email before storing user data
        return sendEmailVerification(user)
          .then(() => setDoc(doc(db, "users", user.uid), { fullName, email }))
          .then(() => {
            showMessage(
              "Account created! A verification email has been sent to <b>" + email + "</b>. Please verify before logging in.",
              "signUpMessage"
            );
            // Sign out immediately so they must verify before accessing the app
            return signOut(auth);
          });
      })
      .catch((error) => {
        if (error.code === "auth/email-already-in-use") {
          showMessage("Email already exists", "signUpMessage");
        } else if (error.code === "auth/weak-password") {
          showMessage("Password too weak (min 6 characters)", "signUpMessage");
        } else {
          showMessage("Error: " + error.message, "signUpMessage");
        }
      });
  });
}

// LOGIN
const loginBtn = document.getElementById("submitLogin");
if (loginBtn) {
  loginBtn.addEventListener("click", function(event) {
    event.preventDefault();
    const email    = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;

    if (!email || !password) {
      showMessage("Please fill all fields", "signInMessage");
      return;
    }

    signInWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        const user = userCredential.user;
        if (!user.emailVerified) {
          // Block access and sign them back out
          signOut(auth);
          showMessage(
            "Please verify your email before logging in. Check your inbox for the verification link.",
            "signInMessage"
          );
          return;
        }
        showMessage("Login successful! Redirecting…", "signInMessage");
        setTimeout(() => { window.location.href = "index.html"; }, 2000);
      })
      .catch((error) => {
        if (error.code === "auth/user-not-found" || error.code === "auth/invalid-credential") {
          showMessage("Email or password is incorrect", "signInMessage");
        } else if (error.code === "auth/wrong-password") {
          showMessage("Wrong password", "signInMessage");
        } else {
          showMessage("Error: " + error.message, "signInMessage");
        }
      });
  });
}

// Redirect based on auth state
onAuthStateChanged(auth, (user) => {
  if (user && user.emailVerified && window.location.pathname.includes("login.html")) {
    window.location.href = "index.html";
  } else if ((!user || !user.emailVerified) && window.location.pathname.includes("index.html")) {
    window.location.href = "login.html";
  }
});
