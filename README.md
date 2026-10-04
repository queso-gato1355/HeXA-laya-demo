# Laya 배달로봇 판단 시연 대시보드

소형 배달로봇(보도/이면도로 주행)의 전방 영상과 GPS를 재생하면서, 로컬 **Laya** 결정 모델이 평가 기준별로
내리는 판단을 실시간으로 보여 주는 **로컬 전용 시연 대시보드**. 실제 차량 제어용이 아니다.

```
(A) 오프라인 전처리 (Python)        (B) 상태 빌더 (TS, 브라우저)        (C) Laya 판단 (laya-service, Node)
 front.mp4 ─ YOLO11n+ByteTrack ─┐    재생 시각 t ──▶ compact JSON state ──▶ POST /api/laya/<기준>  ──▶ systemOne(state, {기준: 질문})
           ─ SCDepthV3 깊이 ─────┼─▶ detections.json / depth.mp4           (Next.js 프록시, 기준마다 별도 요청)
           ─ 여유 공간 ──────────┘    + GPS(routes/) + 내비 계산           ◀── choice / score / noul 확률
```

- Laya는 이미지를 받지 않는다. 인식은 미리 계산해 두고, **Laya 판단만 재생 중 실시간 호출**한다.
- **평가 기준 1개 = HTTP 요청 1개 = `systemOne` 1회 = 질문 1개.** 여러 기준을 한 호출로 묶지 않는다
  (벤치마크의 "한 호출" 열은 비교용일 뿐 앱에서 쓰지 않음).
- 런타임에는 localhost 외 네트워크 요청이 없다 (모델은 `pnpm fetch-models`로 미리 받음, 지도 타일 기본 off,
  시스템 폰트).

## 구성

| 경로 | 내용 |
| --- | --- |
| `app/` | Next.js 16 App Router. `page.tsx`, `api/laya/[criterion]` · `status` · `warmup` (laya-service 프록시, Node 런타임) |
| `src/components/` | VideoPanel · OverlayCanvas · DepthPanel · DetectionPanel · DecisionPanel · DecisionCard · Timeline · MiniMap |
| `src/lib/` | `state/buildState.ts`, `route/{plan,maneuver}.ts`, `arbiter.ts`, `safety.ts`, `scheduler.ts`, `sync.ts`, `projection.ts` (+ vitest) |
| `src/data/routes/` | 데모 영상 5개의 GPS(1 Hz)·주행방향·목적지·횡단 구간 하드코딩 (`<clip>.ts`, 레지스트리 `index.ts`; `make_route.py`가 생성) |
| `src/config/rover.{json,ts}` | 로버 프로필 (카메라 높이/피치/HFOV, 최대 속도, 휠베이스). 전처리와 공유 |
| `shared/` | 기준 정의 `criteria/*.ts` + 레지스트리, state 스키마(zod), Pi 프로필, 샘플 state |
| `laya-service/` | 독립 Laya HTTP 서버 (PC 또는 Raspberry Pi 5). `POST /criteria/:name`, `GET /status`, `POST /warmup` |
| `scripts/preprocess/` | 데이터 확보·클립 선정·깊이·검출·여유 공간 (Python 3.12, uv) |
| `scripts/` | `fetch-models.mjs`, `bench-laya.mjs`, `quantize-laya.py`, `make-sample-states.ts` |
| `docs/` | `dataset-notes` · `env-notes` · `bench` · `bench-pi` · `quant-eval` · `hailo-port` |

## 설치

요구: Node 20+ (개발은 24), pnpm 10+, Python 3.11–3.12 + [uv](https://docs.astral.sh/uv/), 디스크 ~3 GB.
GPU는 선택 (전처리는 CUDA PyTorch가 있으면 사용, Laya는 Windows에서 WebGPU, 없으면 CPU).

```bash
pnpm install
pnpm fetch-models            # models/: Laya ONNX 1.7 GB, SCDepthV3, YOLO11n, DA-V2 Small (한 번만)
cp .env.local.example .env.local
```

`models/`는 git에 넣지 않는다. 모델 없이 `pnpm dev`를 띄워도 UI는 깨지지 않고 "pnpm fetch-models를 먼저
실행하세요"를 보여 준다 (영상·인식·내비·하드 안전 규칙은 Laya 없이도 동작).

### INT8 (실험용 — 현재 정확도 검사 실패, 사용하지 말 것)

```bash
scripts/preprocess/.venv/Scripts/python scripts/quantize-laya.py   # Linux: .venv/bin/python
pnpm quant:eval                                                    # fp32 vs INT8 → docs/quant-eval.md
```

동적 INT8(MatMul/Gemm, per-channel)은 2배 빠르고 RSS가 절반이지만 choice 일치율 48.5%, emergency_stop
확률 오차 평균 0.54로 판단이 크게 바뀐다. 개선 후보: 어텐션/헤드 제외, 정적(QDQ) 보정 양자화, 가중치 전용 INT8/FP16.

```bash
# (위 개선 전에는 fp32 번들을 쓴다)
```

## 데모 영상 (5개, 헤더에서 선택)

| # | clipId | 장면 | 길이 | 보기 좋은 판단 |
| --- | --- | --- | --- | --- |
| 1 | `frodo_28126` | 필리핀 주거지 골목, 우회전 교차로 2곳 | 90 s | 경로/기동, 횡단 안전 |
| 2 | `frodo_28107` | 중국 캠퍼스 광장, 근접 보행자·자전거 | 120 s | 보행자 양보, 충돌 위험 |
| 3 | `frodo_27963` | 공원 자갈길, 정면 근접 보행자 | 105 s | 보행자 양보, 속도 |
| 4 | `frodo_28099` | 주거지 골목, 대형 밴·트럭 근접 통과 | 90 s | 충돌 위험, 비상 정지, 회피 |
| 5 | `frodo_28145` | 강한 역광·렌즈 플레어 골목 | 105 s | 인식 신뢰도, 횡단 안전 |

헤더의 "데모 영상" 선택 상자(또는 `/?clip=<clipId>`)로 바꾸면 대시보드가 새로 마운트되어 판단·타임라인이 초기화된다.
카탈로그는 `scripts/preprocess/clips.json`, 각 클립의 카메라 보정은 `public/data/<clip>/camera.json`
(FrodoBots 로버마다 카메라 장착 높이·각도가 달라 클립별로 추정; 근거가 부족한 값은 `rover.json` 기본값).

## 전처리 (결과는 `public/data/<clip>/`에 이미 있음)

```bash
cd scripts/preprocess
uv sync -p 3.12                                   # torch cu128 휠 (CUDA 런타임 포함)
python fetch_rides.py meta --part 10              # FrodoBots-2K part 10의 CSV만 range 요청으로 (~130 MB 읽기)
python pick_clip.py rank && python pick_clip.py peds --top 20
python pick_clip.py cut --ride ride_28126_20240406043024 --start 1712378086.383 --dur 90 --clip-id frodo_28126
#   (clips.json에 클립을 추가하고 annotations/<clip>.json에 횡단 구간을 적는다)
bash run_all.sh frodo_28126   # depth → DA-V2 비교 → detect → 카메라 보정(camera.json) → 거리 재계산 → freespace → heading → routes/<clip>.ts
```

- 데이터셋 파트 zip(12–95 GB)은 받지 않는다. S3 range 요청으로 필요한 멤버만 읽는다 (`remote_zip.py`).
- 횡단 구간은 영상을 보고 `scripts/preprocess/annotations/<clip>.json`에 적는다.
- Windows 한글 경로 대응으로 영상 입출력은 모두 ffmpeg 파이프 (`imageio-ffmpeg` 번들).

## 실행

```bash
pnpm dev          # laya-service(8787) + Next.js(3000) 동시 실행 → http://localhost:3000
pnpm dev:web      # 대시보드만 (Laya는 다른 곳에서)
pnpm dev:laya     # laya-service만
```

스페이스 = 재생/정지, ←/→ = 2초 이동. 일시정지·탐색 시 즉시 1회 재평가.

### Pi에서 판단하기

Pi 5에서 `laya-service`를 띄우고 (`docs/hailo-port.md`), PC의 `.env.local`에서
`LAYA_ENDPOINT=http://<pi-ip>:8787` 로 바꾸면 코드 수정 없이 로버 브레인이 판단한다.

## 화면

- **좌상 원본 영상** (마스터 클락): **Laya 주행도** — 최종 명령(기동 + 목표 속도)이 뜻하는 앞으로 몇 초의 경로를
  로봇 좌표계에서 만들어 화면 아래에 반투명 파란 띠로 그림(정지 = 빨강, 양보 = 노랑 정지선; GPS 오차와 무관하게
  영상에 붙어 있음). **GPS 경로** — 계획 경로(GPS 궤적 단순화)를 로봇의 스냅 위치에서 흰 점선으로 투영.
  둘 다 체크박스로 따로 켜고 끈다. 그 밖에
  상단 중앙 내비 화살표 "우회전 · 6m", 좌상단 속도 "0.9 m/s (3.2 km/h)", 우상단 최종 명령 배지.
  요소별 토글, dev 모드에서는 투영 파라미터(높이/피치/HFOV/요) 조정 슬라이더.
- **우상 깊이 히트맵**: SCDepthV3 (Hailo-8 배포 가능, 256x320, 3 Hz). **가까움 = 파랑, 멀리 = 빨강** (일반
  관례와 반대). 클립 전체 2–98 퍼센타일 고정 정규화. "비교 모드"로 Depth Anything V2 Small을 나란히
  ("배포 불가" 배지).
- **좌하 객체 인식**: 원본 영상 위 canvas에 bbox, 클래스, track id, 추정 거리 + 하단 1/3 여유 공간 3구역.
- **우하 Laya 판단**: 최종 명령(아비터 규칙/근거/배지), 기준별 카드 (한국어 이름, 결과, 확률 분포 미니 바,
  지연 ms, 판단 시각 t, 결과 나이). 위험 기준(충돌 위험·비상 정지·경로 막힘·횡단 안전)은 위험 색 강조,
  2주기 넘게 갱신 안 되면 회색. 카드 클릭 → 입력 state JSON과 원본 응답 JSON.
- **하단 타임라인**: collision_risk / emergency_stop 시계열, 최종 명령 변경·하드 안전 개입·Laya 뒤늦은 위험
  판단 마커, 횡단 구간 음영, 탐색 슬라이더, 배속.
- **사이드 탭**: 미니맵 (타일 없이 경로 + 현재 위치, `NEXT_PUBLIC_MAP_TILES=osm`이면 OSM 타일), 현재 state JSON,
  **리소스** — CPU/메모리/GPU 실시간 그래프(1 Hz, 최근 5분): 시스템 전체, laya-service·Next.js 프로세스 CPU/RSS,
  GPU 사용률·VRAM·온도·전력(nvidia-smi), Pi Laya 메모리 예산선 3 GB. `LAYA_ENDPOINT`가 Pi면 Pi의 CPU/메모리/SoC
  온도를 따로 그린다. 헤더에도 현재 CPU/RAM/GPU 표시. (laya-service `GET /metrics`, Next `/api/system/metrics`)
- **헤더**: `Laya: WEBGPU` / `Laya: CPU` 배지, INT8 여부, laya-service RSS, 엔드포인트, [PC 실측]/[Pi 예산] 토글.

## 판단 로직

### 기준 (shared/criteria/*.ts, 파일 1개 + 레지스트리 1줄로 추가)

| 기준 | 유형 | 기본 rateHz (PC / Pi 기본) | priority |
| --- | --- | --- | --- |
| collision_risk | score 0–4 | 2 | 1 |
| emergency_stop | noul | 2 | 1 |
| path_blocked | noul | 2 | 2 |
| crossing_safe | noul (횡단 구간에서만, 아니면 "해당 없음") | 1 | 2 |
| pedestrian_yield · maneuver · target_speed | noul · choice · choice | 1 | 3 |
| route_adherence · perception_confidence | choice · score | 0.2 | 5 |
| localization_trust | score | 0.1 | 6 |

instructions/criteria 문자열은 명세 그대로이며, `target_speed`의 m/s는 `rover.json`의 `maxSpeedMps`
(1.2 → 0 / 0.3 / 0.7 / 1.2)로 만든다.

### 스케줄러 (src/lib/scheduler.ts)

- 주기 = 1 / (가장 빠른 rateHz). 매 주기 due인 기준만 요청. 이전 주기 요청이 안 끝났으면 그 tick은 건너뜀.
- 요청은 기준마다 독립 `fetch` 후 `Promise.allSettled` (하나 실패해도 나머지 표시). laya-service는 단일
  모델이라 mutex로 직렬 실행하므로 한 주기 비용은 지연의 **합**이다. 예상 합이 주기 x 0.7을 넘으면
  priority 낮은 기준부터 건너뜀 (최상위 1개는 항상 실행).
- **PC 실측**: 기준별 기본 rateHz x `DECISION_HZ`. `pnpm bench:laya`가 "10개 개별 직렬 합 p95 x 1.5가 주기
  안에 들어가는 최대값(상한 4 Hz)"을 계산해 `.env.local.example`에 넣는다 (현재 docs/bench.md 참고).
- **Pi 예산**: `shared/pi-profile.json`의 rateHz를 쓰고, Next.js 프록시가 각 응답을 Pi p50 지연까지 붙잡아
  **직렬로** 내보낸다 → "실제 로버라면 이 판단이 몇 초 늦게 나온다"가 보인다.
  `LAYA_ENDPOINT`가 원격(Pi)이면 비활성 (실측 우선).
- 서비스 캐시 키: (clipId, t를 0.5 s 단위로 반올림, 기준).

### 아비터 (src/lib/arbiter.ts)

1. **하드 안전** (Laya 무관, 매 프레임): center 구역 1 m 이내 객체 또는 `free_space.center == blocked` → 정지,
   `SAFETY OVERRIDE`
2. `emergency_stop ≥ 0.5` → 정지
3. `collision_risk ≥ 3.0` → 정지
4. `path_blocked ≥ 0.6` → maneuver가 회피면 회피, 아니면 양보 대기
5. 그 외 → maneuver + target_speed

결과 나이(현재 재생 시각 − 판단한 state의 시각)가 1.5 s를 넘는 기준은 제외하고, 그때는 속도 상한을
최저속(crawl)으로 낮추며 "판단 지연" 배지를 띄운다. 내비 지시(`maneuver.ts`, 누적 방위 변화 30° 기준의
결정론적 계산)는 Laya 판단과 별도로 나란히 표시한다.

### state (src/lib/state/buildState.ts)

```json
{ "robot": { "speed_mps": 0.9, "heading_deg": 84 },
  "route": { "next_maneuver": "turn_left", "dist_to_maneuver_m": 6, "crossing_now": false, "off_route_m": 0.8 },
  "gps": { "accuracy_m": 4 },
  "free_space": { "left": "open", "center": "partial", "right": "blocked" },
  "objects": [ { "type": "person", "position": "center", "dist_m": 3.2, "approaching": true, "conf": 0.8 } ] }
```

- GPS 1 Hz → 재생 시각 선형 보간. 속도 = 연속 fix haversine/Δt의 3점 이동평균. 방위 = **나침반 + 영상 요 융합**
  (`heading.py`, docs/dataset-notes.md). IMU가 없으면 2 m 이상 떨어진 직전 fix → 현재 fix의 GPS 방위로 대체.
- 계획 경로 = GPS 궤적을 RDP(1.5 m)로 단순화. `off_route_m`은 여기서의 횡방향 거리. 진행도는 시간 순으로만
  전진하도록 스냅 (교차로에서 제자리 회전 중 GPS 흔들림에 다음 기동점이 깜빡이지 않게).
- 객체: 거리순 상위 6개, bbox 중심 x 3등분으로 left/center/right, 같은 track id가 최근 1초 0.3 m 넘게
  가까워지면 approaching. 숫자는 모두 소수 1자리 (JS/Python 직렬화 차이 방지). 512 토큰 이내 (실측 190–370).

## 검증

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm bench:laya                 # → docs/bench.md, DECISION_HZ
pnpm bench:laya --pi            # Pi 5에서 → docs/bench-pi.md, shared/pi-profile.json
pnpm bench:laya --pi-proxy      # Pi 없이: PC CPU 4스레드 x 감속 가정 (--pi-slowdown, 기본 8)
```

## 한계 (꼭 읽을 것)

- **시연 전용.** 판단은 미리 계산된 단안 인식 결과를 요약한 텍스트 state에 대한 Laya의 응답일 뿐이다.
- **모든 거리는 추정치.** 상대 깊이(SCDepthV3)는 미터가 아니어서 물체 거리는 클래스 표준 높이 핀홀 모델
  (bbox가 화면 아래에서 잘리면 지면 평면 모델)로 추정한다. 카메라 피치·높이·화각은 영상/나침반에서 추정한 값이고
  광각 렌즈 왜곡은 보정하지 않는다 (화면 가장자리의 경로·거리는 덜 정확). GPS 경로 오버레이는 GPS 위치 오차(수 m)를
  그대로 가진다.
- SCDepthV3는 NYU 실내 학습이라 실외에서 하늘을 가깝게 보는 등 품질이 낮다. DA-V2 Metric Outdoor는
  이 저고도 광각 카메라에서 스케일이 ~20배 틀려 비교용도 relative 체크포인트를 쓴다 (docs/dataset-notes.md).
- 여유 공간은 "클립 전체 화소별 깊이 중앙값"을 배경으로 쓰는 오프라인 방식이다 (실시간 이식 시 교체 필요).
- GPS 정확도 컬럼이 없어 4 m 고정 (가정). GPS 방위는 1 Hz·0.1 m 양자화라 투영 경로가 흔들리거나 어긋날 수 있다.
- 횡단 구간은 사람이 영상을 보고 넣은 값이다.
- WebGPU EP는 브라우저와 GPU를 나눠 쓰는 시연 상황에서 지연이 크게 늘고 들쭉날쭉하다 (docs/env-notes.md).
  DirectML EP는 이 모델에서 실패한다.
- **INT8 양자화본은 정확도 검사(docs/quant-eval.md)에서 실패했다.** Pi 프로필도 fp32 기준이며, fp32는 RSS가
  ~3.1 GB로 Pi 메모리 경고선(3 GB)을 약간 넘는다.
- **Pi 수치는 아직 추정치다.** Pi 5 실기가 없어 `bench-pi.md`/`pi-profile.json`은 PC CPU 4스레드 측정에
  x8 감속을 곱한 값이다. Pi에서 `pnpm bench:laya --pi`를 돌리면 실측으로 교체된다.

## 출처·라이선스

- 주행 데이터: [FrodoBots-2K](https://huggingface.co/datasets/BitRobot/FrodoBots-2K), FrodoBots Lab, **CC-BY-SA-4.0**
  (클립 `public/data/<clip>/*`와 `src/data/routes/*`는 이 데이터의 파생물이며 같은 조건을 따른다)
- 결정 모델: [Laya](https://huggingface.co/convaiinnovations/laya), Convai Innovations, **Apache-2.0**,
  ONNX 번들 [receptron/laya-onnx](https://huggingface.co/receptron/laya-onnx), 런타임 [@receptron/laya](https://github.com/receptron/laya) (MIT)
- 객체 검출: Ultralytics YOLO11n, **AGPL-3.0** (전처리 스크립트가 사용. 배포·서비스 시 AGPL 조건 확인)
- 깊이: SCDepthV3 ([sc_depth_pl](https://github.com/JiawangBian/sc_depth_pl), **GPL-3.0**, Hailo Model Zoo 배포본),
  Depth Anything V2 Small (**Apache-2.0**, 비교 모드)
- onnxruntime (MIT), Next.js (MIT), Leaflet (BSD-2), Recharts (MIT)
