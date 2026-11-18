"""Minimal, format-preserving .docx editing for the camera-ready paper.

Paragraph indices are positions of <w:p> elements in word/document.xml (table-cell paragraphs included), as printed by `dump()`.
Only text/equation content is replaced: pPr, run properties (bold / italic), styles, section settings, fonts and media stay as in the original.
"""
from __future__ import annotations

import re
import zipfile
from xml.sax.saxutils import escape

P_RE = re.compile(r"<w:p[ >].*?</w:p>", re.S)
RUN_RE = re.compile(r"<w:r[ >].*?</w:r>", re.S)


def text_of(p: str) -> str:
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", p)) or "".join(re.findall(r"<m:t[^>]*>([^<]*)</m:t>", p))


class Docx:
    def __init__(self, path: str):
        self.path = path
        with zipfile.ZipFile(path) as z:
            self.names = z.namelist()
            self.blobs = {n: z.read(n) for n in self.names}
        self.xml = self.blobs["word/document.xml"].decode("utf8")
        self.spans = [(m.start(), m.end()) for m in P_RE.finditer(self.xml)]
        self.orig = [self.xml[a:b] for a, b in self.spans]
        self.new: dict[int, str] = {}

    def para(self, i: int) -> str:
        return self.new.get(i, self.orig[i])

    def dump(self) -> list[str]:
        return [f"{i}|{text_of(self.para(i))}" for i in range(len(self.orig))]

    def _rprs(self, p: str) -> dict[str, str]:
        out = {"": "", "b": "<w:rPr><w:b/></w:rPr>", "i": "<w:rPr><w:i/></w:rPr>"}
        for r in RUN_RE.findall(p):
            if not re.search(r"<w:t[ >]", r):
                continue
            m = re.search(r"<w:rPr>.*?</w:rPr>", r, re.S)
            rp = m.group(0) if m else ""
            kind = "b" if "<w:b/>" in rp else "i" if "<w:i/>" in rp else ""
            out.setdefault(kind, rp)
            if kind == "" and rp and out[""] == "":
                out[""] = rp
            elif kind != "":
                out[kind] = rp
        return out

    def set_text(self, i: int, expect: str, segments, allow_fields: bool = False) -> None:
        """Replace paragraph i's runs. `segments` = str or [(text, '' | 'b' | 'i'), ...]. `expect` must prefix the current text."""
        p = self.orig[i]
        cur = text_of(p)
        if not cur.startswith(expect):
            raise ValueError(f"paragraph {i} is {cur[:60]!r}, expected prefix {expect!r}")
        if not allow_fields and ("<w:fldChar" in p or "<w:tab/>" in p or "<w:drawing" in p):
            raise ValueError(f"paragraph {i} has fields/tabs/drawings")
        if isinstance(segments, str):
            segments = [(segments, "")]
        rprs = self._rprs(p)
        opener = p[: p.index(">") + 1]
        ppr = re.search(r"<w:pPr>.*?</w:pPr>", p, re.S)
        runs = "".join(f'<w:r>{rprs.get(k, "")}<w:t xml:space="preserve">{escape(t)}</w:t></w:r>' for t, k in segments)
        self.new[i] = f"{opener}{ppr.group(0) if ppr else ''}{runs}</w:p>"

    def segments_of(self, i: int) -> list[tuple[str, str]]:
        """Current text runs of paragraph i as [(text, kind)], kind '' | 'b' | 'i'."""
        from xml.sax.saxutils import unescape
        segs = []
        for run in RUN_RE.findall(self.para(i)):
            t = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", run))
            if not t:
                continue
            rp = re.search(r"<w:rPr>.*?</w:rPr>", run, re.S)
            rp = rp.group(0) if rp else ""
            kind = "b" if "<w:b/>" in rp else "i" if "<w:i/>" in rp else ""
            if segs and segs[-1][1] == kind:
                segs[-1] = (segs[-1][0] + unescape(t), kind)
            else:
                segs.append((unescape(t), kind))
        return segs

    def replace_in(self, i: int, old: str, new: str) -> None:
        """Replace `old` (which must lie inside ONE run) by `new`, keeping every run's formatting."""
        segs = self.segments_of(i)
        for k, (t, kind) in enumerate(segs):
            if old in t:
                segs[k] = (t.replace(old, new, 1), kind)
                self._force(i, segs)
                return
        raise ValueError(f"paragraph {i}: {old!r} not found inside a single run; runs={[s[0][:40] for s in segs]}")

    def _force(self, i: int, segs) -> None:
        p = self.orig[i]
        if "<w:fldChar" in p or "<w:tab/>" in p or "<w:drawing" in p:
            raise ValueError(f"paragraph {i} has fields/tabs/drawings")
        rprs = self._rprs(self.orig[i])
        opener = p[: p.index(">") + 1]
        ppr = re.search(r"<w:pPr>.*?</w:pPr>", p, re.S)
        runs = "".join(f'<w:r>{rprs.get(k, "")}<w:t xml:space="preserve">{escape(t)}</w:t></w:r>' for t, k in segs)
        self.new[i] = f"{opener}{ppr.group(0) if ppr else ''}{runs}</w:p>"

    def set_equation(self, i: int, expect: str, omml_children: str) -> None:
        p = self.orig[i]
        if "<m:oMath>" not in p:
            raise ValueError(f"paragraph {i} has no equation")
        cur = text_of(p)
        if not cur.startswith(expect):
            raise ValueError(f"equation {i} is {cur[:50]!r}, expected prefix {expect!r}")
        a = p.index("<m:oMath>") + len("<m:oMath>")
        b = p.index("</m:oMath>")
        self.new[i] = p[:a] + omml_children + p[b:]

    def save(self, out: str, media: dict[str, bytes] | None = None) -> None:
        parts, last = [], 0
        for i, (a, b) in enumerate(self.spans):
            parts.append(self.xml[last:a])
            parts.append(self.new.get(i, self.orig[i]))
            last = b
        parts.append(self.xml[last:])
        blobs = dict(self.blobs)
        blobs["word/document.xml"] = "".join(parts).encode("utf8")
        for k, v in (media or {}).items():
            blobs[k] = v
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for n in self.names:
                z.writestr(n, blobs[n])


# ----------------------------------------------------------------------------- OMML builder (same font/props as the original equations)
_F = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>'
_FI = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/></w:rPr>'


def r(t: str, nor: bool = False) -> str:
    """math run; nor=True renders upright text (variable names like MPI, DP)."""
    return f'<m:r>{"<m:rPr><m:nor/></m:rPr>" if nor else ""}{_F}<m:t>{escape(t)}</m:t></m:r>'


def sub(base: str, s: str) -> str:
    return f"<m:sSub><m:sSubPr><m:ctrlPr>{_FI}</m:ctrlPr></m:sSubPr><m:e>{base}</m:e><m:sub>{s}</m:sub></m:sSub>"


def frac(num: str, den: str) -> str:
    return f"<m:f><m:fPr><m:ctrlPr>{_FI}</m:ctrlPr></m:fPr><m:num>{num}</m:num><m:den>{den}</m:den></m:f>"


def paren(inner: str) -> str:
    return f"<m:d><m:dPr><m:ctrlPr>{_FI}</m:ctrlPr></m:dPr><m:e>{inner}</m:e></m:d>"


def sqrt(inner: str) -> str:
    return f"<m:rad><m:radPr><m:degHide m:val=\"1\"/><m:ctrlPr>{_FI}</m:ctrlPr></m:radPr><m:deg/><m:e>{inner}</m:e></m:rad>"
