# DDB Integrator — Foundry Premium Content System (official paid distribution)

The goal: list DDB Integrator in Foundry's **official package directory** as a *protected* paid module, with **Patreon-tier-linked content keys** — so patrons install and auto-update it **in-app** from the Setup screen, with an account-bound key that can't be reshared.

This is the long-term home for the paid module. It **supersedes** the Patreon-zip (Option A) and the gated Worker (Option B) once it's live.

## Why it beats the zip / Worker
- **Account-bound content keys** = real DRM (can't reshare a download).
- **In-app install + auto-update** — no manifest URLs to hand out per patron.
- **Official directory listing + Discord release announcement** — discoverability you can't get solo.
- **Patreon integration** — patrons link Patreon → Foundry; their tier controls access automatically.

## Steps

1. **Email Foundry** at `matt@foundryvtt.com` to start the **Premium Content Agreement** + Patreon integration. (Draft below — also pasted to you in chat.) Nothing is billable until content is live.

2. **Create a Content Provider account** and submit the package page at https://foundryvtt.com/packages/submit → check **"Is this premium content."**

3. **Prep the protected build** — in a copy of `module.json` used *only* for the Foundry submission:
   - add `"protected": true`
   - set `"manifest"` to the **Foundry-hosted** package manifest URL they issue you (replaces the GitHub URL)
   - keep `id`, `title`, `version`, `compatibility`, `esmodules`, `socket`, `relationships` as-is

   > ⚠️ **Only the premium build gets `"protected": true`.** Do **not** add it to the Patreon-zip build — Foundry would require a content key and block the manual install. Keep the two builds separate.

4. **Upload** the zip via Foundry's **Upload Tool** (it validates `module.json` and flags issues).

5. **Patreon integration** — Foundry links your Patreon; you choose which tiers grant access. Patrons link their Patreon to their Foundry account and the module appears in-app.

6. **Release** — coordinate the go-live timing + Discord announcement with Foundry.

## Billing
Billed **quarterly**, based on **content keys activated + Patreon subscription usage**. No charges during development. The exact revenue share / fee is negotiated individually — get the number from `matt@foundryvtt.com`.

## Eligibility
Open to independent creators — a functional/code module like this qualifies (premium content isn't limited to map/adventure compendium packs).

---

## Intro email — send to `matt@foundryvtt.com`

> **Subject:** Premium Content System onboarding — DDB Integrator (XtraPklz)
>
> Hi Matt,
>
> I'm Ricky (XtraPklz on Patreon — https://www.patreon.com/XtraPklz), and I'd like to join Foundry's Premium Content System to sell a module I've built: **DDB Integrator**.
>
> It's a functional module for **Foundry VTT v13–v14, dnd5e**, that brings D&D Beyond dice rolls into Foundry as unified, cinematic chat cards — with GM Group Check / Contest cinematics and user-assignable sound cues. It's pure presentation (no rules automation), and it's complete and in testing now.
>
> I sell through Patreon, so I'm especially interested in the **Patreon-linked content key** integration, so my patrons can install and auto-update it in-app, tied to their tier.
>
> Could you share:
> - Premium Content Agreement details + the fee / revenue structure
> - How to set up the Patreon → content-access integration
> - Next steps for a protected package page and uploading via your tool
>
> Happy to provide anything you need on my end. Thanks for building such a great platform.
>
> Best,
> Ricky (XtraPklz)
> mail@rickyj.art · https://www.patreon.com/XtraPklz
