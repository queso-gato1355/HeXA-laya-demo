# Laya INT8 양자화 정확도 회귀 검사

측정일: 2026-10-03 · 호스트: win32-x64 AMD Ryzen 9 9950X3D 16-Core Processor · CPU EP 4스레드

- fp32: `models/laya` (1.7 GB) / INT8: `models/laya-int8` (585 MB, onnxruntime.quantization.quantize_dynamic, QInt8, per-channel=true, MatMul/Gemm)
- 입력: `shared/sample-states.json` state 200개 x 기준 10개 = 2000회 호출씩 (기준마다 개별 `systemOne`)
- 소요: fp32 817 s, INT8 372 s (호출당 평균 409 / 186 ms)

## 결과

**전체 choice 일치율: 48.5%** (291/600)

| 기준 | 유형 | 지표 | |
| --- | --- | --- | --- |
| collision_risk | score | 절대오차 평균 0.3448 | 최대 1.0455 |
| maneuver | choice | 일치율 **42.5%** | |
| target_speed | choice | 일치율 **47.5%** | |
| pedestrian_yield | noul | 절대오차 평균 0.2948 | 최대 0.8930 |
| path_blocked | noul | 절대오차 평균 0.2301 | 최대 0.9015 |
| crossing_safe | noul | 절대오차 평균 0.2435 | 최대 0.9436 |
| emergency_stop | noul | 절대오차 평균 0.5388 | 최대 0.9997 |
| route_adherence | choice | 일치율 **55.5%** | |
| localization_trust | score | 절대오차 평균 0.1986 | 최대 0.5688 |
| perception_confidence | score | 절대오차 평균 0.1797 | 최대 0.5873 |

## ⚠ 경고

- 전체 choice 일치율 48.5% < 95% (기준 95%)
- maneuver choice 일치율 42.5% (기준 95%)
- target_speed choice 일치율 47.5% (기준 95%)
- route_adherence choice 일치율 55.5% (기준 95%)

