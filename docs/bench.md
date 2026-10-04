# Laya 벤치마크 (PC)

측정일: 2026-10-03

호스트: win32-x64, AMD Ryzen 9 9950X3D 16-Core Processor x32, 64 GiB, node v24.15.0

샘플: `shared/sample-states.json`의 state 20개 x 기준 10개 (클립 frodo_28126에서 생성).
각 EP/모델 조합은 별도 프로세스에서 측정 (RSS·콜드 스타트 분리).

| EP | 모델 | 스레드 | 로드 ms | 콜드 첫 호출 ms | 워밍업 후 호출 ms | 기준 1개 p50 / p95 ms | 10개 개별 직렬 합 p50 / p95 ms | 10개 한 호출 p50 / p95 ms (비교용) | RSS MB | 권장 DECISION_HZ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| webgpu | laya (fp32) | - | 1372 | 504 | 102 | 70 / 99 | 739 / 896 | 738 / 938 | 1283 | 0.7 |
| dml | laya | - | 실패: Non-zero status code returned while running Reshape node. Name:'node_view' (DmlExecutionProvider, 80070057) | | | | | | | |
| cpu | laya (fp32) | 8 | 1040 | 187 | 178 | 166 / 230 | 1728 / 2090 | 2538 / 2999 | 3090 | 0.3 |
| webgpu | laya-int8 (INT8) | - | 1315 | 716 | 239 | 214 / 283 | 2244 / 2723 | 2112 / 2668 | 1367 | 0.2 |
| dml | laya-int8 | - | 실패: Non-zero status code returned while running Reshape node. Name:'node_view' (DmlExecutionProvider, 80070057) | | | | | | | |
| cpu | laya-int8 (INT8) | 8 | 889 | 106 | 100 | 91 / 141 | 960 / 1227 | 1877 / 2343 | 1530 | 0.5 |

- **기준 1개**: 기준 하나 = `systemOne` 한 번 (본 설계).
- **10개 개별 직렬 합**: 한 state에 기준 10개를 각각 따로 직렬 호출한 총 지연 (본 설계의 1주기 최악 비용).
- **10개 한 호출**: 10개 질문을 한 `systemOne`에 배치 (비교용, 앱에서는 사용하지 않음).
- **권장 DECISION_HZ** = (10개 개별 직렬 합 p95 x 1.5)가 주기 안에 들어가는 최대값, 상한 4 Hz.
- 측정은 유휴 상태 기준이다. 시연 중에는 브라우저가 영상 3개를 그리며 GPU를 같이 쓰므로 WebGPU 호출이
  250–600 ms로 늘고 들쭉날쭉해진다 (같은 조건 CPU INT8 105–280 ms, docs/env-notes.md).
  게임 등 다른 GPU 작업이 돌면 수 배 더 느려지므로 벤치는 유휴 상태에서 다시 돌린다.

## 결론

`LAYA_EP=auto`가 고르는 첫 EP는 **webgpu**: 10개 직렬 p95 896 ms → **DECISION_HZ=0.7** (.env.local.example 기본값에 반영).
대시보드(PC 실측 모드)는 기준별 기본 rateHz에 이 값을 곱한다 (1 Hz 계열 = 0.7 Hz, 2 Hz 계열 = 1.4 Hz).
