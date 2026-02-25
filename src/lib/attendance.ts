import {
    signInWithEmailAndPassword,
    signOut as firebaseSignOut,
    onAuthStateChanged,
    User,
} from 'firebase/auth';
import {
    doc,
    getDoc,
    collection,
    query,
    where,
    getDocs,
    updateDoc,
    addDoc,
} from 'firebase/firestore';
import { auth, db } from './firebase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserProfile {
    uid: string;
    email: string;
    name: string;
    role: string;
    college: string | null;   // This is the collegeId
    collegeId: string | null;
    active: boolean;
    faceEmbedding?: number[];
    faceRegistered?: boolean;
}

export interface CollegeDetails {
    id: string;
    name: string;
    latitude?: number;
    longitude?: number;
    maxDistance?: number; // km
    startTime?: number;   // hour 0-23
    endTime?: number;     // hour 0-23
}

export interface AttendanceEvent {
    type: 'check_in' | 'check_out';
    time: string; // ISO string
    confidence: number;
    latitude?: number;
    longitude?: number;
}

export interface AttendanceRecord {
    id: string;
    userId: string;
    personName: string;
    date: string; // YYYY-MM-DD
    timestamp: string;
    type: 'check_in' | 'check_out';
    events: AttendanceEvent[];
    checkInTime?: string;
    checkoutTime?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getLocalISOString(): string {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000;
    return (new Date(Date.now() - tzoffset)).toISOString().slice(0, -1);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string): Promise<UserProfile> {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const profile = await getUserProfile(cred.user.uid);
    if (!profile) throw new Error('User profile not found');
    return profile;
}

export function signOut() {
    return firebaseSignOut(auth);
}

export function onAuthChange(cb: (user: User | null) => void) {
    return onAuthStateChanged(auth, cb);
}

// ─── User Profile ──────────────────────────────────────────────────────────────

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
        uid: snap.id,
        email: d.email ?? '',
        name: d.name ?? '',
        role: d.role ?? '',
        college: d.college ?? d.collegeId ?? null,
        collegeId: d.college ?? d.collegeId ?? null,
        active: d.active ?? false,
        faceEmbedding: d.faceEmbedding ?? undefined,
        faceRegistered: d.faceRegistered ?? false,
    };
}

export async function saveFaceEmbedding(uid: string, embedding: number[]): Promise<void> {
    await updateDoc(doc(db, 'users', uid), {
        faceEmbedding: embedding,
        faceRegistered: true,
        faceRegisteredAt: new Date().toISOString(),
    });
}

// ─── College Details ───────────────────────────────────────────────────────────

export async function getCollegeDetails(collegeId: string): Promise<CollegeDetails | null> {
    const snap = await getDoc(doc(db, 'colleges', collegeId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
        id: snap.id,
        name: d.name ?? '',
        latitude: d.latitude !== undefined ? Number(d.latitude) : undefined,
        longitude: d.longitude !== undefined ? Number(d.longitude) : undefined,
        maxDistance: d.maxDistance !== undefined ? Number(d.maxDistance) : undefined,
        startTime: d.startTime !== undefined ? Number(d.startTime) : undefined,
        endTime: d.endTime !== undefined ? Number(d.endTime) : undefined,
    };
}

// ─── Attendance ────────────────────────────────────────────────────────────────

export async function getTodayAttendanceRecord(userId: string): Promise<{ id: string; data: AttendanceRecord } | null> {
    const today = getLocalISOString().split('T')[0]; // YYYY-MM-DD in local time
    const q = query(collection(db, 'attendance'), where('userId', '==', userId));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
        const data = d.data();
        if (data.date === today) {
            return { id: d.id, data: { id: d.id, ...data } as AttendanceRecord };
        }
        // Fallback: check timestamp
        if (data.timestamp) {
            try {
                const ts = new Date(data.timestamp as string);
                if (ts.toISOString().split('T')[0] === today) {
                    return { id: d.id, data: { id: d.id, ...data } as AttendanceRecord };
                }
            } catch (_) { }
        }
    }
    return null;
}

export async function isCurrentlyCheckedIn(userId: string): Promise<boolean> {
    const todayRec = await getTodayAttendanceRecord(userId);
    if (!todayRec) return false;
    const events: AttendanceEvent[] = (todayRec.data.events ?? []);
    if (events.length === 0) {
        // Fallback
        return !!(todayRec.data.checkInTime && !todayRec.data.checkoutTime);
    }
    const sorted = [...events].sort((a, b) => a.time.localeCompare(b.time));
    return sorted[sorted.length - 1].type === 'check_in';
}

export async function markAttendance({
    userId,
    userName,
    type,
    confidence,
    latitude,
    longitude,
}: {
    userId: string;
    userName: string;
    type: 'check_in' | 'check_out';
    confidence: number;
    latitude?: number;
    longitude?: number;
}): Promise<void> {
    const timestamp = getLocalISOString();
    const today = timestamp.split('T')[0];

    const newEvent: AttendanceEvent = {
        type,
        time: timestamp,
        confidence,
        ...(latitude != null && longitude != null ? { latitude, longitude } : {}),
    };

    const todayRec = await getTodayAttendanceRecord(userId);

    if (todayRec) {
        const events = [...(todayRec.data.events ?? []), newEvent];
        events.sort((a, b) => a.time.localeCompare(b.time));

        const updateData: Record<string, unknown> = {
            events,
            type,
            updatedAt: timestamp,
        };
        if (type === 'check_in') {
            updateData.checkInTime = timestamp;
            updateData.checkInConfidence = confidence;
        } else {
            updateData.checkoutTime = timestamp;
            updateData.checkoutConfidence = confidence;
        }
        if (latitude != null) updateData.latitude = latitude;
        if (longitude != null) updateData.longitude = longitude;

        await updateDoc(doc(db, 'attendance', todayRec.id), updateData);
    } else {
        const recordData: Record<string, unknown> = {
            userId,
            personName: userName,
            personId: userId,
            employeeId: userId,
            date: today,
            timestamp,
            confidence,
            type,
            events: [newEvent],
            createdAt: timestamp,
        };
        if (type === 'check_in') {
            recordData.checkInTime = timestamp;
            recordData.checkInConfidence = confidence;
        } else {
            recordData.checkoutTime = timestamp;
            recordData.checkoutConfidence = confidence;
        }
        if (latitude != null) recordData.latitude = latitude;
        if (longitude != null) recordData.longitude = longitude;

        await addDoc(collection(db, 'attendance'), recordData);
    }
}

export async function getAttendanceHistory(userId: string): Promise<AttendanceRecord[]> {
    const q = query(
        collection(db, 'attendance'),
        where('userId', '==', userId),
    );
    const snap = await getDocs(q);
    const records = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceRecord));
    records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return records;
}

// ─── Time Validation ───────────────────────────────────────────────────────────

export function isCheckInAllowed(college: CollegeDetails | null): boolean {
    if (!college?.startTime) return true;
    const hour = new Date().getHours();
    return hour < college.startTime;
}

export function isCheckOutAllowed(college: CollegeDetails | null): boolean {
    if (!college?.endTime) return true;
    const hour = new Date().getHours();
    return hour >= college.endTime;
}

// ─── Geofence ──────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function validateGeofence(
    college: CollegeDetails | null
): Promise<{ valid: boolean; message: string; distance?: number; latitude?: number; longitude?: number }> {
    if (!college?.latitude || !college?.longitude) {
        return { valid: true, message: 'College location not configured' };
    }

    if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const latParam = params.get('lat');
        const lngParam = params.get('lng');
        if (latParam && lngParam) {
            const latNum = parseFloat(latParam);
            const lngNum = parseFloat(lngParam);
            const dist = haversineKm(
                latNum,
                lngNum,
                college.latitude!,
                college.longitude!
            );
            const max = college.maxDistance ?? 1.0;
            if (dist > max) {
                return {
                    valid: false,
                    message: `You are ${dist.toFixed(2)} km away from college. Max allowed: ${max.toFixed(1)} km.`,
                    distance: dist,
                    latitude: latNum,
                    longitude: lngNum,
                };
            }
            return { valid: true, message: 'Location verified (from URL)', latitude: latNum, longitude: lngNum };
        }
    }

    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            // If browser doesn't support geolocation, let it pass
            resolve({ valid: true, message: 'Geolocation not available — skipping check' });
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const dist = haversineKm(
                    pos.coords.latitude,
                    pos.coords.longitude,
                    college.latitude!,
                    college.longitude!
                );
                const max = college.maxDistance ?? 1.0;
                if (dist > max) {
                    resolve({
                        valid: false,
                        message: `You are ${dist.toFixed(2)} km away from college. Max allowed: ${max.toFixed(1)} km.`,
                        distance: dist,
                    });
                } else {
                    resolve({ valid: true, message: 'Location verified' });
                }
            },
            (_err) => {
                // Location unavailable (WebView restriction, GPS off, etc.) — allow attendance
                resolve({ valid: true, message: 'Location unavailable — skipping geofence check' });
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
    });
}
