# Coaster Ranker

This kit turns your roller coaster credits list into a personalized
ranking app. You compare two coasters at a time — *which one wins?* — a
few hundred times, and a sorting algorithm distills those gut calls into
a complete ranked list, with a photo and a manufacturer label on every
card. When you're done you can copy the final order out as text or CSV.

The whole thing runs inside a conversation with Claude. You don't have
to install anything or write any code; Claude does the heavy lifting.

## Download

[**Download the latest kit (zip)**](https://github.com/YOUR-HANDLE/YOUR-REPO/releases/latest/download/coaster-ranker-kit.zip)

After downloading, unzip it. You'll have four files; read on for what
to do with them.

## What's in the kit

| File | What it is |
|------|------------|
| `README.md` | This file. The user guide. |
| `Instructions to Claude.md` | Operating manual Claude reads. |
| `fetch_coaster_images.py` | Image-fetch pipeline Claude runs behind the scenes. |
| `coaster-ranker-template.jsx` | The React artifact template Claude fills in. |

You'll attach all four files to your Claude chat. The bottom two are
working files Claude uses behind the scenes — you don't need to read
them.

## What you need

- A list of the roller coasters you've ridden.
- A Claude account (claude.ai on the web, or the Claude app on your
  phone or desktop).
- The four files above.

## About your list

Almost any format works. You can attach:

- A spreadsheet or CSV.
- A plain text list, pasted into the chat or attached as a `.txt` file.
- Screenshots — of Apple Notes, Google Keep, Captain Coaster, a Reddit
  post, anything Claude can read text from.
- A mix of the above. (Bulk in a CSV, plus screenshots of the few you
  forgot, plus a couple of "oh and I rode this too" lines in the chat —
  all fine.)

The list can be roughly organized by trip, perfectly organized, sorted
alphabetically, or basically random. Claude will adapt to whatever shape
it's in.

## Should I label each ride with its park?

Including the park is helpful but **not required**, and most coasters
don't need it. The park label matters most when a coaster's name is
shared across multiple parks.

**Strongly recommended to label:**

- **Batman: The Ride** — six near-identical clones across Six Flags
- **Goliath** — five totally different rides at five parks
- **Superman** variants — "Ride of Steel" / "Ultimate Flight" / etc.
- **Manta** — Orlando is a B&M Flying, San Diego is a Mack launch — wildly different rides
- **Wild Mouse**, **Wildcat**, **Viper**, **Vortex**, **Corkscrew**, **Phoenix**, **Comet**, **Racer**, **Joker**, **Medusa**, **Thunderbolt**, **Pandemonium**, **Boomerang**, **Riddler's Revenge** — if you've ridden one of these and there's no obvious park context around it, just include the park.

**Don't bother with park labels for unambiguous names.** Pantherian,
Fury 325, Steel Vengeance, Apollo's Chariot, Skyrush, Lightning Rod, El
Toro, Maverick, Voyage, Tatsu, Pantheon — these only exist at one park,
so the park label is redundant.

If you skip a park label where you probably shouldn't have, no big
deal. Claude will ask you about anything it can't resolve from the list
itself. The questions appear as quick tap-the-button choices ("Which
Riddler's Revenge?" with the two options as buttons), so they go fast
— a typical list has somewhere between zero and ten such questions.

## Some examples of acceptable list formats

Anything along these lines will work fine.

**CSV / spreadsheet:**

```
Coaster,Park
Fury 325,Carowinds
Steel Vengeance,Cedar Point
Magnum XL-200,Cedar Point
```

**Notes app / plain text:**

```
1. Fury 325 (Carowinds)
2. Steel Vengeance @ Cedar Point
3. El Toro — Six Flags Great Adventure
4. Pantheon
5. Apollo's Chariot
```

**Bare names** (best when the names are unambiguous):

```
Steel Vengeance
Maverick
Magnum XL-200
Millennium Force
Top Thrill 2
```

**Screenshots:** capture whatever screen has your list, attach the
images. Claude reads them.

## Getting your list out of LogRide (iPhone)

If you track your credits in the LogRide app, the easiest path is to
export your roller coasters as a CSV:

1. Open the **Stats** tab. Under *Attraction Types*, tap **Roller
   Coasters** (the tile with your coaster count).
2. On the Roller Coasters screen, tap the **add-to-list icon** at the
   top right (the one that looks like `+` next to list lines — the
   other top-right icon is just sort). This opens *Add Bulk Attractions
   to List* and tells you it's adding all N attractions.
3. Tap **Select Custom List**, then **+ Create New List**. Name it
   anything ("All Coasters" works); list type can stay on the default.
   Save.
4. Back on the bulk-add screen with your new list selected, tap **Add
   Attractions to List**.
5. Switch to the **Lists** tab and open your new list. You should see
   every coaster numbered, with its park underneath each name.
6. Tap the **⋯** (more) menu at the top right → **Export Lists** →
   **Excel/CSV**.
7. Save to Files, or AirDrop / Mail it to yourself. You want the `.csv`
   on whatever device you'll use Claude from.

The exported CSV has columns labeled **Title** (the coaster name) and
**Description** (the park). Don't worry about the column names —
Claude will figure them out.

## How the conversation goes

Open a new chat with Claude. Attach the four kit files along with your
list, and ask Claude to build you the coaster ranker. From there:

1. **Claude reads your list and resolves what it can on its own.** For
   most lists, that's the great majority — it'll work through park
   abbreviations, infer parks from context where the list is organized
   by trip, and fetch ride details from RCDB when it isn't sure.

2. **Claude walks you through any remaining ambiguities one at a
   time.** These appear as button-choice questions; you don't have to
   type anything for most of them.

3. **For lists of 250+ coasters**, Claude will ask whether you want
   actual ride photos fetched (takes some minutes) or just colored
   manufacturer cards (instant). Both look great in the app — the
   manufacturer cards aren't a degraded mode, they just trade the photo
   for a clean color-coded label. Pick whichever fits your patience
   level.

4. **Claude assembles the artifact** — the ranking app — and presents
   it in the chat. From there it's all yours.

## Using the app

When the app loads, you'll first see a **Select Mode** screen with up
to four options:

| Mode | What it does |
|------|--------------|
| **Full Ranking** | Complete 1-to-N ordering. The most comparisons, the most precise result. |
| **Top 50** | Just rank your top 50; everything else gets filtered out and doesn't appear in the final list. |
| **Top 25** | Same idea, top 25. |
| **Top 10** | Same idea, top 10. |

Each option shows an estimated number of comparisons and an estimated
total time. As a calibration point: a 139-coaster Full Ranking is
roughly 990 comparisons and about an hour at 4 seconds per pick. The
same list ranked as Top 10 is roughly 280 comparisons and about 20
minutes. Pick whatever fits the time you've got — you can always reset
and pick a different mode if you change your mind.

Then the comparisons start. Two cards on the screen, tap the one you
prefer. (Or use the left/right arrow keys on a desktop.) Progress
auto-saves between picks, so you can close the tab and come back later
— just reopen the artifact in the same Claude chat.

**Quick controls:**

- **Undo** — button on screen, or the `U` key. Reverses your last pick.
- **Standings** — peeks at the current partial ranking. For the curious; doesn't affect anything.
- **Reset** — goes back to the mode picker. Erases progress and starts over.

When you're done you'll see a podium for your top 3 and a list of the
rest (or, in Top-K modes, just the K rides you ranked). Two copy
buttons: **Copy text** gives you a numbered list, **Copy CSV** gives
you a spreadsheet-ready version.

## FAQ

**How long does ranking take?**
Depends on list size and mode — estimates show on the mode picker.
Plan for an hour-ish for a Full Ranking of 100–150 coasters, or 20-ish
minutes for Top 10 on the same list. Bigger lists take longer. The app
auto-saves so you don't have to do it all in one sitting.

**What if I disagree with the result?**
The algorithm faithfully reflects your in-the-moment choices. If the
final order surprises you, it's because the way you compared rides in
the moment differs a bit from how you'd articulate your preferences out
loud — which is sort of the point. Use Undo if you misclick. Otherwise
the result is what you said.

**Can I add coasters partway through?**
Not within the same artifact. Either finish the current run, or reset
and start over with the longer list. (Adding to a partial ranking would
mean re-running comparisons against the new ones, which the app
doesn't currently support.)

**What if a coaster's photo is missing?**
Most rides find a photo on RCDB. The rest fall back to a colored
manufacturer chip — a navy "B&M" rectangle, a red "RMC", an amber
"INTAMIN", and so on. That's normal, especially for brand-new or very
obscure coasters.

**What if Claude misclassifies a ride's manufacturer or picks the wrong photo?**
Just tell Claude. Before assembling, or after — it can swap the type
label, fix the park, change the photo, anything you flag. The
conversation continues until you're happy with the lineup. Then Claude
reassembles and gives you the updated artifact.

**Can I save or share the result?**
The **Copy CSV** button puts a clean spreadsheet on your clipboard —
paste it into wherever you keep your records. The artifact itself
lives inside your Claude conversation; you can reopen it any time.

---

Have fun. The first ten comparisons are easy ("obviously Steel
Vengeance over Boomerang") and then they start getting brutal. That's
the whole point.
