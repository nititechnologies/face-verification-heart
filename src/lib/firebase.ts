import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyBY1bcCCSBGVcBgwWzRmQp6tPD6-VDycJc",
    authDomain: "heart-nagaland.firebaseapp.com",
    projectId: "heart-nagaland",
    storageBucket: "heart-nagaland.firebasestorage.app",
    messagingSenderId: "333002007969",
    appId: "1:333002007969:android:171f676b4ac62a686317e0",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
