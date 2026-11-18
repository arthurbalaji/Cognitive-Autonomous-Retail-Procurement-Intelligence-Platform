import sys

sys.path.insert(0, "D:/CARPIP final/scripts/paper")
from docx_tools import Docx, text_of
from edits_static import apply_static

d = Docx("D:/CARPIP final/CARPIP Research Paper SNS - Camera Ready.docx")
apply_static(d)
d.save("D:/CARPIP final/.demo/paper/static.docx")
t0 = t1 = 0
for i in sorted(d.new):
    a, b = len(text_of(d.orig[i])), len(text_of(d.new[i]))
    t0 += a
    t1 += b
    print(i, a, b)
print("chars", t0, t1, "delta words ~", (t1 - t0) // 6)
