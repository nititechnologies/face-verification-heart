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
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const [step, setStep] = useState<Step>('loading');
    const [error, setError] = useState('');
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
    const [showFlash, setShowFlash] = useState(false);
    const [statusText, setStatusText] = useState('');

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

        // ── INSTANT: freeze frame + flash ──
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (canvas) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                if (facingMode === 'user') {
                    ctx.translate(canvas.width, 0);
                    ctx.scale(-1, 1);
                }
                ctx.drawImage(video, 0, 0);
            }
        }

        // Flash + processing — all synchronous state updates batched by React
        setShowFlash(true);
        setStep('processing');
        setError('');
        setStatusText('Verifying...');
        setTimeout(() => setShowFlash(false), 150);

        // CRITICAL: yield to browser so it paints the frozen frame + spinner
        // before the heavy face detection blocks the main thread
        await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

        try {
            // Time check
            const timeOk = isCheckIn ? isCheckInAllowed(college) : isCheckOutAllowed(college);
            if (!timeOk) throw new Error(
                isCheckIn ? 'Check-in is only allowed before college start time' : 'Check-out only after college end time'
            );

            // Run face embedding on frozen canvas AND geofence concurrently
            const embeddingPromise = getFaceEmbedding(canvas!);
            const geoPromise = validateGeofence(college);

            const [embedding, geo] = await Promise.all([embeddingPromise, geoPromise]);

            if (!geo.valid) throw new Error(geo.message);
            if (!embedding) throw new Error('No face detected. Centre your face and try again.');

            const stored = userProfile.faceEmbedding;
            if (!stored?.length) throw new Error('No registered face found. Please register first.');

            const dist = euclideanDistance(Array.from(embedding), stored);
            if (dist > FACE_MATCH_THRESHOLD) {
                throw new Error('Face not recognised. Please try again or re-register.');
            }
            const confidence = Math.max(0, 1 - dist / FACE_MATCH_THRESHOLD);

            const latitude = geo.latitude;
            const longitude = geo.longitude;

            setStatusText('Saving...');
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
    }, [college, isCheckIn, userProfile, stopCamera, onSuccess, facingMode]);

    const PRIMARY = '#004d40';
    const isFrozen = step === 'processing' || step === 'done';

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#000', display: 'flex', flexDirection: 'column' }}>

            {/* Camera / Frozen frame */}
            <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                {/* Live video (hidden when frozen) */}
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{
                        width: '100%', height: '100%', objectFit: 'cover',
                        transform: facingMode === 'user' ? 'scaleX(-1)' : 'none',
                        display: isFrozen ? 'none' : 'block',
                    }}
                />

                {/* Canvas — drawn to on capture, shown as frozen frame */}
                <canvas
                    ref={canvasRef}
                    style={{
                        display: isFrozen ? 'block' : 'none',
                        width: '100%', height: '100%', objectFit: 'cover',
                    }}
                />

                {/* Shutter flash */}
                {showFlash && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        background: '#fff',
                        animation: 'flashFade 0.15s ease-out forwards',
                        zIndex: 10,
                    }} />
                )}

                {/* Oval guide (only when live) */}
                {!isFrozen && <div className="face-oval detected" />}

                {/* Close (X) button */}
                {(step === 'ready' || step === 'loading') && (
                    <button
                        onClick={() => { stopCamera(); onCancel(); }}
                        style={{ position: 'absolute', top: 12, left: 12, width: 38, height: 38, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}
                        title="Close"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                )}

                {/* Check In / Out badge */}
                <div style={{ position: 'absolute', top: 16, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, paddingLeft: 52, paddingRight: 52 }}>
                    <div style={{
                        background: isCheckIn ? 'rgba(0,77,64,0.85)' : 'rgba(183,28,28,0.85)',
                        borderRadius: 999, padding: '6px 18px',
                        color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                    }}>
                        {isCheckIn ? '↗ Check In' : '↙ Check Out'}
                    </div>
                </div>

                {/* Switch camera button */}
                {step === 'ready' && (
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

                {/* Processing overlay (on top of frozen frame) */}
                {step === 'processing' && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                        <div style={{ width: 44, height: 44, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.2)', borderTop: `3px solid ${PRIMARY}`, animation: 'spin 0.6s linear infinite' }} />
                        <p style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: 0 }}>{statusText}</p>
                    </div>
                )}

                {/* Done overlay */}
                {step === 'done' && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                        <div style={{
                            width: 80, height: 80, borderRadius: '50%', background: '#4CAF50',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            animation: 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards',
                        }}>
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        </div>
                        <p style={{ color: '#fff', fontSize: 17, fontWeight: 700, margin: 0 }}>
                            {isCheckIn ? 'Checked In!' : 'Checked Out!'}
                        </p>
                    </div>
                )}
            </div>

            {/* Bottom bar — always rendered for constant height */}
            <div style={{ background: '#000', padding: '16px 20px 36px', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                {/* Floating error pill above button */}
                {error && (
                    <div style={{
                        position: 'absolute', bottom: '100%', left: 16, right: 16, marginBottom: 8,
                        background: 'rgba(183,28,28,0.92)', backdropFilter: 'blur(8px)',
                        color: '#fff', fontSize: 13, textAlign: 'center',
                        padding: '10px 16px', borderRadius: 12,
                        animation: 'slideUp 0.2s ease-out',
                    }}>
                        {error}
                    </div>
                )}

                {(step === 'ready' || step === 'loading') ? (
                    <button
                        onClick={handleCapture}
                        disabled={step === 'loading'}
                        style={{
                            width: '100%', padding: '15px 0', borderRadius: 30, border: 'none',
                            background: step === 'loading' ? '#555' : PRIMARY,
                            color: '#fff', fontWeight: 700, fontSize: 16,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            cursor: step === 'loading' ? 'not-allowed' : 'pointer',
                            transition: 'transform 0.1s',
                        }}
                        onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                        onPointerUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                        </svg>
                        Capture
                    </button>
                ) : (
                    /* Invisible spacer to keep same height during processing/done */
                    <div style={{ width: '100%', padding: '15px 0', visibility: 'hidden', fontSize: 16, fontWeight: 700 }}>&nbsp;</div>
                )}
            </div>

            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
                @keyframes flashFade { from { opacity: 1; } to { opacity: 0; } }
                @keyframes popIn { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                @keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
}
