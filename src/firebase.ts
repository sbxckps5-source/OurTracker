import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);

const databaseId =
  import.meta.env.VITE_FIRESTORE_DATABASE_ID ||
  firebaseConfig.firestoreDatabaseId;

export const db =
  databaseId && databaseId !== '(default)'
    ? getFirestore(app, databaseId)
    : getFirestore(app);


