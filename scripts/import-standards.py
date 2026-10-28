"""Rebuild the pinned legal-text catalog from official HTML and PDF extracts."""

import argparse
import hashlib
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup


DISABILITY_EXTRACTION_FIXES = {
    "5.8.2.4": ("面部条状瘢痕形成，累计长度达30.0cm；面部中心区条状瘢痕形成（宽度达0.2cm），累计长度达15.0cm；2",
                "面部条状瘢痕形成，累计长度达30.0cm；面部中心区条状瘢痕形成（宽度达0.2cm），累计长度达15.0cm；"),
    "5.8.2.5": ("面部块状增生性瘢痕形成，累计面积达15.0cm；面部中心区块状增生性瘢痕形成，单块22面积达7.0cm或者多块累计面积达9.0cm；2",
                "面部块状增生性瘢痕形成，累计面积达15.0cm2；面部中心区块状增生性瘢痕形成，单块面积达7.0cm2或者多块累计面积达9.0cm2；"),
    "5.8.2.6": ("面部片状细小瘢痕形成或者色素异常，累计面积达100.0cm；",
                "面部片状细小瘢痕形成或者色素异常，累计面积达100.0cm2；"),
    "5.9.2.1": ("头皮瘢痕形成或者无毛发，达头皮面积50％；2",
                "头皮瘢痕形成或者无毛发，达头皮面积50％；"),
    "5.9.2.2": ("颅骨缺损25.0cm以上，不宜或者无法手术修补；",
                "颅骨缺损25.0cm2以上，不宜或者无法手术修补；"),
    "5.9.2.4": ("面部条状瘢痕形成，累计长度达20.0cm；面部条状瘢痕形成（宽度达0.2cm），累计长度达10.0cm，其中至少5.0cm以上位于面部中心区；22",
                "面部条状瘢痕形成，累计长度达20.0cm；面部条状瘢痕形成（宽度达0.2cm），累计长度达10.0cm，其中至少5.0cm以上位于面部中心区；"),
    "5.9.2.5": ("面部块状瘢痕形成，单块面积达7.0cm，或者多块累计面积达9.0cm；2",
                "面部块状瘢痕形成，单块面积达7.0cm2，或者多块累计面积达9.0cm2；"),
    "5.9.2.6": ("面部片状细小瘢痕形成或者色素异常，累计面积达30.0cm；",
                "面部片状细小瘢痕形成或者色素异常，累计面积达30.0cm2；"),
    "5.10.2.1": ("面颅骨部分缺损或者畸形，影响面容；2",
                 "面颅骨部分缺损或者畸形，影响面容；"),
    "5.10.2.2": ("头皮瘢痕形成或者无毛发，面积达40.0cm；",
                 "头皮瘢痕形成或者无毛发，面积达40.0cm2；"),
    "5.10.2.5": ("面部块状瘢痕形成，单块面积达3.0cm2，或者多块累计面积达5.0cm2；2",
                 "面部块状瘢痕形成，单块面积达3.0cm2，或者多块累计面积达5.0cm2；"),
    "5.10.2.6": ("面部片状细小瘢痕形成或者色素异常，累计面积达10.0cm；",
                 "面部片状细小瘢痕形成或者色素异常，累计面积达10.0cm2；"),
    "5.10.3.1": ("颏颈粘连畸形松解术后；2", "颏颈粘连畸形松解术后；"),
    "5.10.3.2": ("颈前三角区瘢痕形成，累计面积达25.0cm；",
                 "颈前三角区瘢痕形成，累计面积达25.0cm2；"),
}
DISABILITY_EXTRACTION_FIX_SHA256 = "8281ea72449f64722b5ab9fcd457a7fd93dd2af d8409cd8c40772e4acb57cac0".replace(" ", "")


def compact(text):
    return re.sub(r"\s+", "", text.replace("\u00a0", " "))


def injury_catalog(path):
    raw = path.read_bytes()
    soup = BeautifulSoup(raw.decode("utf-8"), "html.parser")
    lines = [line.strip() for line in soup.get_text("\n").splitlines() if line.strip()]
    clauses, principles = [], []
    category = grade = section = None
    active = None
    collecting = False
    for line in lines:
        line = compact(line)
        if line == "4总则":
            collecting = True
        if not collecting:
            continue
        if line.startswith("附录"):
            break
        heading = re.match(r"^(5\.\d+)\s*([^\d].*)$", line)
        level = re.match(r"^(5\.\d+\.\d+)(重伤一级|重伤二级|轻伤一级|轻伤二级|轻微伤)$", line)
        item = re.match(r"^([a-z])\)(.+)$", line)
        principle = re.match(r"^([46]\.\d+(?:\.\d+)?)(.+)$", line)
        if level:
            section, grade = level.groups()
            active = None
        elif heading:
            category = heading.group(2)
            section = grade = active = None
        elif item and section and grade:
            active = {"id": f"{section}.{item.group(1)}", "grade": grade,
                      "category": category, "text": item.group(2)}
            clauses.append(active)
        elif principle:
            active = {"id": principle.group(1), "text": principle.group(2)}
            principles.append(active)
            section = grade = None
        elif active and not re.match(r"^[456](?:\.|[^0-9])", line):
            active["text"] += line
    assert len(clauses) > 200, "Incomplete injury source"
    index = {clause["id"]: clause for clause in clauses}
    assert "四肢长骨骨折" in index["5.9.4.f"]["text"]
    assert index["5.9.4.f"]["grade"] == "轻伤二级"
    assert "8.0cm" in index["5.1.4.a"]["text"]
    return {"standard": {"type": "injury", "name": "人体损伤程度鉴定标准",
                         "version": "2013年公布版", "effectiveDate": "2014-01-01",
                         "sourceUrl": "https://jjjcz.mee.gov.cn/djfg/gjflfg/sfjs/201308/t20130830_445612.html",
                         "sourceSha256": hashlib.sha256(raw).hexdigest()},
            "principles": principles, "clauses": clauses}


def disability_catalog(path, pdf_path):
    source_sha256 = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    lines = []
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or re.fullmatch(r"-\s*\d+\s*-", line):
            continue
        lines.append(line)
    clauses, principles = [], []
    section = category = grade = active = None
    collecting = False
    grades = ["一级", "二级", "三级", "四级", "五级", "六级", "七级", "八级", "九级", "十级"]
    for line in lines:
        if re.match(r"^4\s+总则", line):
            collecting = True
        if not collecting:
            continue
        if re.fullmatch(r"附\s*录\s*[A-Z]", line):
            break
        level = re.match(r"^5\.(\d+)\s+(一级|二级|三级|四级|五级|六级|七级|八级|九级|十级)$", line)
        heading = re.match(r"^(5\.\d+\.\d+)\s+(.+)$", line)
        item = re.match(r"^(\d+)\)\s*(.+)$", line)
        principle = re.match(r"^([46]\.\d+)\s+(.+)$", line)
        if level:
            grade = grades[int(level.group(1)) - 1] + "伤残"
            section = active = None
        elif heading:
            section, category = heading.groups()
            active = None
        elif item and section:
            active = {"id": f"{section}.{item.group(1)}", "grade": grade,
                      "category": category, "text": compact(item.group(2))}
            clauses.append(active)
        elif principle:
            active = {"id": principle.group(1), "text": compact(principle.group(2))}
            principles.append(active)
            section = None
        elif active and not re.match(r"^[456]\s+", line):
            active["text"] += compact(line)
    assert len(clauses) > 300, "Incomplete disability source"
    index = {clause["id"]: clause for clause in clauses}
    if source_sha256 == DISABILITY_EXTRACTION_FIX_SHA256:
        for clause_id, (extracted_text, official_text) in DISABILITY_EXTRACTION_FIXES.items():
            clause = index[clause_id]
            if clause["text"] == extracted_text:
                clause["text"] = official_text
            elif clause["text"] != official_text:
                raise ValueError(f"Unrecognized PDF extraction text for {clause_id}")
    assert "肋骨骨折6根以上" in index["5.10.3.7"]["text"]
    assert index["5.10.3.7"]["grade"] == "十级伤残"
    assert "脾部分切除" in index["5.9.4.2"]["text"]
    assert index["5.9.4.2"]["grade"] == "九级伤残"
    return {"standard": {"type": "disability", "name": "人体损伤致残程度分级",
                         "version": "2016年公布版", "effectiveDate": "2017-01-01",
                         "sourceUrl": "https://sfj.taian.gov.cn/module/download/downfile.jsp?classid=0&filename=657c49dd386d41d3a0b913c63e332dbb.pdf",
                         "noticeUrl": "https://www.moj.gov.cn/pub/sfbgwapp/zwgk/tzggApp/202105/t20210517_395433.html",
                         "sourceSha256": source_sha256},
            "principles": principles, "clauses": clauses}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    catalogs = {"injury": injury_catalog(args.source_dir / "injury.html"),
                "disability": disability_catalog(args.source_dir / "disability.txt", args.source_dir / "disability.pdf")}
    for name, catalog in catalogs.items():
        ids = [clause["id"] for clause in catalog["clauses"]]
        assert len(ids) == len(set(ids)), "Duplicate clause IDs"
        output = args.output_dir / (name + ".json")
        output.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n")
        print(name, len(ids), "clauses", len(catalog["principles"]), "principles")
