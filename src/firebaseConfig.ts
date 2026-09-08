// src/firebaseConfig.ts
// Firebase initializer - import this wherever you need auth or db.
//
// SECURITY NOTE: Firebase *web* API keys are public identifiers by design —
// they identify the project, not a secret, and access control is enforced by
// Firebase Authentication + Firestore Security Rules. They are still loaded
// from Vite env vars (VITE_FIREBASE_*) so deployments can target separate
// dev/staging/prod projects without code changes. Copy .env.example to .env.
//
// NEVER place service-account keys or admin credentials in VITE_* variables —
// anything prefixed VITE_ is embedded in the client bundle.

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Read config from environment with clear failure messages.
function requiredEnv(name: string): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        "Copy .env.example to .env and fill in your Firebase web config " +
        "(Firebase console → Project settings → Your apps)."
    );
  }
  return value as string;
}

const firebaseConfig = {
  apiKey: requiredEnv("VITE_FIREBASE_API_KEY"),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: requiredEnv("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: requiredEnv("VITE_FIREBASE_APP_ID"),
  ...(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    ? { measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID }
    : {}),
};

const app = initializeApp(firebaseConfig);

// exports you will use in the app
export const auth = getAuth(app);
export const db = getFirestore(app);
