# DDB Integrator

**Bring your D&D Beyond dice rolls into Foundry VTT — as one unified, cinematic chat card — and give the rolls you make inside Foundry the same polish.**

By [XtraPklz](https://www.patreon.com/XtraPklz) · for **Foundry VTT v13–v14** · **dnd5e** system

---

## What it does

DDB Integrator is pure **roll integration and presentation** — no automation, no targeting, no rules-meddling. Every roll, wherever it came from, shows up beautifully and consistently:

- **D&D Beyond → Foundry.** Connects to the D&D Beyond game log on its own (via a ddb-proxy) and turns every roll your players make on D&D Beyond into a clean chat card in Foundry. No MidiQOL, no ddb-sync, nothing else required.
- **Local rolls, too.** Rolls made inside Foundry get the exact same unified card, so your table looks consistent no matter where a roll originated.
- **Cinematic flourishes.** An optional full-screen reveal for each roll — gold on a natural 20, red on a natural 1. For a damage roll against a selected target, the target zooms to center with the attacker and weapon in a sub-circle and the damage called out, themed to the damage type.
- **Group Check & Contest.** Two GM toolbar buttons. Click to open a live cinematic; every incoming roll drops in as a portrait tile (re-rolls update in place); click again to reveal the **party average** (Group Check) or the **highest roller** (Contest).
- **Your sounds.** Assign your own sound files to key moments — including a cue per damage type — in a tidy settings sub-menu. Ships silent; nothing is bundled.
- **Stays out of your way.** Cinematics never cover the GM's interface and always broadcast to every connected player.

## Requirements

- Foundry VTT **v13 or v14**
- **dnd5e** system
- A **ddb-proxy** to reach the D&D Beyond game log — use the **Hosted** option (zero setup) or point it at your own.

## Connecting to D&D Beyond

1. Open the module settings and pick a **Connection mode**:
   - **Hosted (recommended)** — connect through the shared proxy. Your D&D Beyond session cookie passes through that server *only* to authenticate and is never stored. The free shared server can take ~30–60s to wake on the first connect of a session.
   - **Local** — run your own ddb-proxy and set its URL.
2. Click **Get / paste my cookie** for a guided walkthrough to grab your `CobaltSession` cookie.
3. Choose your **campaign** and enter your D&D Beyond **username**.

That's it — rolls start flowing in.

## Support & updates

Made by **XtraPklz**. Get it, get updates, and find help on **[Patreon](https://www.patreon.com/XtraPklz)**.

## Credits

The D&D Beyond token-mint approach is adapted from [ddb-sync](https://github.com/MrPrimate/ddb-sync) (MIT, AshDarkley).
