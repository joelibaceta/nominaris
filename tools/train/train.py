"""
Entrena el tiny-LM de naming (student) por sequence-level distillation.

Entrada:  data/dataset.jsonl  (filas {idea, keywords[], names[], ...} del teacher)
Salida:   tools/train/out/   (modelo GPT-2 pequeno + tokenizer)

Formato de entrenamiento (una secuencia por (keywords -> nombre)):
    <kw> kw1 kw2 kw3 <gen> nombre <eos>
La perdida se enmascara sobre el prompt (<kw>..<gen>): el modelo solo aprende a
GENERAR el nombre condicionado a las keywords. Asi la semantica (que nombre pega
con que idea) queda DENTRO del modelo, aprendida de los ejemplos del teacher.

Uso:
    python tools/train/train.py --data data/dataset.jsonl --epochs 8
"""

import argparse, json, os, random
from pathlib import Path

import torch
from torch.utils.data import Dataset
from tokenizers import ByteLevelBPETokenizer
from transformers import (
    GPT2Config, GPT2LMHeadModel, PreTrainedTokenizerFast,
    Trainer, TrainingArguments,
)

KW, GEN, EOS, PAD = "<kw>", "<gen>", "<eos>", "<pad>"
BLOCK = 64  # contexto corto: keywords + un nombre entran de sobra


def read_rows(path):
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def train_tokenizer(rows, vocab_size, out_dir):
    """BPE byte-level sobre todo el texto (keywords + nombres)."""
    corpus = out_dir / "corpus.txt"
    with open(corpus, "w") as f:
        for r in rows:
            f.write(" ".join(r.get("keywords", [])) + "\n")
            for n in r.get("names", []):
                f.write(n + "\n")
    tok = ByteLevelBPETokenizer()
    tok.train(
        files=[str(corpus)], vocab_size=vocab_size, min_frequency=2,
        special_tokens=[PAD, KW, GEN, EOS],
    )
    tok.save_model(str(out_dir))
    # Envuelve en un tokenizer HF (para Trainer y para exportar tokenizer.json)
    fast = PreTrainedTokenizerFast(
        tokenizer_object=tok._tokenizer,
        pad_token=PAD, eos_token=EOS,
        additional_special_tokens=[KW, GEN],
    )
    fast.save_pretrained(str(out_dir))
    return fast


class NameDataset(Dataset):
    """Cada (keywords -> nombre) es un ejemplo con perdida enmascarada en el prompt."""
    def __init__(self, rows, tok):
        self.ex = []
        kw_id, gen_id, eos_id = tok.convert_tokens_to_ids([KW, GEN, EOS])
        for r in rows:
            kws = " ".join(r.get("keywords", [])).strip()
            prompt = [kw_id] + tok.encode(" " + kws, add_special_tokens=False) + [gen_id]
            for name in r.get("names", []):
                name = name.strip().lower()
                if not name:
                    continue
                body = tok.encode(" " + name, add_special_tokens=False) + [eos_id]
                ids = prompt + body
                if len(ids) > BLOCK:
                    continue
                labels = [-100] * len(prompt) + body  # solo aprende el nombre
                self.ex.append((ids, labels))

    def __len__(self):
        return len(self.ex)

    def __getitem__(self, i):
        ids, labels = self.ex[i]
        return {"input_ids": ids, "labels": labels}


def collate(batch, pad_id):
    m = max(len(b["input_ids"]) for b in batch)
    input_ids, labels, attn = [], [], []
    for b in batch:
        n = m - len(b["input_ids"])
        input_ids.append(b["input_ids"] + [pad_id] * n)
        labels.append(b["labels"] + [-100] * n)
        attn.append([1] * len(b["input_ids"]) + [0] * n)
    t = torch.tensor
    return {"input_ids": t(input_ids), "labels": t(labels), "attention_mask": t(attn)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/dataset.jsonl")
    ap.add_argument("--out", default="tools/train/out")
    ap.add_argument("--vocab", type=int, default=4000)
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--n_embd", type=int, default=256)
    ap.add_argument("--n_layer", type=int, default=4)
    ap.add_argument("--n_head", type=int, default=4)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--dropout", type=float, default=0.1)
    args = ap.parse_args()

    random.seed(0); torch.manual_seed(0)
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)

    rows = read_rows(args.data)
    print(f"{len(rows)} filas; entrenando tokenizer (vocab {args.vocab})...")
    tok = train_tokenizer(rows, args.vocab, out)

    ds = NameDataset(rows, tok)
    print(f"{len(ds)} ejemplos (keywords -> nombre)")

    cfg = GPT2Config(
        vocab_size=tok.vocab_size, n_positions=BLOCK, n_ctx=BLOCK,
        n_embd=args.n_embd, n_layer=args.n_layer, n_head=args.n_head,
        resid_pdrop=args.dropout, embd_pdrop=args.dropout, attn_pdrop=args.dropout,
        bos_token_id=tok.pad_token_id, eos_token_id=tok.eos_token_id,
    )
    model = GPT2LMHeadModel(cfg)
    params = sum(p.numel() for p in model.parameters())
    print(f"Modelo: {params/1e6:.1f}M parametros")

    # Apple Silicon: el Trainer usa MPS (Metal) automaticamente si esta disponible.
    dev = "mps" if torch.backends.mps.is_available() else (
        "cuda" if torch.cuda.is_available() else "cpu")
    print(f"Dispositivo: {dev}")

    targs = TrainingArguments(
        output_dir=str(out / "ckpt"), overwrite_output_dir=True,
        num_train_epochs=args.epochs, per_device_train_batch_size=args.batch,
        learning_rate=3e-4, weight_decay=0.01, warmup_ratio=0.05,
        lr_scheduler_type="cosine", logging_steps=50, save_strategy="no",
        report_to=[], fp16=torch.cuda.is_available(),
    )
    Trainer(
        model=model, args=targs, train_dataset=ds,
        data_collator=lambda b: collate(b, tok.pad_token_id),
    ).train()

    model.save_pretrained(str(out))
    tok.save_pretrained(str(out))
    print(f"\nListo. Modelo en {out}/  ->  siguiente: python tools/train/export.py")


if __name__ == "__main__":
    main()
