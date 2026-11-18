"""Check every reference of the camera-ready paper against Crossref / DataCite by DOI. Report only; never edits the paper."""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

SRC = "CARPIP Research Paper SNS - Camera Ready.docx"
x = zipfile.ZipFile(SRC).read("word/document.xml").decode("utf8")
refs = []
for p in re.findall(r"<w:p[ >].*?</w:p>", x, flags=re.S):
    if 'w:val="Reference"' in p:
        refs.append("".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", p)))


def get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "carpip-ref-check/1.0 (mailto:none@example.org)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def norm(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{4,}", s.lower()))


for i, ref in enumerate(refs, 1):
    doi = re.search(r"DOI:\s*(\S+)", ref).group(1).rstrip(".")
    cited_title = ref.split(". ", 2)[1] if ". " in ref else ref
    m = re.match(r"(.*?),\s*(\d{4})\.\s*(.*?)\.\s", ref)
    year = re.search(r",\s*(\d{4})\.", ref).group(1)
    title = ref.split(f"{year}. ", 1)[1].split(". ", 1)[0]
    res = {"title": None, "authors": [], "year": None, "src": None}
    try:
        j = get("https://api.crossref.org/works/" + urllib.parse.quote(doi))["message"]
        res = {"title": (j.get("title") or [""])[0], "authors": [a.get("family", "") for a in j.get("author", [])],
               "year": (j.get("issued", {}).get("date-parts") or [[None]])[0][0], "src": "crossref"}
    except urllib.error.HTTPError:
        try:
            j = get("https://api.datacite.org/dois/" + urllib.parse.quote(doi))["data"]["attributes"]
            res = {"title": (j.get("titles") or [{}])[0].get("title", ""), "authors": [c.get("familyName", "") for c in j.get("creators", [])],
                   "year": j.get("publicationYear"), "src": "datacite"}
        except Exception as e:  # noqa: BLE001
            res["src"] = f"NOT FOUND ({e})"
    except Exception as e:  # noqa: BLE001
        res["src"] = f"ERROR ({e})"
    overlap = len(norm(title) & norm(res["title"] or "")) / max(len(norm(title)), 1)
    first = ref.split(",")[0].split()[0]
    first_ok = any(first.lower() in a.lower() or a.lower() in first.lower() for a in res["authors"])
    flag = "OK " if overlap >= 0.7 and first_ok else "CHECK"
    print(f"[{i:2d}] {flag} {doi}  src={res['src']}  title-overlap={overlap:.2f} first-author-match={first_ok} year paper={year} registry={res['year']}")
    if flag != "OK ":
        print(f"      paper   : {title}\n      registry: {res['title']}  authors={res['authors'][:4]}")
sys.stdout.flush()
