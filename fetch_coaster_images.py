#!/usr/bin/env python3
"""
fetch_coaster_images.py
=======================
Fetches a photo for each coaster in your list from the Roller Coaster Database
(rcdb.com), resizes it, and emits base64-encoded JPEG data URLs ready to paste
into the COASTER RANKER artifact template.

WHY base64 / data URLs?
  Claude artifacts run in a sandbox whose Content-Security-Policy blocks both
  fetch() to external hosts AND external <img src="..."> loads. Inline base64
  data URLs are the only image source that renders reliably. So we download +
  encode here (in the code-execution sandbox, which DOES have network), then
  bake the bytes into the artifact.

INPUT  (coasters.json): a JSON array of objects, each with:
         { "id": <int>, "name": "<display name>", "park": "<park name>",
           "rcdb_id": "<optional /NNN.htm or NNN>"   # bypass search if set
         }
       'park' disambiguates same-named rides and filters search results.
       'rcdb_id' is an optional escape hatch: when caller already knows the
       exact RCDB page (e.g. for historic-vs-current pairs like Kings Island's
       two "The Bat" rides), pass it and skip search entirely.

OUTPUT (images_b64.json): { "<id>": "data:image/jpeg;base64,...." | null }

USAGE
  pip install pillow --break-system-packages   # if needed
  python3 fetch_coaster_images.py              # reads coasters.json, writes images_b64.json

STRATEGY (per coaster, in order until one works)
  1. RCDB instant-search API (POST /iqs.json, multipart form) by name; pick the
     result whose location/title contains the park.
  2. RCDB full results page (GET /qs.htm?qs=<squashed name>); parse every
     "coaster - park" row, pick the park match. (Catches rides the instant
     search truncates.)
  3. Park-page lookup: resolve the park's RCDB id once, fetch its page, list all
     its coasters with ids, fuzzy-match by name. (Most reliable for classics.)
  Anything still unmatched is left null -> the artifact shows a manufacturer chip.

Be polite: there's a built-in delay between requests. Don't crank it down.
"""
import urllib.request
import urllib.parse
import json
import re
import base64
import io
import os
import sys
import time
import difflib

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required:  pip install pillow --break-system-packages")

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
RCDB = 'https://rcdb.com'
MAX_WIDTH = 480       # card images don't need to be larger
JPEG_QUALITY = 72     # good balance of size vs. clarity
REQUEST_DELAY = 0.6   # seconds between network calls (be a good citizen)

# ---------------------------------------------------------------- networking

def _get(url, timeout=20):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': RCDB + '/'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def _get_text(url, timeout=20):
    return _get(url, timeout).decode('utf-8', errors='replace')

def rcdb_instant_search(query, retries=3):
    """POST to /iqs.json with a multipart body (mimics the site's FormData)."""
    boundary = '----CRBound' + str(int(time.time() * 1000))
    fields = [('q', query), ('s', '1'), ('w', '1280'), ('h', '720'), ('r', '1')]
    body = ''.join(
        f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'
        for k, v in fields
    ) + f'--{boundary}--\r\n'
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                RCDB + '/iqs.json', data=body.encode('utf-8'),
                headers={'User-Agent': UA, 'Origin': RCDB, 'Referer': RCDB + '/',
                         'Content-Type': f'multipart/form-data; boundary={boundary}'})
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read().decode())
        except Exception:
            if attempt < retries - 1:
                time.sleep(1.0 * (attempt + 1))
    return {'results': []}

def rcdb_full_results(query_squashed, retries=3):
    """GET /qs.htm?qs=<squashed> and parse (coaster_path, name, park) triples."""
    url = f'{RCDB}/qs.htm?qs={urllib.parse.quote(query_squashed)}'
    for attempt in range(retries):
        try:
            html = _get_text(url)
            # rows look like:  href=/123.htm>Name</a> - <a href=/456.htm>Park</a>
            return re.findall(
                r'href=(/\d+\.htm)>([^<]+)</a>\s*-\s*<a\s+href=/\d+\.htm>([^<]+)</a>', html)
        except Exception:
            if attempt < retries - 1:
                time.sleep(1.0 * (attempt + 1))
    return []

# ------------------------------------------------------------- page parsing

def extract_first_image(coaster_html):
    """Pull the first picture's URL (>=320px wide) from a coaster page."""
    m = re.search(r'id=pic_json>(\{.*?\})</script>', coaster_html, re.DOTALL)
    if not m:
        return None
    try:
        pics = json.loads(m.group(1)).get('pictures', [])
        if not pics:
            return None
        sizes = pics[0].get('sizes', [])
        for s in sizes:                       # first size >= 320px wide
            if s.get('width', 0) >= 320:
                return s['url']
        return sizes[-1]['url'] if sizes else None   # else largest available
    except Exception:
        return None

def resolve_park_id(park_name):
    """Find a park's RCDB page id by instant-searching its name."""
    j = rcdb_instant_search(park_name)
    for r in j.get('results', []):
        link = r.get('l', '')
        # park results are plain /<id>.htm whose title is just the park name
        if re.fullmatch(r'/\d+\.htm', link) and park_name.lower() in (r.get('t', '') or '').lower():
            return link
    # fall back: first plain page result
    for r in j.get('results', []):
        if re.fullmatch(r'/\d+\.htm', r.get('l', '')):
            return r['l']
    return None

_park_coaster_cache = {}
def park_coasters(park_name):
    """Return list of (coaster_path, coaster_name) for a park (cached)."""
    if park_name in _park_coaster_cache:
        return _park_coaster_cache[park_name]
    out = []
    pid = resolve_park_id(park_name)
    if pid:
        try:
            html = _get_text(RCDB + pid)
            out = re.findall(r'href=(/\d+\.htm)>([^<]+)</a>', html)
        except Exception:
            out = []
    _park_coaster_cache[park_name] = out
    return out

# -------------------------------------------------------------- matching

def _norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())

def park_matches(candidate_text, park):
    if not (park or '').strip():
        return True   # no park constraint -> accept anything
    c = _norm(candidate_text)
    p = _norm(park)
    if p and p in c:
        return True
    # try first significant word of the park
    words = [w for w in re.split(r'[^a-z0-9]+', park.lower()) if len(w) > 3]
    return any(_norm(w) in c for w in words[:1])

def pick_from_instant(results, park):
    real = [r for r in results if not (r.get('l') or '').startswith('qs.htm')]
    for r in real:
        if park_matches((r.get('s') or '') + ' ' + (r.get('t') or ''), park):
            return r['l']
    return None

def pick_from_full(rows, park):
    for path, name, rpark in rows:
        if park_matches(rpark, park):
            return path
    return None

def pick_from_park_page(name, park):
    rows = park_coasters(park)
    if not rows:
        return None
    names = [n for _, n in rows]
    best = difflib.get_close_matches(name, names, n=1, cutoff=0.6)
    if best:
        for path, n in rows:
            if n == best[0]:
                return path
    # substring fallback
    nn = _norm(name)
    for path, n in rows:
        if nn and (nn in _norm(n) or _norm(n) in nn):
            return path
    return None

# -------------------------------------------------------------- encode

def to_base64_jpeg(raw):
    img = Image.open(io.BytesIO(raw))
    if img.mode != 'RGB':
        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
            bg = Image.new('RGB', img.size, (255, 255, 255))
            ia = img.convert('RGBA')
            bg.paste(ia, mask=ia.split()[-1])
            img = bg
        else:
            img = img.convert('RGB')
    if img.width > MAX_WIDTH:
        ratio = MAX_WIDTH / img.width
        img = img.resize((MAX_WIDTH, max(1, int(img.height * ratio))), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=JPEG_QUALITY, optimize=True, progressive=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode('ascii'), len(buf.getvalue())

# -------------------------------------------------------------- per coaster

def find_image_path(name, park):
    # 1) instant search
    path = pick_from_instant(rcdb_instant_search(name).get('results', []), park)
    if path:
        return path
    # 2) full results page (squash the name like RCDB does)
    path = pick_from_full(rcdb_full_results(_norm(name)), park)
    if path:
        return path
    # 3) park-page lookup
    return pick_from_park_page(name, park)

def fetch_one(name, park, rcdb_id=None):
    # Caller can pin a known page directly (e.g. for historic/current disambiguation)
    if rcdb_id:
        path = rcdb_id if rcdb_id.startswith('/') else f'/{rcdb_id.lstrip("/")}'
        if not path.endswith('.htm'):
            path += '.htm'
    else:
        path = find_image_path(name, park)
        if not path:
            return None, 'no RCDB match'
    try:
        img_path = extract_first_image(_get_text(RCDB + path))
        if not img_path:
            return None, f'page {path} has no photos'
        data_url, nbytes = to_base64_jpeg(_get(RCDB + img_path))
        return data_url, f'{nbytes/1024:.0f}KB via {path}'
    except Exception as e:
        return None, str(e)

# -------------------------------------------------------------- main

def _die(msg, code=2):
    print(f'error: {msg}', file=sys.stderr)
    sys.exit(code)


def load_input(in_path):
    """Read and validate the coasters.json file. Exits with a friendly message on bad input."""
    try:
        with open(in_path) as f:
            data = json.load(f)
    except FileNotFoundError:
        _die(f"input file not found: {in_path}\n"
             f"hint: pass the path to your coasters list, e.g.  python3 fetch_coaster_images.py mylist.json out.json")
    except json.JSONDecodeError as e:
        _die(f"{in_path} is not valid JSON ({e.msg} at line {e.lineno}, col {e.colno}).\n"
             f"hint: the file should be a JSON array of objects, e.g.  [{{\"id\":1,\"name\":\"Fury 325\",\"park\":\"Carowinds\"}}, ...]")

    if not isinstance(data, list):
        _die(f"{in_path} must contain a JSON array of coaster objects, not a {type(data).__name__}.\n"
             f"hint: wrap a single object in [...] to make it a one-element list.")

    seen_ids = {}
    cleaned = []
    for idx, c in enumerate(data):
        if not isinstance(c, dict):
            _die(f"item #{idx} is not an object: {c!r}")
        if 'id' not in c:
            _die(f"item #{idx} is missing the required 'id' field: {c!r}")
        if 'name' not in c or not str(c.get('name', '')).strip():
            _die(f"item #{idx} (id={c.get('id')!r}) is missing a usable 'name' field")
        # strip whitespace from string fields so accidental padding from CSV/spreadsheets
        # doesn't quietly break park matching
        c = dict(c)
        for k in ('name', 'park', 'rcdb_id'):
            if isinstance(c.get(k), str):
                c[k] = c[k].strip()
        # duplicate id check
        sid = str(c['id'])
        if sid in seen_ids:
            print(f'  warning: duplicate id {sid!r} — item #{idx} ({c.get("name")!r}) will overwrite '
                  f'item #{seen_ids[sid]} ({data[seen_ids[sid]].get("name")!r})', file=sys.stderr)
        seen_ids[sid] = idx
        cleaned.append(c)
    return cleaned


BATCH_SIZE = 50   # max coasters processed per invocation to avoid tool timeouts


def main(in_path='coasters.json', out_path='images_b64.json'):
    coasters = load_input(in_path)
    if not coasters:
        with open(out_path, 'w') as f:
            json.dump({}, f)
        print('Input list is empty — wrote {} and exited.', file=sys.stderr)
        return

    # Resume support: if out_path exists with prior results, keep them
    # and only process coasters that don't yet have an entry. This lets
    # the caller invoke the script repeatedly in 50-coaster batches without
    # losing prior work to a tool-call timeout.
    results = {}
    if os.path.exists(out_path):
        try:
            with open(out_path) as f:
                prior = json.load(f)
            if isinstance(prior, dict):
                results = prior
        except (json.JSONDecodeError, OSError):
            results = {}

    total = len(coasters)
    remaining = [c for c in coasters if str(c['id']) not in results]
    already_done = total - len(remaining)
    if not remaining:
        hits = sum(1 for v in results.values() if v)
        print(f'\nAll {total} coasters already processed. {hits}/{total} have images.', file=sys.stderr)
        return

    # Process up to BATCH_SIZE this invocation
    batch = remaining[:BATCH_SIZE]
    print(f'Batch: processing {len(batch)} coasters ({already_done} already done, '
          f'{len(remaining) - len(batch)} after this batch)', file=sys.stderr)

    batch_hits = 0
    for i, c in enumerate(batch, 1):
        cid, name, park = c['id'], c['name'], c.get('park', '')
        rcdb_id = c.get('rcdb_id')   # optional: explicit RCDB page like "/627.htm" or "627"
        # normalize a leading/trailing "The" so RCDB search behaves
        q = re.sub(r'^\s*the\s+', '', name, flags=re.I)
        q = re.sub(r'\s+the\s*$', '', q, flags=re.I)
        data_url, msg = fetch_one(q or name, park, rcdb_id=rcdb_id)
        results[str(cid)] = data_url
        status = '✓' if data_url else '✗'
        if data_url:
            batch_hits += 1
        global_idx = already_done + i
        print(f'  {status} [{global_idx:4d}/{total}] {name} @ {park}  —  {msg}', file=sys.stderr)
        # Save partial results every 10 coasters so a mid-batch crash doesn't lose everything
        if i % 10 == 0:
            with open(out_path, 'w') as f:
                json.dump(results, f)
        time.sleep(REQUEST_DELAY)

    with open(out_path, 'w') as f:
        json.dump(results, f)

    total_hits = sum(1 for v in results.values() if v)
    leftover = total - len(results)
    if leftover > 0:
        print(f'\nBatch complete. {total_hits}/{total} images so far, {leftover} coasters still to go.', file=sys.stderr)
        print(f'Run this script again to continue from where it left off.', file=sys.stderr)
    else:
        misses = [k for k, v in results.items() if not v]
        print(f'\nDone: {total_hits}/{total} images. Wrote {out_path}.', file=sys.stderr)
        if misses:
            print(f'Missing ids (will show manufacturer chips): {misses}', file=sys.stderr)
            print('Tip: for stragglers, look the ride up on rcdb.com, grab its /<id>.htm,', file=sys.stderr)
            print('and add a manual override, or just let the chip fallback handle it.', file=sys.stderr)


if __name__ == '__main__':
    args = sys.argv[1:]
    main(*args[:2]) if args else main()
