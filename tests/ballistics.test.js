const test = require('node:test');
const assert = require('node:assert');
const B = require('../js/ballistics.js');

const YD = 0.9144;
// 투어 평균 캐리(yd)
const CARRY = { driver: 275, '3w': 243, '5w': 230, hybrid: 225, '3i': 212, '4i': 203, '5i': 194, '6i': 183, '7i': 172, '8i': 160, '9i': 148, pw: 136 };

test('simulate: 투어 평균 발사 조건에서 캐리 오차 7% 이내', () => {
    for (const c of B.CLUBS) {
        const r = B.simulate(c.speed * B.MPH, c.launch, c.spin);
        const err = Math.abs(r.carry / YD - CARRY[c.id]) / CARRY[c.id];
        assert.ok(err < 0.07, `${c.id}: ${(r.carry / YD).toFixed(0)}yd vs ${CARRY[c.id]}yd`);
    }
});

test('simulate: 체공 시간과 최고점이 현실적인 범위', () => {
    const r = B.simulate(167 * B.MPH, 10.9, 2686);
    assert.ok(r.time > 5.5 && r.time < 7.5);
    assert.ok(r.apex / YD > 25 && r.apex / YD < 40);
    assert.ok(r.apexTime > 0 && r.apexTime < r.time);
});

test('fitFlight: 체공 시간에서 원래 비행을 복원', () => {
    for (const c of B.CLUBS) {
        const truth = B.simulate(c.speed * B.MPH, c.launch, c.spin);
        const fit = B.fitFlight(truth.time, c.id);
        assert.ok(Math.abs(fit.carry - truth.carry) / truth.carry < 0.01, c.id);
        assert.ok(Math.abs(fit.time - truth.time) < 0.01);
        assert.strictEqual(fit.clamped, false);
    }
});

test('fitFlight: 체공 시간이 길수록 캐리가 길다', () => {
    const a = B.fitFlight(4, 'driver'), b = B.fitFlight(5, 'driver'), c = B.fitFlight(6, 'driver');
    assert.ok(a.carry < b.carry && b.carry < c.carry);
});

test('fitFlight: 잘못된 입력과 범위 밖 처리', () => {
    assert.strictEqual(B.fitFlight(0, 'driver'), null);
    assert.strictEqual(B.fitFlight(NaN, 'driver'), null);
    assert.strictEqual(B.fitFlight(60, 'driver').clamped, true);
    assert.strictEqual(B.fitFlight(3, 'unknown').club.id, 'driver');
});

test('distanceAt: 0에서 캐리까지 단조 증가, 보정값 적용', () => {
    const f = B.fitFlight(5.5, '7i');
    assert.strictEqual(B.distanceAt(f, 0), 0);
    assert.strictEqual(B.distanceAt(f, -1), 0);
    let prev = 0;
    for (let t = 0; t <= f.time; t += 0.1) {
        const d = B.distanceAt(f, t);
        assert.ok(d >= prev);
        prev = d;
    }
    assert.strictEqual(B.distanceAt(f, f.time + 1), f.carry);
    assert.ok(Math.abs(B.distanceAt(f, f.time + 1, 150) - 150) < 1e-9);
    assert.ok(Math.abs(B.distanceAt(f, f.time / 2, 150) - B.distanceAt(f, f.time / 2) * 150 / f.carry) < 1e-9);
    assert.strictEqual(B.distanceAt(null, 1), 0);
});

test('index.html의 클럽 옵션이 CLUBS와 일치', () => {
    const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
    const select = html.match(/<select id="clubSelect"[\s\S]*?<\/select>/)[0];
    const opts = [...select.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g)].map(m => [m[1], m[2]]);
    assert.deepStrictEqual(opts, B.CLUBS.map(c => [c.id, c.name]));
});
