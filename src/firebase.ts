import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);

const databaseId =
  import.meta.env.VITE_FIRESTORE_DATABASE_ID ||
  firebaseConfig.firestoreDatabaseId ||
  'ai-studio-ourtracker-d269b44d-bb64-42ab-8187-1d0e7de7e72c';

export const db = getFirestore(app, databaseId);


