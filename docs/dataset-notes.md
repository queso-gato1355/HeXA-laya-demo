# FrodoBots-2K 데이터셋 조사 노트

조사일: 2026-10-03

## 배포 형태

- HF `frodobots/FrodoBots-2K` → `BitRobot/FrodoBots-2K` 로 리다이렉트. HF 저장소에는 README, `helpercode.ipynb`만 있다.
- 실제 데이터: README의 [complete-dataset.csv](https://frodobots-2k-dataset.s3.ap-southeast-1.amazonaws.com/complete-dataset.csv)
  → S3의 `output_rides_{0..18}.zip`. 파트당 압축 12–95 GB, 전체 약 1 TB.
- **전체/파트 다운로드는 하지 않았다.** S3가 HTTP `Range`를 지원하므로 `scripts/preprocess/remote_zip.py`가
  zip central directory만 읽고, 필요한 멤버만 range 요청으로 받는다.
  - part 10 (압축 12.19 GB, ride 120개): CSV 메타데이터 전체 ≈ 129 MB range 읽기 (디스크 45 MB)
  - 후보 20개의 전방 영상 일부 + 최종 클립: ≈ 500 MB
  - 받은 원본은 `data/raw/` (git 제외)

## zip 내부 구조 (ride 단위)

```
output_rides_10/ride_<rideId>_<yyyymmddHHMMSS>/
  control_data_<rideId>.csv
  gps_data_<rideId>.csv
  imu_data_<rideId>.csv
  front_camera_timestamps_<rideId>.csv
  rear_camera_timestamps_<rideId>.csv
  speaker_audio_timestamps_<rideId>.csv
  recordings/<hash>_ride_<rideId>__uid_s_1000__uid_e_video.m3u8          ← 전방 카메라 (HLS)
  recordings/<hash>_ride_<rideId>__uid_s_1000__uid_e_video_<stamp17>.ts  ← 전방 세그먼트 (~16.5 s)
  recordings/<hash>_ride_<rideId>__uid_s_1001__uid_e_video_*.ts          ← 후방 카메라
  recordings/<hash>_ride_<rideId>__uid_s_1001__uid_e_audio_*.ts          ← 마이크
```

- **uid_s_1000 = 전방**: H.264 Main, 1024x576, 20 fps (ffprobe로 확인). uid_s_1001 video = 후방 540x360.
- 세그먼트 파일명 `<stamp17>` = `yyyymmddHHMMSSmmm` (UTC). 세그먼트 첫 프레임의 epoch와 같다
  (ride 27837: 첫 세그먼트 `20240405085907715` ↔ `front_camera_timestamps` 첫 행 `1712307547.715`).
- 세그먼트는 ffmpeg concat demuxer로 이어 붙인 뒤 `-ss/-t`로 잘라 H.264 mp4 하나로 재인코딩한다
  (20 fps 고정, GOP 20 → 대시보드 탐색이 빠름, 오디오 제거).

## CSV 컬럼

| 파일 | 컬럼 | 단위/비고 |
| --- | --- | --- |
| `gps_data_*.csv` | `latitude, longitude, timestamp` | 위경도 소수 6자리, timestamp는 **epoch ms**, ~1 Hz. 정확도 컬럼 없음 |
| `control_data_*.csv` | `linear, angular, rpm_1..rpm_4, timestamp` | linear/angular −1..1 (angular +1 = 좌), rpm = 바퀴 4개, timestamp **epoch s** (소수 2자리), ~10 Hz |
| `front_camera_timestamps_*.csv` | `frame_id, timestamp` | 프레임별 epoch s |
| `imu_data_*.csv` | `compass, gyroscope, accelerometer, ...` | 셀 안에 JSON 배열 (이번 범위에서 미사용) |

- GPS timestamp는 ms, 나머지는 s 단위라 `pick_clip.py`에서 `ts > 1e11`이면 ms로 보고 변환한다.
- GPS에는 `(0, 0)` 행이 섞일 수 있어 제거한다.

## 선택한 클립

`pick_clip.py rank` → `peds` 로 part 10의 ride 120개 중 84개에서 60–120 s 창을 평가했다
(이동거리/평균속도, 55° 이상 회전 횟수, 정지 비율 < 35 %, YOLO 저해상도 샘플링으로 사람·차량 수 가산점).

| 항목 | 값 |
| --- | --- |
| clip_id | `frodo_28126` |
| ride | part 10, `ride_28126_20240406043024` |
| 시작 epoch | 1712378086.383 (2024-04-06 04:34:46 UTC) |
| 길이 | 90 s, 1800 프레임 |
| 이동 | 66.8 m, 평균 0.74 m/s, 정지 비율 7 %, 회전 3회 |
| 장면 | 필리핀 주거지 골목 (보도 없는 이면도로). 주차 차량·오토바이·트라이시클, 교차로 2곳 |
| YOLO 샘플링 | 사람 0.09 / 차량 2.58 (프레임당) |

- 차선(2위): `ride_28107` 캠퍼스 광장 — 근접 보행자가 많음(프레임당 0.97명) 대신 차량·교차로가 없다.
  `python pick_clip.py cut --ride ride_28107_20240406022550 --start 1712370635.311 --dur 120`
- 횡단 구간(`scripts/preprocess/annotations/frodo_28126.json`, 영상 보고 수기 입력):
  8–16 s(첫 우회전 교차로), 46–54 s(두 번째 우회전 교차로).

## 데모 영상 5개 (scripts/preprocess/clips.json)

| clipId | 장면 | 길이 | 카메라 높이 | 피치 | HFOV |
| --- | --- | --- | --- | --- | --- |
| `frodo_28126` | 주거지 골목 · 교차로 | 90 s | 0.82 m (추정) | +5.3° (추정) | 105° (추정) |
| `frodo_28107` | 캠퍼스 광장 · 보행자 | 120 s | 0.5 m (추정) | -0.8° (추정) | 107° (추정) |
| `frodo_27963` | 공원 산책로 · 근접 보행자 | 105 s | 0.75 m (추정) | +5.3° (기본값) | 105° (기본값) |
| `frodo_28099` | 골목 · 대형 차량 근접 | 90 s | 1.08 m (추정) | +5.3° (추정) | 105° (기본값) |
| `frodo_28145` | 역광 골목 · 인식 난이도 | 105 s | 1.04 m (추정) | +5.3° (추정) | 106° (추정) |

- 카메라 값은 클립마다 `calibrate_camera.py`가 추정해 `public/data/<clip>/camera.json`에 저장한다. FrodoBots 로버마다
  장착이 달라 값이 다르다(28107은 0.5 m·수평, 28126은 0.82 m·위로 5°). 근거가 약하거나 범위(HFOV 80–125°,
  피치 −8~+10°, 높이 0.2–1.3 m)를 벗어나면 `rover.json` 기본값을 쓴다: 27963은 공원의 휜 자갈길 때문에 소실점
  피치(+12°)와 회전 HFOV(129°)가, 28099는 가까이 지나가는 밴 때문에 회전 HFOV(141°)가 범위를 벗어났다.
- 28099의 높이 1.08 m는 대형 밴이 많아(차량 높이 1.5 m 가정보다 큼) 과대추정일 수 있다.
- 횡단 구간: 28126 8–16 s·46–54 s, 28099 15–24 s·56–64 s, 28145 7–13 s·35–43 s (`annotations/`), 28107·27963은 없음.

## 카메라 보정 (src/config/rover.json) — 기준 클립 frodo_28126

FrodoBots는 카메라 파라미터를 제공하지 않는다. 처음 가정(높이 0.3 m, 피치 −4°, HFOV 100°)은 크게 틀려서
지면 거리가 ~8배 짧게 나오고 경로 오버레이가 어긋났다. `scripts/preprocess/calibrate_camera.py`로 클립에서 추정:

| 값 | 추정 | 근거 |
| --- | --- | --- |
| 피치 | **+5.3° (위)** | 도로 가장자리 소실점의 행 = 지평선, 화면 높이의 56 % (17프레임 중앙값) |
| 높이 | **0.82 m** | 지평선은 카메라 높이에서 물체를 자른다 → 지평선에 걸친 차량 1,632개가 아래쪽 55 % 지점에서 잘림 x 차량 1.5 m |
| HFOV | **105°** | 회전 중 화면 중앙부 수평 이동(px)과 나침반 각도 변화의 비율 → 초점거리 393 px (2초 창 43개) |

차량 bbox 높이(핀홀) vs 지면 접점 거리로 HFOV를 맞추는 방법도 시도했지만 60–120° 사이에서 오차가 거의
같아 초점거리를 정할 수 없었다. 광각 렌즈 왜곡은 모델링하지 않아 화면 가장자리는 덜 정확하다.
화면 하단 중앙에 로버 앞 범퍼 봉 2개가 항상 보인다. 이 카메라로 보이는 가장 가까운 지면은 약 1.4 m 앞.

## 주행방향 (heading)

GPS 진행 방향은 1 Hz·0.1 m 양자화·골목 다중경로 때문에 회전 구간에서 실제 카메라 회전과 20–60° 어긋났다.
`imu_data`의 나침반(~1 Hz, 축: x=위, y=서, z=남)을 hard-iron 원 맞춤(반경 변동 5.7 %)으로 보정하고,
ride 전체 GPS 진행 방향(2.5 m 이상 이동 구간 333개)에 부호/오프셋을 맞춰(잔차 중앙값 10.4°) 진북 기준으로 바꾼 뒤,
영상 광류(호모그래피)로 구한 카메라 요 변화와 상보 필터(τ 4 s)로 융합한다 (`heading.py` → `src/data/routes/<clip>.ts`의 `heading`, 10 Hz).
IMU 자이로는 ~1 Hz 샘플이라 적분에 쓸 수 없고, 바퀴 RPM은 부호가 없어 요 추정에 맞지 않았다(중앙값 오차 15°).

## 깊이 모델 관찰

- **SCDepthV3** (Hailo Model Zoo, NYU 실내 학습): 근거리 지면 = 파랑, 먼 곳 = 빨강으로 방향은 맞다.
  다만 실내 학습이라 하늘을 "천장"처럼 비교적 가깝게 추정한다 → 히트맵 상단이 주황/노랑으로 보이는 한계.
- **Depth Anything V2 Metric Outdoor Small**은 처음에 시도했으나 이 저고도·광각 카메라에서
  지면 바로 앞을 ~7.5 m로 추정(약 20배 과대)하고 먼 거리는 압축되어, 지면 평면으로 스케일을 맞춰도
  쓸 수 없었다. 비교 모드는 **DA2 Small (relative)** 로 바꾸고 SCDepthV3와 같은 클립 전체 2–98
  퍼센타일 고정 정규화를 쓴다.

## 라이선스

FrodoBots-2K: CC-BY-SA-4.0 — 대시보드 푸터에 출처 표기.
