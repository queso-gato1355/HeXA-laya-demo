"""Dynamic INT8 quantization of the Laya ONNX bundle -> models/laya-int8/

  scripts/preprocess/.venv/Scripts/python scripts/quantize-laya.py      (Windows)
  scripts/preprocess/.venv/bin/python     scripts/quantize-laya.py      (Linux / Pi)

Only MatMul/Gemm weights are quantized (onnxruntime.quantization.quantize_dynamic, per-channel, QInt8);
activations stay float and are quantized on the fly. The tokenizer and calibration config are copied
unchanged, plus a quantization.json marker that laya-service reports in /status.
Accuracy vs fp32 is checked by `pnpm quant:eval` -> docs/quant-eval.md.
"""

from __future__ import annotations

import argparse
import json
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT / "models" / "laya"))
    ap.add_argument("--dst", default=str(ROOT / "models" / "laya-int8"))
    ap.add_argument("--per-channel", action=argparse.BooleanOptionalAction, default=True)
    a = ap.parse_args()

    import onnxruntime
    from onnxruntime.quantization import QuantType, quantize_dynamic

    src, dst = Path(a.src), Path(a.dst)
    if not (src / "laya.onnx").exists():
        raise SystemExit(f"{src}/laya.onnx missing - run: pnpm fetch-models")
    dst.mkdir(parents=True, exist_ok=True)
    (dst / "tokenizer").mkdir(exist_ok=True)

    t0 = time.time()
    print(f"quantizing {src / 'laya.onnx'} (onnxruntime {onnxruntime.__version__}) ...", flush=True)
    # Work in an ASCII temp dir: onnx shape inference mangles non-ASCII paths on Windows.
    # The exported graph carries stale value_info shapes (e.g. 1028 vs 256) that make ORT's shape
    # inference fail, so drop them first; they are re-inferred.
    import tempfile

    import onnx

    work = Path(tempfile.mkdtemp(prefix="laya-quant-"))
    try:
        model = onnx.load(str(src / "laya.onnx"), load_external_data=True)
        n_vi = len(model.graph.value_info)
        del model.graph.value_info[:]
        print(f"dropped {n_vi} value_info entries; staging in {work}", flush=True)
        onnx.save(model, str(work / "in.onnx"), save_as_external_data=True, all_tensors_to_one_file=True,
                  location="in.onnx.data")
        del model
        quantize_dynamic(
            model_input=work / "in.onnx",
            model_output=work / "out.onnx",
            op_types_to_quantize=["MatMul", "Gemm"],
            per_channel=a.per_channel,
            weight_type=QuantType.QInt8,
            use_external_data_format=False,
            extra_options={"MatMulConstBOnly": True},
        )
        shutil.move(str(work / "out.onnx"), dst / "laya.onnx")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    for f in ("laya_config.json", "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json"):
        shutil.copy2(src / f, dst / f)
    size_mb = sum(p.stat().st_size for p in dst.rglob("*") if p.is_file()) / 1e6
    (dst / "quantization.json").write_text(json.dumps({
        "quantized": True,
        "method": "onnxruntime.quantization.quantize_dynamic",
        "weight_type": "QInt8",
        "per_channel": a.per_channel,
        "op_types": ["MatMul", "Gemm"],
        "onnxruntime": onnxruntime.__version__,
        "source": str(src.relative_to(ROOT)) if src.is_relative_to(ROOT) else str(src),
        "size_mb": round(size_mb, 1),
    }, indent=1), encoding="utf-8")
    print(f"wrote {dst} ({size_mb:.0f} MB) in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
