/**
 * DDB Integrator — bring your D&D Beyond dice rolls into Foundry VTT, and give rolls
 * made inside Foundry the same polish. Each roll becomes ONE unified, public chat card,
 * an optional full-screen cinematic flourish, and an optional sound cue.
 *
 * Pure presentation: NO combat automation. No targets, no AC / hit-miss, no save-DC
 * resolution, no apply / heal / temp buttons, no conditions, no interactive buttons.
 *
 * Connects to the D&D Beyond game log on its own via a ddb-proxy (no MidiQOL or
 * ddb-sync required — this module always owns its own socket).
 *
 * Card CSS, cinematic engine, and the DDB connection are all self-contained in this single file.
 */

const NS = 'ddb-integrator';
const seen = new Map();         // rollId → ts, to dedupe DDB game-log events
let ddbSocket = null;

// Flat, monochrome FontAwesome glyphs per roll kind.
const IC = {
  d20: 'fa-dice-d20', dmg: 'fa-droplet', hp: 'fa-heart-pulse', save: 'fa-shield-halved',
  attack: 'fa-crosshairs', check: 'fa-dice-d20', init: 'fa-flag-checkered', death: 'fa-skull',
};
const WM_IMG = 'icons/logo-scifi-blank.png';

/* ------------------------------------------------------------------ styles */
// The .ddbx2-pc player card, .ddbx-sting cinematic, and .ddbx-conn connection-status chip styles,
// scoped to only what an informational card + a result flourish + the connection chip need.
const STYLES = `
.ddbx2-pc, .ddbx-sting{
  --good:#69d77f; --good-soft:#9fd8ac; --bad:#ff6b6b; --bad-soft:#ff9b9b;
  --coral:#e0824d; --coral-text:#f3cdbc; --info:#7fb2ff; --info-soft:#9bd0ff;
  --skill:#bda9e8; --gold:#ffd34d; --txt:#f4f4f4; --txt-dim:#cfcfcf; --txt-mute:#9a9a9a;
}
.ddbx2-pc{font-family:inherit;position:relative;overflow:hidden;border-radius:8px;background:#17181c;background-image:radial-gradient(circle at 50% -20%, var(--accent,rgba(160,27,27,.28)), transparent 72%);padding:12px 10px;text-align:center;color:var(--txt);}
.ddbx2-pc-wm{position:absolute;inset:0;opacity:.16;pointer-events:none;}
.ddbx2-pc-body{position:relative;z-index:1;}
.ddbx2-pc-name{font-size:17px;font-weight:bold;letter-spacing:.06em;color:#fff;margin-bottom:2px;}
.ddbx2-pc-ctx{font-size:13px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:var(--txt-dim);margin-top:5px;}
.ddbx2-pc-title{font-size:16px;font-weight:900;letter-spacing:.02em;margin-bottom:6px;color:#fff;}
.ddbx2-pc-target{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:center;gap:16px;margin-top:10px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08);}
.ddbx2-pc-tgt{display:flex;flex-direction:column;align-items:center;gap:13px;width:92px;}
.ddbx2-pc-reticule{position:relative;width:46px;height:46px;flex:0 0 auto;}
.ddbx2-pc-reticule img{width:100%;height:100%;border-radius:50%;object-fit:cover;}
.ddbx2-pc-reticule::before{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid var(--ret,rgba(255,80,80,.9));box-shadow:0 0 9px var(--retglow,rgba(255,55,55,.55));}
.ddbx2-pc-reticule::after{content:"";position:absolute;inset:-9px;background:linear-gradient(var(--ret,rgba(255,80,80,.95)),var(--ret,rgba(255,80,80,.95))) 50% 0/2px 7px no-repeat,linear-gradient(var(--ret,rgba(255,80,80,.95)),var(--ret,rgba(255,80,80,.95))) 50% 100%/2px 7px no-repeat,linear-gradient(var(--ret,rgba(255,80,80,.95)),var(--ret,rgba(255,80,80,.95))) 0 50%/7px 2px no-repeat,linear-gradient(var(--ret,rgba(255,80,80,.95)),var(--ret,rgba(255,80,80,.95))) 100% 50%/7px 2px no-repeat;}
.ddbx2-pc-tgt.miss{--ret:rgba(172,178,190,.82);--retglow:transparent;}
.ddbx2-pc-tgt.miss .ddbx2-pc-reticule img{filter:grayscale(.85) brightness(.82);}
.ddbx2-pc-tgt.miss .ddbx2-pc-tname{color:#9aa0ac;}
.ddbx2-pc-tname{font-size:11px;font-weight:bold;color:#ffb3b3;letter-spacing:.02em;text-align:center;line-height:1.15;word-break:break-word;}
.ddbx2-ac-nums{display:flex;justify-content:center;margin-top:2px;}
.ddbx2-ac-nums.two{justify-content:space-around;}
.ddbx2-ac-cell{text-align:center;}
.ddbx2-ac-lbl{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--txt-dim,#8b90a0);display:flex;align-items:center;justify-content:center;gap:5px;margin-bottom:3px;}
.ddbx2-ac-val{font-size:40px;font-weight:900;line-height:1;}
.ddbx2-ac-val.hit{color:#5b9cd6;}
.ddbx2-ac-val.dmg{color:var(--coral-text,#e0a878);}
.ddbx2-ac-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:9px;}
.ddbx2-ac-chip{font-size:12px;font-weight:bold;padding:4px 11px;border-radius:20px;background:rgba(224,130,77,.2);color:var(--coral-text,#e0a878);box-shadow:inset 0 0 0 1px rgba(224,130,77,.45);text-transform:capitalize;}
.ddbx2-ac-chip b{color:#fff;}
.ddbx2-ac-applied{font-size:11px;font-weight:bold;color:#ffce6a;margin-top:7px;text-align:center;text-transform:uppercase;letter-spacing:.05em;}
@keyframes ddbx2-pop{0%{transform:scale(.55);opacity:0;}55%{transform:scale(1.18);opacity:1;}100%{transform:scale(1);}}
@keyframes ddbx2-glow{0%{filter:drop-shadow(0 0 0 currentColor);}30%{filter:drop-shadow(0 0 6px currentColor);}100%{filter:drop-shadow(0 0 0 transparent);}}
.ddbx2-pc-kind{font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:var(--txt-dim);display:inline-flex;align-items:center;gap:5px;}
.ddbx2-pc-kind i{opacity:.85;}
.ddbx2-pc-hero{font-size:46px;font-weight:900;line-height:1.05;margin:1px 0 2px;color:var(--txt);animation:ddbx2-pop .4s ease-out;}
.ddbx2-pc-hero.atk{color:var(--info);} .ddbx2-pc-hero.dmg{color:#f0a878;} .ddbx2-pc-hero.gen{color:var(--info);} .ddbx2-pc-hero.heal{color:var(--good);}
.ddbx2-pc-hero.crit{color:var(--good);text-shadow:0 0 12px rgba(95,208,122,.6);}
.ddbx2-pc-hero.fumble{color:var(--bad);text-shadow:0 0 12px rgba(255,107,107,.6);}
.ddbx2-pc-heroL{font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:var(--txt-dim);}
.ddbx2-pc-bd{font-size:11px;color:var(--txt-mute);margin-top:3px;}
.ddbx2-pc-sub{font-size:10px;opacity:.55;margin-top:6px;color:var(--txt-dim);}
.ddbx2-pc-pills{display:flex;flex-wrap:wrap;gap:4px;justify-content:center;margin-top:6px;}
.ddbx2-pc-pill{font-size:10px;padding:1px 8px;border-radius:9px;background:rgba(255,255,255,.12);font-weight:bold;letter-spacing:.03em;color:var(--txt);}
.ddbx2-pc-pill.crit{background:rgba(105,215,127,.2);color:var(--good);box-shadow:inset 0 0 0 1px rgba(105,215,127,.5);}
.ddbx2-pc-pill.fumble{background:rgba(255,107,107,.2);color:var(--bad);box-shadow:inset 0 0 0 1px rgba(255,107,107,.5);}
.ddbx2-pc-pill.dtype{background:rgba(224,130,77,.2);color:var(--coral-text);box-shadow:inset 0 0 0 1px rgba(224,130,77,.45);text-transform:capitalize;}
.ddbx2-pc-pill.applied{background:rgba(255,180,60,.22);color:#ffce6a;box-shadow:inset 0 0 0 1px rgba(255,180,60,.5);}
/* --- Cinematic stinger (orbit layout, result/declare only) --- */
.ddbx-sting{position:fixed;inset:0;z-index:auto;pointer-events:none;overflow:hidden;font-family:'Modesto Condensed','Signika',serif;--ddbx-portbg:radial-gradient(circle at 50% 34%,#41435a,#15151d);--ci-x:6vw;--ci-y:6vh;}
.ddbx-content{position:absolute;inset:var(--ci-y,6vh) var(--ci-x,6vw);pointer-events:none;}
@keyframes ddbx-st-fade{0%{opacity:0;}6%{opacity:1;}85%{opacity:1;}100%{opacity:0;}}
/* The auto-fade is OPT-IN: only elements tagged .ddbx-st-fade fade out (single-roll stingers + the finalized group
   RESULT). The GATHERING Group Check / Contest cinematic deliberately omits it, so there is no fade to fight — it
   simply persists until the GM finalizes or cancels. (Belt: is-gathering also pins opacity if a fade ever leaks in.) */
.ddbx-st-fade{animation:ddbx-st-fade var(--dur,3500ms) ease forwards;}
.ddbx-group.is-gathering{animation:none!important;opacity:1!important;}
/* GM-only close control. The cinematic root is pointer-events:none, so this button re-enables pointer events on itself. */
.ddbx-close{position:absolute;top:var(--ci-y,6vh);right:var(--ci-x,6vw);width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,.6);border:1.6px solid rgba(255,255,255,.5);color:#fff;font:700 18px/37px system-ui,Arial,sans-serif;text-align:center;cursor:pointer;pointer-events:auto;z-index:30;transition:background .15s,border-color .15s,transform .12s;}
.ddbx-close:hover{background:rgba(0,0,0,.85);border-color:#fff;transform:scale(1.08);}
.ddbx-critflash{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 50% 45%, color-mix(in srgb,var(--c1) 65%,transparent), transparent 62%);opacity:0;animation:ddbx-critflash 1.1s ease-out;}
@keyframes ddbx-critflash{0%{opacity:0;}12%{opacity:1;}40%{opacity:.25;}60%{opacity:.7;}100%{opacity:0;}}
.ddbx-sting.crit.critwin .ddbx-result{text-shadow:0 0 30px var(--gold);}
.ddbx-sting.crit.critfail .ddbx-result{filter:drop-shadow(0 0 26px var(--bad));}
.ddbx-bg{position:absolute;inset:0;background-size:cover;background-position:center;filter:blur(64px) saturate(1.25) brightness(.6);opacity:.42;animation:ddbx-st-zoom var(--dur,3500ms) ease-out forwards;}
@keyframes ddbx-st-zoom{0%{transform:scale(1.32);}100%{transform:scale(1.06);}}
.ddbx-vig{position:absolute;inset:0;background:radial-gradient(ellipse 62% 58% at 50% 50%, color-mix(in srgb, var(--c2) 28%, transparent), rgba(2,2,4,.93) 74%);}
.ddbx-sting.colorbg .ddbx-vig{background:radial-gradient(ellipse 64% 60% at 50% 46%, color-mix(in srgb, var(--c1) 24%, transparent), color-mix(in srgb, var(--c2) 30%, rgba(2,2,4,.96)) 72%);}
.ddbx-radial{position:absolute;left:50%;top:50%;width:80vh;height:80vh;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle, color-mix(in srgb, var(--c1) 22%, transparent), transparent 60%);opacity:0;animation:ddbx-rad var(--dur,3500ms) ease forwards;}
@keyframes ddbx-rad{0%{opacity:0;}12%{opacity:1;}85%{opacity:.8;}100%{opacity:0;}}
.ddbx-stage{position:absolute;inset:0;animation:ddbx-rise .7s cubic-bezier(.15,1.2,.4,1);}
@keyframes ddbx-rise{0%{opacity:0;transform:scale(.96);}100%{opacity:1;transform:scale(1);}}
.ddbx-casterwrap{position:absolute;text-align:center;}
.ddbx-caster{display:inline-block;border-radius:50%;--ddbx-portbg:radial-gradient(circle at 50% 34%,#41435a,#15151d);background-color:#15151d;background-size:cover;background-position:center;box-shadow:0 0 0 3px var(--c1),0 0 0 9px rgba(0,0,0,.6),0 0 52px var(--c2);animation:ddbx-portin .8s cubic-bezier(.15,1.3,.4,1);}
@keyframes ddbx-portin{0%{opacity:0;transform:scale(.7);}100%{opacity:1;transform:scale(1);}}
.ddbx-cname{display:block;margin-top:12px;font-size:26px;font-weight:bold;letter-spacing:.18em;text-transform:uppercase;color:#fff;text-shadow:0 2px 10px #000,0 0 16px #000;animation:ddbx-textin .8s ease-out .1s both;}
.ddbx-casterport{position:relative;display:inline-block;line-height:0;}
/* Action-art sub-circle riding the roller portrait (the weapon/spell art). */
.ddbx-actbadge{position:absolute;right:-4px;bottom:6px;width:70px;height:70px;border-radius:50%;background-size:cover;background-position:center;background-color:#15101c;box-shadow:0 0 0 3px var(--c1),0 0 0 6px rgba(0,0,0,.6),0 0 20px #000b;animation:ddbx-badgein .55s cubic-bezier(.15,1.4,.4,1) .22s both;}
@keyframes ddbx-badgein{0%{opacity:0;transform:scale(.2) rotate(-30deg);}100%{opacity:1;transform:scale(1) rotate(0);}}
.ddbx-center{position:absolute;text-align:center;}
.ddbx-glow{width:0;height:2px;margin:12px auto 4px;background:linear-gradient(90deg,transparent,var(--c1),transparent);box-shadow:0 0 16px var(--c1);animation:ddbx-glowline .9s cubic-bezier(.2,.8,.3,1) .25s both;}
@keyframes ddbx-glowline{0%{width:0;opacity:0;}40%{opacity:1;}100%{width:62%;opacity:.95;}}
.ddbx-title{font-size:72px;font-weight:900;line-height:1;letter-spacing:.03em;text-transform:uppercase;background:linear-gradient(180deg,#fff 35%,var(--c1));-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 3px 20px var(--c2));animation:ddbx-textin .7s ease-out;}
@keyframes ddbx-textin{0%{opacity:0;transform:translateY(16px);letter-spacing:.2em;}100%{opacity:1;transform:translateY(0);letter-spacing:.03em;}}
.ddbx-total{font-size:92px;font-weight:900;line-height:1;margin-top:16px;background:linear-gradient(180deg,#fff,var(--c1));-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 3px 24px var(--c2));opacity:0;animation:ddbx-reveal .6s cubic-bezier(.2,1.5,.4,1) 1.3s both;}
@keyframes ddbx-reveal{0%{opacity:0;transform:scale(1.5);}60%{opacity:1;}100%{opacity:1;transform:scale(1);}}
.ddbx-result{position:relative;font-size:112px;font-weight:900;line-height:1;letter-spacing:.04em;text-transform:uppercase;background:linear-gradient(180deg,#fff 30%,var(--c1));-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 4px 30px var(--c1));animation:ddbx-punch .65s cubic-bezier(.2,1.5,.4,1);}
@keyframes ddbx-punch{0%{opacity:0;transform:scale(1.6);letter-spacing:.5em;}55%{opacity:1;}100%{transform:scale(1);letter-spacing:.04em;}}
.ddbx-rsub{font-size:24px;letter-spacing:.22em;text-transform:uppercase;color:var(--txt);margin-top:16px;animation:ddbx-textin .7s ease-out .12s both;}
.ddbx-sting.crit .ddbx-result{animation:ddbx-punch .65s cubic-bezier(.2,1.5,.4,1),ddbx-critpulse 1.1s ease-in-out .35s 2;}
@keyframes ddbx-critpulse{0%,100%{filter:drop-shadow(0 0 20px var(--c1));}50%{filter:drop-shadow(0 0 48px var(--c1)) drop-shadow(0 0 18px #fff);}}
.ddbx-burst{position:absolute;left:50%;top:50%;width:380px;height:380px;margin:-190px 0 0 -190px;border-radius:50%;background:radial-gradient(circle,var(--c1),transparent 62%);opacity:0;animation:ddbx-burst .9s ease-out forwards;}
@keyframes ddbx-burst{0%{opacity:0;transform:scale(.3);}25%{opacity:.55;}100%{opacity:0;transform:scale(1.8);}}
.ddbx-pts{position:absolute;inset:0;overflow:hidden;}
.ddbx-pt{position:absolute;bottom:-12px;border-radius:50%;background:var(--c1);opacity:0;box-shadow:0 0 8px var(--c1);animation-name:ddbx-pt-rise;animation-timing-function:ease-out;animation-fill-mode:forwards;}
.ddbx-pt.spark{background:#fff;box-shadow:0 0 10px #fff,0 0 18px var(--c1);}
@keyframes ddbx-pt-rise{0%{opacity:0;transform:translate(0,0) scale(.6);}15%{opacity:.85;}100%{opacity:0;transform:translate(var(--sway,0),-70vh) scale(1.15);}}
.lay-orbit .ddbx-casterwrap{left:50%;top:50%;transform:translate(-50%,-50%);}
.lay-orbit .ddbx-caster{width:208px;height:208px;}
.lay-orbit .ddbx-center{left:0;right:0;top:21vh;}
.lay-orbit .ddbx-title{font-size:54px;}
.lay-orbit .ddbx-result{font-size:88px;}
.lay-orbit .ddbx-total{font-size:64px;margin-top:8px;}
/* --- Impact cinematic (damage roll WITH a selected target): the target token CENTERED as the focus,
   the attacker + weapon art in a SMALLER circle at the TOP, the big damage number + type label at the BOTTOM.
   Presentation only — the "damage" is just the rolled number; nothing is applied to any actor. --- */
.ddbx-strike{position:relative;width:232px;height:232px;border-radius:50%;background-size:cover;background-position:center;background-color:#15101c;box-shadow:0 0 0 4px var(--c1),0 0 0 9px rgba(0,0,0,.5),0 0 60px var(--c1);animation:ddbx-strikein 1s cubic-bezier(.18,1.3,.32,1) both;}
.ddbx-strike .ddbx-strikesub{position:absolute;right:-6px;bottom:4px;width:84px;height:84px;border-radius:50%;background-size:cover;background-position:center;background-color:#15101c;box-shadow:0 0 0 3px var(--c1),0 0 0 6px rgba(0,0,0,.6),0 0 22px #000b;animation:ddbx-badgein .55s cubic-bezier(.15,1.4,.4,1) .5s both;}
@keyframes ddbx-strikein{0%{opacity:0;transform:translate(-180px,-150px) rotate(-46deg) scale(.5);}55%{opacity:1;transform:translate(0,0) rotate(8deg) scale(1.12);}75%{transform:translate(0,0) rotate(-2deg) scale(.97);}100%{opacity:1;transform:translate(0,0) rotate(0) scale(1);}}
.ddbx-target{position:relative;display:inline-block;border-radius:50%;background-size:cover;background-position:center;background-color:#15151d;box-shadow:0 0 0 4px var(--c1),0 0 0 11px rgba(0,0,0,.6),0 0 70px var(--c2);animation:ddbx-portin .8s cubic-bezier(.15,1.3,.4,1) .15s both;}
.ddbx-tname{display:block;margin-top:12px;font-size:22px;font-weight:bold;letter-spacing:.16em;text-transform:uppercase;color:#fff;text-shadow:0 2px 10px #000,0 0 16px #000;animation:ddbx-textin .8s ease-out .2s both;max-width:100%;box-sizing:border-box;text-align:center;word-break:break-word;}
.ddbx-impact-att{position:absolute;left:0;right:0;top:9vh;display:flex;justify-content:center;}
.ddbx-impact-focus{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:16px 32px;max-width:88vw;}
.ddbx-tfoc{display:flex;flex-direction:column;align-items:center;}
.ddbx-verdict{display:block;margin-top:9px;font-size:22px;font-weight:900;letter-spacing:.18em;text-shadow:0 2px 10px #000,0 0 18px currentColor;animation:ddbx-reveal .5s cubic-bezier(.2,1.5,.4,1) .35s both;}
.ddbx-verdict.v-hit{color:#5fe07a;}
.ddbx-verdict.v-miss{color:#ff6a6a;}
.ddbx-tfoc.v-hit{--c1:#4fd06a;--c2:rgba(79,208,106,.55);}
.ddbx-tfoc.v-miss{--c1:#ff5b5b;--c2:rgba(255,91,91,.5);}
.ddbx-tfoc.v-miss .ddbx-target{filter:grayscale(.5) brightness(.82);}
.ddbx-impact-focus.multi .ddbx-verdict{font-size:15px;margin-top:6px;}
.ddbx-impact-focus.multi .ddbx-tname{font-size:15px;margin-top:8px;letter-spacing:.08em;}
.lay-orbit .ddbx-impact-focus .ddbx-target{width:218px;height:218px;}
.ddbx-impact-readout{position:absolute;left:0;right:0;bottom:13vh;display:flex;flex-direction:column;align-items:center;gap:6px;}
.lay-orbit .ddbx-impact-readout .ddbx-result{font-size:120px;}
.ddbx-impact-readout .ddbx-rsub{margin-top:0;}
.dmgnum{font-size:120px;background:none;-webkit-text-fill-color:#fff;color:#fff;text-shadow:0 4px 14px #000,0 0 6px #000,0 0 30px var(--c1);animation:ddbx-dmgpunch .7s cubic-bezier(.2,1.5,.35,1) .25s both;}
@keyframes ddbx-dmgpunch{0%{opacity:0;transform:scale(2.2);filter:blur(8px);}50%{opacity:1;transform:scale(.94);filter:blur(0);}72%{transform:scale(1.06);}100%{opacity:1;transform:scale(1);}}
.ddbx-flash{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 50% 50%, color-mix(in srgb,var(--c1) 55%,transparent), transparent 60%);opacity:0;animation:ddbx-hitflash .5s ease-out;}
@keyframes ddbx-hitflash{0%{opacity:0;}10%{opacity:.95;}100%{opacity:0;}}
/* The impact zooms the camera onto the token, so the overlay clears a feathered transparent "window" in the centre. */
.ddbx-sting.impactwrap .ddbx-vig{background:radial-gradient(ellipse 60% 62% at 50% 50%, transparent 0 32%, rgba(2,2,4,.42) 64%, rgba(2,2,4,.9) 100%);}
.ddbx-sting.impactwrap .ddbx-tex{-webkit-mask:radial-gradient(ellipse 60% 62% at 50% 50%, transparent 32%, #000 68%);mask:radial-gradient(ellipse 60% 62% at 50% 50%, transparent 32%, #000 68%);}
/* Damage-type full-screen effect wash. */
.ddbx-fx{position:absolute;inset:0;pointer-events:none;overflow:hidden;}
.fx-impact,.fx-fire,.fx-cold,.fx-ooze,.fx-heal{animation:ddbx-flash .6s ease-out;}
.fx-impact{background:radial-gradient(circle at 50% 50%, color-mix(in srgb,var(--c1) 45%,transparent), transparent 62%);}
@keyframes ddbx-flash{0%{opacity:0;}18%{opacity:1;}100%{opacity:0;}}
.fx-fire{background:radial-gradient(circle at 50% 82%, color-mix(in srgb,#ff7a18 60%,transparent), transparent 60%);animation:ddbx-flicker .8s ease-out;}
@keyframes ddbx-flicker{0%{opacity:0;}14%{opacity:1;}40%{opacity:.55;}62%{opacity:.95;}100%{opacity:0;}}
.fx-cold{background:radial-gradient(circle,transparent 48%, rgba(150,215,255,.3));box-shadow:inset 0 0 180px 70px rgba(120,200,255,.45);}
.fx-ooze{background:linear-gradient(180deg, color-mix(in srgb,var(--c1) 55%,transparent), transparent 42%);animation:ddbx-flicker .9s ease-out;}
.fx-heal{background:radial-gradient(circle at 50% 50%, rgba(95,208,122,.4), transparent 62%);animation:ddbx-flash .9s ease-out;}
.fx-shock{background:#fff;opacity:0;animation:ddbx-shock .55s steps(1);}
@keyframes ddbx-shock{0%,100%{opacity:0;}8%{opacity:.85;}13%{opacity:0;}22%{opacity:.7;}27%{opacity:0;}}
.fx-slash span{position:absolute;top:-10%;height:120%;width:6px;background:linear-gradient(180deg,transparent,#fff,transparent);box-shadow:0 0 16px #fff,0 0 30px var(--c1);opacity:0;animation:ddbx-slashin .5s ease-out forwards;}
.fx-slash span:nth-child(1){left:32%;animation-delay:0s;} .fx-slash span:nth-child(2){left:50%;animation-delay:.1s;} .fx-slash span:nth-child(3){left:68%;animation-delay:.2s;}
@keyframes ddbx-slashin{0%{opacity:0;transform:rotate(20deg) translateY(-40px) scaleY(.3);}28%{opacity:1;}100%{opacity:0;transform:rotate(20deg) translateY(40px) scaleY(1.1);}}
.fx-pierce{background:repeating-conic-gradient(from 0deg at 50% 50%, transparent 0 15deg, color-mix(in srgb,var(--c1) 55%,transparent) 15deg 17deg);opacity:0;animation:ddbx-pierce .55s ease-out;}
@keyframes ddbx-pierce{0%{opacity:0;transform:scale(.35);}30%{opacity:.9;}100%{opacity:0;transform:scale(1.5);}}
.fx-burst span{position:absolute;left:50%;top:50%;width:40px;height:40px;border-radius:50%;border:6px solid var(--c1);transform:translate(-50%,-50%);opacity:0;animation:ddbx-ring .65s ease-out forwards;}
.fx-burst span:nth-child(2){animation-delay:.13s;}
@keyframes ddbx-ring{0%{opacity:.9;width:30px;height:30px;}100%{opacity:0;width:95vw;height:95vw;}}
.impactwrap .fx-slash{transform:rotate(-24deg) scale(1.5);}
.impactwrap .fx-slash span{width:10px;}
/* Screen shake (applied to Foundry's #board) for the impact moment. */
.ddbx-shake-soft{animation:ddbx-shake-s .4s cubic-bezier(.36,.07,.19,.97);}
.ddbx-shake-med{animation:ddbx-shake-m .5s cubic-bezier(.36,.07,.19,.97);}
.ddbx-shake-hard{animation:ddbx-shake-h .6s cubic-bezier(.36,.07,.19,.97);}
@keyframes ddbx-shake-s{10%,90%{transform:translate(-1px,0);}30%,70%{transform:translate(2px,-1px);}50%{transform:translate(-2px,1px);}}
@keyframes ddbx-shake-m{10%,90%{transform:translate(-3px,1px);}20%,80%{transform:translate(5px,-2px);}40%,60%{transform:translate(-7px,3px);}50%{transform:translate(7px,-3px);}}
@keyframes ddbx-shake-h{10%,90%{transform:translate(-5px,2px) rotate(-.3deg);}20%,80%{transform:translate(9px,-4px) rotate(.4deg);}40%,60%{transform:translate(-13px,6px) rotate(-.5deg);}50%{transform:translate(13px,-6px) rotate(.5deg);}}
.ddbx-tex{position:absolute;inset:0;pointer-events:none;opacity:.32;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:300px 300px;}
.ddbx-crestbg{position:absolute;inset:0;opacity:.30;animation:ddbx-st-zoom var(--dur,3500ms) ease-out forwards;}
/* --- Connection status chip (GM-only) --- */
.ddbx-conn{position:fixed;left:10px;bottom:10px;z-index:60;display:flex;align-items:center;gap:6px;font:11px/1 Signika,sans-serif;background:rgba(20,20,24,.9);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:5px 9px;color:#dcdcdc;cursor:pointer;opacity:.8;user-select:none;}
.ddbx-conn:hover{opacity:1;}
.ddbx-conn .dot{width:8px;height:8px;border-radius:50%;background:#888;box-shadow:0 0 7px currentColor;}
.ddbx-conn.ok .dot{background:#69d77f;color:#69d77f;} .ddbx-conn.warn .dot{background:#ffcf5a;color:#ffcf5a;animation:ddbx-connpulse 1s ease-in-out infinite;} .ddbx-conn.down .dot{background:#ff6b6b;color:#ff6b6b;}
@keyframes ddbx-connpulse{0%,100%{opacity:1;}50%{opacity:.35;}}
/* --- Group Check / Contest cinematic (GM-driven): a header + a row/grid of roller tiles. PERSISTENT — stays up
   while rolls gather, then reveals the average / winner and fades. Reuses the .ddbx-sting --c1/--c2 theme vars and
   the .ddbx-actbadge action sub-circle look. Presentation only: no numbers are applied to any actor. --- */
.ddbx-ghead{position:absolute;left:0;right:0;top:8vh;text-align:center;}
.ddbx-gh-title{font-size:54px;font-weight:900;line-height:1;letter-spacing:.04em;text-transform:uppercase;background:linear-gradient(180deg,#fff 35%,var(--c1));-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 3px 20px var(--c2));animation:ddbx-textin .7s ease-out;}
.ddbx-gh-sub{font-size:22px;letter-spacing:.16em;text-transform:uppercase;color:var(--txt-dim,#cfcfcf);margin-top:10px;text-shadow:0 2px 8px #000;animation:ddbx-textin .7s ease-out .1s both;}
.ddbx-gh-result{font-size:84px;font-weight:900;line-height:1;letter-spacing:.04em;margin-top:6px;background:linear-gradient(180deg,#fff 30%,var(--c1));-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 4px 26px var(--c1));animation:ddbx-reveal .55s cubic-bezier(.2,1.5,.4,1) both;}
/* Tile grid — centred, wraps, scrolls nothing; each tile holds a portrait, an action sub-circle, the big total, the label. */
.ddbx-gtiles{position:absolute;left:0;right:0;top:30vh;bottom:8vh;display:flex;flex-wrap:wrap;gap:30px;align-items:center;justify-content:center;align-content:center;padding:0 5vw;}
.ddbx-gtile{position:relative;width:172px;text-align:center;animation:ddbx-portin .55s cubic-bezier(.15,1.3,.4,1) both;}
.ddbx-gt-port{position:relative;display:inline-block;line-height:0;}
.ddbx-gt-img{display:inline-block;width:134px;height:134px;border-radius:50%;background-color:#15151d;background-size:cover;background-position:center;box-shadow:0 0 0 3px var(--c1),0 0 0 7px rgba(0,0,0,.55),0 0 30px var(--c2);}
.ddbx-gtile.win .ddbx-gt-img{box-shadow:0 0 0 5px var(--gold,#ffd34d),0 0 0 9px rgba(0,0,0,.55),0 0 46px var(--gold,#ffd34d);transform:scale(1.06);}
.ddbx-gtile.lose{opacity:.5;filter:grayscale(.4);}
.ddbx-gt-crown{position:absolute;top:-14px;left:50%;transform:translateX(-50%);font-size:24px;color:var(--gold,#ffd34d);text-shadow:0 0 12px #ffb300;z-index:2;animation:ddbx-badgein .5s cubic-bezier(.15,1.4,.4,1) .15s both;}
.ddbx-gt-n{font-size:22px;font-weight:bold;color:#fff;margin-top:10px;text-shadow:0 2px 6px #000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ddbx-gt-label{display:block;font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--skill,#bda9e8);margin-top:3px;min-height:14px;text-shadow:0 1px 4px #000;}
.ddbx-gt-label.pend{color:#8a8a96;}
.ddbx-gt-total{display:block;font-size:40px;font-weight:900;line-height:1;color:var(--c1);text-shadow:0 2px 10px #000;margin-top:4px;}
.ddbx-gt-total.pend{color:#888;}
.ddbx-gt-total.gt-upd{animation:ddbx-gtpop .55s cubic-bezier(.2,.9,.25,1);}
@keyframes ddbx-gtpop{0%{transform:scale(.35);opacity:0;}45%{transform:scale(1.26);opacity:1;color:#fff;text-shadow:0 0 18px var(--c1),0 2px 10px #000;}100%{transform:scale(1);}}
.ddbx-gt-sub{display:block;font-size:14px;letter-spacing:.04em;color:var(--txt-mute,#9a9a9a);margin-top:1px;text-shadow:0 1px 4px #000;}
.ddbx-gtile.gt-in{animation:ddbx-gt-in .5s ease-out;}
@keyframes ddbx-gt-in{0%{opacity:0;transform:translateY(14px) scale(.92);}100%{opacity:1;transform:translateY(0) scale(1);}}
`;
function injectStyles() { let el = document.getElementById('ddbx-int-styles'); if (!el) { el = document.createElement('style'); el.id = 'ddbx-int-styles'; document.head.appendChild(el); } el.textContent = STYLES; }

/* ------------------------------------------------------------------ helpers */
function esc(s) { return foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s)) : String(s); }
// Sanitize a string used inside a CSS url('…') within an HTML style attribute.
function cleanUrl(s) { return String(s ?? '').replace(/['"<>\\\r\n\t]/g, '').slice(0, 2000); }
// Harden a stinger payload received over the socket (ANY client can emit one) before it reaches innerHTML.
function sanitizeStinger(p) {
  if (!p || typeof p !== 'object') return null;
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const str = (v, n = 120) => (v == null ? '' : String(v).slice(0, n));
  // Only 'impact' (damage roll WITH a target) and 'result' (everything else) phases exist — both presentation-only.
  const phase = p.phase === 'impact' ? 'impact' : 'result';
  // applyIds is read-only here: it only feeds canvas.animatePan (a camera move). No data is mutated.
  const applyIds = Array.isArray(p.applyIds) ? p.applyIds.slice(0, 24).map(s => str(s, 64)).filter(Boolean) : [];   // read-only camera (pan/zoom-to-fit); allow the full target set
  return {
    phase,
    word: str(p.word), action: str(p.action), who: str(p.who), tone: str(p.tone, 16), color: str(p.color, 32),
    img: cleanUrl(p.img), actorImg: cleanUrl(p.actorImg),
    total: num(p.total), hue: num(p.hue), crest: !!p.crest, cue: str(p.cue, 64),
    dtype: str(p.dtype, 24), heal: !!p.heal, kind: str(p.kind, 16), nat: num(p.nat),
    targetName: str(p.targetName), targetImg: cleanUrl(p.targetImg),
    targets: Array.isArray(p.targets) ? p.targets.slice(0, 24).map(t => ({ name: str(t?.name, 80), img: cleanUrl(t?.img), hit: (t?.hit === true || t?.hit === false) ? t.hit : null })).filter(t => t.img || t.name) : [],
    applyIds, noPan: !!p.noPan, dur: Number.isFinite(p.dur) ? Math.max(100, Math.round(p.dur)) : undefined,
  };
}
// Harden a GROUP cinematic payload received over the socket before it reaches innerHTML (mirrors sanitizeStinger).
// Carries the FULL session state so a player who joined mid-check renders correctly. Purely presentational — the
// totals/sub are display strings only; nothing here is applied to any actor (no automation).
function sanitizeGroup(p) {
  if (!p || typeof p !== 'object') return null;
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const str = (v, n = 120) => (v == null ? '' : String(v).slice(0, n));
  const mode = p.mode === 'contest' ? 'contest' : (p.mode === 'init' ? 'init' : 'check');
  // Phases: 'gathering' (collecting rolls) or 'result' (finalized). Both presentation-only.
  const phase = p.phase === 'result' ? 'result' : 'gathering';
  const entries = Array.isArray(p.entries) ? p.entries.slice(0, 24).map(e => ({
    who: str(e?.who, 80), img: cleanUrl(e?.img), actionImg: cleanUrl(e?.actionImg),
    label: str(e?.label, 60), total: num(e?.total), sub: str(e?.sub, 40), win: e?.win === true ? true : (e?.win === false ? false : null),
  })) : [];
  return { mode, phase, headline: str(p.headline, 80), entries };
}
// Resolve the rolling character to a Foundry actor by the character mapping or by name.
function getMapping() { try { const m = game.settings.get(NS, 'characterMapping'); if (m && Object.keys(m).length) return m; } catch (e) {} return {}; }
function mappedActor(entityId) { const m = getMapping(); const id = m[entityId]; return id ? game.actors.get(id) : null; }
function resolveActor(data) { return mappedActor(data.context?.entityId || data.entityId) || (data.context?.name ? game.actors.getName(data.context.name) : null); }
// DDB dice → a readable formula with the rolled values, e.g. "1d20 (17) + 5".
function ddbFormula(roll) { const n = roll?.diceNotation || {}; const parts = (n.set || []).map(s => { const vals = (s.dice || []).map(d => d.dieValue).filter(v => v != null); const note = `${s.count || 1}${s.dieType || ''}`; return vals.length ? `${note} (${vals.join(', ')})` : note; }); const c = n.constant || 0; let f = parts.join(' + '); if (c) f += `${f ? ' + ' : ''}${c}`; return f || String(roll?.result?.total ?? ''); }
// DDB dice broken out for a Dice So Nice animation that shows the exact DDB values.
function ddbDice(roll) { const n = roll?.diceNotation || {}; const sets = (n.set || []).map(s => ({ faces: parseInt(String(s.dieType || '').replace(/\D/g, '')) || 20, values: (s.dice || []).map(d => d.dieValue).filter(v => v != null) })).filter(s => s.values.length); return sets.length ? { sets, mod: n.constant || 0 } : null; }
// Clean dice notation (no rolled values), e.g. "2d12 + 1d6 + 5" — used to label custom rolls with no action name.
function ddbNotation(roll) { const n = roll?.diceNotation || {}; const parts = (n.set || []).map(s => `${s.count || 1}${s.dieType || ''}`).filter(Boolean); const c = n.constant || 0; let f = parts.join(' + '); if (c) f += `${f ? ' + ' : ''}${c}`; return f; }
// Natural d20 face: 20 for any crit, 1 only when it's the sole die showing a 1.
function natFace(roll) { const v = roll?.result?.values; if (!Array.isArray(v) || !v.length) return null; if (v.includes(20)) return 20; if (v.length === 1 && v[0] === 1) return 1; return null; }
function findItem(actor, name) { if (!actor?.items || !name) return null; const n = String(name).toLowerCase().trim().replace(/[.\s]+$/, ''); return actor.items.find(i => i.name.toLowerCase().trim().replace(/[.\s]+$/, '') === n) || actor.items.find(i => { const inm = i.name.toLowerCase().trim(); return inm.includes(n) || n.includes(inm); }) || null; }
const ABIL = { str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma' };
// Thematic hue per ability: str red, dex green, con blue, int cyan, wis yellow, cha magenta.
const ABIL_HUE = { str: 0, dex: 120, con: 215, int: 180, wis: 50, cha: 300 };
function abilityIcon(ab) { return ab && ABIL[ab] ? 'icons/svg/d20-grey.svg' : ''; }
function abilityHue(ab) { return ABIL_HUE[ab] ?? null; }
function hexToHue(hex) { if (!hex) return null; let h = String(hex).trim().replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); if (h.length < 6) return null; const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16); return [r, g, b].some(isNaN) ? null : rgbToHue(r, g, b); }
// The actor's theme colour: a sheet-color flag if present, else the owning player's colour.
function actorThemeColor(actor) {
  if (!actor) return null;
  const f = actor.flags || {};
  const c = f.dnd5e?.sheetColor || f.dnd5e?.color || f.core?.sheetColor || actor.system?.details?.color;
  if (c) return (c.css || c);
  try { const owner = game.users?.find(u => !u.isGM && actor.testUserPermission?.(u, 'OWNER')); if (owner?.color) return (owner.color.css || owner.color); } catch (e) {}
  return null;
}
function abilityLabel(ab) { return CONFIG.DND5E?.abilities?.[ab]?.label || (ab ? ab.toUpperCase() : 'Save'); }
function titleCase(s) { return String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
function actorByName(name) { return canvas.tokens?.placeables?.find(t => t.actor?.name === name)?.actor || game.actors.getName(name) || null; }
function checkAbilityFromName(name) {
  if (!name) return null; const n = String(name).toLowerCase();
  const abil = CONFIG.DND5E?.abilities ?? {}; for (const [k, v] of Object.entries(abil)) { if (n === k || (v.label && n.includes(v.label.toLowerCase()))) return k; }
  const sk = CONFIG.DND5E?.skills ?? {}; for (const [k, v] of Object.entries(sk)) { if (k === n || (v.label && n.includes(v.label.toLowerCase()))) return v.ability; }
  return null;
}
// Resolve a skill id from free text (a roll's flavor/name); match the skill's label (longest first).
function skillFromText(text) {
  if (!text) return null; const t = String(text).toLowerCase();
  const sk = CONFIG.DND5E?.skills ?? {};
  const hits = Object.entries(sk).filter(([, v]) => { const l = (v.label || '').toLowerCase(); return l && t.includes(l); });
  hits.sort((a, b) => (b[1].label || '').length - (a[1].label || '').length);
  return hits[0]?.[0] || null;
}
// Look up an action's art + damage types (PURELY for labelling the card — no automation).
function resolveAction(actor, name) {
  const item = findItem(actor, name); if (!item) return {};
  const acts = Array.from(item.system?.activities ?? []);
  const healAct = acts.find(a => a.type === 'heal' || a.healing);
  // All damage-part types in order (DDB sends one same-named damage roll per type).
  const allTypes = []; for (const a of acts) for (const p of (a.damage?.parts ?? [])) { const t = p.types ? Array.from(p.types)[0] : p.type; if (t) allTypes.push(t); }
  const isHeal = !!healAct || (!allTypes.length && /\bhe(al|aling)\b|regain.*hit points/.test((item.system?.description?.value || '').toLowerCase()));
  return { damageType: allTypes[0] || '', damageTypes: Array.from(new Set(allTypes)), isHeal, itemType: item.type, img: item.img || '' };
}

/* --------------------------------------------------------------- the unified card */
// ONE public, informational card per roll. Roller portrait + name, action/item name, the
// roll TOTAL (large), the dice breakdown, the kind (icon + label), an advantage/disadvantage
// pill when present, crit/fumble emphasis, and damage type(s). No targets, no buttons.
function speakerFor(c) { return c.actorId ? ChatMessage.getSpeaker({ actor: game.actors.get(c.actorId) }) : { alias: c.who }; }
function kindMeta(c) {
  switch (c.kind) {
    case 'attack': return { ic: IC.attack, label: 'to hit', hero: 'atk' };
    case 'damage': return c.heal ? { ic: IC.hp, label: 'healing', hero: 'heal' } : { ic: IC.dmg, label: 'damage', hero: 'dmg' };
    case 'save': return { ic: IC.save, label: 'saving throw', hero: 'gen' };
    case 'check': return { ic: IC.check, label: 'check', hero: 'gen' };
    case 'init': return { ic: IC.init, label: 'initiative', hero: 'gen' };
    case 'death': return { ic: IC.death, label: 'death save', hero: 'gen' };
    default: return { ic: IC.d20, label: 'roll', hero: 'gen' };
  }
}
function publicCard(c) {
  if (c.toHit || c.damage) return actionCard(c);   // unified attack+damage card (expands as rolls arrive)
  const m = kindMeta(c);
  const nat = c.nat ?? null;
  const heroCls = nat === 20 ? ' crit' : nat === 1 ? ' fumble' : '';
  const hue = abilityHue(c.ability);
  const accent = c.kind === 'damage'
    ? (c.heal ? 'rgba(95,208,122,.26)' : 'rgba(196,93,49,.30)')
    : (hue != null) ? `hsl(${hue} 70% 45% / .28)`
    : nat === 20 ? 'rgba(105,215,127,.26)' : nat === 1 ? 'rgba(255,107,107,.26)' : 'rgba(60,110,170,.28)';
  // Watermark: action art if we have it, else a tinted crest.
  const tint = c.kind === 'damage' ? (c.heal ? 'hsl(140 60% 55%)' : 'hsl(22 60% 55%)') : (hue != null) ? `hsl(${hue} 60% 55%)` : 'hsl(210 60% 55%)';
  const wm = c.img
    ? `<div class="ddbx2-pc-wm" style="background:url('${cleanUrl(c.img)}') center/cover no-repeat;"></div>`
    : `<div class="ddbx2-pc-wm" style="background-color:${tint};-webkit-mask:url('${WM_IMG}') center/62% no-repeat;mask:url('${WM_IMG}') center/62% no-repeat;"></div>`;
  // Target reticule: Foundry's own message header already shows the ROLLER's portrait + name, so we don't repeat it.
  // Instead, when a target was selected as the roll landed, show WHO is being hit, framed in a crosshair reticule.
  const tgts = (Array.isArray(c.targets) && c.targets.length) ? c.targets : (c.target ? [c.target] : []);
  const target = tgts.length
    ? `<div class="ddbx2-pc-target">${tgts.map(t => `<div class="ddbx2-pc-tgt">${t.img ? `<span class="ddbx2-pc-reticule"><img src="${cleanUrl(t.img)}" onerror="this.style.display='none'"></span>` : ''}${t.name ? `<span class="ddbx2-pc-tname">${esc(t.name)}</span>` : ''}</div>`).join('')}</div>`
    : '';
  // Title: the action/item name (initiative/death saves carry no item, so use the kind label there).
  const titleTxt = (c.kind === 'init' || c.kind === 'death') ? m.label : (c.action || m.label);
  const title = `<div class="ddbx2-pc-title">${esc(titleTxt)}</div>`;
  // Pills: advantage/disadvantage, crit/fumble, damage type(s).
  const pills = [];
  if (c.advKind) pills.push(`<span class="ddbx2-pc-pill">${esc(c.advKind)}</span>`);
  if (nat === 20) pills.push(`<span class="ddbx2-pc-pill crit"><i class="fas fa-star"></i> Natural 20</span>`);
  else if (nat === 1) pills.push(`<span class="ddbx2-pc-pill fumble"><i class="fas fa-skull"></i> Natural 1</span>`);
  if (c.kind === 'damage' && !c.heal) for (const t of (c.damageTypes || [])) pills.push(`<span class="ddbx2-pc-pill dtype">${esc(t)}</span>`);
  if (c.appliedMult) pills.push(`<span class="ddbx2-pc-pill applied"><i class="fas fa-burst"></i> ×${esc(c.appliedMult)} applied</span>`);
  const pillRow = pills.length ? `<div class="ddbx2-pc-pills">${pills.join('')}</div>` : '';
  // Hero number + kind label.
  const kindRow = `<div class="ddbx2-pc-kind"><i class="fas ${m.ic}"></i> ${esc(m.label)}</div>`;
  const hero = `<div class="ddbx2-pc-hero ${m.hero}${heroCls}">${c.total}</div>`;
  // Dice breakdown.
  const sub = c.formula ? `<div class="ddbx2-pc-sub">${esc(c.formula)}</div>` : '';
  return `<div class="ddbx2-pc" style="--accent:${accent}">${wm}<div class="ddbx2-pc-body">${title}${kindRow}${hero}${pillRow}${sub}${target}</div></div>`;
}
// The unified player-facing ACTION card: ⌖ To Hit and/or 💧 Damage in ONE card that grows as rolls arrive. The roll FORMULA
// is never shown (it would leak a monster's/PC's modifiers to the table). Damage types ride below as chips (with per-type
// values when there's more than one). Missed targets are greyed.
function actionCard(c) {
  const wm = c.img
    ? `<div class="ddbx2-pc-wm" style="background:url('${cleanUrl(c.img)}') center/cover no-repeat;"></div>`
    : `<div class="ddbx2-pc-wm" style="background-color:hsl(22 60% 55%);-webkit-mask:url('${WM_IMG}') center/62% no-repeat;mask:url('${WM_IMG}') center/62% no-repeat;"></div>`;
  const title = `<div class="ddbx2-pc-title">${esc(c.action || 'Action')}</div>`;
  const cells = [];
  if (c.toHit) cells.push(`<div class="ddbx2-ac-cell"><div class="ddbx2-ac-lbl"><i class="fas fa-crosshairs"></i> To Hit</div><div class="ddbx2-ac-val hit">${esc(c.toHit.value)}</div></div>`);
  if (c.damage) cells.push(`<div class="ddbx2-ac-cell"><div class="ddbx2-ac-lbl"><i class="fas fa-tint"></i> Damage</div><div class="ddbx2-ac-val dmg">${esc(c.damage.total)}</div></div>`);
  const nums = cells.length ? `<div class="ddbx2-ac-nums${cells.length > 1 ? ' two' : ''}">${cells.join('')}</div>` : '';
  let chips = '';
  if (c.damage && Array.isArray(c.damage.types) && c.damage.types.length) {
    const single = c.damage.types.length === 1;
    chips = `<div class="ddbx2-ac-chips">${c.damage.types.map(t => `<span class="ddbx2-ac-chip">${single ? '' : `<b>${esc(t.value)}</b> `}${esc(t.type)}</span>`).join('')}</div>`;
  }
  const applied = c.appliedMult ? `<div class="ddbx2-ac-applied">×${esc(c.appliedMult)} applied</div>` : '';
  const tgts = Array.isArray(c.targets) ? c.targets : [];
  const target = tgts.length
    ? `<div class="ddbx2-pc-target">${tgts.map(t => `<div class="ddbx2-pc-tgt${t.hit === false ? ' miss' : ''}">${t.img ? `<span class="ddbx2-pc-reticule"><img src="${cleanUrl(t.img)}" onerror="this.style.display='none'"></span>` : ''}${t.name ? `<span class="ddbx2-pc-tname">${esc(t.name)}</span>` : ''}</div>`).join('')}</div>`
    : '';
  return `<div class="ddbx2-pc" style="--accent:rgba(196,93,49,.30)">${wm}<div class="ddbx2-pc-body">${title}${nums}${chips}${applied}${target}</div></div>`;
}
async function postPublic(c) {
  const flags = { [NS]: { card: true } };
  if (c.kind === 'damage') flags[NS].cardData = c;   // kept so we can update the displayed total when the GM applies the damage
  return ChatMessage.create({ speaker: speakerFor(c), content: publicCard(c), flags });
}
// --- Unified action card: ONE expanding card per action (attack + its damage), instead of separate cards. ---
let _actionCards = new Map();   // key "actorId::action" -> { msgId, data, at, dmgCount, timer }
function unifiedKey(card) { return (card.actorId || card.who || '?') + '::' + (card.action || '?'); }
function hitForUuid(uuid) {
  try {
    if (!game.settings.get(NS, 'autoConfirmHits')) return null;   // verdict off → no auto hit/miss anywhere (manual confirm coming)
    if (!uuid || !_attackHits.size || (Date.now() - _attackHitsAt) > 120000) return null;
    const h = _attackHits.get(uuid); return h === undefined ? null : h;
  } catch (e) { return null; }
}
function cardTargets(card) {
  try { return buildNativeTargets(card.targets).map(nt => ({ img: nt.img, name: nt.name, hit: hitForUuid(nt.uuid) })); } catch (e) { return []; }
}
// Fold one damage roll into a card's damage. DDB sends one roll PER type (in the action's part order), so the type comes
// from damageTypes[idx]; same-type rolls merge into one chip; the total accumulates.
function addDmgToCard(data, card, idx) {
  data.damage = data.damage || { total: 0, types: [] };
  // Local rolls carry an exact per-type breakdown (card.damageParts). DDB sends one roll PER type, so fall back to the
  // action's type order (damageTypes[idx]). Either way, same-type values merge into one chip and the total accumulates.
  const parts = (Array.isArray(card.damageParts) && card.damageParts.length)
    ? card.damageParts
    : [{ type: (card.damageTypes || [])[idx] || card.damageType || (card.damageTypes || [])[0] || '', value: Math.max(0, Math.round(Number(card.total) || 0)) }];
  for (const p of parts) {
    const type = p.type || '';
    const val = Math.max(0, Math.round(Number(p.value) || 0));
    const ex = type ? data.damage.types.find(t => t.type === type) : null;
    if (ex) ex.value += val; else data.damage.types.push({ type, value: val });
    data.damage.total += val;
  }
}
function scheduleCardUpdate(rec) {
  clearTimeout(rec.timer);   // coalesce the per-type damage rolls (they arrive in a burst) into one re-render
  rec.timer = setTimeout(async () => {
    try { const msg = game.messages?.get?.(rec.msgId); if (msg) await msg.update({ content: publicCard(rec.data), flags: { [NS]: { card: true, cardData: rec.data } } }); } catch (e) {}
  }, 120);
}
// Post (or expand) the stylized card. Attack → a fresh card with To Hit; its damage rolls EXPAND that same card; a damage
// roll with no recent attack starts its own card. Non-action rolls (check/save/init/death/heal) keep the classic card.
async function presentStylized(card) {
  const isAttack = card.kind === 'attack';
  const isDmg = card.kind === 'damage' && !card.heal;
  if (!isAttack && !isDmg) return postPublic(card);
  const key = unifiedKey(card), now = Date.now();
  if (isDmg) {
    const rec = _actionCards.get(key);
    if (rec && (now - rec.at) < 120000 && game.messages?.get?.(rec.msgId)) {
      addDmgToCard(rec.data, card, rec.dmgCount++); rec.at = now; scheduleCardUpdate(rec);
      return game.messages.get(rec.msgId);
    }
  }
  const data = { who: card.who, action: card.action, actorId: card.actorId, actorImg: card.actorImg, img: card.img, kind: card.kind, targets: cardTargets(card), toHit: null, damage: null };
  let dmgCount = 0;
  if (isAttack) data.toHit = { value: Math.max(0, Math.round(Number(card.total) || 0)) };
  else { addDmgToCard(data, card, 0); dmgCount = 1; }
  const msg = await ChatMessage.create({ speaker: speakerFor(card), content: publicCard(data), flags: { [NS]: { card: true, cardData: data } } });
  _actionCards.set(key, { msgId: msg.id, data, at: now, dmgCount, timer: null });
  return msg;
}

// Present ONE roll: post the public card, animate the DDB dice, fire the cinematic + sound.
async function present(p) {
  try {
    const actor = p.actorId ? game.actors.get(p.actorId) : (p.who ? actorByName(p.who) : null);
    // ONLY attacks + damage have targets. Initiative, saves, and skill checks are reports on the ACTOR's own roll — they
    // never target anyone, so ignore whatever token happens to be selected (a Contest / Group Check gathers rollers, not targets).
    const targets = (p.kind === 'attack' || p.kind === 'damage') ? captureTargets() : [];   // presentation only
    const card = {
      who: p.who, action: p.action, actorId: actor?.id || null,
      kind: p.kind, heal: !!p.heal, ability: p.ability || null,
      total: Number(p.total) || 0, nat: p.nat ?? null, advKind: p.advKind || '',
      damageType: p.damageType || '', damageTypes: p.damageTypes || [], damageParts: p.damageParts || null,
      img: p.img || '', actorImg: actor?.img || '', formula: p.formula || '',
      target: targets[0] || null, targets,   // PRESENTATION ONLY — first frames the impact cinematic; the card lists all.
    };
    if (card.kind === 'attack') { try { recordAttackHits(card); } catch (e) {} }   // remember hit/miss for the tray + card colouring
    const styled = await presentStylized(card);   // ONE expanding card per action (attack rolls open it, damage rolls grow it)
    // D&D Beyond DAMAGE rolls have no native dnd5e card, so synthesize one (with the system's Apply tray) for the GM.
    // The stylized card's id rides on the damage card so the apply hook can update its displayed total to the applied amount.
    if (p.ddb) { try { synthDamageCard(card, styled?.id); synthAttackCard(card); } catch (e) {} }
    // Initiative: the FIRST init roll auto-opens an Initiative gather; the rest fold in; each value is written to the
    // combat tracker. Only when nothing else is running (or an Initiative gather already is) — a manual Group Check /
    // Contest is never hijacked. The GM ends the gather with the ✕ on the cinematic.
    if (card.kind === 'init' && game.user?.isGM && (!GroupRoll.active || GroupRoll.mode === 'init')) {
      if (!GroupRoll.active) startGroup('init');
      setInitiative(actor, card.total);
      ingestGroupRoll({ who: card.who, actorId: actor?.id || null, actorImg: card.actorImg, actionImg: '', isAction: false, label: 'Initiative', kind: 'init', total: card.total, nat: card.nat });
      return;
    }
    // While a Group Check / Contest session is live, fold this roll into the group cinematic instead of firing the
    // individual roll-reveal flourish (the chat card above is unaffected). An action/item roll (attack/damage) carries
    // its art; a bare ability/skill/save check does not.
    if (GroupRoll.active && game.user?.isGM) {
      const isAction = card.kind === 'attack' || card.kind === 'damage';
      ingestGroupRoll({
        who: card.who, actorId: actor?.id || null, actorImg: card.actorImg,
        actionImg: card.img, isAction, label: card.action || '',
        kind: card.kind, total: card.total, nat: card.nat,
      });
      return;
    }
    // Skip our DDB-dice animation for a DDB ATTACK roll — the native attack card already animates the d20 (no double).
    if (!(p.ddb && card.kind === 'attack' && game.settings.get(NS, 'ddbApplyCard'))) dsnRoll(p.dice);
    announce(card);
  } catch (e) { console.warn('DDB Integrator | present', e); }
}
// Read the GM's currently-targeted tokens (ALL of them) for the card/cinematic — never stored, never resolved for HP.
// Uses the actor PORTRAIT (actor.img), falling back to the token image.
function captureTargets() {
  try {
    return Array.from(game.user?.targets || [])
      .map(t => ({ id: t.id || null, name: t.actor?.name || t.name || '', img: t.actor?.img || t.document?.texture?.src || '' }))
      .filter(t => t.img || t.name);
  } catch (e) { return []; }
}
// Write a rolled initiative value onto the actor's combatant(s) in the active combat. GM only; no-op without a combat
// or a matching combatant. This is the ONLY place the module writes Foundry state — and only the initiative field.
function setInitiative(actor, value) {
  try {
    if (!game.user?.isGM || !actor || !game.combat || value == null) return;
    const combs = game.combat.combatants.filter(c => (c.actorId || c.actor?.id) === actor.id);
    for (const c of combs) { try { game.combat.setInitiative(c.id, Number(value)); } catch (e) {} }
  } catch (e) { console.warn('DDB Integrator | setInitiative', e); }
}
// For a D&D Beyond DAMAGE roll (which has no native card), post the SYSTEM's own damage card — with its Apply tray
// (multipliers, resistance, temp HP). Uses dnd5e's OWN activity-less damage path (the same one its [[/damage]] enricher
// uses): a constant `parts:["<total>"]` evaluates to the exact DDB total (no re-roll), and the Apply tray renders from
// the DamageRoll instance + GM — no real item/activity required. Posted publicly; only the GM can apply; never automatic.
async function synthDamageCard(card, stylizedId) {
  try {
    if (!game.user?.isGM) return;
    if (card.kind !== 'damage' || card.heal) return;
    if (!game.settings.get(NS, 'ddbApplyCard')) return;
    const DamageRoll = CONFIG.Dice?.DamageRoll; if (!DamageRoll?.build) { console.warn('DDB Integrator | no DamageRoll.build'); return; }
    const dtype = card.damageType || (card.damageTypes && card.damageTypes[0]) || '';
    const total = Math.max(0, Math.round(Number(card.total) || 0));
    const flags = synthFlags(card, 'damage');
    if (stylizedId) flags[NS].stylizedId = stylizedId;   // so the apply hook can update the stylized card's total
    const miss = missedMultipliers(card);   // pre-select ×0 on the tray for targets the attack missed (seeded in the render hook)
    if (miss.length) flags[NS].multipliers = miss;
    console.log('[ddbx-synth] damage card', { total, dtype });
    await DamageRoll.build(
      { rolls: [{ parts: [String(total)], options: { type: dtype, types: dtype ? [dtype] : [], properties: [] } }], hookNames: ['damage'] },
      { configure: false },
      { create: true, data: { flavor: `${card.action || 'Damage'} — Damage Roll`, speaker: speakerFor(card), flags, whisper: nativeWhisper() } }
    );
  } catch (e) { console.warn('DDB Integrator | synthDamageCard', e); }
}
// The kept d20 face from a DDB roll (total minus the flat modifier and any non-d20 dice) — to force the synth attack die.
function ddbD20Face(roll) {
  try {
    const dd = ddbDice(roll); if (!dd || !(dd.sets || []).some(s => s.faces === 20)) return null;
    const other = (dd.sets || []).filter(s => s.faces !== 20).reduce((a, s) => a + (s.values || []).reduce((x, v) => x + (Number(v) || 0), 0), 0);
    return Number(roll.result?.total ?? 0) - (dd.mod || 0) - other;
  } catch (e) { return null; }
}
// For a D&D Beyond ATTACK roll, post the native attack card (d20 total vs each target's AC → hit/miss). dnd5e's attack-card
// render reads roll.d20, whose getter requires terms[0] to be a real Die — a constant crashes it. So we build "1d20 + mod",
// roll it, then force the d20 face (to the DDB result) and the total to the exact DDB total. Hit/miss = total vs AC.
async function synthAttackCard(card) {
  try {
    if (!game.user?.isGM) return;
    if (card.kind !== 'attack') return;
    if (!game.settings.get(NS, 'ddbApplyCard')) return;
    const D20Roll = CONFIG.Dice?.D20Roll; if (!D20Roll?.toMessage) { console.warn('DDB Integrator | no D20Roll.toMessage'); return; }
    const total = Math.round(Number(card.total) || 0);
    const ac = buildNativeTargets(card.targets).find(t => t.ac != null)?.ac ?? null;
    // The d20 face: the real DDB face if we have it, else 20/1 for a known crit/fumble, else a neutral 10 (the total is forced).
    const face = Number.isFinite(card.d20) ? card.d20 : (card.nat === 20 ? 20 : card.nat === 1 ? 1 : 10);
    const mod = total - face;
    console.log('[ddbx-synth] attack card', { total, ac, face, mod });
    const roll = new D20Roll(`1d20 ${mod < 0 ? '-' : '+'} ${Math.abs(mod)}`, {}, { target: ac == null ? undefined : ac, criticalSuccess: 20, criticalFailure: 1, advantageMode: 0, rollType: 'attack' });
    await roll.evaluate();
    // Force the d20 to the DDB face (accessing roll.d20 upgrades terms[0] to a D20Die first) and pin the displayed total.
    try { const die = roll.d20; if (die?.results?.length) { die.results[0].result = face; die.results[0].active = true; delete die.results[0].discarded; } roll._total = total; } catch (e) {}
    await D20Roll.toMessage([roll], { flavor: `${card.action || 'Attack'} — Attack Roll`, speaker: speakerFor(card), flags: synthFlags(card, 'attack'), whisper: nativeWhisper() }, { create: true });
  } catch (e) { console.warn('DDB Integrator | synthAttackCard', e); }
}
// Shared dnd5e flags for a synthesized native card: roll type + targets (name/img/actor-uuid/AC), plus the real
// item/activity when the roller is a genuine actor (richer header + resistance properties); skipped for placeholders.
// The [NS].synth flag makes our own preCreateChatMessage interceptor skip it (so it isn't re-stylized / duplicated).
function synthFlags(card, type) {
  const dnd5e = { targets: buildNativeTargets(card.targets), messageType: 'roll', roll: { type } };
  const actor = card.actorId ? game.actors.get(card.actorId) : null;
  const item = actor?.items?.find?.(i => i.name === card.action) || null;
  if (item) {
    dnd5e.item = { type: item.type, id: item.id, uuid: item.uuid };
    let act = null; try { act = item.system?.activities?.contents?.[0] || (item.system?.activities ? Array.from(item.system.activities)[0] : null); } catch (e) {}
    if (act?.uuid) dnd5e.activity = { type: act.type, id: act.id, uuid: act.uuid };
  }
  return { dnd5e, [NS]: { synth: true } };
}
// Whisper list for the native cards: GMs only when "Native cards: GM only" is on (so players see only the stylized card), else public ([]).
function nativeWhisper() { try { return game.settings.get(NS, 'nativeGmOnly') ? ChatMessage.getWhisperRecipients('GM').map(u => u.id) : []; } catch (e) { return []; } }
// Build the dnd5e.targets flag (name, img, actor uuid, AC) from the captured target tokens — for the Apply tray's TARGETED tab.
function buildNativeTargets(targets) {
  const out = [];
  for (const t of (targets || [])) {
    try {
      const tok = t.id ? canvas.tokens?.get?.(t.id) : null;
      const actor = tok?.actor;
      out.push({ name: t.name || actor?.name || '', img: t.img || actor?.img || '', uuid: actor?.uuid || '', ac: actor?.system?.attributes?.ac?.value ?? null });
    } catch (e) {}
  }
  return out;
}
// Attack→damage correlation for the damage tray's pre-selected multipliers. D&D Beyond sends the attack and damage as
// SEPARATE rolls, so when an attack lands we record per-target hit/miss (vs each target's AC; nat 20 always hits / nat 1
// always misses); the FOLLOWING damage roll reads it to pre-set ×0 for any target the attack missed. Consumed on read so
// a later save-spell on the same token isn't wrongly zeroed; ignored if older than two minutes.
let _attackHits = new Map(), _attackHitsAt = 0;
function recordAttackHits(card) {
  try {
    const hits = new Map();
    for (const nt of buildNativeTargets(card.targets)) {
      if (!nt.uuid) continue;
      const hit = card.nat === 20 ? true : card.nat === 1 ? false : (nt.ac == null ? true : Number(card.total) >= Number(nt.ac));
      hits.set(nt.uuid, hit);
    }
    if (hits.size) { _attackHits = hits; _attackHitsAt = Date.now(); }
  } catch (e) {}
}
// ×0 multipliers for targets the most recent attack MISSED (resistance/vulnerability is left to dnd5e's own trait math).
function missedMultipliers(card) {
  const out = [];
  try {
    if (!game.settings.get(NS, 'autoConfirmHits')) return out;   // verdict off → don't auto-zero missed targets on the tray either
    if (!_attackHits.size || (Date.now() - _attackHitsAt) > 120000) return out;   // no recent attack → don't pre-zero
    for (const nt of buildNativeTargets(card.targets)) {
      if (nt.uuid && _attackHits.get(nt.uuid) === false) out.push({ uuid: nt.uuid, multiplier: 0 });
    }
    // NOT consumed: a multi-type hit makes several native trays (one per type), and each needs the same ×0 set. Staleness
    // is bounded by the 120s window + the next attack overwriting _attackHits.
  } catch (e) {}
  return out;
}

/* --------------------------------------------------------------- receive: D&D Beyond rolls */
// A WebSocket dice-roll event → ONE unified card. Classifies the roll kind from rollType/action.
async function renderRoll(data) {
  const roll = data.rolls?.[0] || {};
  const rt = (roll.rollType || '').toLowerCase();
  const action = data.action || 'Roll';
  const actor = resolveActor(data);
  const ctx = resolveAction(actor, action);
  const rollerName = actor?.name || data.context?.name || 'D&D Beyond';
  const isCustom = rt === 'custom' || /^custom$/i.test(String(action || ''));
  const genLabel = (isCustom && ddbNotation(roll)) ? ddbNotation(roll) : titleCase(action || rt);
  // Kind classification.
  let kind = 'other', ability = null;
  const isInit = rt === 'initiative' || /\binitiative\b/i.test(action);
  const isDeath = rt === 'death' || /death\s*saving\s*throw/i.test(action);
  if (rt === 'to hit') kind = 'attack';
  else if (rt === 'damage' || rt === 'heal' || ctx.isHeal) kind = 'damage';
  else if (isInit) kind = 'init';
  else if (isDeath) kind = 'death';
  else if (rt === 'save') { kind = 'save'; ability = checkAbilityFromName(action); }
  else { kind = 'check'; ability = checkAbilityFromName(action); }
  const checkAb = ability || (kind === 'check' ? checkAbilityFromName(action) : null);
  const img = (kind === 'check' || kind === 'save') ? (abilityIcon(checkAb) || ctx.img) : ctx.img;
  const label = kind === 'save' && checkAb ? `${abilityLabel(checkAb)} Save` : (isCustom ? genLabel : (action || genLabel));
  return present({
    who: rollerName, action: label, actorId: actor?.id || null,
    kind, heal: ctx.isHeal || rt === 'heal', ability: checkAb,
    total: Number(roll.result?.total ?? 0), nat: natFace(roll), d20: ddbD20Face(roll),
    damageType: ctx.damageType, damageTypes: ctx.damageTypes,
    dice: ddbDice(roll), advKind: roll.rollKind || '', formula: ddbFormula(roll), img, ddb: true,
  });
}

/* --------------------------------------------------------------- receive: local Foundry rolls */
// A native dnd5e roll message (made inside Foundry) → the SAME unified card. The native card
// is suppressed by the preCreateChatMessage hook; here we render ours.
function renderLocalMessage(message, keepNative) {
  const f = message.flags?.dnd5e; if (!f || f.messageType !== 'roll') return;
  const roll = message.rolls?.[0]; if (!roll) return;
  const rtype = f.roll?.type;
  let actor = message.speaker?.actor ? game.actors.get(message.speaker.actor) : null;
  if (!actor && message.speaker?.token) { try { actor = (message.speaker.scene ? game.scenes.get(message.speaker.scene) : canvas.scene)?.tokens?.get(message.speaker.token)?.actor; } catch (e) {} }
  let item = null; try { item = f.item?.uuid ? fromUuidSync(f.item.uuid) : null; } catch (e) {}
  const action = item?.name || (message.flavor || '').split(' - ')[0].trim() || rtype || 'Roll';
  const who = actor?.name || message.alias || action;
  const d20 = roll.dice?.find(d => d.faces === 20)?.results?.map(x => x.result) || null;
  const nat = d20 ? (d20.includes(20) ? 20 : (d20.length === 1 && d20[0] === 1 ? 1 : null)) : null;
  const ctx = resolveAction(actor, action);
  // Kind classification.
  let kind = 'other';
  if (rtype === 'attack') kind = 'attack';
  else if (rtype === 'damage' || rtype === 'heal' || ctx.isHeal) kind = 'damage';
  else if (rtype === 'initiative') kind = 'init';
  else if (rtype === 'death') kind = 'death';
  else if (rtype === 'save') kind = 'save';
  else kind = 'check';
  const r = f.roll || {};
  const skillId = r.skill || (kind === 'check' ? skillFromText(message.flavor || action) : null);
  let ability = r.ability || null;
  if (!ability && skillId) ability = CONFIG.DND5E?.skills?.[skillId]?.ability;
  if (!ability && r.tool) ability = CONFIG.DND5E?.tools?.[r.tool]?.ability || 'int';
  if (!ability && kind === 'check') ability = checkAbilityFromName(action);
  if (!ability && kind === 'save') ability = checkAbilityFromName(action);
  const label = skillId ? (CONFIG.DND5E?.skills?.[skillId]?.label || action)
    : (kind === 'save' && ability) ? `${abilityLabel(ability)} Saving Throw`
    : (kind === 'check' && ability) ? `${abilityLabel(ability)} Check`
    : (rtype === 'skill') ? ((message.flavor || '').split(' - ')[0].trim() || 'Skill Check')
    : (kind === 'init' || kind === 'death') ? titleCase(rtype)
    : (action || titleCase(rtype));
  const img = (kind === 'check' || kind === 'save') ? (abilityIcon(ability) || ctx.img || item?.img || '') : (ctx.img || item?.img || '');
  // Native card is normally suppressed, so animate the dice ourselves (skip if the GM keeps native cards — its own
  // Dice So Nice would already show them, and re-showing would double the dice).
  try { if (!keepNative && game.dice3d) game.dice3d.showForRoll(roll, game.user, true); } catch (e) {}
  // Local damage can carry MULTIPLE types in one message (a monster's multi-type attack), so split it per type up front.
  const healFlag = ctx.isHeal || rtype === 'heal';
  const dmgParts = (kind === 'damage' && !healFlag) ? damagePartsFromRolls(message.rolls) : null;
  const total = (dmgParts && dmgParts.length) ? dmgParts.reduce((s, p) => s + p.value, 0) : Number(roll.total ?? 0);
  present({
    who, action: label, actorId: actor?.id || null,
    kind, heal: healFlag, ability: (kind === 'check' || kind === 'save') ? ability : null,
    total, nat,
    damageType: ctx.damageType, damageTypes: ctx.damageTypes, damageParts: dmgParts && dmgParts.length ? dmgParts : undefined,
    dice: null, advKind: '', formula: roll.formula, img,
  });
}

/* ------------------------------------------------------------- socket tap */
function onRaw(ev) {
  let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
  if (typeof msg?.eventType !== 'string' || !msg.eventType.startsWith('dice/roll')) return;
  const data = msg.data || msg; const rollId = data.rollId || msg.id;
  if (!rollId || seen.has(rollId)) return; seen.set(rollId, Date.now());
  if (!data.rolls?.length) return;
  renderRoll(data).catch(e => console.error('DDB Integrator | renderRoll', e));
}
// Small GM-only chip showing the live D&D Beyond link status. Click to reconnect.
let _connEl = null;
function setDdbStatus(state, detail) {
  try {
    if (!game.user?.isGM) return;
    if (!_connEl) {
      _connEl = document.createElement('div'); _connEl.className = 'ddbx-conn';
      _connEl.innerHTML = `<span class="dot"></span><span class="lbl">DDB</span>`;
      _connEl.addEventListener('click', () => { try { setDdbStatus('connecting', 'Reconnecting…'); reconnect(); } catch (e) {} });
      (document.getElementById('interface') || document.body).appendChild(_connEl);
    }
    _connEl.classList.remove('ok', 'warn', 'down');
    _connEl.classList.add(state === 'connected' ? 'ok' : state === 'connecting' ? 'warn' : 'down');
    _connEl.querySelector('.lbl').textContent = state === 'connected' ? 'DDB' : state === 'connecting' ? 'DDB…' : 'DDB ✕';
    _connEl.title = detail || (state === 'connected' ? 'D&D Beyond link active — click to reconnect' : state === 'connecting' ? 'Connecting to D&D Beyond…' : 'D&D Beyond link down — click to reconnect');
  } catch (e) {}
}

/* ---------------------------------------------------- standalone DDB connection */
// Token-mint approach adapted from ddb-sync (MIT, AshDarkley): mint an stt token via ddb-proxy
// from the CobaltSession cookie, then open the DDB game-log WebSocket. The token expires
// (~5 min) and DDB recycles the serverless socket, so reconnect re-mints. We only consume
// dice rolls. This module ALWAYS owns its own socket — no ddb-sync coexistence.
class DdbSocket {
  constructor(cfg) { this.cfg = cfg; this.ws = null; this.token = null; this.attempts = 0; this.max = 12; this.delay = 600; this.closed = false; this.authFailed = false; }
  async mintToken() {
    try {
      const r = await fetch(`${this.cfg.proxyUrl}/proxy/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cobalt: this.cfg.cobaltCookie }) });
      if (!r.ok) {
        // 401/403 = bad/expired cookie → don't retry-spam. Other codes (502/503 etc.) = a sleeping free-tier server → transient, retry.
        if (r.status === 401 || r.status === 403) { ui.notifications.error('DDB Integrator: CobaltSession cookie expired or invalid — update it in settings.'); this.authFailed = true; return null; }
        console.error('DDB Integrator | token mint HTTP', r.status); return null;
      }
      const d = await r.json(); return d.token || null;
    } catch (e) { console.error('DDB Integrator | token mint failed (server waking?)', e); return null; }
  }
  async connect() {
    this.closed = false;
    setDdbStatus('connecting', isHosted() ? 'Connecting — the shared server can take ~30–60s to wake on first use…' : 'Connecting…');
    this.token = await this.mintToken();
    if (!this.token) {
      // A failed mint in Hosted mode is usually a cold (sleeping) free-tier proxy — keep retrying instead of giving up.
      if (!this.closed && !this.authFailed && this.attempts < this.max) { this.scheduleReconnect(); return; }
      ui.notifications.warn(`DDB Integrator: could not authenticate with D&D Beyond — ${isHosted() ? 'check your cookie, or the shared server may be down; try Reconnect shortly.' : 'check the cobalt cookie / proxy URL.'}`);
      setDdbStatus('down', isHosted() ? 'Couldn’t reach the shared server — click to retry.' : 'Authentication failed — check the cobalt cookie / proxy URL.');
      return;
    }
    const url = `wss://game-log-api-live.dndbeyond.com/v1?gameId=${this.cfg.campaignId}&userId=${this.cfg.userId}&stt=${this.token}`;
    try { this.ws = new WebSocket(url); } catch (e) { console.error('DDB Integrator | ws create failed', e); this.scheduleReconnect(); return; }
    this.ws.onopen = () => { this.attempts = 0; this.send({ type: 'authenticate', data: { token: this.token, campaignId: this.cfg.campaignId } }); console.log('DDB Integrator | DDB socket connected'); };
    this.ws.onmessage = (e) => this.onMsg(e);
    this.ws.onerror = (e) => console.error('DDB Integrator | ws error', e);
    this.ws.onclose = (e) => { if (!this.closed && e.code !== 1000) this.scheduleReconnect(); };
  }
  onMsg(e) {
    let m; try { m = JSON.parse(e.data); } catch (x) { return; }
    if (m?.eventType === 'authenticated') { setDdbStatus('connected', 'D&D Beyond link active — click to reconnect'); this.send({ type: 'subscribe', data: { event: 'character.update', campaignId: this.cfg.campaignId } }); return; }
    onRaw(e); // dice rolls → our renderer (ignores everything non-dice)
  }
  send(d) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(typeof d === 'string' ? d : JSON.stringify(d)); }
  scheduleReconnect() { if (this.attempts >= this.max) { console.error('DDB Integrator | max reconnect attempts'); setDdbStatus('down', 'D&D Beyond link lost — click to retry.'); return; } this.attempts++; setDdbStatus('connecting', isHosted() ? `Waking the shared server (attempt ${this.attempts})…` : `Reconnecting to D&D Beyond (attempt ${this.attempts})…`); setTimeout(() => { if (!this.closed) this.connect(); }, this.delay * this.attempts); }
  disconnect() { this.closed = true; if (this.ws) { try { this.ws.close(1000, 'manual'); } catch (e) {} this.ws = null; } }
}
// The shared XtraPklz-hosted ddb-proxy (Hosted mode — zero setup). Update here if the host ever changes.
const HOSTED_PROXY = 'https://ddb-proxy-0q1p.onrender.com';
function connMode() { try { return game.settings.get(NS, 'connectionMode') || 'hosted'; } catch (e) { return 'hosted'; } }
function isHosted() { return connMode() !== 'local'; }
// The proxy URL actually used: the baked-in shared server in Hosted mode, or the GM's own in Local mode.
function effectiveProxyUrl() { return isHosted() ? HOSTED_PROXY : (game.settings.get(NS, 'proxyUrl') || '').replace(/\/+$/, ''); }
function startOwnSocket() {
  if (!game.settings.get(NS, 'enabled')) { console.log('DDB Integrator | connection disabled in settings'); return; }
  const cfg = { cobaltCookie: game.settings.get(NS, 'cobaltCookie'), proxyUrl: effectiveProxyUrl(), campaignId: game.settings.get(NS, 'campaignId'), userId: game.settings.get(NS, 'userId') };
  if (!cfg.cobaltCookie || !cfg.campaignId || !cfg.userId || (!isHosted() && !cfg.proxyUrl)) { ui.notifications.warn(`DDB Integrator: connection not set up — need your cobalt cookie, campaign, username${isHosted() ? '' : ', and a Local proxy URL'}. Use the "Get / paste my cookie" button in settings.`); return; }
  ddbSocket?.disconnect();
  ddbSocket = new DdbSocket(cfg);
  ddbSocket.connect();
}
function reconnect() { ddbSocket?.disconnect(); startOwnSocket(); }
// Fetch the player characters in the configured campaign from D&D Beyond (via the proxy's /proxy/campaigns).
async function fetchCampaignCharacters() {
  const proxyUrl = effectiveProxyUrl();
  const cobalt = game.settings.get(NS, 'cobaltCookie');
  const campaignId = String(game.settings.get(NS, 'campaignId') || '');
  if (!proxyUrl || !cobalt) { ui.notifications.warn('DDB Integrator: set Proxy URL and CobaltSession cookie first.'); return []; }
  try {
    const r = await fetch(`${proxyUrl}/proxy/campaigns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cobalt }) });
    const j = await r.json();
    if (!j.success) { ui.notifications.error('DDB Integrator: ' + (j.message || 'campaign fetch failed')); return []; }
    const camps = j.data || [];
    const camp = camps.find(c => String(c.id) === campaignId);
    if (!camp) { ui.notifications.warn(`DDB Integrator: campaign ${campaignId} not found in your DDB campaigns.`); return []; }
    const chars = (camp.characters || []).map(c => ({ id: String(c.characterId ?? c.id ?? ''), name: c.characterName || c.name || '(unnamed)' })).filter(c => c.id);
    if (!chars.length) ui.notifications.warn('DDB Integrator: no characters listed for this campaign.');
    return chars;
  } catch (e) { console.error('DDB Integrator | campaign fetch', e); ui.notifications.error('DDB Integrator: campaign fetch error (see console).'); return []; }
}
function pcActorByName(name) { const n = String(name || '').toLowerCase().trim(); return game.actors.find(a => a.type === 'character' && a.name.toLowerCase().trim() === n)?.id || ''; }

/* ---------------------------------------------------- character-mapping editor */
class MappingApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: 'ddbx-int-mapping', tag: 'div', window: { title: 'DDB Integrator — Character Mapping', icon: 'fas fa-people-arrows' }, position: { width: 580, height: 'auto' } };
  constructor(opts) { super(opts); this.rows = null; }
  _seed() { if (this.rows) return; this.rows = Object.entries(getMapping()).map(([ddb, actorId]) => ({ ddb, name: game.actors.get(actorId)?.name || '', actorId })); }
  _actorOptions(sel) { const pcs = game.actors.filter(a => a.type === 'character').sort((a, b) => a.name.localeCompare(b.name)); return `<option value="">— select actor —</option>` + pcs.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join(''); }
  async _renderHTML() {
    this._seed();
    const rows = this.rows.map((r, i) => `<tr data-i="${i}">
      <td><input class="r-ddb" value="${esc(r.ddb || '')}" placeholder="DDB id" style="width:120px"></td>
      <td class="r-name" style="font-size:11px;opacity:.8">${esc(r.name || '')}</td>
      <td><select class="r-actor" style="width:100%">${this._actorOptions(r.actorId)}</select></td>
      <td style="text-align:center"><a class="r-del" title="Remove"><i class="fas fa-trash"></i></a></td></tr>`).join('');
    return `<div style="padding:8px 10px">
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <button type="button" class="m-fetch"><i class="fas fa-cloud-arrow-down"></i> Fetch players from D&D Beyond</button>
        <button type="button" class="m-add"><i class="fas fa-plus"></i> Add row</button>
      </div>
      <table style="width:100%"><thead><tr><th style="text-align:left">DDB ID</th><th style="text-align:left">DDB name</th><th style="text-align:left">Foundry actor</th><th></th></tr></thead><tbody class="m-body">${rows || ''}</tbody></table>
      <p style="font-size:11px;opacity:.65;margin:6px 0">Fetch pulls your campaign's players (by Campaign ID) and auto-matches by name. Adjust dropdowns, then Save. Rolls also resolve by name automatically — mapping is only needed when names differ.</p>
      <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:6px">
        <button type="button" class="m-cancel">Cancel</button>
        <button type="button" class="m-save"><i class="fas fa-check"></i> Save</button></div></div>`;
  }
  async _replaceHTML(result, content) { content.innerHTML = result; this._wire(content); }
  _collect(root) { const body = root.querySelector('.m-body'); if (!body) return; this.rows = Array.from(body.querySelectorAll('tr')).map(tr => ({ ddb: tr.querySelector('.r-ddb')?.value.trim() || '', name: tr.querySelector('.r-name')?.textContent || '', actorId: tr.querySelector('.r-actor')?.value || '' })); }
  _wire(root) {
    root.querySelector('.m-fetch')?.addEventListener('click', async () => {
      this._collect(root); ui.notifications.info('DDB Integrator: fetching campaign players…');
      const chars = await fetchCampaignCharacters();
      for (const c of chars) { const ex = this.rows.find(r => r.ddb === c.id); if (ex) ex.name = c.name; else this.rows.push({ ddb: c.id, name: c.name, actorId: pcActorByName(c.name) }); }
      this.render();
    });
    root.querySelector('.m-add')?.addEventListener('click', () => { this._collect(root); this.rows.push({ ddb: '', name: '', actorId: '' }); this.render(); });
    root.querySelectorAll('.r-del').forEach(a => a.addEventListener('click', (e) => { this._collect(root); const i = Number(e.currentTarget.closest('tr')?.dataset.i); if (!Number.isNaN(i)) this.rows.splice(i, 1); this.render(); }));
    root.querySelector('.m-cancel')?.addEventListener('click', () => this.close());
    root.querySelector('.m-save')?.addEventListener('click', async () => {
      this._collect(root); const out = {}; for (const r of this.rows) if (r.ddb && r.actorId) out[r.ddb] = r.actorId;
      await game.settings.set(NS, 'characterMapping', out); ui.notifications.info(`DDB Integrator: saved ${Object.keys(out).length} mapping(s).`); this.close();
    });
  }
}
function editMapping() { new MappingApp().render(true); }

/* ---------------------------------------------------- guided cobalt-cookie helper
   Browsers (rightly) hide the HttpOnly CobaltSession cookie from all page scripts — it can't be auto-grabbed. This
   walks the GM through the 30-second copy: open D&D Beyond, DevTools → Application → Cookies → copy, paste, save. */
function editCookie() { try { new CookieApp().render(true); } catch (e) { console.warn('DDB Integrator | cookie helper', e); } }
class CookieApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: 'ddbx-int-cookie', tag: 'div', window: { title: 'DDB Integrator — Get your D&D Beyond cookie', icon: 'fas fa-cookie-bite' }, position: { width: 540, height: 'auto' } };
  async _renderHTML() {
    const cur = (() => { try { return game.settings.get(NS, 'cobaltCookie') || ''; } catch (e) { return ''; } })();
    return `<div style="padding:10px 12px;line-height:1.5">
      <p style="margin:0 0 8px">Your <b>CobaltSession</b> cookie is your D&amp;D Beyond login. Browsers keep it hidden from scripts, so it can't be grabbed automatically — but copying it takes about 30 seconds:</p>
      <div style="margin:8px 0"><button type="button" class="c-open"><i class="fas fa-up-right-from-square"></i> Open D&amp;D Beyond (log in first)</button></div>
      <ol style="margin:6px 0 10px;padding-left:20px">
        <li>On the D&amp;D Beyond tab, open the browser dev tools: <b>F12</b> (Windows) or <b>⌥⌘I</b> (Mac).</li>
        <li>Open the <b>Application</b> tab → in the left sidebar, <b>Cookies</b> → <b>https://www.dndbeyond.com</b>.</li>
        <li>Click the <b>CobaltSession</b> row and copy its <b>Value</b> (the long string).</li>
        <li>Paste it below and hit <b>Save &amp; connect</b>.</li>
      </ol>
      <textarea class="c-val" rows="3" placeholder="Paste the CobaltSession value here…" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:11px">${esc(cur)}</textarea>
      <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px">
        <button type="button" class="c-cancel">Cancel</button>
        <button type="button" class="c-save"><i class="fas fa-check"></i> Save &amp; connect</button></div></div>`;
  }
  async _replaceHTML(result, content) { content.innerHTML = result; this._wire(content); }
  _wire(root) {
    root.querySelector('.c-open')?.addEventListener('click', () => { try { window.open('https://www.dndbeyond.com/', '_blank', 'noopener'); } catch (e) {} });
    root.querySelector('.c-cancel')?.addEventListener('click', () => this.close());
    root.querySelector('.c-save')?.addEventListener('click', async () => {
      const v = (root.querySelector('.c-val')?.value || '').trim();
      if (!v) { ui.notifications.warn('DDB Integrator: paste your CobaltSession value first.'); return; }
      await game.settings.set(NS, 'cobaltCookie', v);
      ui.notifications.info('DDB Integrator: cookie saved — connecting…');
      this.close(); try { reconnect(); } catch (e) {}
    });
  }
}

/* ----------------------------------------------------------- sound cues */
// The module ships SILENT — no audio is bundled or fetched from anywhere. Every cue defaults to "" (no sound);
// the GM assigns their own files in the "Sound Effects" submenu. All sound state (on/off, volume, and one file
// per cue) lives in a single per-client `soundConfig` object — nothing sits on the main settings page.
// Five "key" cues fire on a roll's outcome…
const SOUND_KEY_CUES = [
  ['roll', 'Any roll lands'],
  ['crit', 'Natural 20'],
  ['fumble', 'Natural 1'],
  ['damage', 'Damage roll (generic)'],
  ['heal', 'Healing roll'],
];
// …plus a file per damage type, so a damage roll can sound off its OWN element (else it falls back to "damage").
const DAMAGE_TYPES = ['slashing', 'piercing', 'bludgeoning', 'fire', 'cold', 'lightning', 'thunder', 'acid', 'poison', 'necrotic', 'radiant', 'psychic', 'force'];
// The flat list that drives the submenu form: [cue id, friendly label].
const SOUND_EVENTS = [...SOUND_KEY_CUES, ...DAMAGE_TYPES.map(t => ['dmg.' + t, `Damage · ${t}`])];
// Normalize a damage-type string to a known dmg.<type> key (else falls through to the generic 'damage' cue).
function dmgKey(t) { t = String(t || '').toLowerCase(); return DAMAGE_TYPES.includes(t) ? t : ''; }
// Read the single sound-config object: { on:bool, volume:number, <cue>:url, ... }. Cues default to "" (silent).
function soundCfg() { try { return game.settings.get(NS, 'soundConfig') || {}; } catch (e) { return {}; } }
function soundOn() { const c = soundCfg(); return c.on !== false; }   // default ON, like the old per-client toggle
// Resolve a cue id to its configured file path. A 'dmg.<type>' cue falls back to the generic 'damage' cue when unset.
function soundFor(cue) {
  if (!cue) return '';
  const cfg = soundCfg();
  let url = cfg[cue];
  if (!url && cue.startsWith('dmg.')) url = cfg['damage'];
  return String(url || '');
}
function playCueSound(url) {
  try {
    if (!url) return;
    let vol = 0.5; const c = soundCfg(); const v = Number(c.volume); if (Number.isFinite(v) && v >= 0) vol = v;
    const AH = foundry.audio?.AudioHelper || globalThis.AudioHelper;
    AH?.play?.({ src: url, volume: vol, autoplay: true, loop: false, channel: 'environment' }, false);
  } catch (e) { console.warn('DDB Integrator | sound', e); }
}
// Damage-type → theme hue for the impact cinematic (purely cosmetic colouring of the flourish).
function damageHue(t) { t = String(t || '').toLowerCase(); if (/fire/.test(t)) return 22; if (/cold/.test(t)) return 195; if (/light/.test(t)) return 55; if (/acid/.test(t)) return 95; if (/poison/.test(t)) return 110; if (/necro/.test(t)) return 280; if (/radiant/.test(t)) return 48; if (/psychic/.test(t)) return 300; if (/force/.test(t)) return 265; if (/thunder/.test(t)) return 275; if (/slash|pierc|bludgeon/.test(t)) return 0; return 0; }
// The primary damage type from a damage chat message's rolls — for the impact's colour + sound when damage is applied.
function damageTypeFromMessage(msg) { try { for (const r of (msg?.rolls || [])) { const t = r?.options?.type; if (t) return String(t); } } catch (e) {} return ''; }
// Per-type breakdown of a set of damage rolls. Uses dnd5e's own aggregateDamageRolls (splits even a single mixed-flavor
// roll by type), falling back to one entry per roll. Powers the per-type chips on local cards + the per-type impact flashes.
function damagePartsFromRolls(rolls) {
  try {
    const agg = game.dnd5e?.dice?.aggregateDamageRolls;
    const list = agg ? agg(rolls || [], { respectProperties: false }) : (rolls || []);
    return list.map(r => ({ type: String(r?.options?.type || ''), value: Math.max(0, Math.round(Number(r?.total) || 0)) })).filter(p => p.type || p.value);
  } catch (e) {
    try { return (rolls || []).map(r => ({ type: String(r?.options?.type || ''), value: Math.max(0, Math.round(Number(r?.total) || 0)) })).filter(p => p.type || p.value); } catch (e2) { return []; }
  }
}
// What to flash per impact: one type → the APPLIED amount (post-multiplier); multiple types → each rolled per-type value.
function damagePartsFromMessage(msg, applied) {
  const typed = damagePartsFromRolls(msg?.rolls);
  if (typed.length <= 1) return [{ type: typed[0]?.type || '', value: Math.max(0, Math.round(Number(applied) || 0)) }];
  return typed;
}
// GM: when damage is APPLIED, fire the impact cinematic showing the FINAL applied amount (post ×2 / resistance) on the
// damaged target. dnd5e fires this hook ONCE PER target, so we BUFFER the burst and conduct it as one camera sequence:
// zoom to the first target, hold its overlay, then PAN (staying zoomed) to the next, and only zoom back out + re-centre on
// the attacker after the last. Each overlay waits a beat after the camera settles, so the zoom lands first.
let _applyBuf = [], _applyTimer = null, _applyAttacker = null, _applyRunning = false;
function onDamageApplied(actor, amount, options) {
  try {
    if (!game.user?.isGM) return;
    const amt = Math.round(Number(amount) || 0);
    if (amt <= 0) return;   // damage only (healing is negative)
    _applyBuf.push({
      actor, amt, token: actor?.getActiveTokens?.()?.[0] || null,
      parts: damagePartsFromMessage(options?.originatingMessage, amt),   // per-type flashes (one type → the applied amount)
      stylizedId: options?.originatingMessage?.flags?.[NS]?.stylizedId || null, multiplier: options?.multiplier,
    });
    const at = attackerTokenFromMessage(options?.originatingMessage); if (at) _applyAttacker = at;
    clearTimeout(_applyTimer); _applyTimer = setTimeout(flushApplyBuffer, 140);   // collect the per-target burst into one run
  } catch (e) { console.warn('DDB Integrator | onDamageApplied', e); }
}
// The attacker's token (to re-centre on after the last target), from the damage card's speaker.
function attackerTokenFromMessage(msg) {
  try {
    const sp = msg?.speaker; if (!sp) return null;
    if (sp.token) { const scn = sp.scene ? game.scenes.get(sp.scene) : canvas.scene; const t = scn?.tokens?.get(sp.token)?.object || canvas.tokens?.get?.(sp.token); if (t) return t; }
    if (sp.actor) { const t = game.actors.get(sp.actor)?.getActiveTokens?.()?.[0]; if (t) return t; }
  } catch (e) {}
  return null;
}
// ONE impact flash on a target (single damage type, short on-screen duration). noPan: the batch owns the camera.
function castImpact(actor, token, type, value, dur) {
  const payload = {
    phase: 'impact', kind: 'damage', total: value, dtype: type || '', heal: false, nat: null, action: '', noPan: true, dur,
    who: '', actorImg: '', img: '', hue: null,
    targetName: actor?.name || '', targetImg: actor?.img || '',
    targets: [{ name: actor?.name || '', img: actor?.img || '' }],
    applyIds: token?.id ? [token.id] : [], cue: 'dmg.' + dmgKey(type || ''),
  };
  playStinger(payload);
  try { game.socket?.emit(`module.${NS}`, { t: 'stinger', payload }); } catch (e) {}
}
// Conduct the buffered applies: zoom to each TARGET once, flash each of its damage types fast, then zoom out on the attacker.
async function flushApplyBuffer() {
  if (_applyRunning) { _applyTimer = setTimeout(flushApplyBuffer, 150); return; }   // a sequence is mid-run — retry shortly
  const items = _applyBuf.slice(); _applyBuf = [];
  const attacker = _applyAttacker; _applyAttacker = null;
  if (!items.length) return;
  for (const it of items) { if (it.stylizedId) updateStylizedDamage(it.stylizedId, it.amt, it.multiplier); }
  // Group apply events by TARGET so a multi-type hit flashes its types on one framing instead of re-zooming per type.
  const groups = [], byKey = new Map();
  for (const it of items) {
    const k = it.token?.id || it.actor?.id || ('?' + groups.length);
    let g = byKey.get(k); if (!g) { g = { token: it.token, actor: it.actor, flashes: [] }; byKey.set(k, g); groups.push(g); }
    const parts = (Array.isArray(it.parts) && it.parts.length) ? it.parts : [{ type: '', value: it.amt }];
    for (const p of parts) g.flashes.push({ type: p.type, value: p.value });
  }
  let visuals = true; try { visuals = game.settings.get(NS, 'cinematics'); } catch (e) {}
  if (!visuals) { for (const g of groups) for (const f of g.flashes) castImpact(g.actor, g.token, f.type, f.value, cineMs()); return; }
  _applyRunning = true;
  // Capture the TRUE original view ONCE, LOCALLY (pre-attack view if an attack just zoomed in, else the current view), and
  // cancel the attack impact's pending restore timer so it can't yank the camera or null the view out from under us.
  let origin = _preImpactView ? { ..._preImpactView } : null;
  if (!origin) { try { if (canvas?.ready) origin = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x }; } catch (e) {} }
  try { clearTimeout(_restoreTimer); } catch (e) {}
  _preImpactView = null;   // the batch owns the camera now
  const base = cineMs();
  try {
    for (const g of groups) {
      if (g.token) await panToTokens([g.token], 340);   // AWAIT the pan so the camera fully RESTS before the overlay (no mid-pan doubling)
      await delay(130);                                  // let it settle a beat, then reveal the portrait
      const multi = g.flashes.length > 1;
      const fdur = multi ? Math.max(430, Math.round(base * 0.28)) : Math.max(600, Math.round(base * 0.46));   // faster: a fraction of the duration setting
      for (const f of g.flashes) { castImpact(g.actor, g.token, f.type, f.value, fdur); await delay(fdur + 320); }
    }
    // Zoom back OUT to the original scale, re-centred on the triggering actor (or restore the original view if no token).
    if (attacker && origin) { try { const c = attacker.center; canvas.animatePan({ x: c.x, y: c.y, scale: origin.scale, duration: 680 }); } catch (e) {} }
    else if (origin) { try { canvas.animatePan({ ...origin, duration: 680 }); } catch (e) {} }
  } finally { clearPreImpactView(); _applyRunning = false; if (_applyBuf.length) _applyTimer = setTimeout(flushApplyBuffer, 80); }
}
// Re-render the stylized damage card with the APPLIED total (and the multiplier as a pill). Stored cardData lets us rebuild it.
async function updateStylizedDamage(msgId, applied, multiplier) {
  try {
    const msg = game.messages?.get?.(msgId); const c = msg?.flags?.[NS]?.cardData; if (!c) return;
    const mult = (Number(multiplier) && Number(multiplier) !== 1) ? Number(multiplier) : null;
    await msg.update({ content: publicCard({ ...c, total: Math.round(applied), appliedMult: mult }) });
  } catch (e) { console.warn('DDB Integrator | updateStylizedDamage', e); }
}
Hooks.on('dnd5e.applyDamage', onDamageApplied);   // fire the damage impact when the GM applies damage (post-multiplier)
// Seed the native damage tray's per-target multipliers (×0 for targets the attack missed). dnd5e's tray exposes the public
// getTargetOptions(uuid) → mutating the live options object pre-presses the matching multiplier button + recalculates the
// row total when the tray lazily builds (on scroll/open) — which always happens AFTER this render hook (verified in 5.3.3).
// We never set resistance multipliers — dnd5e applies those from the target's traits, so setting them here would double up.
// Seed ONCE per message so the GM's manual per-row tweaks aren't reset on a later re-render.
const _seededTrays = new Set();
Hooks.on('dnd5e.renderChatMessage', (message, html) => {
  try {
    const plan = message?.flags?.[NS]?.multipliers;
    if (!plan?.length || _seededTrays.has(message.id)) return;
    const root = html instanceof HTMLElement ? html : (html?.[0] || null);
    let el = root?.querySelector?.('damage-application');
    if (!el) el = document.querySelector(`[data-message-id="${message.id}"] damage-application`);
    if (!el?.getTargetOptions) return;   // GM-only element; absent for players or if the tray didn't render
    for (const { uuid, multiplier } of plan) { try { el.getTargetOptions(uuid).multiplier = multiplier; } catch (e) {} }
    _seededTrays.add(message.id);
  } catch (e) {}
});
// Damage-type → a full-screen effect wash for the impact cinematic.
function damageFx(t) { t = String(t || '').toLowerCase();
  if (/slash/.test(t)) return '<div class="ddbx-fx fx-slash"><span></span><span></span><span></span></div>';
  if (/pierc/.test(t)) return '<div class="ddbx-fx fx-pierce">' + Array.from({ length: 10 }).map((_, i) => `<span style="transform:translate(-50%,-50%) rotate(${i * 36}deg)"></span>`).join('') + '</div>';
  if (/bludgeon|force|thunder/.test(t)) return '<div class="ddbx-fx fx-burst"><span></span><span></span></div>';
  if (/fire/.test(t)) return '<div class="ddbx-fx fx-fire"></div>';
  if (/cold/.test(t)) return '<div class="ddbx-fx fx-cold"></div>';
  if (/light/.test(t)) return '<div class="ddbx-fx fx-shock"></div>';
  if (/acid|poison/.test(t)) return '<div class="ddbx-fx fx-ooze"></div>';
  if (/heal/.test(t)) return '<div class="ddbx-fx fx-heal"></div>';
  return '<div class="ddbx-fx fx-impact"></div>';
}

/* ----------------------------------------------------- sound-effects submenu */
// A small editor (mirrors the Character-Mapping / cookie apps): on/off, a volume slider, and one file field per
// cue — the five key cues plus every damage type. Browse with the file picker; preview each; all blank by default.
class SoundApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: 'ddbx-int-sounds', tag: 'div', window: { title: 'DDB Integrator — Sound Effects', icon: 'fas fa-volume-high' }, position: { width: 640, height: 'auto' } };
  async _renderHTML() {
    const cfg = soundCfg();
    const on = cfg.on !== false;
    let vol = Number(cfg.volume); if (!Number.isFinite(vol) || vol < 0) vol = 0.5;
    const row = ([cue, label]) => `<tr data-cue="${esc(cue)}">
        <td style="white-space:nowrap;padding:3px 10px 3px 0;font-size:12px">${esc(label)}</td>
        <td style="width:100%"><input class="s-url" value="${esc(cfg[cue] || '')}" placeholder="(silent — leave blank for no sound)" style="width:100%;font-size:11px"></td>
        <td><a class="s-browse" title="Browse files"><i class="fas fa-folder-open"></i></a></td>
        <td><a class="s-play" title="Preview"><i class="fas fa-play"></i></a></td></tr>`;
    const keyRows = SOUND_KEY_CUES.map(row).join('');
    const dmgRows = DAMAGE_TYPES.map(t => row(['dmg.' + t, `Damage · ${t}`])).join('');
    return `<div style="padding:8px 10px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" class="s-on" ${on ? 'checked' : ''}> Play sound cues</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px">Volume <input type="range" class="s-vol" min="0" max="1" step="0.05" value="${vol}" style="width:130px"> <span class="s-voln" style="font-size:11px;opacity:.7;min-width:28px">${Math.round(vol * 100)}%</span></label>
      </div>
      <p style="font-size:11px;opacity:.65;margin:0 0 8px">Assign your own file to any cue — browse your asset folders, ▶ to preview. Leave a field blank to keep it silent (the module bundles no audio). A damage roll uses its matching <b>damage type</b> file if set, otherwise the generic <b>Damage roll</b> cue. Saved per-user.</p>
      <table style="width:100%;border-collapse:collapse"><tbody class="s-body">${keyRows}</tbody></table>
      <h4 style="margin:12px 0 4px;font-size:12px;opacity:.8;border-bottom:1px solid rgba(255,255,255,.12);padding-bottom:3px">By damage type</h4>
      <table style="width:100%;border-collapse:collapse"><tbody class="s-body">${dmgRows}</tbody></table>
      <div style="display:flex;align-items:center;gap:6px;margin-top:10px">
        <span style="flex:1"></span>
        <button type="button" class="s-cancel">Cancel</button>
        <button type="button" class="s-save"><i class="fas fa-check"></i> Save</button></div></div>`;
  }
  async _replaceHTML(result, content) { content.innerHTML = result; this._wire(content); }
  _wire(root) {
    const FP = foundry.applications?.apps?.FilePicker?.implementation || globalThis.FilePicker;
    root.querySelector('.s-vol')?.addEventListener('input', e => { const n = root.querySelector('.s-voln'); if (n) n.textContent = `${Math.round(Number(e.currentTarget.value) * 100)}%`; });
    root.querySelectorAll('.s-browse').forEach(a => a.addEventListener('click', e => {
      const inp = e.currentTarget.closest('tr').querySelector('.s-url');
      try { new FP({ type: 'audio', current: inp.value || '', callback: p => { inp.value = p; } }).render(true); }
      catch (err) { ui.notifications.warn('DDB Integrator: could not open the file picker — paste a path instead.'); }
    }));
    root.querySelectorAll('.s-play').forEach(a => a.addEventListener('click', e => { const v = e.currentTarget.closest('tr').querySelector('.s-url').value.trim(); if (v) playCueSound(v); else ui.notifications.info('DDB Integrator: that cue is blank (silent).'); }));
    root.querySelector('.s-cancel')?.addEventListener('click', () => this.close());
    root.querySelector('.s-save')?.addEventListener('click', async () => {
      const out = { on: !!root.querySelector('.s-on')?.checked, volume: Number(root.querySelector('.s-vol')?.value) };
      root.querySelectorAll('tr[data-cue]').forEach(tr => { const v = tr.querySelector('.s-url').value.trim(); if (v) out[tr.dataset.cue] = v; });
      await game.settings.set(NS, 'soundConfig', out); ui.notifications.info('DDB Integrator: sound settings saved.'); this.close();
    });
  }
}
function editSounds() { try { new SoundApp().render(true); } catch (e) { console.warn('DDB Integrator | sound editor', e); } }

/* ---------------------------------------------------- cinematic phase stinger */
// Average-color → hue, so each action's stinger themes itself off its own art.
function rgbToHue(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return null; let h; if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; return ((Math.round(h * 60)) + 360) % 360; }
// Hue of the most saturated (vivid) pixel in the art — more representative than an average.
function imgHue(src) { return new Promise(res => { if (!src) return res(null); const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => { try { const S = 24; const cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d'); x.drawImage(img, 0, 0, S, S); const d = x.getImageData(0, 0, S, S).data; let bestSat = -1, bestHue = null; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 60) continue; const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, dl = mx - mn; if (l < 0.12 || l > 0.92) continue; const s = dl === 0 ? 0 : dl / (1 - Math.abs(2 * l - 1)); if (s > bestSat) { bestSat = s; bestHue = rgbToHue(d[i], d[i + 1], d[i + 2]); } } res(bestHue); } catch (e) { res(null); } }; img.onerror = () => res(null); img.src = src; }); }
// Build an already-evaluated Roll with the exact DDB dice values so Dice So Nice animates the real result.
function forcedRoll(dice) {
  try {
    const T = foundry.dice?.terms || {}; const DieT = T.Die || globalThis.Die; const Op = T.OperatorTerm || globalThis.OperatorTerm; const Num = T.NumericTerm || globalThis.NumericTerm;
    if (!DieT || !dice?.sets?.length) return null;
    const terms = []; let total = 0;
    for (const s of dice.sets) {
      if (!s.values.length) continue;
      if (terms.length) { const op = new Op({ operator: '+' }); op._evaluated = true; terms.push(op); }
      const d = new DieT({ number: s.values.length, faces: s.faces });
      d.results = s.values.map(v => ({ result: v, active: true })); d._evaluated = true;
      terms.push(d); total += s.values.reduce((a, b) => a + b, 0);
    }
    if (!terms.length) return null;
    if (dice.mod) { const op = new Op({ operator: '+' }); op._evaluated = true; terms.push(op); const num = new Num({ number: dice.mod }); num._evaluated = true; terms.push(num); total += dice.mod; }
    const roll = Roll.fromTerms(terms); roll._evaluated = true; roll._total = total;
    return roll;
  } catch (e) { console.warn('DDB Integrator | forcedRoll', e); return null; }
}
// Animate the exact DDB dice via Dice So Nice (synchronized to all clients).
async function dsnRoll(dice) { try { if (!game.dice3d || !dice) return; const roll = forcedRoll(dice); if (roll) await game.dice3d.showForRoll(roll, game.user, true); } catch (e) { console.warn('DDB Integrator | dsn', e); } }
const TONE_HUE = { crit: 45, critmiss: 352, hit: 140, miss: 0, gen: 210 };

// Lift the Dice So Nice canvas above the cinematic so the 3D dice render on top of it.
function liftDice(on) {
  try {
    const c = document.getElementById('dice-box-canvas') || document.querySelector('canvas#dice-box-canvas, .dice-box-canvas');
    if (c) c.style.zIndex = on ? '100000' : '';
  } catch (e) {}
}
// Zoom + pan the canvas to frame the target token during the impact cinematic, then drift back. READ-ONLY: this
// only moves the camera (canvas.animatePan) — it never touches token or actor data. Resolves the token by its id.
let _preImpactView = null, _restoreTimer = null;
const delay = (ms) => new Promise(r => setTimeout(r, ms));
// Resolve token placeables from token-ids OR actor-ids.
function resolveTokens(ids) {
  const toks = [], seen = new Set();
  for (const id of new Set(ids || [])) {
    const byTok = canvas.tokens?.get?.(id);
    if (byTok) { if (!seen.has(byTok.id)) { seen.add(byTok.id); toks.push(byTok); } continue; }
    for (const t of (canvas.tokens?.placeables || [])) { if (t.actor?.id === id && !seen.has(t.id)) { seen.add(t.id); toks.push(t); } }
  }
  return toks;
}
// Pan/zoom the canvas to frame the given tokens (read-only camera move; no store, no auto-restore).
function panToTokens(toks, duration = 480) {
  try {
    if (!canvas?.ready || !(toks || []).length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of toks) { const c = t.center, r = Math.max(t.w, t.h) * 0.5; minX = Math.min(minX, c.x - r); maxX = Math.max(maxX, c.x + r); minY = Math.min(minY, c.y - r); maxY = Math.max(maxY, c.y + r); }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const pad = 2.6;
    const scale = Math.max(0.25, Math.min(1.7, Math.min(window.innerWidth / (bw * pad), window.innerHeight / (bh * pad))));
    // Return the animation promise so callers can AWAIT the pan settling before revealing an overlay (.catch so an
    // interrupted pan never rejects the await).
    const pr = canvas.animatePan({ x: cx, y: cy, scale, duration });
    return (pr && pr.catch) ? pr.catch(() => {}) : pr;
  } catch (e) {}
}
function storePreImpactView() { try { if (canvas?.ready && !_preImpactView) _preImpactView = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x }; } catch (e) {} }
function clearPreImpactView() { _preImpactView = null; }
// Single-shot impact pan (the ATTACK roll-time impact): zoom to the targets, auto-restore the prior view shortly after.
function panToImpactByActors(ids) {
  try {
    const toks = resolveTokens(ids); if (!toks.length) return;
    storePreImpactView();
    panToTokens(toks);
    clearTimeout(_restoreTimer);
    _restoreTimer = setTimeout(() => { try { if (_preImpactView) { canvas.animatePan({ ..._preImpactView, duration: 620 }); _preImpactView = null; } } catch (e) {} }, Math.max(1400, cineMs()));
  } catch (e) {}
}
// Briefly shake Foundry's game board for an impact (a CSS transform burst — no data change).
let _shakeTimer = null;
function shakeScreen(level) {
  try {
    const el = document.getElementById('board') || document.getElementById('interface') || document.getElementById('canvas');
    if (!el) return;
    const cls = `ddbx-shake-${level || 'med'}`;
    el.classList.remove('ddbx-shake-soft', 'ddbx-shake-med', 'ddbx-shake-hard');
    void el.offsetWidth; el.classList.add(cls);
    clearTimeout(_shakeTimer); _shakeTimer = setTimeout(() => el.classList.remove(cls), 700);
  } catch (e) {}
}
// UI-SAFE POSITIONING — size a cinematic overlay to the OPEN CANVAS rectangle so it never covers the GM's UI
// (left scene controls, right sidebar, bottom hotbar, top nav). Measures those chrome elements' bounding rects and
// insets the overlay clear of them; sensible fallbacks if any are missing/collapsed. Applied on ALL clients (clean
// for the GM, still fully visible to players — players just have little/no chrome to clear). The element keeps
// pointer-events:none so it never blocks a click. Falls back to the full viewport if anything goes wrong.
function uiSafeRect() {
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  let left = 0, top = 0, right = vw, bottom = vh;
  try {
    // Only count a chrome element if it's actually visible on screen (not hidden/collapsed/zero-size).
    const shown = el => { if (!el) return false; try { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false; } catch (e) {} const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4; };
    const pick = (...ids) => { for (const id of ids) { const el = document.getElementById(id); if (shown(el)) return el.getBoundingClientRect(); } return null; };
    const L = pick('ui-left', 'controls');                 // left scene controls
    // Right sidebar / chat drawer — the LEFTMOST right-hugging visible panel (skins vary in id; a chat popout can sit
    // further left than the rail, and that's the edge we must clear so the ✕ isn't buried under it).
    let R = null;
    for (const id of ['ui-right', 'sidebar', 'chat', 'chat-notifications', 'chat-popout']) { const el = document.getElementById(id); if (shown(el)) { const r = el.getBoundingClientRect(); if (r.right >= vw - 4 && (!R || r.left < R.left)) R = r; } }
    const B = pick('ui-bottom', 'hotbar');                  // bottom hotbar / players
    const T = pick('navigation', 'ui-top', 'scene-navigation'); // top scene nav
    // Inset only from the edge each panel hugs (the chrome lines the viewport sides).
    if (L && L.left <= 4) left = Math.max(left, L.right);
    if (R && R.right >= vw - 4) right = Math.min(right, R.left);
    if (T && T.top <= 4) top = Math.max(top, T.bottom);
    if (B && B.bottom >= vh - 4) bottom = Math.min(bottom, B.top);
  } catch (e) {}
  // Guard against a degenerate/inverted rect (e.g. chrome that fills the screen) → fall back to the full viewport.
  if (!(right - left > 80) || !(bottom - top > 80)) { left = 0; top = 0; right = vw; bottom = vh; }
  return { left, top, width: right - left, height: bottom - top };   // the BACKGROUND fills this; content is inset separately (--ci-*)
}
// Pin a cinematic wrap into the UI-safe canvas rectangle. The wrap is inserted right after #board (a possibly
// transformed/contained block), so we measure its own offset and correct for it — the same trick the single-roll
// stinger already used, now centralised and inset to the canvas so the chrome stays clear.
function fitCinematic(wrap) {
  try {
    const rect = uiSafeRect();
    wrap.style.right = ''; wrap.style.bottom = '';
    wrap.style.left = rect.left + 'px'; wrap.style.top = rect.top + 'px';
    wrap.style.width = rect.width + 'px'; wrap.style.height = rect.height + 'px';
    const r = wrap.getBoundingClientRect();
    // Correct any offset the containing block introduced so the overlay lands exactly on the target rect.
    const dx = rect.left - r.left, dy = rect.top - r.top;
    if (Math.abs(dx) > 0.5) wrap.style.left = (rect.left + dx) + 'px';
    if (Math.abs(dy) > 0.5) wrap.style.top = (rect.top + dy) + 'px';
  } catch (e) {
    try { wrap.style.left = '0px'; wrap.style.top = '0px'; wrap.style.width = '100vw'; wrap.style.height = '100vh'; } catch (e2) {}
  }
}
// Re-fit any on-screen cinematic when the sidebar / chat drawer toggles, so a persistent one (Group / Initiative) stays
// clear of it — the ✕ shouldn't get buried when the chat opens mid-cinematic.
Hooks.on('collapseSidebar', () => { try { document.querySelectorAll('.ddbx-sting').forEach(el => fitCinematic(el)); } catch (e) {} });
// Cinematics are SERIALIZED through a queue so a new one can never render on top of one already on screen.
let _stQ = [], _stBusy = false;
function playStinger(p) { try { if (!p) return; if (GroupRoll.active && game.user?.isGM) return; _stQ.push(p); pumpStingers(); } catch (e) {} }
// Single-roll cinematic on-screen time (ms), from the GM-set "Cinematic duration" setting. Clamped to a sane floor.
function cineMs() { try { return Math.max(800, Math.round((Number(game.settings.get(NS, 'cinematicDuration')) || 3.5) * 1000)); } catch (e) { return 3500; } }
function pumpStingers() {
  // Hard stop: while a Group Check / Contest is live, that cinematic owns the screen — never pump a single-roll one.
  if (GroupRoll.active && game.user?.isGM) { _stQ.length = 0; _stBusy = false; return; }
  if (_stBusy || !_stQ.length) return;
  const p = _stQ.shift(); _stBusy = true;
  try { renderStinger(p); } catch (e) { console.warn('DDB Integrator | stinger', e); }
  let visuals = true; try { visuals = game.settings.get(NS, 'cinematics'); } catch (e) {}
  const occ = !visuals ? 0 : (Number.isFinite(p.dur) ? p.dur : (cineMs() + (p.phase === 'impact' ? 200 : 0)));
  setTimeout(() => { _stBusy = false; pumpStingers(); }, occ + 300);
}
// Roll-reveal flourish (roller portrait + roll total + kind, gold for a nat 20, red for a nat 1), OR — for a damage
// roll WITH a selected target — the impact reveal: the target token CENTERED, attacker + weapon art in a sub-circle
// at the TOP, the big damage number + type label below. Both are PRESENTATION ONLY (the number is just what was rolled).
async function renderStinger(p) {
  try {
    if (!document.body) return;
    // Last line of defense: a live Group Check / Contest suppresses every single-roll cinematic, however it got here.
    if (GroupRoll.active && game.user?.isGM) return;
    // Sound cue rides the same broadcast but has its own on/off (in soundConfig), so audio can play even with visuals off.
    if (p.cue) { try { if (soundOn()) playCueSound(soundFor(p.cue)); } catch (e) {} }
    if (!game.settings.get(NS, 'cinematics')) return;
    const layout = 'orbit';
    const impact = p.phase === 'impact';
    const crit = p.tone === 'crit' || p.tone === 'critmiss';
    const dur = Number.isFinite(p.dur) ? p.dur : (cineMs() + (impact ? 200 : 0));
    // Colour: an impact themes off its damage type (gold-ish heal); else gold for a crit, red for a crit-fail, then art hue.
    let H;
    if (impact) H = p.heal ? 140 : p.kind === 'damage' ? (damageHue(p.dtype) ?? 0) : (p.hue != null ? p.hue : (p.nat === 20 ? 45 : p.nat === 1 ? 0 : 210));
    else { H = (TONE_HUE[p.tone] != null) ? TONE_HUE[p.tone] : hexToHue(p.color); if (H == null) H = (p.hue != null) ? p.hue : (await imgHue(p.img)); }
    if (H == null) H = 210;
    const colorBg = !impact && !!p.color && TONE_HUE[p.tone] == null;
    const critCls = p.tone === 'crit' ? ' crit critwin' : p.tone === 'critmiss' ? ' crit critfail' : '';
    const wrap = document.createElement('div'); wrap.className = `ddbx-sting ddbx-st-fade lay-${layout} ph-${impact ? 'impact' : 'result'}${critCls}${colorBg ? ' colorbg' : ''}`;
    wrap.style.setProperty('--c1', `hsl(${H} 78% 62%)`); wrap.style.setProperty('--c2', `hsl(${H} 80% 26%)`); wrap.style.setProperty('--dur', dur + 'ms');
    let particles = ''; const N = 44; for (let i = 0; i < N; i++) { const x = (Math.random() * 100).toFixed(1); const dl = (Math.random() * 1.8).toFixed(2); const du = (1.6 + Math.random() * 1.9).toFixed(2); const sz = (2 + Math.random() * 5).toFixed(1); const sway = Math.round(Math.random() * 50 - 25); const spark = i % 4 === 0 ? ' spark' : ''; particles += `<span class="ddbx-pt${spark}" style="left:${x}%;--sway:${sway}px;width:${sz}px;height:${sz}px;animation-delay:${dl}s;animation-duration:${du}s;"></span>`; }
    const showBg = p.img && !colorBg && !impact;
    const bgEl = showBg ? `<div class="ddbx-bg" style="background-image:url('${cleanUrl(p.img)}');"></div>` : '';
    const crestBg = (p.crest && !impact) ? `<div class="ddbx-crestbg" style="background-color:hsl(${H} 64% 58%);-webkit-mask:url('${WM_IMG}') center/50% no-repeat;mask:url('${WM_IMG}') center/50% no-repeat;"></div>` : '';
    const tex = '<div class="ddbx-tex"></div>';
    const critFx = crit ? '<div class="ddbx-critflash"></div>' : '';
    const frame = `<div class="ddbx-radial"></div>`;
    if (impact) {
      // Impact reveal: the target token is the focus (centre, zoom-in), the attacker rides a SMALLER circle at the top
      // with the weapon/action art as its own sub-circle, the damage total is the big number, type label beneath.
      wrap.classList.add('impactwrap');
      // A hit (damage/heal) gets the aggressive FX — impact flash, damage wash, screen shake; an attack/to-hit roll
      // shows the SAME target-centred framing but calmer (no shake/wash), labelled by the action name.
      const isHit = p.kind === 'damage' || p.heal;
      const dmgType = p.heal ? 'healing' : p.dtype;
      const attArt = p.img ? `<span class="ddbx-strikesub" style="background-image:url('${cleanUrl(p.img)}')"></span>` : '';
      const att = p.actorImg ? `<div class="ddbx-strike" style="background-image:url('${cleanUrl(p.actorImg)}')">${attArt}</div>` : (p.img ? `<div class="ddbx-strike" style="background-image:url('${cleanUrl(p.img)}')"></div>` : '');
      // The overlay shows EVERY targeted token (portrait + name), centred and wrapping; portraits shrink as the count grows.
      const tlist = (Array.isArray(p.targets) && p.targets.length) ? p.targets : ((p.targetImg || p.targetName) ? [{ img: p.targetImg, name: p.targetName }] : []);
      const tn = tlist.length, tsz = tn <= 1 ? 218 : tn === 2 ? 176 : tn === 3 ? 148 : tn <= 6 ? 120 : 96;
      const focus = tn ? `<div class="ddbx-impact-focus${tn > 1 ? ' multi' : ''}">${tlist.map(t => { const v = t.hit === true ? 'hit' : t.hit === false ? 'miss' : ''; return `<div class="ddbx-tfoc${v ? ' v-' + v : ''}" style="width:${tsz}px">${t.img ? `<span class="ddbx-target" style="width:${tsz}px;height:${tsz}px;background-image:url('${cleanUrl(t.img)}'),var(--ddbx-portbg)"></span>` : ''}${v ? `<span class="ddbx-verdict v-${v}">${v === 'hit' ? 'HIT' : 'MISS'}</span>` : ''}${t.name ? `<span class="ddbx-tname">${esc(t.name)}</span>` : ''}</div>`; }).join('')}</div>` : '';
      const num = (p.total != null) ? `<div class="ddbx-result dmgnum">${esc(p.total)}</div>` : '';
      const labTxt = p.heal ? 'healing' : isHit ? `${esc(p.dtype || '')} damage`.trim() : esc(p.action || 'attack');
      const lab = `<div class="ddbx-rsub">${labTxt}</div>`;
      wrap.innerHTML = `<div class="ddbx-vig${isHit ? ' hit' : ''}"></div>${tex}${isHit ? `<div class="ddbx-flash"></div>${damageFx(dmgType)}` : frame}<div class="ddbx-content"><div class="ddbx-impact-att">${att}</div>${focus}<div class="ddbx-impact-readout">${num}${lab}</div></div>`;
      if (isHit) { try { shakeScreen(p.heal ? 'soft' : ((p.total ?? 0) >= 25 ? 'hard' : 'med')); } catch (e) {} }
      // noPan: a conducted apply sequence owns the camera (zoom → pan target-to-target → zoom out); don't let the overlay also pan.
      if (!p.noPan) { try { panToImpactByActors(p.applyIds); } catch (e) {} }
    } else {
      // Action-art sub-circle riding the roller portrait (only for real action art, never the check d20/crest placeholder).
      const actionBadge = (p.img && !p.crest) ? `<span class="ddbx-actbadge" style="background-image:url('${cleanUrl(p.img)}')"></span>` : '';
      // Caster portrait (the hero) + their name + the action sub-circle.
      const caster = p.actorImg ? `<div class="ddbx-casterwrap"><span class="ddbx-casterport"><span class="ddbx-caster" style="background-image:url('${cleanUrl(p.actorImg)}'),var(--ddbx-portbg)"></span>${actionBadge}</span>${p.who ? `<span class="ddbx-cname">${esc(p.who)}</span>` : ''}</div>` : '';
      // Centre: the big roll total (the "result" word) + the action/kind line beneath.
      const rsub = p.action ? esc(p.action) : '';
      const center = `<div class="ddbx-center"><div class="ddbx-burst"></div><div class="ddbx-result">${esc(p.word ?? p.total ?? '')}</div>${rsub ? `<div class="ddbx-rsub">${rsub}</div>` : ''}</div>`;
      wrap.innerHTML = `${p.crest ? crestBg : bgEl}<div class="ddbx-vig"></div>${tex}${critFx}${frame}<div class="ddbx-pts">${particles}</div><div class="ddbx-content"><div class="ddbx-stage">${caster}${center}</div></div>`;
    }
    // GM-only ✕ to dismiss this reveal early (the cinematic root is click-through; the button re-enables its own clicks).
    if (game.user?.isGM) wrap.insertAdjacentHTML('beforeend', '<div class="ddbx-close" title="Dismiss">✕</div>');
    // Render just ABOVE the canvas but BELOW the UI: insert right after #board so the map is covered dramatically
    // while chat/toolbar stay on top and interactive.
    const board = document.getElementById('board');
    if (board?.parentElement) board.parentElement.insertBefore(wrap, board.nextSibling);
    else document.body.appendChild(wrap);
    // Size the overlay to the OPEN CANVAS rectangle so it never covers the GM's UI (clean for the GM, fully visible
    // to players). #board's parent can be a transformed/contained block, so fitCinematic corrects for that too.
    fitCinematic(wrap);
    liftDice(true);
    const done = () => { wrap.remove(); if (!document.querySelector('.ddbx-sting')) liftDice(false); };
    setTimeout(done, dur);
  } catch (e) { console.warn('DDB Integrator | stinger', e); }
}
// GM builds the terse roll-reveal payload and broadcasts it to every client (so all players see the flourish).
// Always runs (so the sound cue fires even when the visual is disabled); the visual is gated inside renderStinger.
function announce(card) {
  try {
    if (!game.user?.isGM) return;
    if (GroupRoll.active) return;   // a Group Check / Contest owns the screen — never overlay a single-roll stinger
    // A DAMAGE roll fires NO cinematic at roll time — its impact reveal is deferred to when the GM APPLIES the damage
    // (the dnd5e.applyDamage hook below), so the number shown reflects any ×2 / resistance. The stylized card still posts.
    if (card.kind === 'damage') return;
    const actor = card.actorId ? game.actors.get(card.actorId) : null;
    const nat = card.nat ?? null;
    const isGen = card.kind === 'check' || card.kind === 'save' || card.kind === 'init' || card.kind === 'death';
    const hue = abilityHue(card.ability);
    const m = kindMeta(card);
    // ANY attack or damage roll WITH a selected target → the IMPACT reveal: the target framed in the centre, the
    // attacker + action art in a sub-circle at the top, the rolled total as the big number. Pure presentation.
    const isImpact = card.kind === 'attack' && !!card.target;   // damage impact is deferred to apply-time (see applyDamage hook)
    if (isImpact) {
      const isDmg = card.kind === 'damage';
      const dtype = isDmg ? (card.damageType || (card.damageTypes && card.damageTypes[0]) || '') : '';
      // HIT / MISS verdict per target (vs AC), when enabled — greens the hits, reds the misses on the reveal.
      let showVerdict = false; try { showVerdict = game.settings.get(NS, 'autoConfirmHits'); } catch (e) {}
      const nts = buildNativeTargets(card.targets);
      const payload = {
        phase: 'impact', kind: card.kind, total: card.total, dtype, heal: !!card.heal, nat, action: card.action || '',
        who: card.who || actor?.name || '', actorImg: actor?.img || '', img: card.img || '', hue,
        targetName: card.target.name || '', targetImg: card.target.img || '',
        targets: nts.map(nt => ({ name: nt.name || '', img: nt.img || '', hit: showVerdict ? hitForUuid(nt.uuid) : null })),   // ALL targets → overlay shows each
        applyIds: (card.targets || []).map(t => t && t.id).filter(Boolean),   // ALL target ids → camera frames them all (read-only)
        cue: isDmg ? ('dmg.' + dmgKey(dtype)) : (nat === 20 ? 'crit' : nat === 1 ? 'fumble' : 'roll'),
      };
      playStinger(payload);
      try { game.socket?.emit(`module.${NS}`, { t: 'stinger', payload }); } catch (e) {}
      return;
    }
    // Tone: gold for a nat 20, red for a nat 1, else neutral by kind colour.
    let tone = 'gen';
    if (nat === 20) tone = 'crit'; else if (nat === 1) tone = 'critmiss';
    const word = String(card.total);
    const action = `${esc(card.action || m.label)} · ${m.label}`;
    const payload = {
      phase: 'result', word, total: card.total, tone, action,
      who: card.who || actor?.name || '', actorImg: actor?.img || '',
      img: card.img || '', crest: isGen, color: actorThemeColor(actor), hue: hue,
    };
    // Pick the sound cue: crit / fumble override, then damage / heal, else any-roll.
    payload.cue = nat === 20 ? 'crit' : nat === 1 ? 'fumble' : (card.kind === 'damage' ? (card.heal ? 'heal' : 'damage') : 'roll');
    playStinger(payload);
    try { game.socket?.emit(`module.${NS}`, { t: 'stinger', payload }); } catch (e) {}
  } catch (e) { console.warn('DDB Integrator | announce', e); }
}

/* ----------------------------------------------------- GM-driven Group Check & Contest cinematic
   A GM tool collects the next rolls (DDB or local) into ONE persistent cinematic instead of firing each roll's
   individual flourish — multiple roller portraits shown together, the reference module's "group" reveal. While a
   session is live every parsed roll STILL posts its normal unified chat card (the chat log is untouched) but its
   per-roll cinematic is skipped; the roll's portrait/total/label fold into the group tile grid instead.
   FINALIZE computes the AVERAGE (Group Check, rounded up) or the HIGHEST (Contest, winner highlighted) — a DISPLAY
   number only. Pure presentation: no HP, no targeting, no hit/miss, no conditions, no buttons. */
const GroupRoll = { active: false, mode: null, entries: new Map() };
let _groupFinalizeTimer = null;
// Auto-close the INITIATIVE cinematic: hold it for the cinematic-duration setting after the FIRST of — the last player
// combatant submitting initiative, OR combat starting — then resolve it. (The GM's ✕ still closes it manually/early.)
function allPlayersHaveInit() {
  try {
    const combat = game.combat; if (!combat) return false;
    const players = combat.combatants.filter(c => c.actor?.hasPlayerOwner);
    return players.length > 0 && players.every(c => c.initiative != null);   // no player combatants → this trigger doesn't apply
  } catch (e) { return false; }
}
function scheduleInitClose() {
  try {
    if (!game.user?.isGM || !GroupRoll.active || GroupRoll.mode !== 'init' || GroupRoll.initCloseTimer) return;   // first trigger wins
    GroupRoll.initCloseTimer = setTimeout(() => {
      GroupRoll.initCloseTimer = null;
      if (GroupRoll.active && GroupRoll.mode === 'init') finalizeGroup();
    }, cineMs());
  } catch (e) {}
}
Hooks.on('combatStart', () => { try { scheduleInitClose(); } catch (e) {} });
Hooks.on('updateCombat', (combat, changed) => { try { if (changed?.round != null) scheduleInitClose(); } catch (e) {} });
Hooks.on('updateCombatant', (c, changed) => { try { if (changed?.initiative != null && allPlayersHaveInit()) scheduleInitClose(); } catch (e) {} });

// Refresh the GM toolbar so the active tool reflects the live session state (toggled on/off).
function refreshGroupControls() { try { ui.controls?.render?.(true); } catch (e) {} }

// Build the socket-broadcastable group payload from the live session (FULL state every time, so a player who joined
// mid-check renders correctly). headline is the finalized result line; entries are display-only tiles.
function groupPayload(phase, headline) {
  const entries = Array.from(GroupRoll.entries.values()).map(e => ({
    who: e.who || '', img: e.actorImg || '', actionImg: e.actionImg || '',
    label: e.label || '', total: (e.total == null ? null : e.total), sub: e.sub || '', win: e.win ?? null,
  }));
  return { mode: GroupRoll.mode || 'check', phase, headline: headline || '', entries };
}
// GM: push the current session state to every client (and render locally).
function broadcastGroup(phase, headline) {
  const payload = groupPayload(phase, headline);
  renderGroup(payload);
  try { game.socket?.emit(`module.${NS}`, { t: 'group', payload }); } catch (e) {}
}

// One roller tile: portrait + action sub-circle (the .ddbx-actbadge look) + big total + label + optional sub.
function groupTile(e) {
  const cls = e.win === true ? ' win' : (e.win === false ? ' lose' : '');
  const crown = e.win === true ? `<span class="ddbx-gt-crown"><i class="fas fa-crown"></i></span>` : '';
  const badge = e.actionImg ? `<span class="ddbx-actbadge" style="background-image:url('${cleanUrl(e.actionImg)}')"></span>` : '';
  const img = cleanUrl(e.img) || 'icons/svg/mystery-man.svg';
  const total = (e.total != null) ? `<span class="ddbx-gt-total">${esc(e.total)}</span>` : `<span class="ddbx-gt-total pend">…</span>`;
  const label = e.label ? `<span class="ddbx-gt-label">${esc(e.label)}</span>` : `<span class="ddbx-gt-label pend"><i class="fas fa-hourglass-half"></i></span>`;
  const sub = e.sub ? `<span class="ddbx-gt-sub">${esc(e.sub)}</span>` : '';
  return `<div class="ddbx-gtile${cls}" data-who="${esc(e.who)}"><span class="ddbx-gt-port"><span class="ddbx-gt-img" style="background-image:url('${img}'),var(--ddbx-portbg)">${crown}</span>${badge}</span><div class="ddbx-gt-n">${esc(e.who)}</div>${label}${total}${sub}</div>`;
}
// Header for the group cinematic: title + a "gathering rolls…" line, or the finalized result line.
function groupHead(p) {
  const title = p.mode === 'contest' ? 'Contest' : p.mode === 'init' ? 'Initiative' : 'Group Check';
  if (p.phase === 'result') {
    if (p.mode === 'init') return `<div class="ddbx-gh-title">${title}</div><div class="ddbx-gh-sub">turn order set</div>`;
    if (p.mode === 'contest') return `<div class="ddbx-gh-title">${title}</div><div class="ddbx-gh-sub">winner</div>${p.headline ? `<div class="ddbx-gh-result">${esc(p.headline)}</div>` : ''}`;
    return `<div class="ddbx-gh-title">${title}</div>${p.headline ? `<div class="ddbx-gh-result">${esc(p.headline)}</div>` : ''}<div class="ddbx-gh-sub">party average</div>`;
  }
  const n = (p.entries || []).length;
  return `<div class="ddbx-gh-title">${title}</div><div class="ddbx-gh-sub">gathering rolls&hellip;${n ? ` &middot; ${n}` : ''}</div>`;
}
// Render (or re-render in place) the group cinematic on THIS client. PERSISTENT: stays until a 'result' fade or a
// clear. Runs for every client (gated only by the 'cinematics' visual toggle, like the single-roll stinger).
let _groupEl = null, _groupTimer = null;
function renderGroup(p) {
  try {
    if (!document.body) return;
    if (!game.settings.get(NS, 'cinematics')) return;
    const tilesHTML = (p.entries || []).map(groupTile).join('');
    // In-place update: if a group cinematic is already on screen, patch the header + only the tiles that changed so
    // settled tiles don't re-animate (mirrors the reference's "only the updated number moves"). Falls through to a
    // fresh build on a phase change (gathering → result) or if the element is gone.
    if (_groupEl?.isConnected && _groupEl.dataset.phase === p.phase) {
      try {
        const head = _groupEl.querySelector('.ddbx-ghead'); if (head) head.innerHTML = groupHead(p);
        const cont = _groupEl.querySelector('.ddbx-gtiles');
        if (cont) {
          const byKey = new Map(); cont.querySelectorAll('.ddbx-gtile').forEach(el => byKey.set(el.dataset.who ?? '', el));
          const liveKeys = new Set();
          for (const e of (p.entries || [])) {
            const key = String(e.who ?? ''); liveKeys.add(key);
            const tmp = document.createElement('div'); tmp.innerHTML = groupTile(e); const fresh = tmp.firstElementChild; if (!fresh) continue;
            const cur = byKey.get(key);
            if (!cur) { fresh.classList.add('gt-in'); cont.appendChild(fresh); continue; }   // new roller → gentle fade-in
            const ct = cur.querySelector('.ddbx-gt-total'), ft = fresh.querySelector('.ddbx-gt-total');
            if (ct && ft && ct.textContent !== ft.textContent) ft.classList.add('gt-upd');   // total changed → pulse just that number
            // Swap the inner content (label/total/sub/badge) but keep the tile element so its entry animation stays settled.
            if (cur.innerHTML !== fresh.innerHTML) cur.innerHTML = fresh.innerHTML;
            if (cur.className.replace(' gt-in', '') !== fresh.className) cur.className = fresh.className;
          }
          // Drop tiles for rollers no longer present (shouldn't happen mid-session, but keeps state honest).
          for (const [key, el] of byKey) if (!liveKeys.has(key)) el.remove();
        }
        return;
      } catch (e) { /* fall through to full rebuild */ }
    }
    // Full (re)build.
    if (_groupEl) { try { _groupEl.remove(); } catch (e) {} _groupEl = null; }
    clearTimeout(_groupTimer);
    const wrap = document.createElement('div');
    // 'is-gathering' forces the cinematic to persist (no fade) until finalize/cancel; a 'result' build omits it so the
    // celebratory reveal uses the standard fade-out.
    wrap.className = 'ddbx-sting lay-orbit ddbx-group' + (p.phase === 'result' ? ' ddbx-st-fade' : ' is-gathering');
    wrap.dataset.phase = p.phase;
    // Theme: gold on a finalized result (a celebratory reveal), cool indigo while gathering.
    const H = p.phase === 'result' ? 45 : 265;
    wrap.style.setProperty('--c1', `hsl(${H} 78% 62%)`); wrap.style.setProperty('--c2', `hsl(${H} 80% 26%)`);
    const dur = p.phase === 'result' ? (cineMs() + 200) : 0;
    if (dur) wrap.style.setProperty('--dur', dur + 'ms');
    let particles = ''; const N = p.phase === 'result' ? 44 : 24;
    for (let i = 0; i < N; i++) { const x = (Math.random() * 100).toFixed(1); const dl = (Math.random() * 1.8).toFixed(2); const du = (1.6 + Math.random() * 1.9).toFixed(2); const sz = (2 + Math.random() * 5).toFixed(1); const sway = Math.round(Math.random() * 50 - 25); const spark = i % 4 === 0 ? ' spark' : ''; particles += `<span class="ddbx-pt${spark}" style="left:${x}%;--sway:${sway}px;width:${sz}px;height:${sz}px;animation-delay:${dl}s;animation-duration:${du}s;"></span>`; }
    wrap.innerHTML = `<div class="ddbx-vig"></div><div class="ddbx-tex"></div><div class="ddbx-radial"></div><div class="ddbx-pts">${particles}</div><div class="ddbx-content"><div class="ddbx-ghead">${groupHead(p)}</div><div class="ddbx-gtiles">${tilesHTML}</div></div>`;
    // GM-only ✕ to reveal the result now (Group Check / Contest) or end the Initiative gather. Persists across in-place updates.
    if (game.user?.isGM && p.phase !== 'result') wrap.insertAdjacentHTML('beforeend', '<div class="ddbx-close" title="Reveal / end">✕</div>');
    // While gathering, hold opacity steady (no auto-fade); the result phase uses the standard fade-out animation.
    if (p.phase !== 'result') wrap.style.animation = 'none';
    const board = document.getElementById('board');
    if (board?.parentElement) board.parentElement.insertBefore(wrap, board.nextSibling);
    else document.body.appendChild(wrap);
    fitCinematic(wrap);   // keep clear of the GM's UI; fully visible to players
    _groupEl = wrap;
    // The result phase fades and tears itself down after its animation; the gathering phase persists until finalize/clear.
    if (p.phase === 'result') _groupTimer = setTimeout(() => { try { if (_groupEl === wrap) { wrap.remove(); _groupEl = null; } } catch (e) {} }, dur);
  } catch (e) { console.warn('DDB Integrator | group cinematic', e); }
}
// Tear down the group cinematic on THIS client (used on cancel / clear, broadcast to all).
function clearGroupLocal() { try { clearTimeout(_groupTimer); if (_groupEl) { _groupEl.remove(); _groupEl = null; } } catch (e) {} }

// GM: START a session for the given mode and open the gathering cinematic on every client.
function startGroup(mode) {
  if (!game.user?.isGM) return;
  const now = Date.now();
  if (GroupRoll.active) {
    if (GroupRoll.mode === mode) {
      // Same tool again = finalize — BUT ignore a spurious immediate re-fire. A scene-control toggle can fire its
      // handler more than once per physical click (onChange + onClick, and a ui.controls re-render can re-enter),
      // which would start-then-finalize in the same instant. A real "click again to finalize" is always seconds later.
      if (now - (GroupRoll.startedAt || 0) < 1200) { refreshGroupControls(); return; }   // swallow a spurious double-fire
      finalizeGroup(); return;
    }
    ui.notifications.warn(`DDB Integrator: a ${GroupRoll.mode === 'contest' ? 'Contest' : GroupRoll.mode === 'init' ? 'Initiative gather' : 'Group Check'} is already running — finish the current one first.`);
    return;
  }
  GroupRoll.active = true; GroupRoll.mode = mode; GroupRoll.entries.clear(); GroupRoll.startedAt = now;
  clearTimeout(GroupRoll.initCloseTimer); GroupRoll.initCloseTimer = null;   // fresh session — drop any pending init auto-close
  // Clear any in-flight / queued single-roll cinematics so none linger and overlay the group cinematic.
  try { _stQ.length = 0; _stBusy = false; document.querySelectorAll('.ddbx-sting:not(.ddbx-group)').forEach(el => el.remove()); } catch (e) {}
  clearTimeout(_groupFinalizeTimer); _groupFinalizeTimer = null;
  broadcastGroup('gathering');
  refreshGroupControls();
  ui.notifications.info(`DDB Integrator: ${mode === 'contest' ? 'Contest' : mode === 'init' ? 'Initiative' : 'Group Check'} started — rolls will gather. ${mode === 'init' ? 'Click the ✕ on the cinematic to end.' : 'Click the tool again to finalize.'}`);
}
// GM: route a parsed roll into the live session (called from renderRoll / renderLocalMessage). Upserts the roller's
// tile in place (re-rolls / skill-swaps UPDATE, never add a new tile). Returns nothing — the chat card still posts.
function ingestGroupRoll(info) {
  try {
    if (!GroupRoll.active || !game.user?.isGM) return;
    // Key by resolved actor id, else roller name — so the same roller's re-roll updates their existing tile.
    const key = info.actorId || info.who || 'roll';
    const prev = GroupRoll.entries.get(key) || {};
    const isD20 = info.kind === 'attack' || info.kind === 'check' || info.kind === 'save' || info.kind === 'init' || info.kind === 'death' || info.kind === 'other';
    // total = the big d20-test number; sub = a non-d20 value (damage) shown small. A plain check has no sub.
    const total = isD20 ? (Number(info.total) || 0) : (prev.total != null ? prev.total : null);
    const sub = !isD20 ? (info.total != null ? String(info.total) : '') : (prev.sub || '');
    GroupRoll.entries.set(key, {
      who: info.who || prev.who || 'Roll',
      actorImg: info.actorImg || prev.actorImg || '',
      // Action art only for an action/item roll (not a bare ability/skill check).
      actionImg: (info.isAction ? (info.actionImg || '') : '') || prev.actionImg || '',
      label: info.label || prev.label || '',
      total, sub, nat: info.nat ?? prev.nat ?? null, win: null,   // no winner/loser during gathering — set only at finalize
    });
    broadcastGroup('gathering');
  } catch (e) { console.warn('DDB Integrator | ingestGroupRoll', e); }
}
// GM: FINALIZE — compute the headline (average / winner), reveal it, then fade + clear after ~3.5s. Untoggles the tool.
function finalizeGroup() {
  if (!game.user?.isGM || !GroupRoll.active) return;
  clearTimeout(GroupRoll.initCloseTimer); GroupRoll.initCloseTimer = null;   // we're resolving now — cancel any pending auto-close
  const mode = GroupRoll.mode;
  const entries = Array.from(GroupRoll.entries.values()).filter(e => e.total != null);
  let headline = '';
  if (mode === 'contest') {
    const max = entries.length ? Math.max(...entries.map(e => e.total)) : null;
    for (const [k, e] of GroupRoll.entries) { e.win = (max != null && e.total === max); GroupRoll.entries.set(k, e); }
    const winners = entries.filter(e => e.total === max).map(e => e.who);
    headline = winners.length ? winners.join(', ') : '—';
  } else if (mode === 'init') {
    headline = '';   // initiative: no average or winner — the rolled values are already on the combat tracker
  } else {
    // Group Check: AVERAGE of all totals, rounded UP.
    if (entries.length) { const avg = Math.ceil(entries.reduce((a, e) => a + e.total, 0) / entries.length); headline = String(avg); }
    else headline = '—';
  }
  broadcastGroup('result', headline);
  // After the reveal fades, clear the session + untoggle the tool. The broadcast already faded the visual on all clients.
  clearTimeout(_groupFinalizeTimer);
  _groupFinalizeTimer = setTimeout(() => {
    GroupRoll.active = false; GroupRoll.mode = null; GroupRoll.entries.clear();
    refreshGroupControls();
  }, 3500);
}
// GM: CANCEL — clear with no result (right-click the tool, or Escape). Tears the cinematic down on every client.
function cancelGroup() {
  if (!game.user?.isGM) return;
  const wasActive = GroupRoll.active;
  GroupRoll.active = false; GroupRoll.mode = null; GroupRoll.entries.clear();
  clearTimeout(_groupFinalizeTimer); _groupFinalizeTimer = null;
  clearGroupLocal();
  try { game.socket?.emit(`module.${NS}`, { t: 'groupclear' }); } catch (e) {}
  refreshGroupControls();
  if (wasActive) ui.notifications.info('DDB Integrator: group roll cancelled.');
}

/* --------------------------------------------------------------- bootstrap */
// ─── GM toolbar: Group Check & Contest ───
// Registered at TOP LEVEL (not inside `ready`) so the hook is present BEFORE Foundry first renders the scene controls
// — registering inside `ready` fires too late and the tools never paint. We add the two tools to the EXISTING Token
// Controls group: V13/V14 silently drops a custom top-level control group that isn't bound to a real canvas layer.
Hooks.on('getSceneControlButtons', (controls) => {
  try {
    if (!game.user?.isGM) return;
    const group = controls?.tokens ?? controls?.token ?? Object.values(controls ?? {})[0];
    if (!group?.tools) return;
    const checkActive = GroupRoll.active && GroupRoll.mode === 'check';
    const contestActive = GroupRoll.active && GroupRoll.mode === 'contest';
    const t1 = {
      name: 'ddbiGroupCheck', title: 'DDB: Group Check — click to gather rolls, click again to finish (right-click cancels)',
      icon: 'fas fa-users', toggle: true, active: checkActive, visible: true,
      // onChange fires on the toggle click; startGroup() decides START vs FINALIZE from the live session state.
      onChange: () => startGroup('check'), onClick: () => startGroup('check'),
    };
    const t2 = {
      name: 'ddbiContest', title: 'DDB: Contest — click to gather rolls, click again to reveal the winner (right-click cancels)',
      icon: 'fas fa-people-arrows', toggle: true, active: contestActive, visible: true,
      onChange: () => startGroup('contest'), onClick: () => startGroup('contest'),
    };
    if (Array.isArray(group.tools)) group.tools.push(t1, t2);   // legacy array form
    else { group.tools[t1.name] = t1; group.tools[t2.name] = t2; }   // V13/V14 record form
  } catch (e) { console.warn('DDB Integrator | scene controls', e); }
});

Hooks.once('init', () => {
  // ─── D&D Beyond connection ───
  game.settings.register(NS, 'enabled', { name: 'Connect to D&D Beyond', hint: 'Open a connection to the D&D Beyond game log (via your ddb-proxy) to receive rolls. Turn off to use this module only for local Foundry rolls.', scope: 'world', config: true, type: Boolean, default: true });
  // CLIENT scope: the cobalt cookie is a D&D Beyond credential only the GM's client uses (never synced to players).
  game.settings.register(NS, 'connectionMode', { name: 'Connection mode', hint: 'Hosted (recommended): connect through the shared XtraPklz proxy — zero setup. Your D&D Beyond session cookie passes through that server ONLY to authenticate and is never stored. The free shared server may take ~30–60s to wake on the first connect of a session. · Local: run your own ddb-proxy and set its URL below — full privacy, no shared-server limits.', scope: 'world', config: true, type: String, choices: { hosted: 'Hosted — easy, no setup (recommended)', local: 'Local — your own proxy (advanced)' }, default: 'hosted' });
  game.settings.register(NS, 'cobaltCookie', { name: 'CobaltSession cookie', hint: 'Your dndbeyond.com CobaltSession cookie. Use the "Get / paste my cookie" button above for a guided walkthrough. Stored only in this browser (never shared with players); re-enter it per device you GM from.', scope: 'client', config: true, type: String, default: '' });
  game.settings.register(NS, 'proxyUrl', { name: 'Local proxy URL', hint: 'Only used in LOCAL connection mode: your own ddb-proxy base URL, e.g. http://localhost:3000 (no trailing slash). Ignored in Hosted mode.', scope: 'world', config: true, type: String, default: '' });
  game.settings.register(NS, 'campaignId', { name: 'Campaign (game) ID', hint: 'D&D Beyond campaign/game ID.', scope: 'world', config: true, type: String, default: '' });
  game.settings.register(NS, 'userId', { name: 'D&D Beyond username (or user ID)', hint: 'Your D&D Beyond username works here — you do NOT need the numeric user ID. (The numeric ID from DevTools also works if you prefer.)', scope: 'world', config: true, type: String, default: '' });
  game.settings.register(NS, 'characterMapping', { scope: 'world', config: false, type: Object, default: {} });
  // ─── Cards ───
  game.settings.register(NS, 'ddbApplyCard', { name: 'Native cards for D&D Beyond rolls', hint: 'D&D Beyond rolls have no native card of their own. When on, also post the system’s native cards for them — the damage card with its Apply tray (½/×2 multipliers, resistance, temp HP) and the attack card with hit/miss vs the target’s AC — so D&D Beyond rolls behave just like local Foundry rolls. Your stylized card + cinematic still post too. Applying is always a GM click; nothing is automatic.', scope: 'world', config: true, type: Boolean, default: true });
  game.settings.register(NS, 'nativeGmOnly', { name: 'Native cards: GM only', hint: 'Whisper the native dnd5e cards (the AC hit/miss card and the damage Apply card) to the GM only, so players see just your stylized card + cinematic. Turn off to show the native cards to everyone.', scope: 'world', config: true, type: Boolean, default: true });
  // ─── Cinematics ───
  game.settings.register(NS, 'cinematics', { name: 'Cinematic roll reveals', hint: 'Show a brief full-screen flourish when a roll lands — the roller portrait, the total, and the kind, with gold flair for a natural 20 and red for a natural 1. Shown to all players.', scope: 'world', config: true, type: Boolean, default: true });
  game.settings.register(NS, 'cinematicDuration', { name: 'Cinematic duration (seconds)', hint: 'How long a single-roll cinematic stays on screen before it fades (also sets the spacing between back-to-back reveals and the group result reveal). Group Check / Contest / Initiative gathering stay up until you finalize them.', scope: 'world', config: true, type: Number, range: { min: 1.5, max: 10, step: 0.5 }, default: 3.5 });
  game.settings.register(NS, 'autoConfirmHits', { name: 'Attack hit / miss verdict', hint: 'On an attack, mark each target HIT or MISS — green or red — on the cinematic + the chat card, decided by the roll vs the target’s AC. Turn off to hide the verdict (a manual GM confirm is coming in a later update). GM only.', scope: 'world', config: true, type: Boolean, default: true });
  // ─── Sound (per-client) ───
  // All sound state — on/off, volume, and a file per cue (incl. every damage type) — lives in this single object,
  // edited via the "Sound Effects" submenu below. Nothing else sits on the main settings page. Ships silent (all blank).
  game.settings.register(NS, 'soundConfig', { scope: 'client', config: false, type: Object, default: {} });
  // Editor submenus.
  try {
    class DdbxSoundMenu extends foundry.applications.api.ApplicationV2 { async render() { editSounds(); return this; } }
    game.settings.registerMenu(NS, 'soundMenu', { name: 'Sound Effects', label: 'Edit sound effects', hint: 'Turn sound cues on/off, set the volume, and assign a file to each cue — the five key cues plus one per damage type. The module bundles no audio; every cue is blank (silent) until you set it.', icon: 'fas fa-volume-high', type: DdbxSoundMenu, restricted: false });
    class DdbxMappingMenu extends foundry.applications.api.ApplicationV2 { async render() { editMapping(); return this; } }
    game.settings.registerMenu(NS, 'mappingMenu', { name: 'Character Mapping', label: 'Edit Character Mapping', hint: 'Map D&D Beyond characters to Foundry actors (only needed when names differ).', icon: 'fas fa-people-arrows', type: DdbxMappingMenu, restricted: true });
    class DdbxCookieMenu extends foundry.applications.api.ApplicationV2 { async render() { editCookie(); return this; } }
    game.settings.registerMenu(NS, 'cookieMenu', { name: 'D&D Beyond cookie', label: 'Get / paste my cookie', hint: 'Guided walkthrough to copy your CobaltSession cookie from D&D Beyond and save it here.', icon: 'fas fa-cookie-bite', type: DdbxCookieMenu, restricted: true });
  } catch (e) { console.warn('DDB Integrator | menu register failed (use DDBIntegrator.editSounds()/editMapping())', e); }
  // Section headers on the settings page so the toggles read as labeled groups.
  Hooks.on('renderSettingsConfig', (app, html) => {
    try {
      const root = (html?.[0]) || html; if (!root?.querySelector) return;
      const SEC = { enabled: 'D&D Beyond Connection', ddbApplyCard: 'Cards', cinematics: 'Cinematics' };
      for (const [key, label] of Object.entries(SEC)) {
        const field = root.querySelector(`[name="${NS}.${key}"]`); const row = field?.closest('.form-group'); if (!row) continue;
        const h = document.createElement('h3'); h.textContent = label; h.className = 'ddbx-int-section';
        // Pin an explicit font so the header isn't shrunk/restyled by Foundry's or a font module's global h3 rules.
        h.style.cssText = 'margin:16px 0 6px;padding-bottom:4px;border-bottom:2px solid var(--color-border-light-primary,#782e22);font:700 16px/1.35 var(--font-primary,"Signika",sans-serif);color:inherit;text-transform:none;letter-spacing:.01em;';
        row.parentNode.insertBefore(h, row);
      }
    } catch (e) { console.warn('DDB Integrator | settings sections', e); }
  });
});

Hooks.once('ready', () => {
  // Styles + the stinger socket listener run for EVERY client (players see public cards and cinematic reveals).
  // Sanitize socket-received stinger payloads — any client can emit one, and it reaches innerHTML.
  injectStyles();
  // Socket listener runs on EVERY client (players see the cinematics). Each payload is sanitized before innerHTML,
  // and the group payload carries FULL state so a player who joined mid-check still renders correctly.
  try {
    game.socket?.on(`module.${NS}`, (m) => {
      if (m?.t === 'stinger') playStinger(sanitizeStinger(m.payload));
      else if (m?.t === 'group') { const g = sanitizeGroup(m.payload); if (g) renderGroup(g); }
      else if (m?.t === 'groupclear') clearGroupLocal();
    });
  } catch (e) {}
  if (!game.user.isGM) { console.log('DDB Integrator | ready (v0.2.5)'); return; }
  window.DDBIntegrator = { reconnect, startOwnSocket, editMapping, editCookie, editSounds, fetchCampaignCharacters, startGroup, finalizeGroup, cancelGroup };
  // Replace/suppress Foundry's native dnd5e roll cards — this module posts its own. ONLY native ROLL cards are
  // touched (no item/usage interception, no automation): a GM roll renders our card too, then we keep the native
  // one (whispered) or cancel it; players' native roll cards are suppressed per the toggle.
  Hooks.on('preCreateChatMessage', (message) => {
    try {
      if (message.flags?.[NS]) return;   // our own cards (stylized + synthesized native apply card) — never re-process
      const f = message.flags?.dnd5e; if (!f) return;
      const isNativeRoll = f.messageType === 'roll' && !!message.rolls?.length;
      if (!isNativeRoll) return;   // we never touch non-roll cards
      // The GM's own roll → ALSO render our stylized card + cinematic. keepNative=true so we don't double the dice
      // animation. With "Native cards: GM only" on, whisper the native card to the GM so players see only the stylized one.
      if (game.user.isGM) {
        renderLocalMessage(message, true);
        if (game.settings.get(NS, 'nativeGmOnly')) { try { message.updateSource({ whisper: ChatMessage.getWhisperRecipients('GM').map(u => u.id), blind: false }); } catch (e) {} }
      }
    } catch (e) { console.error('DDB Integrator | intercept error', e); }
  });
  // (GM toolbar Group Check / Contest tools are registered at TOP LEVEL — see the getSceneControlButtons hook above
  //  the init hook — so the hook exists BEFORE Foundry first paints the scene controls. Registering it here, inside
  //  `ready`, ran too late: the controls had already rendered once and the tools never appeared.)
  // Right-click either tool → cancel the live session (presentation-only; no result). The toolbar buttons carry the
  // tool name in a data attribute across builds; match either tool, then cancel.
  document.addEventListener('contextmenu', (ev) => {
    try {
      if (!GroupRoll.active) return;
      const btn = ev.target?.closest?.('[data-tool="ddbiGroupCheck"],[data-tool="ddbiContest"]');
      if (btn) { ev.preventDefault(); cancelGroup(); }
    } catch (e) {}
  }, true);
  // GM-only ✕ on any cinematic: reveal/end a live group session (Group Check / Contest / Initiative), otherwise dismiss
  // the single reveal that was clicked. The cinematic root is click-through; only the .ddbx-close button takes the click.
  document.addEventListener('click', (ev) => {
    try {
      const x = ev.target?.closest?.('.ddbx-close'); if (!x) return;
      ev.preventDefault(); ev.stopPropagation();
      if (!game.user?.isGM) return;
      if (GroupRoll.active) { finalizeGroup(); return; }
      const wrap = x.closest('.ddbx-sting'); if (wrap) wrap.remove();
    } catch (e) {}
  }, true);
  // NOTE: no Escape-to-cancel — Escape is heavily overloaded in Foundry (closing sheets, roll-config dialogs,
  // deselecting tokens), so binding it here silently killed live sessions mid-roll. Cancel via right-click on the
  // tool, or finalize by clicking the tool again.
  // Standalone: we always own the connection.
  startOwnSocket();
  setInterval(() => { const sc = Date.now() - 60000; for (const [k, t] of seen) if (t < sc) seen.delete(k); }, 10000);
  // Insurance: force one scene-controls re-render now that everything is wired, in case the controls had already
  // painted. The top-level getSceneControlButtons hook is what makes the tools appear; this just guarantees a paint.
  try { ui.controls?.render?.(true); } catch (e) {}
  console.log('DDB Integrator | ready (v0.2.5)');
});
