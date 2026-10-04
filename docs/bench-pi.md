# Laya 벤치마크 (Raspberry Pi 5 프로필)

> **주의: Pi 실측이 아니다.** 이 표는 PC CPU를 4스레드로 제한한 대리 측정값이고, Pi 예산 모드와
> `shared/pi-profile.json`은 이 값에 **x8 감속 가정**을 곱한 추정치를 쓴다.
> Pi 5에서 `pnpm bench:laya --pi`를 실행하면 이 문서와 프로필이 실측값으로 교체된다.

측정일: 2026-10-03

호스트: win32-x64, AMD Ryzen 9 9950X3D 16-Core Processor x32, 64 GiB, node v24.15.0

샘플: `shared/sample-states.json`의 state 20개 x 기준 10개 (클립 frodo_28126에서 생성).
각 EP/모델 조합은 별도 프로세스에서 측정 (RSS·콜드 스타트 분리).

| EP | 모델 | 스레드 | 로드 ms | 콜드 첫 호출 ms | 워밍업 후 호출 ms | 기준 1개 p50 / p95 ms | 10개 개별 직렬 합 p50 / p95 ms | 10개 한 호출 p50 / p95 ms (비교용) | RSS MB | 권장 DECISION_HZ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cpu | laya (fp32) | 4 | 1062 | 268 | 258 | 244 / 331 | 2522 / 3001 | 3464 / 4075 | 3086 | 0.2 |
| cpu | laya-int8 (INT8) | 4 | 892 | 137 | 132 | 120 / 186 | 1281 / 1649 | 2224 / 2870 | 1541 | 0.4 |

## 기준별 지연 (laya, x8 추정)

| 기준 | p50 ms | p95 ms |
| --- | --- | --- |
| collision_risk | 1952 | 2648 |
| maneuver | 1952 | 2648 |
| target_speed | 1952 | 2648 |
| pedestrian_yield | 1952 | 2648 |
| path_blocked | 1952 | 2648 |
| crossing_safe | 1952 | 2648 |
| emergency_stop | 1952 | 2648 |
| route_adherence | 1952 | 2648 |
| localization_trust | 1952 | 2648 |
| perception_confidence | 1952 | 2648 |

## 스케줄러 rateHz (Pi 프로필)

조건: "한 주기 동안 실행되는 호출들의 p95 합 < 주기 x 0.7". 기준 10개가 한 주기에 모두 몰리는 최악의 경우
(p95 합 26480 ms)는 스케줄러가 예산 초과분을 낮은 priority부터 다음 주기로 미루므로, 정상 상태 조건
Σ(p95 x rateHz) < 0.7 (단일 직렬 큐 점유율)을 쓴다. 기본 rateHz 전체에 같은 계수 **x0.021**를 곱해 점유율 58%.

| 기준 | 기본 rateHz | Pi rateHz |
| --- | --- | --- |
| collision_risk | 2 | 0.042 |
| maneuver | 1 | 0.021 |
| target_speed | 1 | 0.021 |
| pedestrian_yield | 1 | 0.021 |
| path_blocked | 2 | 0.042 |
| crossing_safe | 1 | 0.021 |
| emergency_stop | 2 | 0.042 |
| route_adherence | 0.2 | 0.004 |
| localization_trust | 0.1 | 0.002 |
| perception_confidence | 0.2 | 0.004 |

## 메모리

Laya 서비스 RSS: laya 3086 MB, laya-int8 1541 MB. 예산 경고선 3 GB — **초과: laya: 3086 MB**. Pi 5 8 GB에서 OS + Hailo 파이프라인과 함께 운용 가능 여부 판단용.

프로필 모델은 **fp32**. INT8(동적 양자화)은 속도는 2배(기준 1개 p50 120 vs 244 ms, 스케일 전)지만
정확도 회귀 검사에서 choice 일치율 48.5%로 실패해 쓰지 않는다 (docs/quant-eval.md). fp32는 RSS 경고선 3 GB를 약간 넘는다.
