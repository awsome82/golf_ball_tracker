/* 궤적 계산용 순수 함수 (DOM 비의존, Node 테스트 가능) */
(function (root) {
    'use strict';

    const STEPS_PER_SEGMENT = 40;

    /** 시간순 정렬된 복사본 반환 (원본 불변) */
    function sortPoints(points) {
        return points.slice().sort((a, b) => a.t - b.t);
    }

    /** Catmull-Rom 스플라인 경로 계산. points: [{t, nx, ny}] */
    function computeSpline(points, steps = STEPS_PER_SEGMENT) {
        const P = sortPoints(points);
        const path = [];
        if (P.length === 0) return path;
        for (let i = 0; i < P.length - 1; i++) {
            const p0 = i > 0 ? P[i - 1] : P[i];
            const p1 = P[i];
            const p2 = P[i + 1];
            const p3 = i < P.length - 2 ? P[i + 2] : P[i + 1];
            for (let s = 0; s < steps; s++) {
                const t = s / steps;
                const tt = t * t;
                const ttt = tt * t;
                const q1 = -ttt + 2 * tt - t;
                const q2 = 3 * ttt - 5 * tt + 2;
                const q3 = -3 * ttt + 4 * tt + t;
                const q4 = ttt - tt;
                path.push({
                    nx: 0.5 * (p0.nx * q1 + p1.nx * q2 + p2.nx * q3 + p3.nx * q4),
                    ny: 0.5 * (p0.ny * q1 + p1.ny * q2 + p2.ny * q3 + p3.ny * q4),
                    t: p1.t + (p2.t - p1.t) * t
                });
            }
        }
        const last = P[P.length - 1];
        path.push({ nx: last.nx, ny: last.ny, t: last.t });
        return path;
    }

    /** 비행시간(초)과 최고점 높이(영상 픽셀) 계산 */
    function computeStats(points, path, videoHeight) {
        const P = sortPoints(points);
        const start = P[0];
        const end = P[P.length - 1];
        let minNy = start.ny;
        path.forEach(p => { if (p.ny < minNy) minNy = p.ny; });
        return {
            flightTime: end.t - start.t,
            apexHeightPx: (start.ny - minNy) * videoHeight
        };
    }

    /** 시각 t에서의 경로 위치를 샘플 사이 선형 보간으로 구한다 (범위 밖은 양 끝으로 고정).
     *  반환: { nx, ny, t, index } — index는 t 이하인 마지막 샘플의 위치 */
    function pointAt(path, t) {
        if (!path.length) return null;
        const first = path[0], last = path[path.length - 1];
        if (t <= first.t) return { nx: first.nx, ny: first.ny, t: first.t, index: 0 };
        if (t >= last.t) return { nx: last.nx, ny: last.ny, t: last.t, index: path.length - 1 };
        let lo = 0, hi = path.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (path[mid].t <= t) lo = mid; else hi = mid;
        }
        const a = path[lo], b = path[hi];
        const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
        return { nx: a.nx + (b.nx - a.nx) * f, ny: a.ny + (b.ny - a.ny) * f, t, index: lo };
    }

    const api = { computeSpline, computeStats, sortPoints, pointAt, STEPS_PER_SEGMENT };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Spline = api;
})(typeof window !== 'undefined' ? window : globalThis);
