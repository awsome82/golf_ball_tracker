const test = require('node:test');
const assert = require('node:assert');
const U = require('../js/export-utils.js');

test('evenSize는 짝수로 내림', () => {
    assert.strictEqual(U.evenSize(1081), 1080);
    assert.strictEqual(U.evenSize(1080), 1080);
    assert.strictEqual(U.evenSize(0), 2);
});

test('snapFps는 가까운 일반 fps로 보정', () => {
    assert.strictEqual(U.snapFps(29.97), 29.97);
    assert.strictEqual(U.snapFps(59.94), 59.94);
    assert.strictEqual(U.snapFps(30.01), 30);
    assert.strictEqual(U.snapFps(23.976), 23.976);
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

test('seekTimeForFrame은 프레임 중간 시각', () => {
    assert.strictEqual(U.seekTimeForFrame(0, 30), 0.5 / 30);
    assert.ok(U.seekTimeForFrame(10, 25) > U.frameTime(10, 25));
    assert.ok(U.seekTimeForFrame(10, 25) < U.frameTime(11, 25));
});

test('pickBitrate는 범위 안', () => {
    assert.strictEqual(U.pickBitrate(640, 360, 30), 10e6);
    assert.strictEqual(U.pickBitrate(3840, 2160, 60), 60e6);
    const mid = U.pickBitrate(1920, 1080, 30);
    assert.ok(mid > 10e6 && mid < 60e6);
});
