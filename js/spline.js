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

    /** 경로 샘플별 누적 화면 길이(픽셀 기준). w, h는 영상 크기 */
    function arcLengths(path, w, h) {
        const cum = [0];
        for (let i = 1; i < path.length; i++) {
            cum.push(cum[i - 1] + Math.hypot((path[i].nx - path[i - 1].nx) * w, (path[i].ny - path[i - 1].ny) * h));
        }
        return cum;
    }

    /** 누적 길이 s 지점의 위치 (범위 밖은 양 끝으로 고정). index는 s 이하인 마지막 샘플 */
    function pointAtArc(path, cum, s) {
        if (!path.length) return null;
        const last = path.length - 1;
        if (s <= 0) return { nx: path[0].nx, ny: path[0].ny, index: 0 };
        if (s >= cum[last]) return { nx: path[last].nx, ny: path[last].ny, index: last };
        let lo = 0, hi = last;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (cum[mid] <= s) lo = mid; else hi = mid;
        }
        const a = path[lo], b = path[hi];
        const f = cum[hi] > cum[lo] ? (s - cum[lo]) / (cum[hi] - cum[lo]) : 0;
        return { nx: a.nx + (b.nx - a.nx) * f, ny: a.ny + (b.ny - a.ny) * f, index: lo };
    }

    /** 진행 프로필: 클릭한 점(매듭)을 클릭한 시각에 정확히 지나면서, 그 사이의 속도를 매끄럽게 잇는다.
     *  knots: [{t, s}] (시간·누적 길이 모두 증가), boost: 출발 속도 배율(1 = 첫 구간 평균 속도, 최대 3)
     *  단조 3차 보간(Fritsch-Carlson)이라 뒤로 가거나 튀지 않는다. 반환: 매듭별 기울기 포함 프로필 */
    function buildProfile(knots, boost = 1) {
        const k = knots.filter((p, i) => i === 0 || p.t > knots[i - 1].t);
        const n = k.length;
        if (n < 2) return { knots: k, slopes: k.map(() => 0) };
        const d = [];
        for (let i = 0; i < n - 1; i++) d.push((k[i + 1].s - k[i].s) / (k[i + 1].t - k[i].t));
        const m = new Array(n).fill(0);
        for (let i = 1; i < n - 1; i++) {
            m[i] = d[i - 1] > 0 && d[i] > 0 ? 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]) : 0;
        }
        m[0] = d[0] * Math.min(3, Math.max(0, boost));
        m[n - 1] = Math.min(d[n - 2], n > 2 ? 3 * d[n - 2] : d[n - 2]);
        return { knots: k, slopes: m };
    }

    /** 프로필에서 시각 t의 누적 길이 (범위 밖은 양 끝으로 고정) */
    function arcAtTime(profile, t) {
        const k = profile.knots, m = profile.slopes;
        if (!k.length) return 0;
        if (t <= k[0].t) return k[0].s;
        if (t >= k[k.length - 1].t) return k[k.length - 1].s;
        let i = 0;
        while (i < k.length - 2 && t >= k[i + 1].t) i++;
        const h = k[i + 1].t - k[i].t;
        const u = (t - k[i].t) / h, u2 = u * u, u3 = u2 * u;
        return (2 * u3 - 3 * u2 + 1) * k[i].s + (u3 - 2 * u2 + u) * h * m[i]
             + (-2 * u3 + 3 * u2) * k[i + 1].s + (u3 - u2) * h * m[i + 1];
    }

    const api = { computeSpline, computeStats, sortPoints, pointAt, arcLengths, pointAtArc, buildProfile, arcAtTime, STEPS_PER_SEGMENT };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Spline = api;
})(typeof window !== 'undefined' ? window : globalThis);
