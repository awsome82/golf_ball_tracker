const FRAME_STEP = 1 / 30; // 30fps 가정
const EXPORT_FPS = 60;

const App = {
    step: 0, 
    video: { el: null, dur: 0, w: 0, h: 0, playing: false },
    points: [], 
    splinePath: [],
    flight: null,      // Ballistics.fitFlight 결과 (거리 추정)
    carryOverride: 0,  // 사용자가 입력한 실제 캐리(m), 0이면 추정값 사용
    tracer: { width: 5, color: '#ffffff' }, // 트레이서 선 굵기(화면 px 기준)와 색
    lag: 0.1,
    isRecording: false,
    recorder: null,
    chunks: []
};

const UI = {
    file: document.getElementById('fileIn'),
    upload: document.getElementById('uploadUI'),
    canvas: document.getElementById('analysisCanvas'),
    ctx: document.getElementById('analysisCanvas').getContext('2d'),
    seek: document.getElementById('seek'),
    timelineMarkers: document.getElementById('timelineMarkers'), // Timeline Markers
    time: document.getElementById('timeDisplay'),
    btnPlay: document.getElementById('btnPlay'),
    btnPrev: document.getElementById('btnPrevFrame'),
    btnNext: document.getElementById('btnNextFrame'),
    steps: [1,2,3,4,5].map(n => document.getElementById(`step${n}`)),
    title: document.getElementById('msgTitle'),
    body: document.getElementById('msgBody'),
    btn: document.getElementById('mainBtn'),
    resultBtns: document.getElementById('resultBtns'),
    dlBtn: document.getElementById('downloadBtn'),
    addInfoBtn: document.getElementById('addInfoBtn'),
    undo: document.getElementById('undoBtn'),
    stats: document.getElementById('statsPanel'),
    badge: document.getElementById('stepBadge'),
    exportOverlay: document.getElementById('exportOverlay'),
    // Info
    infoPanel: document.getElementById('infoInputPanel'),
    overlay: document.getElementById('broadcastOverlay'),
    confirmInfo: document.getElementById('confirmInfoBtn'),
    inputs: {
        name: document.getElementById('inName'),
        score: document.getElementById('inScore'),
        hole: document.getElementById('inHole'),
        dist: document.getElementById('inDist'),
        shot: document.getElementById('inShot'),
        course: document.getElementById('inCourse')
    },
    displays: {
        name: document.getElementById('dispName'),
        score: document.getElementById('dispScore'),
        hole: document.getElementById('dispHole'),
        dist: document.getElementById('dispDist'),
        course: document.getElementById('dispCourse')
    }
};

// --- Init ---
window.onload = () => {
    App.video.el = document.getElementById('videoElement');
    UI.file.addEventListener('change', loadVideo);
    
    App.video.el.addEventListener('loadedmetadata', onVideoReady);
    App.video.el.addEventListener('timeupdate', onTimeUpdate);
    App.video.el.addEventListener('ended', onVideoEnded);
    App.video.el.addEventListener('error', onVideoError);

    UI.btnPlay.addEventListener('click', togglePlay);
    UI.seek.addEventListener('input', (e) => {
        if(App.isRecording) return;
        App.video.el.currentTime = e.target.value;
        render();
    });
    const endDrag = () => { App.seekDragging = false; };
    UI.seek.addEventListener('pointerup', endDrag);
    UI.seek.addEventListener('pointercancel', endDrag);
    UI.seek.addEventListener('change', endDrag);
    UI.seek.addEventListener('pointerdown', () => {
        App.seekDragging = true;
        if(App.isRecording) return;
        App.video.el.pause();
        App.video.playing = false;
        updatePlayIcon();
    });

    UI.btnPrev.addEventListener('click', () => !App.isRecording && frameStep(-FRAME_STEP));
    UI.btnNext.addEventListener('click', () => !App.isRecording && frameStep(FRAME_STEP));

    UI.canvas.addEventListener('pointerdown', onCanvasClick);
    UI.btn.addEventListener('click', onMainAction);
    UI.addInfoBtn.addEventListener('click', () => setStep(5));
    UI.confirmInfo.addEventListener('click', () => {
        updateOverlay();
        const originalText = UI.confirmInfo.innerText;
        UI.confirmInfo.innerHTML = '<i class="fa-solid fa-check"></i> 적용 완료';
        UI.confirmInfo.classList.add('is-done');
        setTimeout(() => {
            setStep(4); 
            setTimeout(() => {
                UI.confirmInfo.innerText = originalText;
                UI.confirmInfo.classList.remove('is-done');
            }, 500);
        }, 1000);
    });
    UI.undo.addEventListener('click', onUndo);
    const clubSel = document.getElementById('clubSelect'); // 옵션은 index.html에 정의
    const onFlightInput = () => { if(App.splinePath.length) { updateFlight(); render(); } };
    clubSel.addEventListener('change', onFlightInput);
    document.getElementById('carryInput').addEventListener('input', onFlightInput);
    initTracerControls();
    UI.dlBtn.addEventListener('click', startExport);
    document.getElementById('exportCancelBtn').addEventListener('click', () => { App.exportCancel = true; });

    window.addEventListener('resize', () => {
        render();
        if(App.step===5 || !UI.overlay.classList.contains('hidden')) {
            adjustFontSize(UI.displays.name);
            adjustFontSize(UI.displays.course);
        }
    });
    requestAnimationFrame(animLoop);
};

// --- Marker Update Logic ---
function updateTimelineMarkers() {
    UI.timelineMarkers.innerHTML = ''; // Clear existing
    
    if (App.video.dur === 0) return;

    App.points.forEach((p, idx) => {
        const pct = (p.t / App.video.dur) * 100;
        const marker = document.createElement('div');
        marker.className = 't-marker';
        marker.style.left = `${pct}%`;

        if (p.type === 'start') {
            marker.classList.add('tm-impact');
            marker.title = "Impact";
        } else if (p.type === 'mid') {
            // Check if this is the LAST mid point (Apex)
            // Find index of last mid point
            let lastMidIndex = -1;
            for(let i = App.points.length-1; i>=0; i--) {
                if(App.points[i].type === 'mid') {
                    lastMidIndex = i;
                    break;
                }
            }

            if (idx === lastMidIndex) {
                 marker.classList.add('tm-apex');
                 marker.title = "Apex";
            } else {
                 marker.classList.add('tm-mid');
                 marker.title = "Mid";
            }
        } else if (p.type === 'end') {
            marker.classList.add('tm-landing');
            marker.title = "Landing";
        }
        
        UI.timelineMarkers.appendChild(marker);
    });
}


function adjustFontSize(element) {
    if (!element) return;
    element.style.fontSize = "";
    if (element.scrollWidth > element.clientWidth) {
        let currentSize = parseFloat(window.getComputedStyle(element).fontSize);
        while (element.scrollWidth > element.clientWidth && currentSize > 8) {
            currentSize -= 0.5;
            element.style.fontSize = currentSize + "px";
        }
    }
}

function loadVideo(e) {
    const f = e.target.files[0];
    if(!f) return;
    if(App.video.el.src.startsWith('blob:')) URL.revokeObjectURL(App.video.el.src);
    App.video.file = f;
    App.video.el.src = URL.createObjectURL(f);
    App.video.el.muted = false; 
    UI.upload.classList.add('hidden');
}

let toastTimer = null;
function showToast(msg) {
    let el = document.getElementById('toast');
    if(!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.setAttribute('role', 'alert');
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

function onVideoError() {
    UI.upload.classList.remove('hidden');
    UI.file.value = '';
    showToast('영상을 불러올 수 없습니다. 지원되는 영상 파일인지 확인하세요.');
}

function onVideoReady() {
    App.video.dur = App.video.el.duration;
    App.video.w = App.video.el.videoWidth;
    App.video.h = App.video.el.videoHeight;
    // Set canvas size to match video resolution for export quality
    UI.canvas.width = App.video.w;
    UI.canvas.height = App.video.h;
    
    UI.seek.max = App.video.dur;
    setStep(1);
    render();
    updateTimelineMarkers();
}

function togglePlay() {
    if(App.isRecording) return;
    if(App.video.el.paused) {
        App.video.el.play();
        App.video.playing = true;
    } else {
        App.video.el.pause();
        App.video.playing = false;
    }
    updatePlayIcon();
}

function updatePlayIcon() {
    UI.btnPlay.innerHTML = App.video.playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
}

function frameStep(dt) {
    App.video.el.pause();
    App.video.playing = false;
    updatePlayIcon();
    App.video.el.currentTime = Math.max(0, Math.min(App.video.dur, App.video.el.currentTime + dt));
}

function onTimeUpdate() {
    // 프레임 이동·seek 때도 슬라이더가 따라오게 함 (드래그 중에는 건드리지 않음)
    if(!App.seekDragging) UI.seek.value = App.video.el.currentTime;
    UI.time.textContent = App.video.el.currentTime.toFixed(2);
}

function onVideoEnded() {
    App.video.playing = false;
    updatePlayIcon();
    // webm 실시간 녹화 중일 때만 종료 (MP4 내보내기는 자체 루프로 제어)
    if(App.isRecording && App.recorder && App.recorder.state === 'recording') stopExport();
}

// --- Export Logic ---
function createRecorder(stream) {
    const candidates = [
        { mimeType: 'video/webm; codecs=vp9', videoBitsPerSecond: 25000000 },
        { mimeType: 'video/webm', videoBitsPerSecond: 15000000 },
        {}
    ];
    for(const opts of candidates) {
        if(opts.mimeType && !MediaRecorder.isTypeSupported(opts.mimeType)) continue;
        try { return new MediaRecorder(stream, opts); } catch(e) { /* 다음 후보 시도 */ }
    }
    return null;
}

function startExportWebm() {
    if(App.isRecording) return;
    if(typeof MediaRecorder === 'undefined' || !UI.canvas.captureStream) {
        showToast('이 브라우저는 영상 저장을 지원하지 않습니다. 최신 Chrome/Edge를 사용하세요.');
        return;
    }

    const canvasStream = UI.canvas.captureStream(EXPORT_FPS);
    // 영상 오디오 트랙 캡처 (실패해도 무음으로 진행)
    try {
        const el = App.video.el;
        const vStream = el.captureStream ? el.captureStream()
            : (el.mozCaptureStream ? el.mozCaptureStream() : null);
        if(vStream && vStream.getAudioTracks().length > 0) {
            canvasStream.addTrack(vStream.getAudioTracks()[0]);
        }
    } catch(e) {
        console.warn('오디오 캡처 실패, 무음으로 저장합니다.', e);
    }

    const recorder = createRecorder(canvasStream);
    if(!recorder) {
        showToast('영상 녹화기를 만들 수 없습니다.');
        return;
    }

    App.isRecording = true;
    UI.exportOverlay.classList.remove('hidden');
    App.video.el.pause();
    App.video.el.currentTime = 0;

    App.recorder = recorder;
    App.chunks = [];
    App.exportCancel = false;
    recorder.ondataavailable = e => { if(e.data.size > 0) App.chunks.push(e.data); };
    recorder.onstop = saveRecording;
    recorder.start();
    App.video.el.play();
    App.video.playing = true;
}

function saveRecording() {
    const blob = new Blob(App.chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'protrax_analysis.webm';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

function stopExport() {
    App.isRecording = false;
    UI.exportOverlay.classList.add('hidden');
    if(App.recorder && App.recorder.state !== 'inactive') App.recorder.stop();
    render();
}

// --- Canvas Drawing for Overlay (Export) ---
function drawCanvasOverlay(ctx) {
    // Only draw if info exists
    if (UI.overlay.classList.contains('hidden')) return;

    const W = UI.canvas.width;
    const H = UI.canvas.height;
    const scale = W / 1280; // Base scale on 720p width approx

    const boxW = 260 * scale;
    const top = 30 * scale;
    const left = 30 * scale;
    const row1H = 50 * scale;
    const row2H = 35 * scale;
    const row3H = 30 * scale;

    ctx.font = `bold ${24*scale}px "Teko", sans-serif`;
    ctx.textBaseline = 'middle';

    // Row 1: Name & Score
    // Name Box (White)
    ctx.fillStyle = 'white';
    ctx.fillRect(left, top, boxW * 0.75, row1H);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    // Auto fit name
    let fontSize = 24*scale;
    ctx.font = `bold ${fontSize}px "Teko", sans-serif`;
    const nameText = UI.inputs.name.value.toUpperCase();
    while(ctx.measureText(nameText).width > (boxW*0.7) && fontSize > 10) {
        fontSize--;
        ctx.font = `bold ${fontSize}px "Teko", sans-serif`;
    }
    ctx.fillText(nameText, left + (boxW*0.75)/2, top + row1H/2 + (2*scale));

    // Score Box (Red)
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(left + boxW * 0.75, top, boxW * 0.25, row1H);
    ctx.fillStyle = 'white';
    ctx.font = `bold ${28*scale}px "Roboto", sans-serif`;
    ctx.fillText(UI.inputs.score.value, left + boxW * 0.75 + (boxW*0.25)/2, top + row1H/2 + (2*scale));

    // Row 2: Stats & Shot
    const top2 = top + row1H;
    ctx.fillStyle = '#15803d';
    ctx.fillRect(left, top2, boxW, row2H);
    
    // Stats Text
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    ctx.font = `bold ${18*scale}px "Roboto", sans-serif`;
    
    // Hole
    const holeX = left + 10*scale;
    ctx.fillText(UI.inputs.hole.value, holeX, top2 + row2H/2);
    const holeW = ctx.measureText(UI.inputs.hole.value).width;
    ctx.font = `400 ${12*scale}px "Roboto", sans-serif`;
    ctx.fillText("TH", holeX + holeW + 2*scale, top2 + row2H/2);

    // Dist
    ctx.font = `bold ${18*scale}px "Roboto", sans-serif`;
    const distX = holeX + holeW + 35*scale;
    ctx.fillText(UI.inputs.dist.value, distX, top2 + row2H/2);
    const distW = ctx.measureText(UI.inputs.dist.value).width;
    ctx.font = `400 ${12*scale}px "Roboto", sans-serif`;
    ctx.fillText("YDS", distX + distW + 2*scale, top2 + row2H/2);

    // Shot Tiles
    const shotVal = parseInt(UI.inputs.shot.value);
    const tileS = 20*scale;
    const gap = 3*scale;
    const startX = left + boxW - (4*tileS + 3*gap) - 10*scale;
    
    for(let i=1; i<=4; i++) {
        const x = startX + (i-1)*(tileS+gap);
        const y = top2 + (row2H - tileS)/2;
        
        if(i === shotVal) {
            ctx.fillStyle = 'white';
            ctx.fillRect(x, y, tileS, tileS);
            ctx.fillStyle = '#15803d';
        } else {
            ctx.fillStyle = '#0f5f2c'; // Darker green
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, tileS, tileS);
            ctx.fillRect(x, y, tileS, tileS);
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
        }
        
        ctx.font = `bold ${14*scale}px "Roboto", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(i, x + tileS/2, y + tileS/2 + 1*scale);
    }

    // Row 3: Course
    const top3 = top2 + row2H;
    ctx.fillStyle = '#facc15';
    ctx.fillRect(left, top3, boxW, row3H);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    
    fontSize = 16*scale;
    ctx.font = `bold ${fontSize}px "Teko", sans-serif`;
    const courseText = UI.inputs.course.value.toUpperCase();
    while(ctx.measureText(courseText).width > (boxW*0.9) && fontSize > 8) {
        fontSize--;
        ctx.font = `bold ${fontSize}px "Teko", sans-serif`;
    }
    ctx.fillText(courseText, left + boxW/2, top3 + row3H/2 + 1*scale);
}

// --- Logic ---
function setStep(s) {
    App.step = s;
    updateUI();
}

function updateUI() {
    UI.steps.forEach((el, i) => {
        if(!el) return; 
        const isActive = (i+1 === App.step);
        const isPast = (i+1 < App.step);
        el.className = 'step' + (isActive ? ' is-active' : isPast ? ' is-done' : '');
        if (isActive) {
            el.setAttribute('aria-current', 'step');
            UI.badge.innerText = `STEP ${i+1} / ${UI.steps.length}`;
        } else el.removeAttribute('aria-current');
    });
    
    UI.undo.classList.add('hidden');
    UI.btn.classList.remove('hidden');
    UI.resultBtns.classList.add('hidden');
    UI.infoPanel.classList.add('hidden');
    
    switch(App.step) {
        case 1:
            UI.title.innerText = "타격 시점 (Impact) 설정";
            UI.body.innerText = "공이 타격되는 순간(Impact)의 위치를 정확히 클릭하세요.";
            setBtn("위치 클릭 대기중", false);
            break;
        case 2:
            UI.title.innerText = "중간 궤적 입력";
            UI.body.innerHTML = "공이 날아가는 경로를 따라 1개 이상의 점을 클릭하세요.<br><b>마지막 점이 최고점(APEX)으로 기록됩니다.</b>";
            const ptCount = App.points.filter(p => p.type === 'mid').length;
            setBtn(ptCount >= 1 ? "다음: 낙하지점 설정" : "최소 1개 이상 입력", ptCount >= 1);
            UI.undo.classList.remove('hidden');
            break;
        case 3:
            UI.title.innerText = "낙하지점 (Landing Point) 설정";
            UI.body.innerText = "공이 지면에 닿는 순간을 찾아 클릭하세요. 궤적의 끝점입니다.";
            setBtn("위치 클릭 대기중", false);
            UI.undo.classList.remove('hidden');
            break;
        case 4:
            UI.title.innerText = "분석 완료";
            UI.body.innerText = "궤적을 따라 비거리(m)가 표시됩니다. 클럽을 선택하면 추정이 정확해집니다.\n정보를 추가하고 영상을 저장할 수 있습니다.";
            UI.btn.classList.add('hidden');
            UI.resultBtns.classList.remove('hidden');
            UI.stats.classList.remove('hidden');
            break;
        case 5:
            UI.title.innerText = "방송 정보 입력";
            UI.body.innerText = "화면 좌측 상단에 표시될 플레이어 및 코스 정보를 입력하세요.";
            UI.btn.classList.add('hidden');
            UI.stats.classList.add('hidden');
            UI.infoPanel.classList.remove('hidden');
            updateOverlay(); 
            break;
    }
}

function setBtn(txt, active) {
    UI.btn.innerText = txt;
    UI.btn.disabled = !active;
}

function onMainAction() {
    if(App.step === 2) {
        setStep(3);
        App.video.el.currentTime = Math.min(App.video.dur, App.video.el.currentTime + 1.5);
    } else if(App.step === 4) {
        // Replay not on main button anymore
    }
}

function updateOverlay() {
    UI.displays.name.innerText = UI.inputs.name.value;
    UI.displays.score.innerText = UI.inputs.score.value;
    UI.displays.hole.innerText = UI.inputs.hole.value;
    UI.displays.dist.innerText = UI.inputs.dist.value;
    UI.displays.course.innerText = UI.inputs.course.value;

    const shot = parseInt(UI.inputs.shot.value);
    for(let i=1; i<=4; i++) {
        const el = document.getElementById(`shot${i}`);
        if(i === shot) {
            el.className = "shot-num shot-active";
        } else {
            el.className = "shot-num shot-inactive";
        }
    }
    UI.overlay.classList.remove('hidden');
    adjustFontSize(UI.displays.name);
    adjustFontSize(UI.displays.course);
}

function onUndo() {
    if(App.points.length > 0) {
        App.points.pop();
        if(App.points.length === 0) { 
            setStep(1); 
            // Remove impact marker
            updateTimelineMarkers();
        }
        else if(App.points.length > 0 && App.points[App.points.length-1].type === 'start') setStep(2);
        else updateUI();
        render();
        updateTimelineMarkers();
    }
}

// 현재 모드(편집/내보내기)에 맞춰 캔버스 크기와 정규좌표→픽셀 변환 함수를 계산
function getMapping() {
    if(App.isRecording) {
        // 내보내기: 원본 해상도, 영상이 캔버스를 가득 채움
        UI.canvas.width = App.video.w;
        UI.canvas.height = App.video.h;
        const w = UI.canvas.width, h = UI.canvas.height;
        return { w, h, vidW: w, vidH: h, ox: 0, oy: 0,
                 toPx: (nx, ny) => ({ x: nx * w, y: ny * h }) };
    }
    // 편집: 캔버스는 화면 크기, 영상은 object-fit: contain
    const rect = UI.canvas.getBoundingClientRect();
    UI.canvas.width = rect.width;
    UI.canvas.height = rect.height;
    const w = rect.width, h = rect.height;
    const scale = Math.min(w / App.video.w, h / App.video.h);
    const vidW = App.video.w * scale;
    const vidH = App.video.h * scale;
    const ox = (w - vidW) / 2;
    const oy = (h - vidH) / 2;
    App.displayVidW = vidW; // 내보내기 시 화면과 같은 비율로 선 굵기를 맞추기 위해 기억
    return { w, h, vidW, vidH, ox, oy,
             toPx: (nx, ny) => ({ x: ox + nx * vidW, y: oy + ny * vidH }) };
}

function onCanvasClick(e) {
    if(App.step === 5 || App.isRecording || !App.video.w) return;

    const m = getMapping();
    const rect = UI.canvas.getBoundingClientRect();
    const normX = (e.clientX - rect.left - m.ox) / m.vidW;
    const normY = (e.clientY - rect.top - m.oy) / m.vidH;
    if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return;

    const t = App.video.el.currentTime;
    const pt = { t, nx: normX, ny: normY, type: '' };

    if (App.step === 1) {
        pt.type = 'start';
        App.points = [pt];
        App.video.el.currentTime += 0.04; 
        setStep(2);
    } else if(App.step === 2) {
        if(t <= App.points[0].t) { showToast("타격 시점보다 뒤의 시간을 선택하세요."); return; }
        pt.type = 'mid';
        App.points.push(pt);
        App.points = Spline.sortPoints(App.points);
        updateUI();
    } else if(App.step === 3) {
        const lastPt = App.points[App.points.length-1];
        if(t <= lastPt.t) { showToast("이전 점보다 뒤의 시간을 선택하세요."); return; }
        pt.type = 'end';
        App.points.push(pt);
        calculateSpline();
        setStep(4);
    }
    render();
    updateTimelineMarkers();
}

function calculateSpline() {
    App.points = Spline.sortPoints(App.points);
    App.splinePath = Spline.computeSpline(App.points);
    updateStats();
}

function updateStats() {
    const st = Spline.computeStats(App.points, App.splinePath, App.video.h);
    document.getElementById('statTime').innerText = st.flightTime.toFixed(2);
    updateFlight();
    renderChart();
}

// 체공 시간과 선택한 클럽으로 거리를 추정하고 통계 패널을 갱신
function updateFlight() {
    if(App.points.length < 2) return;
    const T = App.points[App.points.length-1].t - App.points[0].t;
    App.flight = Ballistics.fitFlight(T, document.getElementById('clubSelect').value);
    App.carryOverride = parseFloat(document.getElementById('carryInput').value) || 0;
    const f = App.flight;
    const set = (id, txt) => { document.getElementById(id).innerText = txt; };
    if(!f) { ['statCarry','statSpeed','statHeight'].forEach(id => set(id, '--')); return; }
    set('statCarry', Math.round(carryMeters()) + ' m');
    // 볼스피드와 높이는 모델 추정값 (실제 캐리를 입력해도 바뀌지 않음)
    set('statSpeed', Math.round(f.speed * 3.6) + ' km/h');
    set('statHeight', Math.round(f.apex) + ' m');
    document.getElementById('carryNote').innerText = App.carryOverride > 0
        ? '입력한 실제 캐리 기준으로 표시합니다.'
        : (f.clamped ? '체공 시간이 모델 범위를 벗어나 정확도가 낮습니다.' : '체공 시간과 클럽으로 추정한 값입니다.');
}

function carryMeters() {
    if(!App.flight) return 0;
    return App.carryOverride > 0 ? App.carryOverride : App.flight.carry;
}

function animLoop() {
    if(App.video.playing) {
        UI.seek.value = App.video.el.currentTime;
        UI.time.textContent = App.video.el.currentTime.toFixed(2);
        render();
    }
    requestAnimationFrame(animLoop);
}

function render() {
    if(!App.video.w) return;
    const ctx = UI.ctx;
    const m = getMapping();

    if(App.isRecording) {
        ctx.drawImage(App.video.el, 0, 0, m.w, m.h);
        if (App.step >= 4) {
            // 화면(웹)에서 보이는 것과 같은 비율이 되도록, 화면 좌표계로 그린 뒤 원본 해상도로 확대
            const k = App.displayVidW ? m.w / App.displayVidW : 1;
            ctx.save();
            ctx.scale(k, k);
            drawMeteorTrajectory(ctx, (nx, ny) => ({ x: nx * m.w / k, y: ny * m.h / k }));
            ctx.restore();
            drawCanvasOverlay(ctx); // 스코어보드
        }
    } else {
        ctx.clearRect(0, 0, m.w, m.h);
        if (App.step >= 4) {
            drawMeteorTrajectory(ctx, m.toPx);
        } else {
            drawSimpleTrajectory(ctx, m.toPx);
            drawPoints(ctx, m.toPx);
        }
    }
}

function drawPoints(ctx, toScreen) {
    App.points.forEach((p, i) => {
        const pos = toScreen(p.nx, p.ny);
        let radius = 6;
        let color = '#fbbf24'; 
        let border = '#fff';
        let label = '';
        if(p.type === 'start') {
            radius = 6; color = '#ffffff'; label = 'S';
        } else if(p.type === 'mid') {
            radius = 3; color = '#fbbf24'; 
        } else if(p.type === 'end') {
            radius = 6; color = 'rgba(255, 255, 255, 0.8)'; border = '#ffffff'; label = 'Landing Point'; 
        }
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI*2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = border;
        ctx.lineWidth = 2;
        ctx.stroke();
        if(label) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px sans-serif';
            ctx.fillText(label, pos.x + radius + 4, pos.y + 4);
        }
    });
}

// --- 트레이서 스타일 (굵기·색) ---
const TRACER_KEY = 'protrax.tracer';

function initTracerControls() {
    try {
        const saved = JSON.parse(localStorage.getItem(TRACER_KEY) || 'null');
        if(saved && saved.width >= 2 && saved.width <= 12) App.tracer.width = saved.width;
        if(saved && /^#[0-9a-f]{6}$/i.test(saved.color)) App.tracer.color = saved.color;
    } catch(e) { /* 저장소를 쓸 수 없으면 기본값 사용 */ }

    const widthIn = document.getElementById('tracerWidth');
    const colorIn = document.getElementById('tracerColor');
    const swatches = Array.from(document.querySelectorAll('.tracer-swatch'));
    const sync = () => {
        widthIn.value = App.tracer.width;
        document.getElementById('tracerWidthVal').innerText = App.tracer.width;
        colorIn.value = App.tracer.color;
        swatches.forEach(b => b.setAttribute('aria-pressed',
            String(b.dataset.color.toLowerCase() === App.tracer.color.toLowerCase())));
    };
    const apply = () => {
        sync();
        try { localStorage.setItem(TRACER_KEY, JSON.stringify(App.tracer)); } catch(e) { /* 무시 */ }
        if(!App.isRecording) render();
    };
    widthIn.addEventListener('input', () => { App.tracer.width = parseFloat(widthIn.value); apply(); });
    colorIn.addEventListener('input', () => { App.tracer.color = colorIn.value; apply(); });
    swatches.forEach(b => {
        b.style.background = b.dataset.color;
        b.addEventListener('click', () => { App.tracer.color = b.dataset.color; apply(); });
    });
    sync();
}

function drawSimpleTrajectory(ctx, toScreen) {
    if(App.splinePath.length === 0) return;
    ctx.save();
    ctx.beginPath();
    App.splinePath.forEach((p, i) => {
        const q = toScreen(p.nx, p.ny);
        if(i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    });
    ctx.strokeStyle = App.tracer.color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = App.tracer.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
}

// 트레이서 전용 레이어 (구간별 투명도를 겹침 없이 합성하기 위한 오프스크린 캔버스)
let tracerLayer = null;
const TRACER_BANDS = 64;

function drawMeteorTrajectory(ctx, toScreen) {
    if(App.splinePath.length === 0) return;

    const drawLimit = App.video.el.currentTime - App.lag;
    // 머리 위치를 현재 시각에 맞춰 보간 → 매 프레임 균일하게 전진
    const head = Spline.pointAt(App.splinePath, drawLimit);
    if(drawLimit > App.splinePath[0].t) {
        const pts = App.splinePath.slice(0, head.index + 1).map(p => toScreen(p.nx, p.ny));
        const headPos = toScreen(head.nx, head.ny);
        const lastPt = pts[pts.length - 1];
        if(Math.hypot(headPos.x - lastPt.x, headPos.y - lastPt.y) > 0.01) pts.push(headPos);
        if(pts.length > 1) {
            drawTracerLine(ctx, pts);
            drawArrow(ctx, pts[pts.length - 2], pts[pts.length - 1]);
        }
    }
    drawDistanceLabel(ctx, toScreen, drawLimit);
}

// 꼬리는 투명, 머리는 불투명한 선. 구간(band)마다 앞 구간과 겹치는 부분을 지운 뒤 그려
// 반투명 선이 겹쳐 구슬처럼 보이는 현상을 없앤다.
function drawTracerLine(ctx, pts) {
    const cv = ctx.canvas;
    if(!tracerLayer) tracerLayer = document.createElement('canvas');
    if(tracerLayer.width !== cv.width || tracerLayer.height !== cv.height) {
        tracerLayer.width = cv.width;
        tracerLayer.height = cv.height;
    }
    const L = tracerLayer.getContext('2d');
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.clearRect(0, 0, cv.width, cv.height);
    L.setTransform(ctx.getTransform());
    // 끝을 평평하게(butt) 해야 지우는 영역이 앞 구간을 파먹지 않는다
    L.lineCap = 'butt';
    L.lineJoin = 'round';
    L.strokeStyle = App.tracer.color;

    const w = App.tracer.width;
    const n = pts.length - 1; // 선분 수
    const bands = Math.min(TRACER_BANDS, n);
    for(let b = 0; b < bands; b++) {
        // 앞 구간과 선분 하나만큼 겹치게 시작해 경계의 실금을 없앤다 (겹친 부분은 아래에서 지우고 다시 그림)
        const from = Math.max(0, Math.floor(b * n / bands) - 1);
        const to = Math.floor((b + 1) * n / bands);
        if(to <= from) continue;
        L.beginPath();
        L.moveTo(pts[from].x, pts[from].y);
        for(let i = from + 1; i <= to; i++) L.lineTo(pts[i].x, pts[i].y);

        const alpha = Math.pow((b + 1) / bands, 2);
        // 1) 이 구간이 덮을 영역을 먼저 지움 (앞 구간과 겹치는 부분 제거)
        L.globalCompositeOperation = 'destination-out';
        L.globalAlpha = 1;
        L.lineWidth = w * 2.4;
        L.stroke();
        // 2) 옅은 글로우 + 본선
        L.globalCompositeOperation = 'source-over';
        L.globalAlpha = alpha * 0.22;
        L.stroke();
        L.globalAlpha = alpha;
        L.lineWidth = w;
        L.stroke();
    }
    L.globalAlpha = 1;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tracerLayer, 0, 0);
    ctx.restore();
}

// 트레이서 머리(공) 옆에 실시간 거리, 낙하 후에는 최종 캐리 표시
function drawDistanceLabel(ctx, toScreen, headTime) {
    if(!App.flight || App.points.length < 2) return;
    const start = App.points[0], end = App.points[App.points.length-1];
    const elapsed = headTime - start.t;
    if(elapsed <= 0) return;
    const landed = headTime >= end.t;

    // 머리 위치: 스플라인에서 headTime 이하의 마지막 점
    const head = Spline.pointAt(App.splinePath, headTime);
    const pos = toScreen(head.nx, head.ny);

    // 클릭한 체공 시간과 모델 시간을 맞춰 0 → 캐리로 증가
    const flightT = end.t - start.t;
    const frac = Math.min(1, elapsed / flightT);
    const meters = Math.round(Ballistics.distanceAt(App.flight, frac * App.flight.time, App.carryOverride));
    const value = String(meters);

    const FONT = '"Teko", "Noto Sans KR", sans-serif';
    const H = 26, PAD = 8;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = `700 23px ${FONT}`;
    const wValue = ctx.measureText(value).width;
    ctx.font = `600 14px ${FONT}`;
    const wUnit = ctx.measureText('M').width;
    const wTag = landed ? ctx.measureText('CARRY').width + 6 : 0;
    const W = PAD * 2 + wTag + wValue + 3 + wUnit;

    // 영상 영역 안에 머물도록 위치 보정
    const tl = toScreen(0, 0), br = toScreen(1, 1);
    let x = pos.x + 12, y = pos.y - H - 8;
    if(x + W > br.x - 4) x = pos.x - W - 12;
    if(y < tl.y + 4) y = pos.y + 10;
    x = Math.max(tl.x + 4, x);

    ctx.fillStyle = landed ? 'rgba(21, 128, 61, 0.92)' : 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(x, y, W, H, 4); else ctx.rect(x, y, W, H);
    ctx.fill();

    let cx = x + PAD;
    const cy = y + H / 2 + 1.5;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    if(landed) {
        ctx.font = `600 14px ${FONT}`;
        ctx.fillText('CARRY', cx, cy);
        cx += wTag;
    }
    ctx.font = `700 23px ${FONT}`;
    ctx.fillText(value, cx, cy);
    ctx.font = `600 14px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('M', cx + wValue + 3, cy + 1.5);
    ctx.restore();
}

function drawArrow(ctx, prevPos, lastPos) {
    const angle = Math.atan2(lastPos.y - prevPos.y, lastPos.x - prevPos.x);
    const k = App.tracer.width / 3; // 선 굵기에 비례

    ctx.save();
    ctx.translate(lastPos.x, lastPos.y);
    ctx.rotate(angle);
    ctx.scale(k, k);

    // Rounded Arrow
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(-6, -4);
    ctx.quadraticCurveTo(-4, 0, -6, 4);
    ctx.closePath();
    ctx.fillStyle = App.tracer.color;
    ctx.fill();

    // 머리 글로우 (가운데는 흰색으로 밝게)
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 8);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI*2);
    ctx.fill();

    ctx.restore();
}

// --- Chart ---
let chart = null;
function renderChart() {
    if(chart) chart.destroy();
    const ctx = document.getElementById('chart').getContext('2d');
    const startY = App.points[0].ny;
    const data = App.splinePath.map(p => (startY - p.ny) * 100); 
    const labels = App.splinePath.map(p => (p.t - App.points[0].t).toFixed(1));

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Height',
                data: data,
                borderColor: '#ffffff', // White Chart Line
                backgroundColor: (context) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
                    gradient.addColorStop(0, 'rgba(255,255,255,0.5)');
                    gradient.addColorStop(1, 'rgba(255,255,255,0)');
                    return gradient;
                },
                fill: true,
                pointRadius: 0,
                tension: 0.4, 
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: {display: false}, tooltip: {mode: 'index', intersect: false} },
            scales: { x: {display: false}, y: {display: false} }
        }
    });
}
