# -*- coding: utf-8 -*-
"""Симуляція нової логіки pidbir_donoriv.gs — константи читаються прямо з .gs,
щоб перевірявся справжній код, а не його копія."""
import sys, io, csv, re, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import os
HERE = os.path.dirname(os.path.abspath(__file__))

GS = os.path.join(HERE, "pidbir_donoriv.gs")
# CSV-експорти бази донорів і листа проєктів — вказати свої шляхи
BASE = r"База Пироги - Топ (Робоч).csv"
GP = r"25-26 пироги – меджик + ГП - ГП - Вересень.csv"

src = open(GS, encoding="utf-8").read()


def js_const(name):
    """Витягти var NAME = <літерал>; і перетворити на Python-значення."""
    m = re.search(r"var\s+" + name + r"\s*=\s*([^;]+);", src, re.S)
    if not m:
        raise SystemExit(f"не знайдено {name} у .gs")
    body = m.group(1)
    body = re.sub(r"//[^\n]*", "", body)          # коментарі
    body = re.sub(r"'\s*\+\s*\n?\s*'", "", body)  # склеєні рядки 'a' + 'b'
    body = body.replace("'", '"')
    body = re.sub(r",(\s*[}\]])", r"\1", body)    # висячі коми
    return json.loads(body)


REGION_GEO = js_const("GP_REGION_GEO")
LANG_REGION = js_const("GP_LANG_REGION")
REGION_ALLOW = js_const("GP_REGION_ALLOW")
TIER_BLOCKS = js_const("GP_TIER_BLOCKS")
DEFAULT_EN = js_const("GP_REGION_DEFAULT_EN")
DR_MIN = js_const("GP_DR_MIN")
TR_MIN = js_const("GP_TRAFFIC_MIN")
TR_MIN_EN = js_const("GP_TRAFFIC_MIN_EN")

GEO_REGION = {}
for reg, codes in REGION_GEO.items():
    for c in codes.split():
        if c in GEO_REGION:
            print(f"!! код {c} у двох регіонах: {GEO_REGION[c]} і {reg}")
        GEO_REGION[c] = reg

print(f"прочитано з .gs: {len(GEO_REGION)} кодів країн, {len(REGION_ALLOW)} регіонів, "
      f"пороги DR{DR_MIN}/tr{TR_MIN}/en{TR_MIN_EN}")
missing = [r for r in REGION_GEO if r not in REGION_ALLOW]
if missing:
    print("!! регіони без GP_REGION_ALLOW:", missing)
unknown = sorted({r for v in REGION_ALLOW.values() for r in v} - set(REGION_GEO))
if unknown:
    print("!! у GP_REGION_ALLOW є неіснуючі регіони:", unknown)
for lang, reg in LANG_REGION.items():
    if reg not in REGION_ALLOW:
        print(f"!! GP_LANG_REGION[{lang}] = {reg} — такого регіону немає")


def to_int(v):
    v = re.sub(r"[^\d\-]", "", str(v))
    return int(v) if v not in ("", "-") else 0


def geo_code(v):
    m = re.match(r"\(?\s*([A-Za-z]{2})\s*,", str(v or ""))
    return m.group(1).lower() if m else ""


def detect_geo(project):
    for w in reversed(re.split(r"[\s\-_,()/]+", project or "")):
        if re.fullmatch(r"[A-Za-z]{2}", w) and w == w.upper():
            c = w.lower()
            if c in ("id", "io"):
                continue
            return c
    return ""


with open(BASE, encoding="utf-8", errors="ignore", newline="") as f:
    rows = list(csv.reader(f))[1:]
donors = []
for r in rows:
    def c(i): return r[i].strip() if i < len(r) else ""
    if not c(1):
        continue
    donors.append({"block": c(0), "domain": c(1).lower(), "lang": c(2),
                   "dr": to_int(c(3)), "traffic": to_int(c(4)), "geo": geo_code(c(5))})

no_region = [d for d in donors if not GEO_REGION.get(d["geo"])]
if no_region:
    print(f"!! {len(no_region)} донорів із ГЕО поза мапою:",
          sorted({d['geo'] or '(порожнє)' for d in no_region}))


def passes(d):
    return d["dr"] >= DR_MIN and d["traffic"] >= (TR_MIN_EN if d["lang"] == "English" else TR_MIN)


def region_of(lang, geo):
    return GEO_REGION.get(geo) or LANG_REGION.get(lang) or (DEFAULT_EN if lang == "English" else "")


def run(lang, geo):
    region = region_of(lang, geo)
    allow = REGION_ALLOW.get(region)
    dreg = lambda d: GEO_REGION.get(d["geo"], "")
    pool = [d for d in donors if d["block"] not in TIER_BLOCKS
            and (dreg(d) in allow if allow else True)]
    used, queues = set(), []

    def take(name, native, fn):
        src_ = donors if native else pool
        lst = [d for d in src_ if d["domain"] not in used and fn(d)]
        for d in lst:
            used.add(d["domain"])
        if lst:
            queues.append({"name": name, "native": native, "list": lst})

    if geo:
        take(f"Регіональні — {lang} + {geo.upper()}", True,
             lambda d: d["lang"] == lang and d["geo"] == geo)
    if lang != "English":
        take(f"Уся мова — {lang}", True, lambda d: d["lang"] == lang)
        if region and region != "Америка":
            take(f"Увесь регіон — {region}", False, lambda d: dreg(d) == region)
    elif region and region != "Америка":
        take(f"Англомовні — регіон {region}", False,
             lambda d: d["lang"] == "English" and dreg(d) == region)
    take("Англомовні" + (f" — {', '.join(allow)}" if allow else ""), False,
         lambda d: d["lang"] == "English")

    picked = []
    for q in queues:
        for d in sorted(q["list"], key=lambda x: -x["traffic"]):
            if q["native"] or passes(d):
                picked.append((q["name"], d))
    return region, picked


print()
print("=== Online Casinos NZ (English + NZ) ===")
region, picked = run("English", "nz")
print(f"регіон = {region}, підібрано {len(picked)}")
seen = []
for n, _ in picked:
    if n not in seen:
        seen.append(n)
for n in seen:
    print(f"  {n}: {sum(1 for x, _ in picked if x == n)}")
print("  перші 12:")
for n, d in picked[:12]:
    print(f'    {d["geo"]:4s} {d["block"]:12s} {d["domain"]:32s} DR{d["dr"]:>4} tr{d["traffic"]:>7}')

print()
print("=== усі проєкти листа ===")
print(f"{'Проєкт':30s} {'Мова':11s} {'ГЕО':4s} {'регіон':10s} {'к-сть':>5s}  черги")
print("-" * 108)
with open(GP, encoding="utf-8", errors="ignore", newline="") as f:
    gp = list(csv.reader(f))
seen_proj = set()
for r in gp[3:]:
    def c(i): return r[i].strip() if i < len(r) else ""
    project, lang = c(2), c(4)
    if not lang or project in seen_proj:
        continue
    seen_proj.add(project)
    geo = detect_geo(project)
    reg, pk = run(lang, geo)
    qs, order = {}, []
    for n, _ in pk:
        if n not in qs:
            qs[n] = 0
            order.append(n)
        qs[n] += 1
    detail = "; ".join(f"{n.split(' — ')[0]}:{qs[n]}" for n in order)
    print(f"{project[:30]:30s} {lang:11s} {geo.upper():4s} {reg or '—':10s} {len(pk):>5d}  {detail[:52]}")
