# 로버 실기 이식 메모 (Raspberry Pi 5 + AI HAT+ 26 TOPS / Hailo-8)

이번 범위는 대시보드와 PC 전처리이고, 실기 코드는 포함하지 않는다. 이 문서는 대시보드가 보여 주는
인식/판단을 로버에서 같은 구성으로 재현하기 위한 메모다.

## 역할 분담

| 단계 | PC 시연 (이 저장소) | 로버 (Pi 5 + Hailo-8) |
| --- | --- | --- |
| 객체 검출 | Ultralytics YOLO11n PyTorch, 640, 오프라인 | Hailo-8 `yolov11n.hef`, 640x640 |
| 추적 | Ultralytics ByteTrack | Pi CPU에서 ByteTrack (HEF 출력 박스 입력) |
| 깊이 | SCDepthV3 ONNX (PyTorch 원본), 256x320, 3 Hz | Hailo-8 `scdepthv3.hef`, 256x320 |
| 물체 거리 | 핀홀 (클래스 높이) / 지면 평면 | 동일 (CPU, 수 μs) |
| 여유 공간 | 클립 전체 깊이 중앙값 대비 근접 화소 비율 | 실시간에는 "최근 N초 이동 중앙값" 배경으로 교체 필요 (아래) |
| 하드 안전 규칙 | 검출 결과로 매 프레임 | 동일, Hailo 검출 주기와 같은 주기 |
| Laya 판단 | `laya-service` (PC, WebGPU/CPU) | `laya-service` (Pi CPU 4스레드, fp32 — INT8은 정확도 검사 실패) |

Hailo-8은 인식 전용이다. Laya(ModernBERT 계열 ~4억 파라미터 인코더)는 Hailo Model Zoo 범위 밖이고,
Pi CPU에서 onnxruntime-node (linux-arm64 CPU EP)로 돈다. 지연은 `docs/bench-pi.md` 참고.

## 모델과 HEF

Hailo Model Zoo (Dataflow Compiler v2.19.0, hailo8 컴파일본):

| 모델 | Model Zoo 이름 | HEF | 입력 | 원본 (PC 전처리에서 사용) | Hailo-8 FPS (batch 1 / 8) | 라이선스 |
| --- | --- | --- | --- | --- | --- | --- |
| YOLO11n | `yolov11n` | `ModelZoo/Compiled/v2.19.0/hailo8/yolov11n.hef` (8.6 MB) | 640x640x3 RGB | `yolo11n.pt` (Ultralytics) | 185 / 541 | AGPL-3.0 |
| SCDepthV3 | `scdepthv3` | `ModelZoo/Compiled/v2.19.0/hailo8/scdepthv3.hef` (13.6 MB) | 256x320x3 RGB | `DepthEstimation/indoor/scdepthv3/pretrained/2023-07-20/scdepthv3.zip` → `scdepthv3.onnx` | 929 / 929 | GPL-3.0 |

HEF URL 접두사: `https://hailo-model-zoo.s3.eu-west-2.amazonaws.com/` (2026-10-03 HEAD 200 확인).
FPS는 Model Zoo 문서의 PCIe Gen3 x4 호스트 수치다. Pi 5의 AI HAT+는 PCIe Gen2 x1(설정 시 Gen3)이라
실제로는 더 낮다. 두 모델을 한 장치에서 번갈아 돌리면 컨텍스트 전환 비용도 든다 (깊이를 3 Hz로 둔 이유).

> 참고: Model Zoo 네트워크 YAML의 `supported_hw_arch`에는 hailo15h/hailo10h만 적혀 있지만, 공개 모델
> 문서(HAILO8)에 두 모델 모두 hailo8 컴파일 HEF 링크가 있고 다운로드도 된다.

## 전·후처리 차이

### YOLO11n

- **전처리**: Ultralytics는 letterbox(회색 114 패딩)로 640에 맞춘다. HEF 입력도 640x640 RGB uint8이므로
  같은 letterbox를 CPU에서 하고 넣는다 (정규화 0–1은 HEF 내부, `normalize_in_net`).
- **후처리**: HEF는 NMS가 장치에 포함되어 있다 (`device_pre_post_layers.nms: true`). 출력은
  `80 x 5 x 100`, 즉 클래스별 최대 100개 박스의 `(y_min, x_min, y_max, x_max, score)` 정규화 좌표.
  PyTorch 쪽 Ultralytics NMS(IoU 0.7, class-aware)와 임계값이 다르니 HailoRT 설정에서
  score 임계 0.3 (이 저장소 `detect.py --conf` 기본값)과 맞춘다.
- 사용 클래스 (COCO id): person 0, bicycle 1, car 2, motorcycle 3, bus 5, truck 7, traffic light 9,
  fire hydrant 10, stop sign 11, bench 13, dog 16. 나머지 클래스는 버린다.
- 8비트 양자화로 mAP 39.0 → 37.5 (Model Zoo 수치). 작은/먼 물체 검출이 약간 줄 수 있다.
- **추적**: ByteTrack은 HEF 밖이다. Pi CPU에서 `bytetrack` 파이썬/C++ 구현을 같은 파라미터
  (Ultralytics `bytetrack.yaml`)로 돌린다. 대시보드의 `approaching` 판정은 track id가 1초 이상 유지되어야 한다.

### SCDepthV3

- **전처리**: 256x320으로 리사이즈한 RGB uint8. PC(ONNX)에서는 `(x - 114.75) / 57.375` 정규화를 직접 하고,
  HEF는 이 정규화를 망 안에 포함한다 (`normalize_in_net: true`). 즉 Pi에서는 리사이즈만 한다.
- **후처리 (CPU)**: 출력 logits → `depth = 1 / (sigmoid(x) * 10 + 0.009)`
  (`hailo_model_zoo/core/postprocessing/depth_estimation_postprocessing.py`). 값이 클수록 멀다.
- **스케일**: NYU 실내 학습이라 실외에서 미터 단위가 아니다 (하늘을 비교적 가깝게 봄). 그래서 이 저장소는
  깊이를 순위(near/mid/far)와 여유 공간 판정에만 쓰고, 물체 거리는 핀홀/지면 모델로 추정한다.
- **정규화**: 대시보드 히트맵은 클립 전체 2–98 퍼센타일 고정 범위다. 실시간에는 클립 전체를 모르므로
  최근 수십 초의 이동 퍼센타일(또는 고정 상수)을 써야 깜빡임이 없다.
- 8비트 양자화 RMSE 0.481(float) → 0.48(HW), NYU 기준 차이는 미미.

### 여유 공간 (free space)

PC 전처리는 "클립 전체의 화소별 깊이 중앙값"을 배경(대부분 노면 + 로버 범퍼 봉)으로 보고, 그보다
20 % 이상 가까운 화소 비율로 open/partial/blocked를 정한다 (`freespace.py`). 실시간에는 미래 프레임이 없으므로:
- 로버 정지·직진 구간에서 모은 화소별 이동 중앙값을 배경으로 쓰거나,
- 카메라 높이/피치로 계산한 지면 평면 예상 깊이(`common.ground_distance`)를 상대 깊이에 맞춰 스케일링해 쓴다.

## 카메라 / 로버 프로필

`src/config/rover.json` (대시보드와 전처리가 같이 읽음): 카메라 높이 0.82 m, 피치 +5.3°(위), HFOV 105°,
최대 속도 1.2 m/s, 휠베이스 0.3 m, 폭 0.45 m. 카메라 값은 FrodoBots 클립에서 추정한 값(`calibrate_camera.py`, docs/dataset-notes.md)이고 나머지는 **가정치**다. 실기 카메라를 캘리브레이션해서
교체하면 경로 투영, 핀홀 거리, `target_speed` 질문의 m/s 문자열이 함께 바뀐다.

## Laya 서비스 배포 (Pi)

```bash
# Pi OS 64-bit, Node 20+
git clone <repo> && cd <repo>
pnpm install --filter laya-service...
# 모델 번들: pnpm fetch-models (fp32, 1.7 GB). INT8은 docs/quant-eval.md 실패로 보류
LAYA_MODEL_DIR=./models/laya LAYA_EP=cpu LAYA_INTRA_THREADS=4 LAYA_HOST=0.0.0.0 pnpm dev:laya
# 실측 벤치 → docs/bench-pi.md, shared/pi-profile.json 갱신
pnpm bench:laya --pi
```

PC 대시보드의 `.env.local`에서 `LAYA_ENDPOINT=http://<pi-ip>:8787`로 바꾸면 코드 수정 없이 Pi가 판단한다
(이때 "Pi 예산" 시뮬레이션 토글은 비활성: 실측이 우선).

메모리: fp32 번들은 서비스 RSS가 ~3.1 GB로 경고선(3 GB)을 약간 넘는다 (INT8은 ~1.5 GB지만 정확도 실패).
Pi 5 8 GB에서 OS(~0.5 GB) + Hailo 파이프라인(수백 MB) + fp32 Laya(~3.1 GB)는 들어가지만 여유가 작다.
정확도를 지키는 양자화(어텐션 제외, 정적 QDQ 보정 등)가 Pi 이식의 다음 과제다.
