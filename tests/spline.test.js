const test = require('node:test');
const assert = require('node:assert');
const { computeSpline, computeStats, sortPoints, STEPS_PER_SEGMENT } = require('../js/spline.js');

const pts = [
    { t: 0, nx: 0.1, ny: 0.8 },
    { t: 1, nx: 0.4, ny: 0.3 },
    { t: 3, nx: 0.9, ny: 0.9 }
];

test('sortPoints는 원본을 변경하지 않는다', () => {
    const input = [{ t: 2 }, { t: 1 }];
    const out = sortPoints(input);
    assert.deepStrictEqual(out.map(p => p.t), [1, 2]);
    assert.deepStrictEqual(input.map(p => p.t), [2, 1]);
});

test('스플라인은 시작/끝점을 지나고 길이가 맞다', () => {
    const path = computeSpline(pts);
    assert.strictEqual(path.length, (pts.length - 1) * STEPS_PER_SEGMENT + 1);
    assert.deepStrictEqual(path[0], { nx: 0.1, ny: 0.8, t: 0 });
    assert.deepStrictEqual(path[path.length - 1], { nx: 0.9, ny: 0.9, t: 3 });
});

test('시간은 단조 증가한다', () => {
    const path = computeSpline(pts);
    for (let i = 1; i < path.length; i++) assert.ok(path[i].t >= path[i - 1].t);
});

test('빈 입력은 빈 경로', () => {
    assert.deepStrictEqual(computeSpline([]), []);
});

test('통계: 비행시간과 최고점 높이', () => {
    const path = computeSpline(pts);
    const s = computeStats(pts, path, 1000);
    assert.strictEqual(s.flightTime, 3);
    assert.ok(s.apexHeightPx >= 500 - 1e-6); // (0.8-0.3)*1000 이상
});

test('pointAt: 샘플 사이 보간과 범위 밖 고정', () => {
    const { pointAt } = require('../js/spline.js');
    const path = [{ t: 0, nx: 0, ny: 0 }, { t: 1, nx: 1, ny: 2 }, { t: 3, nx: 3, ny: 2 }];
    assert.deepStrictEqual(pointAt(path, 0.5), { nx: 0.5, ny: 1, t: 0.5, index: 0 });
    assert.deepStrictEqual(pointAt(path, 2), { nx: 2, ny: 2, t: 2, index: 1 });
    assert.deepStrictEqual(pointAt(path, -1), { nx: 0, ny: 0, t: 0, index: 0 });
    assert.deepStrictEqual(pointAt(path, 9), { nx: 3, ny: 2, t: 3, index: 2 });
    assert.strictEqual(pointAt([], 1), null);
});

test('arcLengths / pointAtArc: 누적 길이와 위치', () => {
    const S = require('../js/spline.js');
    const path = [{ nx: 0, ny: 0 }, { nx: 0.3, ny: 0 }, { nx: 0.3, ny: 0.4 }];
    const cum = S.arcLengths(path, 100, 100);
    assert.deepStrictEqual(cum.map(v => Math.round(v)), [0, 30, 70]);
    const p = S.pointAtArc(path, cum, 50);
    assert.ok(Math.abs(p.nx - 0.3) < 1e-9 && Math.abs(p.ny - 0.2) < 1e-9);
    assert.strictEqual(p.index, 1);
    assert.strictEqual(S.pointAtArc(path, cum, -5).index, 0);
    assert.strictEqual(S.pointAtArc(path, cum, 999).index, 2);
});

test('진행 프로필: 매듭을 정확히 지나고 단조 증가하며 출발 배율이 반영된다', () => {
    const S = require('../js/spline.js');
    const knots = [{ t: 0, s: 0 }, { t: 1, s: 600 }, { t: 3, s: 1000 }];
    for (const boost of [1, 2, 3]) {
        const pr = S.buildProfile(knots, boost);
        for (const k of knots) assert.ok(Math.abs(S.arcAtTime(pr, k.t) - k.s) < 1e-9);
        let prev = -1;
        for (let t = 0; t <= 3.0001; t += 0.01) {
            const s = S.arcAtTime(pr, t);
            assert.ok(s >= prev - 1e-9, `boost ${boost} t ${t}`);
            prev = s;
        }
        assert.strictEqual(S.arcAtTime(pr, -1), 0);
        assert.strictEqual(S.arcAtTime(pr, 9), 1000);
    }
    const early = b => S.arcAtTime(S.buildProfile(knots, b), 0.1);
    assert.ok(early(2) > early(1) && early(3) > early(2));
    // 출발 속도 = 첫 구간 평균 속도 × 배율
    assert.ok(Math.abs(S.arcAtTime(S.buildProfile(knots, 2), 0.001) / 0.001 - 1200) < 5);
});

test('진행 프로필: 같은 시각의 매듭은 건너뛴다', () => {
    const S = require('../js/spline.js');
    const pr = S.buildProfile([{ t: 0, s: 0 }, { t: 0, s: 5 }, { t: 2, s: 10 }], 2);
    assert.strictEqual(pr.knots.length, 2);
    assert.ok(Math.abs(S.arcAtTime(pr, 2) - 10) < 1e-9);
});
