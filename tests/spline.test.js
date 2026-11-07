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
