'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    UserProfile,
    CollegeDetails,
    AttendanceRecord,
    AttendanceEvent,
    getCollegeDetails,
    isCurrentlyCheckedIn,
    isCheckInAllowed,
    isCheckOutAllowed,
    validateGeofence,
    getAttendanceHistory,
} from '@/lib/attendance';
import dynamic_ from 'next/dynamic';

const FaceRegistration = dynamic_(() => import('./FaceRegistration'), { ssr: false });
const MarkAttendance = dynamic_(() => import('./MarkAttendance'), { ssr: false });

type EligibilityState = 'checking' | 'eligible' | 'ineligible';
type ActiveModal = null | 'register' | 'mark';
type HistoryFilter = 'all' | 'check_in' | 'check_out';

const PRIMARY = '#004d40';
const PRIMARY_DARK = '#00251a';

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
    return (
        <div style={{
            background: '#fff',
            borderRadius: 12,
            border: '0.5px solid #e0e0e0',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            padding: '16px',
            ...style,
        }}>
            {children}
        </div>
    );
}

interface Props { profile: UserProfile }

export default function AttendanceDashboard({ profile }: Props) {
    const [freshProfile, setFreshProfile] = useState<UserProfile>(profile);
    const [college, setCollege] = useState<CollegeDetails | null>(null);
    const [checkedIn, setCheckedIn] = useState(false);
    const [isEnrolled, setIsEnrolled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [eligibility, setEligibility] = useState<EligibilityState>('checking');
    const [eligibilityMsg, setEligibilityMsg] = useState('');
    const [history, setHistory] = useState<AttendanceRecord[]>([]);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
    const [activeModal, setActiveModal] = useState<ActiveModal>(null);

    const loadStatus = useCallback(async () => {
        setLoading(true);
        try {
            let col: CollegeDetails | null = null;
            if (freshProfile.collegeId) col = await getCollegeDetails(freshProfile.collegeId);
            setCollege(col);
            setIsEnrolled(!!(freshProfile.faceRegistered && freshProfile.faceEmbedding?.length));
            const ci = await isCurrentlyCheckedIn(freshProfile.uid);
            setCheckedIn(ci);
        } finally {
            setLoading(false);
        }
    }, [freshProfile]);

    const checkEligibility = useCallback(async () => {
        setEligibility('checking');
        try {
            const isCI = !checkedIn;
            const timeOk = isCI ? isCheckInAllowed(college) : isCheckOutAllowed(college);
            if (!timeOk) {
                setEligibility('ineligible');
                setEligibilityMsg(isCI ? 'Check-in only before college start time' : 'Check-out only after college end time');
                return;
            }
            const geo = await validateGeofence(college);
            setEligibility(geo.valid ? 'eligible' : 'ineligible');
            setEligibilityMsg(geo.valid ? '' : geo.message);
        } catch {
            setEligibility('ineligible');
            setEligibilityMsg('Unable to verify location');
        }
    }, [college, checkedIn]);

    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const all = await getAttendanceHistory(freshProfile.uid);
            setHistory(all);
        } finally {
            setHistoryLoading(false);
        }
    }, [freshProfile.uid]);

    useEffect(() => { loadStatus(); loadHistory(); }, [loadStatus, loadHistory]);
    useEffect(() => { if (!loading) checkEligibility(); }, [loading, checkedIn, college, checkEligibility]);

    const handleRegistrationComplete = async () => {
        const { getUserProfile } = await import('@/lib/attendance');
        const p = await getUserProfile(freshProfile.uid);
        if (p) setFreshProfile(p);
        setActiveModal(null);
        loadStatus();
    };

    const handleMarkComplete = () => {
        setActiveModal(null);
        loadStatus();
        loadHistory();
    };

    // Flatten events for history display
    const flatEvents = history
        .flatMap((r) => {
            const evs: { type: 'check_in' | 'check_out'; time: string; latitude?: number; longitude?: number }[] = [];
            if (r.events?.length) {
                r.events.forEach((e: AttendanceEvent) => evs.push({
                    type: e.type,
                    time: e.time,
                    latitude: e.latitude,
                    longitude: e.longitude
                }));
            } else {
                const lat = (r as any).latitude;
                const lng = (r as any).longitude;
                if (r.checkInTime) evs.push({ type: 'check_in', time: r.checkInTime, latitude: lat, longitude: lng });
                if (r.checkoutTime) evs.push({ type: 'check_out', time: r.checkoutTime, latitude: lat, longitude: lng });
            }
            return evs;
        })
        .filter((e) => historyFilter === 'all' || e.type === historyFilter)
        .sort((a, b) => b.time.localeCompare(a.time));

    return (
        <>
            {activeModal === 'register' && (
                <FaceRegistration
                    userId={freshProfile.uid}
                    userName={freshProfile.name}
                    onComplete={handleRegistrationComplete}
                    onCancel={() => setActiveModal(null)}
                />
            )}
            {activeModal === 'mark' && (
                <MarkAttendance
                    userProfile={freshProfile}
                    college={college}
                    isCheckIn={!checkedIn}
                    onSuccess={handleMarkComplete}
                    onCancel={() => setActiveModal(null)}
                />
            )}

            <div style={{ height: '100dvh', background: '#f8f8f8', display: 'flex', flexDirection: 'column' }}>

                {/* Loading state */}
                {loading ? (
                    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {[1, 2].map((i) => (
                            <div key={i} style={{ background: '#fff', borderRadius: 12, height: 72, border: '0.5px solid #e0e0e0' }} />
                        ))}
                    </div>
                ) : (
                    <div style={{ padding: '20px 20px 0', flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                        {/* Status Card */}
                        <Card style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            <div style={{
                                width: 48, height: 48, borderRadius: 10, flexShrink: 0,
                                background: isEnrolled ? '#E8F5E9' : '#FFF3E0',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                {isEnrolled ? (
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="10" fill="#4CAF50" />
                                        <path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                ) : (
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="10" fill="#FF9800" />
                                        <path d="M12 8v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
                                        <circle cx="12" cy="16" r="1" fill="white" />
                                    </svg>
                                )}
                            </div>
                            <div>
                                <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: '#000' }}>
                                    {isEnrolled ? 'Face Registered' : 'Face Not Registered'}
                                </p>
                                <p style={{ margin: '2px 0 0', fontSize: 13, color: '#666' }}>
                                    {isEnrolled ? 'You can now mark attendance' : 'Register your face to enable attendance'}
                                </p>
                            </div>
                        </Card>

                        {/* Action Card */}
                        <Card style={{ marginBottom: 24 }}>
                            {!isEnrolled ? (
                                <button
                                    onClick={() => setActiveModal('register')}
                                    style={{
                                        width: '100%', padding: '14px 0', borderRadius: 10, border: 'none',
                                        background: PRIMARY, color: '#fff', fontWeight: 700, fontSize: 15,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
                                    }}
                                >
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                                        <circle cx="12" cy="13" r="4" />
                                    </svg>
                                    Register Face
                                </button>
                            ) : (
                                <>
                                    {/* Check In / Out button */}
                                    <button
                                        onClick={() => eligibility === 'eligible' && setActiveModal('mark')}
                                        disabled={eligibility !== 'eligible'}
                                        style={{
                                            width: '100%', padding: '14px 0', borderRadius: 10, border: 'none', marginBottom: 10,
                                            background: eligibility === 'checking' ? '#ccc' : eligibility === 'eligible' ? PRIMARY : '#ccc',
                                            color: '#fff', fontWeight: 700, fontSize: 15,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                            cursor: eligibility === 'eligible' ? 'pointer' : 'not-allowed',
                                            opacity: eligibility === 'ineligible' ? 0.65 : 1,
                                        }}
                                    >
                                        {eligibility === 'checking' ? (
                                            <>
                                                <span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTop: '2px solid #fff', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                                                Verifying...
                                            </>
                                        ) : checkedIn ? (
                                            <>
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                                                </svg>
                                                Check Out
                                            </>
                                        ) : (
                                            <>
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                                                </svg>
                                                Check In
                                            </>
                                        )}
                                    </button>

                                    {/* Eligibility error */}
                                    {eligibility === 'ineligible' && eligibilityMsg && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d32f2f', fontSize: 12, marginBottom: 10 }}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                            </svg>
                                            {eligibilityMsg}
                                        </div>
                                    )}

                                    {/* Re-register */}
                                    <button
                                        onClick={() => setActiveModal('register')}
                                        style={{
                                            width: '100%', padding: '12px 0', borderRadius: 10, border: '1px solid #e0e0e0',
                                            background: 'transparent', color: '#666', fontWeight: 500, fontSize: 14,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer',
                                        }}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-3.51" />
                                        </svg>
                                        Re-register Face
                                    </button>
                                </>
                            )}
                        </Card>

                        {/* History Section */}
                        <p style={{ fontWeight: 700, fontSize: 17, margin: '0 0 12px', color: '#000' }}>Attendance History</p>

                        {/* Filter Pills */}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                            {(['all', 'check_in', 'check_out'] as HistoryFilter[]).map((f) => (
                                <button
                                    key={f}
                                    onClick={() => setHistoryFilter(f)}
                                    style={{
                                        flex: 1, padding: '8px 0', borderRadius: 9999,
                                        border: `0.5px solid ${historyFilter === f ? PRIMARY : '#e0e0e0'}`,
                                        background: historyFilter === f ? PRIMARY : '#fff',
                                        color: historyFilter === f ? '#fff' : '#666',
                                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                    }}
                                >
                                    {f === 'all' ? 'All' : f === 'check_in' ? 'Check In' : 'Check Out'}
                                </button>
                            ))}
                        </div>

                        {/* History records */}
                        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 32, paddingRight: 4, marginRight: -4, display: 'flex', flexDirection: 'column' }}>
                            {historyLoading ? (
                                <Card style={{ textAlign: 'center', padding: '40px 20px' }}>
                                    <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid #e0e0e0', borderTop: `2px solid ${PRIMARY}`, margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
                                </Card>
                            ) : flatEvents.length === 0 ? (
                                <Card style={{ textAlign: 'center', padding: '40px 20px' }}>
                                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', margin: '0 auto 12px' }}>
                                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                                    </svg>
                                    <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 15, color: '#000' }}>No attendance records</p>
                                    <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
                                        {historyFilter === 'all' ? 'Attendance records will appear here once marked' : `No ${historyFilter.replace('_', ' ')} records found`}
                                    </p>
                                </Card>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {flatEvents.map((ev, i) => {
                                        const isIn = ev.type === 'check_in';
                                        const d = new Date(ev.time);
                                        const dateStr = d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
                                        const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                                        return (
                                            <Card key={i} style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <div style={{
                                                    width: 48, height: 48, borderRadius: 10, flexShrink: 0,
                                                    background: isIn ? '#E8F5E9' : '#FFF3E0',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: 12, fontWeight: 700,
                                                    color: isIn ? '#2e7d32' : '#e65100',
                                                }}>
                                                    {isIn ? 'IN' : 'OUT'}
                                                </div>
                                                <div style={{ flex: 1 }}>
                                                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#000' }}>{dateStr}</p>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                                                        <p style={{ margin: 0, fontSize: 13, color: '#666' }}>{timeStr}</p>
                                                        {ev.latitude != null && ev.longitude != null && (
                                                            <span style={{ fontSize: 10, color: '#666', background: '#e0e0e0', padding: '2px 6px', borderRadius: 4, fontWeight: 500 }}>
                                                                {ev.latitude.toFixed(4)}, {ev.longitude.toFixed(4)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </Card>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        button { -webkit-tap-highlight-color: transparent; }
      `}</style>
        </>
    );
}
