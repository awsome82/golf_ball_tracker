/* 내보내기용 순수 헬퍼 (DOM 비의존, Node 테스트 가능) */
(function (root) {
    'use strict';

    const COMMON_FPS = [24, 25, 30, 50, 60];

    /** H.264는 짝수 해상도가 필요하다 */
    function evenSize(n) {
        const v = Math.max(2, Math.round(n));
        return v % 2 === 0 ? v : v - 1;
    }

    /** 측정한 fps를 가장 가까운 일반 fps로 보정 (잘못된 값이면 fallback) */
    function snapFps(measured, fallback = 30) {
        if (!isFinite(measured) || measured < 10 || measured > 130) return fallback;
        return COMMON_FPS.reduce((best, f) =>
            Math.abs(f - measured) < Math.abs(best - measured) ? f : best, COMMON_FPS[0]);
    }

    function frameCount(duration, fps) {
        return Math.max(1, Math.floor(duration * fps));
    }

    /** i번째 프레임의 재생 시각(초) */
    function frameTime(i, fps) {
        return i / fps;
    }

    /** i번째 프레임의 타임스탬프(마이크로초) */
    function frameTimestampUs(i, fps) {
        return Math.round((i * 1e6) / fps);
    }

    /** 해상도 기준 비트레이트 (30fps 기준 ~0.2 bit/pixel, 최소 8Mbps, 최대 50Mbps) */
    function pickBitrate(width, height, fps) {
        const bps = width * height * fps * 0.2;
        return Math.round(Math.min(50e6, Math.max(8e6, bps)));
    }

    const api = { evenSize, snapFps, frameCount, frameTime, frameTimestampUs, pickBitrate };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ExportUtils = api;
})(typeof window !== 'undefined' ? window : globalThis);
