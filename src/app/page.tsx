'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { getUserProfile, getCollegeDetails, UserProfile, CollegeDetails } from '@/lib/attendance';
import dynamic_ from 'next/dynamic';

const AttendanceDashboard = dynamic_(() => import('@/components/AttendanceDashboard'), { ssr: false });
const FaceRegistration = dynamic_(() => import('@/components/FaceRegistration'), { ssr: false });
const MarkAttendance = dynamic_(() => import('@/components/MarkAttendance'), { ssr: false });

export default function Home() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [college, setCollege] = useState<CollegeDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [flowType, setFlowType] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uid = params.get('uid');
    const type = params.get('type');
    setFlowType(type);

    if (!uid) {
      setError('No user ID provided. Please open this page from the app.');
      setLoading(false);
      return;
    }
    getUserProfile(uid)
      .then(async (p) => {
        if (!p) {
          setError('User not found.');
        } else {
          setProfile(p);
          if (p.collegeId) {
            const c = await getCollegeDetails(p.collegeId);
            setCollege(c);
          }
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f8f8' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #e0e0e0', borderTop: '3px solid #004d40', margin: '0 auto 12px', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ fontSize: 14, color: '#666', margin: 0 }}>Loading...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f8f8f8' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 32, margin: '0 0 12px' }}>⚠️</p>
          <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>Something went wrong</p>
          <p style={{ fontSize: 13, color: '#666', margin: 0 }}>{error}</p>
        </div>
      </div>
    );
  }

  // If a specific flow type is requested, render only that component
  if (flowType === 'register') {
    return (
      <FaceRegistration
        userId={profile!.uid}
        userName={profile!.name}
        onComplete={() => {
          // Notify Flutter that registration succeeded
          if (window.FlutterChannel) window.FlutterChannel.postMessage('success');
        }}
        onCancel={() => {
          if (window.FlutterChannel) window.FlutterChannel.postMessage('cancel');
        }}
      />
    );
  }

  if (flowType === 'checkin' || flowType === 'checkout') {
    return (
      <MarkAttendance
        userProfile={profile!}
        college={college}
        isCheckIn={flowType === 'checkin'}
        onSuccess={() => {
          if (window.FlutterChannel) window.FlutterChannel.postMessage('success');
        }}
        onCancel={() => {
          if (window.FlutterChannel) window.FlutterChannel.postMessage('cancel');
        }}
      />
    );
  }

  // Fallback: render the entire dashboard
  return <AttendanceDashboard profile={profile!} />;
}

// Add TypeScript definition for the Flutter JavascriptChannel
declare global {
  interface Window {
    FlutterChannel?: {
      postMessage: (message: string) => void;
    };
  }
}
