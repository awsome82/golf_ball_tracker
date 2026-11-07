/* MP4(H.264 + AAC) 오프라인 내보내기: WebCodecs + mp4-muxer
 * 재생 없이 프레임을 하나씩 정확히 렌더링해 인코딩하므로 프레임 누락이 없다.
 * 의존: app.js(App, UI, render, showToast), export-utils.js, Mp4Muxer(전역) */
'use strict';

const AUDIO_SAMPLE_RATE = 48000;
const H264_CODECS = ['avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42001f'];

function seekTo(t) {
    return new Promise(resolve => {
        const v = App.video.el;
        if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) { resolve(); return; }
        v.addEventListener('seeked', () => resolve(), { once: true });
        v.currentTime = t;
    });
}

/** 재생 중 프레임 간격으로 fps 추정 (실패 시 30) */
function detectFps() {
    const v = App.video.el;
    if (!v.requestVideoFrameCallback) return Promise.resolve(30);
    return new Promise(resolve => {
        const times = [];
        const prevTime = v.currentTime, prevMuted = v.muted;
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            v.pause();
            v.muted = prevMuted;
            v.currentTime = prevTime;
            const d = [];
            for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
            d.sort((a, b) => a - b);
            const median = d.length ? d[Math.floor(d.length / 2)] : 0;
            resolve(ExportUtils.snapFps(median > 0 ? 1 / median : NaN));
        };
        const cb = (now, meta) => {
            times.push(meta.mediaTime);
            if (times.length >= 12) finish(); else v.requestVideoFrameCallback(cb);
        };
        v.muted = true;
        v.requestVideoFrameCallback(cb);
        v.play().catch(finish);
        setTimeout(finish, 1500);
    });
}

async function pickVideoConfig(width, height, fps, bitrate) {
    for (const codec of H264_CODECS) {
        const cfg = { codec, width, height, bitrate, framerate: fps, latencyMode: 'quality' };
        try {
            const r = await VideoEncoder.isConfigSupported(cfg);
            if (r.supported) return cfg;
        } catch (e) { /* 다음 코덱 시도 */ }
    }
    return null;
}

/** 원본 오디오를 디코딩. 오디오가 없거나 실패하면 null */
async function decodeAudio() {
    if (!App.video.file || !window.AudioEncoder || !window.AudioData) return null;
    try {
        const buf = await App.video.file.arrayBuffer();
        const ctx = new OfflineAudioContext(2, 1, AUDIO_SAMPLE_RATE);
        const audio = await ctx.decodeAudioData(buf);
        const channels = Math.min(2, audio.numberOfChannels);
        // AAC 우선, 미지원이면 Opus로 폴백
        for (const [codec, muxCodec] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
            const cfg = { codec, sampleRate: audio.sampleRate, numberOfChannels: channels, bitrate: 192000 };
            const r = await AudioEncoder.isConfigSupported(cfg);
            if (r.supported) return { audio, cfg, channels, muxCodec };
        }
        return null;
    } catch (e) {
        console.warn('오디오 디코딩 실패, 무음으로 저장합니다.', e);
        return null;
    }
}

async function encodeAudio(info, muxer) {
    const { audio, cfg, channels } = info;
    const encoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: e => { throw e; }
    });
    encoder.configure(cfg);
    const CHUNK = 4096;
    const total = audio.length;
    for (let start = 0; start < total; start += CHUNK) {
        if (App.exportCancel) break;
        const n = Math.min(CHUNK, total - start);
        const data = new Float32Array(n * channels);
        for (let c = 0; c < channels; c++) {
            data.set(audio.getChannelData(c).subarray(start, start + n), c * n);
        }
        const ad = new AudioData({
            format: 'f32-planar', sampleRate: audio.sampleRate, numberOfFrames: n,
            numberOfChannels: channels, timestamp: Math.round(start / audio.sampleRate * 1e6), data
        });
        encoder.encode(ad);
        ad.close();
        if (encoder.encodeQueueSize > 16) {
            await new Promise(r => encoder.addEventListener('dequeue', r, { once: true }));
        }
    }
    await encoder.flush();
    encoder.close();
}

function setProgress(text) {
    const el = document.getElementById('exportProgress');
    if (el) el.textContent = text;
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function canExportMp4() {
    return !!(window.VideoEncoder && window.VideoFrame && window.Mp4Muxer);
}

async function startExportMp4() {
    const v = App.video.el;
    v.pause();
    App.video.playing = false;
    updatePlayIcon();
    App.exportCancel = false;
    App.isRecording = true;
    UI.exportOverlay.classList.remove('hidden');
    setProgress('준비 중...');

    let videoEncoder = null;
    const restoreTime = v.currentTime;
    try {
        const fps = await detectFps();
        const width = ExportUtils.evenSize(App.video.w);
        const height = ExportUtils.evenSize(App.video.h);
        const bitrate = ExportUtils.pickBitrate(width, height, fps);
        const vcfg = await pickVideoConfig(width, height, fps, bitrate);
        if (!vcfg) throw new Error('H.264 인코더를 사용할 수 없습니다.');

        setProgress('오디오 처리 중...');
        const audioInfo = await decodeAudio();

        const muxer = new Mp4Muxer.Muxer({
            target: new Mp4Muxer.ArrayBufferTarget(),
            video: { codec: 'avc', width, height, frameRate: fps },
            audio: audioInfo ? { codec: audioInfo.muxCodec, numberOfChannels: audioInfo.channels, sampleRate: audioInfo.audio.sampleRate } : undefined,
            fastStart: 'in-memory'
        });

        let encodeError = null;
        videoEncoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: e => { encodeError = e; }
        });
        videoEncoder.configure(vcfg);

        // H.264 짝수 해상도 보정용 캔버스
        const out = document.createElement('canvas');
        out.width = width; out.height = height;
        const octx = out.getContext('2d');

        const total = ExportUtils.frameCount(App.video.dur, fps);
        for (let i = 0; i < total; i++) {
            if (App.exportCancel) throw new Error('cancelled');
            if (encodeError) throw encodeError;
            await seekTo(Math.min(ExportUtils.frameTime(i, fps), App.video.dur - 0.001));
            render();
            octx.drawImage(UI.canvas, 0, 0, width, height);
            const frame = new VideoFrame(out, { timestamp: ExportUtils.frameTimestampUs(i, fps), duration: Math.round(1e6 / fps) });
            videoEncoder.encode(frame, { keyFrame: i % fps === 0 });
            frame.close();
            if (videoEncoder.encodeQueueSize > 8) {
                await new Promise(r => videoEncoder.addEventListener('dequeue', r, { once: true }));
            }
            if (i % 5 === 0) setProgress(`${Math.round((i / total) * 100)}% (${i}/${total} 프레임, ${fps}fps)`);
        }
        await videoEncoder.flush();
        if (encodeError) throw encodeError;

        if (audioInfo) {
            setProgress('오디오 인코딩 중...');
            await encodeAudio(audioInfo, muxer);
        }
        if (App.exportCancel) throw new Error('cancelled');

        muxer.finalize();
        downloadBlob(new Blob([muxer.target.buffer], { type: 'video/mp4' }), 'protrax_analysis.mp4');
        showToast('MP4 저장이 완료되었습니다.');
    } catch (e) {
        if (e.message !== 'cancelled') {
            console.error(e);
            showToast('MP4 저장 중 오류가 발생했습니다: ' + e.message);
        }
    } finally {
        try { if (videoEncoder && videoEncoder.state !== 'closed') videoEncoder.close(); } catch (e) { /* 무시 */ }
        App.isRecording = false;
        UI.exportOverlay.classList.add('hidden');
        v.currentTime = restoreTime;
        render();
    }
}

/** MP4(WebCodecs)를 우선 사용하고, 미지원 브라우저는 webm 실시간 녹화로 폴백 */
function startExport() {
    if (App.isRecording) return;
    if (canExportMp4()) startExportMp4();
    else {
        showToast('이 브라우저는 MP4 저장을 지원하지 않아 WebM으로 저장합니다.');
        startExportWebm();
    }
}
