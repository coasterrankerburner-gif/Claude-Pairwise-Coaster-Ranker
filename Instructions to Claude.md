# Coaster Ranker — Claude Operating Manual

You are assembling a personalized roller-coaster ranking artifact for a user
who has provided their credits list. This file is your operating manual.
The user has been given a separate README (`README.md`)
that explains the product in human-friendly terms; you don't need to
re-explain that side to them.

## What you have to work with

| File | Purpose |
|------|---------|
| `coaster-ranker-template.jsx` | The React artifact. Contains the ranking engine (merge sort + binary-insertion top-K), the UI, keyboard shortcuts, auto-save, undo, standings, and the final ranked output with copy/CSV export. Has two clearly-marked placeholders: `COASTERS` and `IMAGES`. |
| `fetch_coaster_images.py` | A Python image-fetch pipeline that scrapes rcdb.com for one photo per coaster, resizes it, base64-encodes it, and writes the result as JSON. Runs in the code-execution sandbox. Processes up to 50 coasters per invocation; resume-friendly. |
| `Instructions to Claude.md` | This file. |
| The user's list | A CSV, text, screenshots, or some mix — whatever they had handy. |

Your job: parse the list, resolve ambiguities, build a `COASTERS` array,
either fetch images or skip with consent, assemble the artifact, present it.
The artifact handles the ranking UX on its own.

---

## Step 1 — Parse the list and resolve ambiguities

People format their credits lists wildly differently. The input might be
bare coaster names, names paired with parks, mixed (parks only on
disambiguators), names with park abbreviations, screenshots of any of
those, or any combination of the above. Handle all of these without
nagging the user about entries that are already unambiguous.

**1a. Expand park abbreviations** using context. Common ones:

- **CP** = Cedar Point · **KD** = Kings Dominion · **KI** = Kings Island
- **SFMM** = Six Flags Magic Mountain · **SFOT** = Six Flags Over Texas
- **SFGAdv** / **SFGA** (sometimes) = Six Flags Great Adventure (Jackson, NJ)
- **SFGAm** = Six Flags Great America (Gurnee, IL)
- **SFNE** = Six Flags New England · **SFA** = Six Flags America (defunct/sold)
- **SFOG** = Six Flags Over Georgia · **SFFiesta** = Six Flags Fiesta Texas
- **SFStL** = Six Flags St. Louis · **SFDK** = Six Flags Discovery Kingdom
- **BGW** = Busch Gardens Williamsburg · **BGT** = Busch Gardens Tampa
- **HP** = Hersheypark · **KBF** = Knott's Berry Farm · **DW** = Dollywood
- **WDW** = Walt Disney World (then sub-parks: MK, EPCOT, HS, AK)

**SFGA is ambiguous** — could mean Great Adventure or Great America.
Resolve by what's also in the list: if other rides clearly belong to
Gurnee (American Eagle, Whizzer, Maxx Force, Raging Bull), it's
Great America; if clearly Jackson NJ (El Toro, Kingda Ka, Nitro, Jersey
Devil Coaster), it's Great Adventure.

**1b. Decide which entries actually need a park.** Don't request a park
for unambiguous-by-name rides: Pantherian, Fury 325, Top Thrill 2, X2,
Iron Gwazi, Pantheon, Steel Vengeance, Millennium Force, Skyrush,
Candymonium, Apollo's Chariot, Maverick, Lightning Rod, Fahrenheit, Tatsu,
El Toro, Cheetah Hunt, Pipeline, Wonder Woman Flight of Courage, etc. Run
RCDB search; if it returns a clean single hit, that's it. Move on.

**1c. Look for patterns the list itself reveals; RCDB confirms; ask only
when both fail.** Don't assume any particular ordering principle going
in — lists may be sorted by preference, by ride count, alphabetically,
in visit/credit order, or with no organization at all. Some lists will
show clear park clusters (rides from one trip grouping together); others
won't.

When a pattern emerges, use it to *hypothesize* a park for ambiguous bare
names: a bare "Comet" surrounded by Hersheypark entries is almost
certainly Hershey's Comet; a bare "Flight of Fear" in a Kings Dominion
cluster is KD's, not KI's. Then confirm that hypothesis against RCDB —
search for the name, see what installations exist, look at the result
whose park matches your guess. Web search on RCDB pages is fair game and
surfaces ride details you might not have in memory (recent additions and
renames especially). Trust RCDB over uncertain factual recall — your
training data has gaps, RCDB is ground truth.

**At cluster boundaries, consider BOTH neighboring clusters as candidate
homes** before reaching for a non-clustered park or a historical ride.
If a ride sits between an ending cluster A and a starting cluster B, run
the RCDB check at *both* A and B. Example: "Big Bad Wolf: The Wolf's
Revenge" appearing between a BGW cluster and a BGT cluster is the 2024
BGW family invert — RCDB confirms BGW, not BGT, and the *Wolf's Revenge*
suffix in the name already pins it as the new ride, not the demolished
1984 Big Bad Wolf. Don't jump to "this must be an unrelated BGT ride" or
"this must be the historical version" when one of the neighboring
clusters has the exact match.

Only ask the user when:

- multiple RCDB matches survive even after cluster filtering,
- the list has no exploitable pattern and the bare name has multiple
  installations, or
- cluster says X but RCDB says X doesn't exist there — flag the
  contradiction.

Common multi-park names worth special care: **Batman: The Ride** (six
near-identical B&M Inverts across Six Flags), **Goliath**, **Superman**
variants, **Mr. Freeze**, **Manta** (SeaWorld Orlando vs San Diego — very
different rides), **Twister**, **Wildcat / Wild Cat**, **Thunderbolt**,
**Racer**, **Phoenix**, **Hurler**, **Wild One**, **Corkscrew**,
**Vortex**, **Viper**, **Joker** variants.

Two specific name collisions that have tripped past sessions and
deserve calling out:

- **Riddler's Revenge** is TWO different rides at TWO different parks.
  The famous one is the **B&M Stand-up at Six Flags Magic Mountain**
  (1998). But Six Flags New England has a **Vekoma SLC** also called
  **Riddler's Revenge** (renamed from Mind Eraser, post-2024). They are
  different coasters; both count as credits. If the user's cluster
  around the entry is SFNE, it's the Vekoma SLC — *don't* override the
  cluster signal with the more famous SFMM ride.

- **Bizarro** is a former name used at TWO different parks for TWO
  different rides. **Bizarro at SFGAdv** is the former name of the B&M
  Floorless now called **Medusa** (renamed Bizarro 2009–2016, then back
  to Medusa). **Bizarro at SFNE** is the former name of the Intamin Mega
  Coaster now called **Superman the Ride** (renamed Bizarro 2009–2016,
  then back to Superman the Ride). When the user writes `Bizarro
  (SFNE)`, that is Superman the Ride, NOT Medusa — use the park label
  to resolve which current name (and which RCDB page) it points to. Same
  logic applies to any old name carried forward with a park label: park
  wins.

**1d. Watch for historic-vs-current ambiguity at the same park.** Rare
but real: when a name has been used by two different rides at one park
across eras, the park label alone doesn't disambiguate. RCDB's history
section on each page is the reliable source — former names, opening /
closing dates, and rename trails are all there.

- **The Bat at Kings Island** — the short-lived 1981 Arrow Suspended
  (closed 1983, demolished; RCDB `/73.htm`) versus the current Arrow
  Suspended that opened 1993 as Top Gun, renamed Flight Deck (2008),
  then The Bat (2014); RCDB `/627.htm`. Default to the current ride
  unless the user is plausibly old enough to have ridden the 1981 one.

Note that ride **conversions and reskins almost always get new names**
(Wildcat → Wildcat's Revenge, Texas Giant → New Texas Giant, Cyclone →
Wicked Cyclone, Mean Streak → Steel Vengeance, Mantis → Rougarou), so
the name the user writes already disambiguates. Don't ask "did you mean
the RMC version or the original?" — they'll have used the current
marketed name if they rode the current ride.

When you've confirmed which version: pass it through to the build script
using the optional `rcdb_id` field (see below), so the script doesn't
have to re-pick.

**1d.5. Relocation vs conversion — dedup rule.** Sometimes the same
physical coaster appears in a user's list under two names because it
was relocated or renamed. Sometimes two superficially similar rides are
actually distinct credits because of a fundamental conversion. The rule:

- **Relocation (with or without rename) = ONE credit.** The same physical
  coaster moved from one park to another counts once. RCDB reflects this
  by carrying a single page through the rename trail. Examples:
  *Dominator* (Geauga Lake → Kings Dominion: same RCDB page, one credit),
  *Iron Wolf* → *Apocalypse* (SFGAm → Six Flags America: same B&M
  Stand-up with two names, one credit).

- **Significant conversion = TWO credits, even if the structure is
  reused.** When the ride's fundamental character changes (stand-up →
  floorless, classic wood → RMC steel topper, etc.), RCDB issues a new
  page and it counts as a new credit. Examples: *Mantis → Rougarou*
  (B&M stand-up retracked to floorless at CP: two credits), *Mean
  Streak → Steel Vengeance* (PTC wood → RMC hybrid: two credits),
  *Wildcat → Wildcat's Revenge* (classic wood → RMC I-Box at Hershey:
  two credits).

Conversions almost always come with new marketed names that already
disambiguate, but if the user lists both names (a not-uncommon
"completist" move for someone who rode both versions), treat them as
two distinct entries. Conversely, if the user lists a relocation under
both names (Iron Wolf AND Apocalypse, both meaning the same physical
ride moved from SFGAm to SFA), surface that gently — "you've got the
same coaster listed twice under its two names — should I merge?" —
rather than silently counting it as two credits.

**1e. Build `COASTERS`.** After disambiguation, produce the array. Each
entry:

```js
{ id: 1, name: "The Bat", park: "Kings Island", type: "Arrow Suspended" }
```

If you've pinned an RCDB page during disambiguation, you can pass it
through to the build script via an extra field in your `coasters.json`
(it's stripped before going into the artifact):

```json
{ "id": 17, "name": "The Bat", "park": "Kings Island", "rcdb_id": "/627.htm" }
```

**1f. Classify types.** Assign a manufacturer/model label per coaster
from your knowledge, then **list back any you're uncertain about
(especially recent installs and obscure/relocated rides) and ask the
user to confirm**. The user knows their own list better than the
training data does.

The right discipline here is: **only ask when you need to**. A list of
100 coasters might have 5–10 entries that genuinely need user input;
everything else should resolve silently.

**1g. How to ask, when you have to.** Use the interactive button-choice
tool (`ask_user_input_v0` or equivalent in your environment), not
free-text prompts. One ambiguity per question — don't bundle three
different unresolved coasters into a single "and also..." question that
forces the user into a text reply. On mobile, the question text gets
clipped after ~3 lines with no expand affordance, so:

- Keep the question itself short (under ~150 characters / 2–3 lines max).
- Put the disambiguating detail *in the button labels*, not buried in
  the question text. Buttons can be longer than the question and remain
  readable.
- Prefer 2–4 button choices over a text field. If you can't enumerate
  the options, the ambiguity probably needs a different framing.

Bad: "I see 'Riddler's Revenge' in your SFNE cluster but Riddler's
Revenge is most famously the B&M stand-up at Six Flags Magic Mountain,
although Six Flags New England does have a Vekoma SLC also called
Riddler's Revenge (formerly Mind Eraser), which one did you ride or
did you ride both?" → *the user reading this on a phone sees only "I
see 'Riddler's Revenge' in your SFNE cluster but Riddler's…"*

Good: "Which Riddler's Revenge?" — buttons: "SFNE — Vekoma SLC",
"SFMM — B&M Stand-up", "Both (separate credits)", "Different ride".

---

## Step 2 — Fetch images (or skip, for very large lists)

**For lists of 250+ coasters, ASK FIRST.** Image-fetching takes roughly
~2 seconds per coaster. At that rate:

| List size | Image-fetch time | Generic-cards alternative |
|-----------|------------------|---------------------------|
| ~100      | ~3–5 min         | (not worth skipping) |
| ~250      | ~8–10 min        | seconds |
| ~500      | ~17–20 min       | seconds |
| ~1000     | ~35–40 min       | seconds |

Phrase it as a button choice: "Fetch images (~X min) or use generic
manufacturer cards (seconds)?" The artifact looks fine either way — the
fallback chips are intentional, not a degraded mode.

If the user wants images, write your `COASTERS` data to `coasters.json`
(keeping `id`, `name`, `park`, and any `rcdb_id` overrides from Step 1d).
The script processes in **batches of 50 per invocation** to stay within
tool-call timeouts, resumes from prior output, and prints a clear "X
more to go" message when the batch ends. Loop until done:

```bash
pip install pillow --break-system-packages   # if Pillow isn't already present
python3 fetch_coaster_images.py coasters.json images_b64.json
# ... if the last line says "X coasters still to go", run it again:
python3 fetch_coaster_images.py coasters.json images_b64.json
# ... repeat until the final line says "Done: N/N images."
```

A 250-coaster list takes 5 invocations; 500 takes 10. The output JSON
is partial-written every 10 coasters within a batch, so even a hard
crash mid-batch only loses ~10 entries' worth of work.

If the user wants generic cards instead, skip the script entirely —
write `IMAGES = {}` (empty object) into the artifact. The artifact's
manufacturer-chip fallback handles every card automatically.

---

## Step 3 — Assemble the artifact

Open `coaster-ranker-template.jsx` and:

- Replace the `COASTERS = [...]` placeholder with the real array from
  Step 1 (including the `type` field), and
- Replace the `IMAGES = {...}` placeholder with the contents of
  `images_b64.json` (or `{}` for generic-cards mode).

Save it as a `.jsx` artifact and present it. The user starts ranking
from the mode-picker screen.

---

## Step 4 — Handle stragglers and follow-ups (optional)

For any coaster the script couldn't find a photo for, the card
automatically shows a colored manufacturer chip (navy "B&M", red "RMC",
amber "INTAMIN", brown "WOODEN", etc.) instead. That's usually fine.

If the user wants a real photo for a straggler, you can:

- Look it up on rcdb.com, grab the page id (`rcdb.com/<id>.htm`), and
  pull that page's photo directly; or
- Reuse another coaster's photo if it's an identical clone (e.g. two
  Batman: The Ride clones, or two B&M Inverts of the same model); or
- Just leave the chip — it looks fine.

If the user wants to fix a type label, a park, or anything else in the
COASTERS array, edit the artifact directly rather than rerunning the
pipeline.

---

## Important technical notes (so you don't relearn these the hard way)

1. **Images MUST be embedded as base64 data URLs, not links.** The
   artifact sandbox's Content-Security-Policy blocks both `fetch()` to
   external hosts and external `<img src="...">`. That's the entire
   reason for the Python step. Do not try to load images from
   Wikipedia/RCDB URLs at runtime in the artifact — they will silently
   fail and you'll only see the fallback chips.

2. **Wikipedia's image CDN rate-limits/blocks cloud IPs.** RCDB is the
   reliable source from the sandbox. The script already handles RCDB's
   quirks:

   - instant-search is a multipart-form POST to `/iqs.json`;
   - it truncates results, so the script falls back to the full
     `/qs.htm?qs=...` page and then to listing the park's own page.

3. **Artifact styling constraint.** The template uses a `<style>` block
   with CSS classes (not Tailwind arbitrary values like `bg-[#hex]`),
   because the artifact runtime has no Tailwind JIT compiler. Keep that
   pattern if you restyle.

4. **Comparison count by mode.** The artifact offers four precision
   modes at the start screen; each shows its own picks/time estimate.
   Assuming ~4 seconds per gut-decision:

   | Mode | Algorithm | n=60 | n=139 | n=300 | n=500 |
   |------|-----------|------|-------|-------|-------|
   | **Full Ranking** | merge sort, complete 1→N order | 355 / ~24 min | 990 / ~66 min | 2,469 / ~165 min | 4,483 / ~299 min |
   | **Top 50** | binary-insertion into a top-K leaderboard | 370 / ~25 min | 701 / ~47 min | 1,090 / ~73 min | 1,446 / ~97 min |
   | **Top 25** | same | 270 / ~18 min | 454 / ~31 min | 715 / ~48 min | 975 / ~65 min |
   | **Top 10** | same | 162 / ~11 min | 277 / ~19 min | 470 / ~32 min | 690 / ~46 min |

   Top-K modes find and rank just the top K; everything else is filtered
   out and doesn't appear in the final list. Estimates are slightly
   conservative (the actual count tends to come in ~10-20% lower). The
   mode is locked into the save data — switching modes requires reset.

   Top-K modes where K ≥ N are hidden automatically (they would
   degenerate to Full anyway). At very small N the Top-K savings
   disappear.

5. **Artifact bundle size scales with N.** The base64 images live inside
   the artifact source. At ~37KB per image average:

   - n = 50  → ~2 MB artifact
   - n = 139 → ~5 MB
   - n = 300 → ~11 MB
   - n = 500 → ~18 MB

   The artifact still runs at the upper end, but parsing time grows and
   mobile load gets sluggish. For lists much above 300, consider
   lowering `MAX_WIDTH` in `fetch_coaster_images.py` (try 360px), or
   offering the user generic cards instead via Step 2.

6. **No ties.** Every comparison forces a pick (by design). Undo is
   available (button, or the `U` key) if the user misclicks.

7. **Stale saved progress.** If the user edits `COASTERS` (add/remove
   rides, reorder) *after* they've started ranking, the artifact
   detects that the stored progress no longer fits the new list and
   brings them back to the mode picker. Old choices can't be remapped
   automatically when the underlying list changes.
