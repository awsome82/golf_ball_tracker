# ProTrax – Golf Ball Tracer

골프 영상 위에 공의 비행 궤적(트레이서)과 중계 스타일 스코어보드를 입히고 `.webm`으로 저장하는 브라우저 도구입니다. 서버·빌드 없이 동작합니다.

https://awsome82.github.io/golf_ball_tracker/

## 사용법
1. 영상 파일 업로드
2. **타격** 지점 클릭 → **중간 궤적**(1개 이상, 마지막 점이 최고점) 클릭 → **낙하** 지점 클릭
3. 결과 확인 (비행 시간, 최고점 높이[px], 높이 차트)
4. (선택) 방송 정보(선수/홀/거리/스코어/샷/골프장) 입력
5. 영상 저장 → `protrax_analysis.mp4` (H.264 + AAC, 원본 해상도)

## 실행
```bash
python3 -m http.server 8000   # 후 http://localhost:8000 접속
```
`index.html`을 직접 열어도 동작합니다. 인터넷 연결 필요(Tailwind, Chart.js, Font Awesome, Google Fonts CDN).

## 구조
```
index.html        # 마크업
css/style.css     # 스타일
js/spline.js      # 궤적/통계 계산 (순수 함수)
js/export-utils.js# 내보내기 헬퍼 (해상도/fps/비트레이트)
js/app.js         # UI, 캔버스, webm 폴백 내보내기
js/mp4-export.js  # MP4 오프라인 인코딩 (WebCodecs + mp4-muxer)
tests/            # node --test "tests/*.test.js"
```

## 테스트
```bash
node --test "tests/*.test.js"
```

## 브라우저
MP4 저장은 WebCodecs(`VideoEncoder`)가 필요해 최신 Chrome/Edge를 권장합니다. 재생 없이 프레임을 하나씩 렌더링해 인코딩하므로 프레임 누락이 없습니다. 미지원 브라우저는 webm 실시간 녹화로 폴백합니다. AAC 인코더가 없으면 Opus 오디오로 저장됩니다.

## 한계
높이는 카메라 보정 없는 화면 픽셀 값이며, 거리는 사용자가 입력한 값입니다.
