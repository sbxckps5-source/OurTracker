import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);

// Use the named Firestore database when configured; fall back to the
// project's default database when the id is empty or "(default)".
const databaseId = firebaseConfig.firestoreDatabaseId;
export const db =
  databaseId && databaseId !== '(default)'
    ? getFirestore(app, databaseId)
    : getFirestore(app);

