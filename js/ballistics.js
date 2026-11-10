/* 골프공 탄도 모델과 체공 시간 기반 거리 추정 (DOM 비의존, Node 테스트 가능)
 *
 * 카메라 한 대의 화면 좌표로는 실제 거리를 잴 수 없으므로, 영상에서 정확히 얻을 수 있는
 * 체공 시간과 선택한 클럽의 일반적인 발사 조건으로 비행 모델을 맞춰 캐리를 추정한다.
 * 모델: 중력 + 항력 + 마그누스 양력, RK4 적분. 계수는 투어 평균 발사 데이터에 맞춰 보정. */
(function (root) {
    'use strict';

    const MASS = 0.04593, RADIUS = 0.02135, RHO = 1.225, G = 9.81;
    const K = 0.5 * RHO * Math.PI * RADIUS * RADIUS / MASS;
    const CD0 = 0.2, CD_SPIN = 0.3, CL_K = 0.6, CL_EXP = 0.6, CL_MAX = 0.3, SPIN_DECAY_S = 25;
    const DT = 0.005, MAX_T = 20;
    const MPH = 0.44704;

    /** 클럽별 일반적인 발사 조건: 볼스피드(mph), 발사각(도), 백스핀(rpm) */
    const CLUBS = [
        { id: 'driver', name: '드라이버', speed: 167, launch: 10.9, spin: 2686 },
        { id: '3w', name: '3번 우드', speed: 158, launch: 9.2, spin: 3655 },
        { id: '5w', name: '5번 우드', speed: 152, launch: 9.4, spin: 4350 },
        { id: 'hybrid', name: '하이브리드', speed: 146, launch: 10.2, spin: 4437 },
        { id: '3i', name: '3번 아이언', speed: 142, launch: 10.4, spin: 4630 },
        { id: '4i', name: '4번 아이언', speed: 137, launch: 11.0, spin: 4836 },
        { id: '5i', name: '5번 아이언', speed: 132, launch: 12.1, spin: 5361 },
        { id: '6i', name: '6번 아이언', speed: 127, launch: 14.1, spin: 6231 },
        { id: '7i', name: '7번 아이언', speed: 120, launch: 16.3, spin: 7097 },
        { id: '8i', name: '8번 아이언', speed: 115, launch: 18.1, spin: 7998 },
        { id: '9i', name: '9번 아이언', speed: 109, launch: 20.4, spin: 8647 },
        { id: 'pw', name: '피칭 웨지', speed: 102, launch: 24.2, spin: 9304 }
    ];

    function getClub(id) {
        return CLUBS.find(c => c.id === id) || CLUBS[0];
    }

    /** 가속도 (vx, vy: m/s, w: rad/s) */
    function accel(vx, vy, w) {
        const v = Math.hypot(vx, vy) || 1e-9;
        const s = RADIUS * w / v;
        const cd = CD0 + CD_SPIN * s;
        const cl = Math.min(CL_MAX, CL_K * Math.pow(s, CL_EXP));
        return [-K * v * (cd * vx + cl * vy), -G + K * v * (cl * vx - cd * vy)];
    }

    /** 비행 시뮬레이션. speed: m/s, launchDeg: 도, spinRpm: rpm
     *  반환: { carry(m), time(s), apex(m), apexTime(s), samples:[{t,x,y}] } */
    function simulate(speed, launchDeg, spinRpm) {
        const th = launchDeg * Math.PI / 180;
        const w0 = spinRpm * 2 * Math.PI / 60;
        let x = 0, y = 0, vx = speed * Math.cos(th), vy = speed * Math.sin(th), t = 0;
        let apex = 0, apexTime = 0;
        const samples = [{ t: 0, x: 0, y: 0 }];
        const spinAt = tt => w0 * Math.exp(-tt / SPIN_DECAY_S);
        while (t < MAX_T) {
            const [a1x, a1y] = accel(vx, vy, spinAt(t));
            const [a2x, a2y] = accel(vx + a1x * DT / 2, vy + a1y * DT / 2, spinAt(t + DT / 2));
            const [a3x, a3y] = accel(vx + a2x * DT / 2, vy + a2y * DT / 2, spinAt(t + DT / 2));
            const [a4x, a4y] = accel(vx + a3x * DT, vy + a3y * DT, spinAt(t + DT));
            const nx = x + DT * (vx + DT / 6 * (a1x + a2x + a3x));
            const ny = y + DT * (vy + DT / 6 * (a1y + a2y + a3y));
            vx += DT / 6 * (a1x + 2 * a2x + 2 * a3x + a4x);
            vy += DT / 6 * (a1y + 2 * a2y + 2 * a3y + a4y);
            if (ny < 0) {
                // 지면 통과 지점을 선형 보간
                const f = y / (y - ny);
                const carry = x + (nx - x) * f, time = t + DT * f;
                samples.push({ t: time, x: carry, y: 0 });
                return { carry, time, apex, apexTime, samples };
            }
            x = nx; y = ny; t += DT;
            if (y > apex) { apex = y; apexTime = t; }
            samples.push({ t, x, y });
        }
        return { carry: x, time: t, apex, apexTime, samples };
    }

    /** 체공 시간(초)과 클럽으로 비행을 역추정.
     *  발사각은 클럽 값으로 고정, 스핀은 속도에 비례, 볼스피드를 이분법으로 풀어 체공 시간을 맞춘다.
     *  반환: null(입력 불량) 또는 { club, speed(m/s), launch, spin, carry, time, apex, apexTime, samples, clamped } */
    function fitFlight(flightTime, clubId) {
        if (!isFinite(flightTime) || flightTime <= 0) return null;
        const club = getClub(clubId);
        const run = v => simulate(v, club.launch, club.spin * v / (club.speed * MPH));
        let lo = 5, hi = 100; // m/s (약 11~224mph)
        const tLo = run(lo).time, tHi = run(hi).time;
        let clamped = false, v;
        if (flightTime <= tLo) { v = lo; clamped = true; }
        else if (flightTime >= tHi) { v = hi; clamped = true; }
        else {
            for (let i = 0; i < 40; i++) {
                const mid = (lo + hi) / 2;
                if (run(mid).time < flightTime) lo = mid; else hi = mid;
            }
            v = (lo + hi) / 2;
        }
        const r = run(v);
        return {
            club, speed: v, launch: club.launch, spin: club.spin * v / (club.speed * MPH),
            carry: r.carry, time: r.time, apex: r.apex, apexTime: r.apexTime, samples: r.samples, clamped
        };
    }

    /** 타격 후 경과 시간 t(초)에서의 비거리(m). carryOverride가 있으면 곡선 모양은 유지하고 끝값만 맞춘다. */
    function distanceAt(flight, t, carryOverride) {
        if (!flight) return 0;
        const s = flight.samples;
        const scale = carryOverride > 0 && flight.carry > 0 ? carryOverride / flight.carry : 1;
        if (t <= 0) return 0;
        if (t >= flight.time) return flight.carry * scale;
        // 샘플 간격이 일정(DT)하므로 인덱스를 바로 계산
        const i = Math.min(s.length - 2, Math.floor(t / DT));
        const a = s[i], b = s[i + 1];
        const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
        return (a.x + (b.x - a.x) * f) * scale;
    }

    const api = { CLUBS, getClub, simulate, fitFlight, distanceAt, MPH };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Ballistics = api;
})(typeof window !== 'undefined' ? window : globalThis);
