# -*- coding: utf-8 -*-
"""Profile the supplied 249-country Chinese passport visa CSV."""
import csv, json, re, collections, sys, io

CSV_PATH = r"E:\dsh-new-1\visaatlas\data\source\global_249_countries_cn_passport_visa.csv"
COUNTRY_JSON = r"E:\dsh-new-1\visaatlas\data\countries.json"

with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
    rows = list(csv.DictReader(f))

print("rows:", len(rows))
print("columns:", list(rows[0].keys()))
print()

regions = collections.Counter(r["大洲分组 (Region)"] for r in rows)
print("regions:", dict(regions))
print()

cats = collections.Counter(r["中国护照通行政策分类"] for r in rows)
print("policy categories:")
for k, v in cats.most_common():
    print(f"  {v:3d}  {k!r}")
print()

# duplicates / anomalies
codes = [r["国家/地区代码 (ISO2)"] for r in rows]
print("duplicate codes:", [c for c, n in collections.Counter(codes).items() if n > 1])
print("bad code format:", [c for c in codes if not re.fullmatch(r"[A-Z]{2}", c)])
print("route codes dup:", [c for c, n in collections.Counter(r["推荐路线编号 (route_code)"] for r in rows).items() if n > 1])
print("empty cn names:", [r["国家/地区代码 (ISO2)"] for r in rows if not r["中文名称"].strip()])
print()

# compare with country catalog
countries = json.load(open(COUNTRY_JSON, encoding="utf-8"))
cat_codes = {c["code"] for c in countries}
csv_codes = set(codes)
print("catalog countries:", len(countries))
print("in csv not in catalog:", sorted(csv_codes - cat_codes))
print("in catalog not in csv:", sorted(cat_codes - csv_codes))
print()

# description patterns
print("sample descriptions:")
for r in rows[:15]:
    print(" -", r["国家/地区代码 (ISO2)"], "|", r["中国护照通行政策分类"], "|", r["旅游签证及免签/落地签说明"][:80])
print()

print("other visa types values:")
for k, v in collections.Counter(r["其他常见签证类型 (商务/留学/工作等)"] for r in rows).most_common(40):
    print(f"  {v:3d}  {k!r}")
print()

# quick coarse classification attempt
patterns = {
    "互免": r"互免",
    "单方面免签": r"单方面免签",
    "免签": r"免签",
    "落地签": r"落地签|口岸签",
    "电子签": r"电子签|e-?visa|eVisa",
    "申根": r"申根",
    "过境": r"过境",
    "使馆": r"使馆|使领馆",
}
for name, pat in patterns.items():
    n = sum(1 for r in rows if re.search(pat, r["旅游签证及免签/落地签说明"]))
    print(f"desc contains {name}: {n}")
print()

# stay-day mentions
day_pat = re.compile(r"(\d{1,3})\s*天")
mention = [(r["国家/地区代码 (ISO2)"], day_pat.findall(r["旅游签证及免签/落地签说明"])) for r in rows]
with_days = [(c, d) for c, d in mention if d]
print("rows with explicit day count:", len(with_days), "e.g.", with_days[:12])
month_pat = re.compile(r"(\d{1,2})\s*个?月")
with_months = [(r["国家/地区代码 (ISO2)"], month_pat.findall(r["旅游签证及免签/落地签说明"])) for r in rows if month_pat.search(r["旅游签证及免签/落地签说明"])]
print("rows with explicit month count:", len(with_months), "e.g.", with_months[:12])
print()

# empty / weird
print("empty desc:", [(r["国家/地区代码 (ISO2)"], r["中国护照通行政策分类"]) for r in rows if not r["旅游签证及免签/落地签说明"].strip()])
print("desc length distribution:", collections.Counter(len(r["旅游签证及免签/落地签说明"]) // 10 * 10 for r in rows))
print()

# rows where category says 免签 but description says 需签 or vice versa
suspect = []
for r in rows:
    c = r["中国护照通行政策分类"]
    d = r["旅游签证及免签/落地签说明"]
    if "免签" in c and re.search(r"须|需|申请签证|办理签证", d) and not re.search(r"免签|不需要", d):
        suspect.append(("免签类但描述要签", r["国家/地区代码 (ISO2)"], c, d))
    if "预办" in c and re.search(r"免签|落地签", d):
        suspect.append(("预办类但描述免签/落地", r["国家/地区代码 (ISO2)"], c, d))
print("category/description suspects:", len(suspect))
for s in suspect[:40]:
    print("  ", s)

print()
print("region->sample country codes:")
by_region = collections.defaultdict(list)
for r in rows:
    by_region[r["大洲分组 (Region)"]].append(r["国家/地区代码 (ISO2)"])
for k, v in by_region.items():
    print("  ", k, len(v), v[:8])
