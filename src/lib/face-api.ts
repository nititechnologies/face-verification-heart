'use client';

import * as faceapi from '@vladmandic/face-api';

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

export async function loadFaceApiModels(): Promise<void> {
    if (modelsLoaded) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]).then(() => {
        modelsLoaded = true;
    });

    return loadingPromise;
}

export async function getFaceEmbedding(
    videoOrCanvas: HTMLVideoElement | HTMLCanvasElement
): Promise<Float32Array | null> {
    const detection = await faceapi
        .detectSingleFace(videoOrCanvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

    if (!detection) return null;
    return detection.descriptor;
}

export async function detectFaceWithLandmarks(
    videoOrCanvas: HTMLVideoElement | HTMLCanvasElement
): Promise<faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }> | null> {
    const detection = await faceapi
        .detectSingleFace(videoOrCanvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
        .withFaceLandmarks();
    return detection ?? null;
}

export function euclideanDistance(emb1: number[], emb2: number[]): number {
    return faceapi.euclideanDistance(emb1, emb2);
}

// Threshold matching Flutter's web app: 0.5 euclidean distance
export const FACE_MATCH_THRESHOLD = 0.5;
