"""Build the revised camera-ready paper from the original template + measured results.

    python scripts/paper/build.py [out.docx]

Original is never modified. Content (text, equations, table cells, figure bitmaps) is replaced; styles, fonts, page setup stay.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

from docx_tools import Docx, text_of  # noqa: E402
from edits_results import Nums, apply_tables, apply_text  # noqa: E402
from edits_static import apply_static  # noqa: E402
from extras import build_extras  # noqa: E402

SRC = os.path.join(ROOT, "CARPIP Research Paper SNS - Camera Ready.docx")


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, ".demo", "paper", "revised.docx")
    d = Docx(SRC)
    X = Nums()
    apply_static(d)
    apply_tables(d, X)
    apply_text(d, X, build_extras(X))
    media = {}
    for k in (1, 2, 3):
        with open(os.path.join(HERE, "figs", f"image{k}.png"), "rb") as f:
            media[f"word/media/image{k}.png"] = f.read()
    d.save(out, media)
    t0 = t1 = 0
    for i in sorted(d.new):
        a, b = len(text_of(d.orig[i])), len(text_of(d.new[i]))
        t0 += a
        t1 += b
    print(f"wrote {out}; edited paragraphs {len(d.new)}; characters {t0} -> {t1}")


if __name__ == "__main__":
    main()
