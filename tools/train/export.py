"""
Exporta el tiny-LM entrenado a ONNX + int8, en el layout que transformers.js
espera (public/model/onnx/model_quantized.onnx + tokenizer + config).

Uso:
    python tools/train/export.py --model tools/train/out --out public/model
"""

import argparse, shutil
from pathlib import Path

from optimum.onnxruntime import ORTModelForCausalLM
from onnxruntime.quantization import quantize_dynamic, QuantType


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="tools/train/out")
    ap.add_argument("--out", default="public/model")
    args = ap.parse_args()

    src, out = Path(args.model), Path(args.out)
    onnxdir = out / "onnx"
    onnxdir.mkdir(parents=True, exist_ok=True)

    print("Exportando a ONNX (fp32)...")
    ort = ORTModelForCausalLM.from_pretrained(src, export=True)
    tmp = out / "_ort"
    ort.save_pretrained(tmp)

    # config del modelo -> raiz de out (transformers.js lo lee de ahi)
    for f in ["config.json", "generation_config.json"]:
        if (tmp / f).exists():
            shutil.copy(tmp / f, out / f)

    # tokenizer + metadatos -> raiz de out
    for f in ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
              "vocab.json", "merges.txt"]:
        if (src / f).exists():
            shutil.copy(src / f, out / f)

    # localiza el onnx exportado y muevelo a out/onnx/
    onnx_files = list(tmp.glob("*.onnx"))
    if not onnx_files:
        raise SystemExit("No se genero ningun .onnx en el export")
    main_onnx = (tmp / "model.onnx") if (tmp / "model.onnx").exists() \
        else max(onnx_files, key=lambda p: p.stat().st_size)
    shutil.copy(main_onnx, onnxdir / "model.onnx")
    for d in tmp.glob("*.onnx_data"):  # datos externos (si el modelo fuera grande)
        shutil.copy(d, onnxdir / d.name)

    fp32 = onnxdir / "model.onnx"
    int8 = onnxdir / "model_quantized.onnx"
    print("Cuantizando a int8...")
    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8)

    mb = lambda p: p.stat().st_size / 1e6
    fp32_mb, int8_mb = mb(fp32), mb(int8)
    fp32.unlink(missing_ok=True)  # el frontend solo usa el int8; no dejamos el fp32 (48 MB)
    shutil.rmtree(tmp, ignore_errors=True)

    print("\nListo:")
    print(f"  fp32: {fp32_mb:.1f} MB (descartado)")
    print(f"  int8: {int8_mb:.1f} MB  <- lo sirve el frontend")
    print(f"\nModelo en {out}/ -> recarga la app (npm run dev) y usa el tiny-LM solo.")


if __name__ == "__main__":
    main()
