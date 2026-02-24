'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { loadFaceApiModels, getFaceEmbedding } from '@/lib/face-api';
import { saveFaceEmbedding } from '@/lib/attendance';

type Status = 'idle' | 'loading-models' | 'ready' | 'capturing' | 'done' | 'error';
const PRIMARY = '#004d40';

interface Props {
    userId: string;
    userName: string;
    onComplete: () => void;
    onCancel: () => void;
}

export default function FaceRegistration({ userId, userName, onComplete, onCancel }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [status, setStatus] = useState<Status>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [showFaceGuide, setShowFaceGuide] = useState(false);
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
        // Auto-start
        (async () => {
            setStatus('loading-models');
            try {
                await loadFaceApiModels();
                await startCamera('user');
                setStatus('ready');
                setShowFaceGuide(true);
            } catch (e: unknown) {
                setStatus('error');
                setErrorMsg(e instanceof Error ? e.message : 'Failed to start camera');
            }
        })();
        return () => stopCamera();
    }, [stopCamera, startCamera]);

    const handleCapture = useCallback(async () => {
        if (!videoRef.current) return;
        setStatus('capturing');
        setErrorMsg('');
        try {
            const embedding = await getFaceEmbedding(videoRef.current);
            if (!embedding) {
                setStatus('ready');
                setErrorMsg('No face detected. Centre your face in the oval and try again.');
                return;
            }
            await saveFaceEmbedding(userId, Array.from(embedding));
            stopCamera();
            setStatus('done');
            setTimeout(onComplete, 1200);
        } catch (err: unknown) {
            setStatus('ready');
            setErrorMsg(err instanceof Error ? err.message : 'Failed to save face data');
        }
    }, [userId, stopCamera, onComplete]);

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

                {/* Face oval guide */}
                {showFaceGuide && status !== 'done' && (
                    <div className={`face-oval ${status === 'capturing' ? 'blinking' : 'detected'}`} />
                )}

                {/* Done tick */}
                {status === 'done' && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#4CAF50', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        </div>
                        <p style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: 0 }}>Face Registered!</p>
                    </div>
                )}

                {/* Loading */}
                {(status === 'loading-models' || status === 'idle') && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.3)', borderTop: '3px solid #fff', animation: 'spin 0.8s linear infinite' }} />
                        <p style={{ color: '#fff', fontSize: 14, margin: 0 }}>Loading face models...</p>
                    </div>
                )}

                {/* Instruction pill */}
                {status === 'ready' && (
                    <div style={{
                        position: 'absolute', top: '72%', left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                        borderRadius: 999, padding: '10px 22px', whiteSpace: 'nowrap',
                    }}>
                        <p style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: 0 }}>Position your face in the oval</p>
                    </div>
                )}

                {/* Capturing */}
                {status === 'capturing' && (
                    <div style={{
                        position: 'absolute', top: '72%', left: '50%', transform: 'translateX(-50%)',
                        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                        borderRadius: 999, padding: '10px 22px', display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                        <p style={{ color: '#fff', fontSize: 15, fontWeight: 600, margin: 0 }}>Scanning face...</p>
                    </div>
                )}

                {/* Header — close + switch camera */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '16px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{
                        background: 'rgba(0,0,0,0.5)', borderRadius: 999, padding: '6px 14px',
                        color: '#fff', fontSize: 13, fontWeight: 600,
                    }}>
                        Register Face — {userName}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {/* Switch camera */}
                        {status !== 'capturing' && status !== 'done' && (
                            <button
                                onClick={switchCamera}
                                style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                title="Switch camera"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M20 7h-9" /><path d="M14 17H5" /><polyline points="17 4 20 7 17 10" /><polyline points="7 14 4 17 7 20" />
                                </svg>
                            </button>
                        )}
                        {/* Close */}
                        {status !== 'capturing' && status !== 'done' && (
                            <button
                                onClick={() => { stopCamera(); onCancel(); }}
                                style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                                ✕
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Error & button */}
            <div style={{ background: '#000', padding: '12px 20px 32px' }}>
                {errorMsg && (
                    <p style={{ color: '#ff6b6b', fontSize: 13, textAlign: 'center', margin: '0 0 10px' }}>{errorMsg}</p>
                )}
                {status === 'ready' && (
                    <button
                        onClick={handleCapture}
                        style={{
                            width: '100%', padding: '15px 0', borderRadius: 30, border: 'none',
                            background: PRIMARY, color: '#fff', fontWeight: 700, fontSize: 16,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer',
                        }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                        </svg>
                        Capture Face
                    </button>
                )}
                {status !== 'ready' && status !== 'error' && (
                    <button
                        onClick={() => { stopCamera(); onCancel(); }}
                        style={{ display: 'block', margin: '0 auto', background: 'transparent', border: 'none', color: '#aaa', fontSize: 15, fontWeight: 500, cursor: 'pointer', padding: '8px 32px' }}
                    >
                        Cancel
                    </button>
                )}
                {status === 'error' && (
                    <button onClick={() => { stopCamera(); onCancel(); }}
                        style={{ width: '100%', padding: '14px', borderRadius: 30, border: 'none', background: '#333', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                        Go Back
                    </button>
                )}
            </div>

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
