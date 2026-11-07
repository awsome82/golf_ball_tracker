const test = require('node:test');
const assert = require('node:assert');
const U = require('../js/export-utils.js');

test('evenSize는 짝수로 내림', () => {
    assert.strictEqual(U.evenSize(1081), 1080);
    assert.strictEqual(U.evenSize(1080), 1080);
    assert.strictEqual(U.evenSize(0), 2);
});

test('snapFps는 가까운 일반 fps로 보정', () => {
    assert.strictEqual(U.snapFps(29.97), 30);
    assert.strictEqual(U.snapFps(59.9), 60);
    assert.strictEqual(U.snapFps(23.976), 24);
    assert.strictEqual(U.snapFps(NaN), 30);
    assert.strictEqual(U.snapFps(500), 30);
});

test('프레임 수/시각/타임스탬프', () => {
    assert.strictEqual(U.frameCount(2, 30), 60);
    assert.strictEqual(U.frameCount(0, 30), 1);
    assert.strictEqual(U.frameTime(15, 30), 0.5);
    assert.strictEqual(U.frameTimestampUs(30, 30), 1000000);
    assert.strictEqual(U.frameTimestampUs(1, 30), 33333);
});

test('pickBitrate는 범위 안', () => {
    assert.strictEqual(U.pickBitrate(640, 360, 30), 8e6);
    assert.strictEqual(U.pickBitrate(3840, 2160, 60), 50e6);
    const mid = U.pickBitrate(1920, 1080, 30);
    assert.ok(mid > 8e6 && mid < 50e6);
});
