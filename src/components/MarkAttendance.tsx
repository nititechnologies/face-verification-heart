'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { loadFaceApiModels, getFaceEmbedding, euclideanDistance, FACE_MATCH_THRESHOLD } from '@/lib/face-api';
import {
    markAttendance,
    validateGeofence,
    isCheckInAllowed,
    isCheckOutAllowed,
    CollegeDetails,
    UserProfile,
} from '@/lib/attendance';

type Step = 'loading' | 'ready' | 'processing' | 'done';

interface Props {
    userProfile: UserProfile;
    college: CollegeDetails | null;
    isCheckIn: boolean;
    onSuccess: () => void;
    onCancel: () => void;
}

export default function MarkAttendance({ userProfile, college, isCheckIn, onSuccess, onCancel }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const [step, setStep] = useState<Step>('loading');
    const [error, setError] = useState('');
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

    const stopCamera = useCallback(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
    }, []);

    const startCamera = useCallback(async (mode: 'user' | 'environment') => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        streamRef.current = stream;
        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => { });
        }
    }, []);

    const switchCamera = useCallback(async () => {
        const next: 'user' | 'environment' = facingMode === 'user' ? 'environment' : 'user';
        setFacingMode(next);
        await startCamera(next);
    }, [facingMode, startCamera]);

    useEffect(() => {
        (async () => {
            try {
                await loadFaceApiModels();
                await startCamera('user');
                setStep('ready');
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : 'Failed to start camera');
                setStep('ready');
            }
        })();
        return () => stopCamera();
    }, [stopCamera, startCamera]);

    const handleCapture = useCallback(async () => {
        if (!videoRef.current) return;
        setStep('processing');
        setError('');

        try {
            // Time check
            const timeOk = isCheckIn ? isCheckInAllowed(college) : isCheckOutAllowed(college);
            if (!timeOk) throw new Error(
                isCheckIn ? 'Check-in is only allowed before college start time' : 'Check-out only after college end time'
            );

            // Geofence (non-blocking if location unavailable)
            const geo = await validateGeofence(college);
            if (!geo.valid) throw new Error(geo.message);

            // Get face embedding
            const embedding = await getFaceEmbedding(videoRef.current);
            if (!embedding) throw new Error('No face detected. Centre your face and try again.');

            const stored = userProfile.faceEmbedding;
            if (!stored?.length) throw new Error('No registered face found. Please register first.');

            const dist = euclideanDistance(Array.from(embedding), stored);
            if (dist > FACE_MATCH_THRESHOLD) {
                throw new Error('Face not recognised. Please try again or re-register.');
            }
            const confidence = Math.max(0, 1 - dist / FACE_MATCH_THRESHOLD);

            // Location (optional)
            let latitude: number | undefined, longitude: number | undefined;
            try {
                const pos = await new Promise<GeolocationPosition>((res, rej) =>
                    navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
                );
                latitude = pos.coords.latitude;
                longitude = pos.coords.longitude;
            } catch (_) { }

            await markAttendance({
                userId: userProfile.uid,
                userName: userProfile.name,
                type: isCheckIn ? 'check_in' : 'check_out',
                confidence,
                latitude,
                longitude,
            });

            stopCamera();
            setStep('done');
            setTimeout(onSuccess, 1200);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
            setStep('ready');
        }
    }, [college, isCheckIn, userProfile, stopCamera, onSuccess]);

    const PRIMARY = '#004d40';

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#000', display: 'flex', flexDirection: 'column' }}>
            {/* Camera */}
            <div style={{ position: 'relative', flex: 1 }}>
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '100%', height: '100%', objectFit: 'cover', transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
                />

                {/* Oval guide */}
                <div className="face-oval detected" />

                {/* Check In / Out badge + switch camera */}
                <div style={{ position: 'absolute', top: 16, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, paddingRight: 52 }}>
                    <div style={{
                        background: isCheckIn ? 'rgba(0,77,64,0.85)' : 'rgba(183,28,28,0.85)',
                        borderRadius: 999, padding: '6px 18px',
                        color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                    }}>
                        {isCheckIn ? '↗ Check In' : '↙ Check Out'}
                    </div>
                </div>
                {/* Switch camera button */}
                {step !== 'processing' && step !== 'done' && (
                    <button
                        onClick={switchCamera}
                        style={{ position: 'absolute', top: 12, right: 12, width: 38, height: 38, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Switch camera"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 7h-9" /><path d="M14 17H5" /><polyline points="17 4 20 7 17 10" /><polyline points="7 14 4 17 7 20" />
                        </svg>
                    </button>
                )}

                {/* Loading overlay */}
                {step === 'loading' && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.3)', borderTop: '3px solid #fff', animation: 'spin 0.8s linear infinite' }} />
                        <p style={{ color: '#fff', fontSize: 14, margin: 0 }}>Loading...</p>
                    </div>
                )}

                {/* Processing overlay */}
                {step === 'processing' && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.3)', borderTop: `3px solid ${PRIMARY}`, animation: 'spin 0.8s linear infinite' }} />
                        <p style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: 0 }}>Verifying face...</p>
                    </div>
                )}

                {/* Done overlay */}
                {step === 'done' && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#4CAF50', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        </div>
                        <p style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: 0 }}>
                            {isCheckIn ? 'Checked In!' : 'Checked Out!'}
                        </p>
                    </div>
                )}
            </div>

            {/* Error */}
            {error && (
                <div style={{ background: '#b71c1c', color: '#fff', fontSize: 13, textAlign: 'center', padding: '10px 16px' }}>
                    {error}
                </div>
            )}

            {/* Bottom bar — Capture + Cancel */}
            {step !== 'processing' && step !== 'done' && (
                <div style={{ background: '#000', padding: '16px 20px 36px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <button
                        onClick={handleCapture}
                        disabled={step === 'loading'}
                        style={{
                            width: '100%', padding: '15px 0', borderRadius: 30, border: 'none',
                            background: step === 'loading' ? '#555' : PRIMARY,
                            color: '#fff', fontWeight: 700, fontSize: 16,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            cursor: step === 'loading' ? 'not-allowed' : 'pointer',
                        }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                        </svg>
                        Capture
                    </button>
                    <button
                        onClick={() => { stopCamera(); onCancel(); }}
                        style={{
                            background: 'transparent', border: 'none', color: '#aaa',
                            fontSize: 15, fontWeight: 500, cursor: 'pointer', padding: '8px',
                        }}
                    >
                        Cancel
                    </button>
                </div>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
