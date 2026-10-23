// Real Mobile Safari (iOS simulator), Villagehop prototype: a full daily game, 7 questions answered by typing a number
// on the iOS software keyboard. Per question: tap the field, try letters, try 150, type the answer, tap Submit, tap Next.
// Checks: field and Submit above the keyboard, question visible, input filters, game reaches the end, sound starts,
// console errors. Everything after the first tap is done natively (Appium web reads block ~20-30 s once the keyboard
// is open): the page records itself every 100 ms and the journal is read once at the end.
import { remote } from "webdriverio";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync, spawn } from "node:child_process";

mkdirSync("out", { recursive: true });
const URL = process.env.URL || "https://estimation.d24fxhqaj8oukz.amplifyapp.com/village/?lang=en&sansouverture";
const devs = JSON.parse(execSync("xcrun simctl list devices available -j").toString()).devices;
const runtime = Object.keys(devs).filter((k) => k.includes("iOS")).sort().pop();
const iphone = devs[runtime].find((d) => d.udid === process.env.UDID) || devs[runtime].find((d) => /^iPhone 1[6-7]( |$)/.test(d.name)) || devs[runtime].find((d) => d.name.startsWith("iPhone"));
const version = runtime.split("iOS-")[1].replace(/-/g, ".");
console.log("device", iphone.name, version, "url", URL);

const opts = {
  hostname: "127.0.0.1", port: 4723, logLevel: "warn", connectionRetryTimeout: 1200000, connectionRetryCount: 0,
  capabilities: {
    platformName: "iOS", browserName: "Safari",
    "appium:automationName": "XCUITest", "appium:deviceName": iphone.name, "appium:platformVersion": version,
    "appium:udid": iphone.udid, "appium:connectHardwareKeyboard": false, "appium:nativeWebTap": true,
    "appium:wdaLaunchTimeout": 600000, "appium:simulatorStartupTimeout": 600000, "appium:newCommandTimeout": 900, "appium:safariInitialUrl": "about:blank",
    "appium:webviewConnectTimeout": 180000, "appium:webkitResponseTimeout": 60000, "appium:showSafariConsoleLog": true,
  },
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let d;
try { d = await remote(opts); } catch (e) { console.log("session: second try after", e.message); await pause(30000); d = await remote(opts); }

/* watchdog: whatever happens, results are written and the step ends before the job timeout */
let finir = null;
setTimeout(async () => { console.log("WATCHDOG: 30 min, stopping"); try { await finir?.(); } catch {} video.kill("SIGINT"); await pause(3000); process.exit(1); }, 30 * 60 * 1000).unref();
const video = spawn("xcrun", ["simctl", "io", iphone.udid, "recordVideo", "-f", "out/run.mp4"]);
const t0 = Date.now(), t = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
const bilan = { device: `${iphone.name} iOS ${version}`, url: URL, manches: [], erreurs: [] };
let web = null, n = 0;
const enNatif = () => d.switchContext("NATIVE_APP");
const enWeb = () => d.switchContext(web);
const capture = async (nom) => { const f = `out/${String(++n).padStart(2, "0")}-${nom}.png`; await d.saveScreenshot(f).catch((e) => console.log("capture ratée", nom, e.message)); return f; };
/** First native element matching an iOS predicate, polled without implicit waits (waitForExist is very slow here). */
async function trouver(pred, ms = 60000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const l = await d.$$(`-ios predicate string:${pred}`).catch(() => []);
    for (const e of l) { if (await e.isDisplayed().catch(() => false)) return e; }
    await pause(400);
  }
  return null;
}
const rect = async (e) => { try { const r = await e.getElementRect(e.elementId); return { y: Math.round(r.y), bas: Math.round(r.y + r.height), x: Math.round(r.x), h: Math.round(r.height) }; } catch { return null; } };
const valeurChamp = async (e) => e.getAttribute("value").catch(() => "?");
async function taper(champ, texte) {
  try { await champ.addValue(texte); } catch (e) { console.log("addValue refusé", JSON.stringify(texte), e.message.split("\n")[0]); try { await d.keys(texte.split("")); } catch (e2) { console.log("keys refusé", e2.message.split("\n")[0]); } }
  await pause(500);
}
async function effacer(champ) {
  for (let i = 0; i < 4; i++) {
    const v = await valeurChamp(champ);
    if (!v || v === "or type" || v === "ou tape") return;
    const del = await trouver(`type == "XCUIElementTypeKey" AND (label ==[c] "Delete" OR name ==[c] "delete")`, 3000);
    if (del) { for (let k = 0; k < String(v).length; k++) await del.click().catch(() => {}); } else await taper(champ, "\b\b\b");
  }
}
const fermerAstuces = async () => {
  const b = await d.$$(`-ios predicate string:type == "XCUIElementTypeButton" AND (label ==[c] "Close" OR name ==[c] "Close")`).catch(() => []);
  for (const x of b) { await x.click().catch(() => {}); console.log("astuce Safari fermée"); }
};

finir = async () => {
  finir = null;

  try {
    await enWeb();
    const r = await d.execute(() => { clearInterval(window.__ji); return { j: window.__j, err: window.__err, total: document.getElementById("fin-total")?.textContent, finVisible: !document.getElementById("fin").hidden, resultats: window.__village?.resultats?.map((x) => [x.reponse, x.vrai, x.points]), ctx: (window.__ctx || []).map((c) => [c.state, c.currentTime, c.sampleRate]) }; });
    writeFileSync("out/journal.json", JSON.stringify(r.j));
    bilan.erreurs = r.err; bilan.total = r.total; bilan.finVisible = r.finVisible; bilan.resultats = r.resultats; bilan.audio = r.ctx;
    // summary of the journal: problems only, plus every change while the keyboard is open
    let avant = "", cachees = 0, sous = 0;
    for (const [ms, ev, h, top, sy, ih, cl, vh, etat, q, c, v, val, act, au] of r.j || []) {
      const ouvert = h < ih - 100;
      const qCachee = etat === "etat-question" && q && (q[0] < top - 1 || q[1] > top + h + 1);
      const cSous = ouvert && c && c[1] > top + h + 1, vSous = ouvert && v && v[1] > top + h + 1;
      if (qCachee) cachees++; if (cSous || vSous) sous++;
      const l = `${etat} vvH ${h} vvTop ${top} scrollY ${sy} --clavier ${cl} --vv-haut ${vh} question ${q} champ ${c} valider ${v} val "${val}" focus ${act} audio ${au}`;
      if (l !== avant || ev !== ".") console.log(`JOURNAL ${String(ms).padStart(6)} ${ev.padEnd(14)} ${l}${qCachee ? "  <-- QUESTION CACHÉE" : ""}${cSous ? "  <-- CHAMP SOUS LE CLAVIER" : ""}${vSous ? "  <-- VALIDER SOUS LE CLAVIER" : ""}`);
      avant = l;
    }
    bilan.echantillonsQuestionCachee = cachees; bilan.echantillonsSousLeClavier = sous;
  } catch (e) { console.log("journal illisible", e.message); }
  writeFileSync("out/bilan.json", JSON.stringify(bilan, null, 1));
  console.log("BILAN", JSON.stringify(bilan));
};
try {
  await d.url(URL);
  web = (await d.getContexts()).map((c) => String(c.id ?? c)).find((c) => c.startsWith("WEBVIEW"));
  console.log("contexte web", web);
  await enWeb();
  const pret = async () => {
    const fin = Date.now() + 180000;
    for (let i = 0; Date.now() < fin; i++) {
      const ok = await d.execute(() => document.readyState === "complete" && !!document.querySelector("#jouer") && !document.getElementById("app").classList.contains("ouverture")).catch(() => false);
      if (ok) return true;
      console.log("page pas prête", i, t());
      await pause(1000);
    }
    return false;
  };
  console.log("page chargée", t());
  await pret();
  // test device: same flag as Jonathan's own devices, then reload
  await d.execute(() => localStorage.setItem("village.moi", "1")).catch((e) => console.log("flag moi non posé", e.message));
  await d.url(URL);
  await enWeb().catch(() => {});
  console.log("page prête", await pret(), t());
  console.log("bundle", await d.execute(() => [...document.scripts].map((s) => s.src).filter(Boolean).join(" ")));
  // the recorder: every 100 ms + viewport, focus, touch, input, errors; audio contexts are tracked from here on
  await d.execute(() => {
    window.__j = []; window.__err = []; window.__ctx = [];
    const t0 = performance.now();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const Enr = function (...a) { const c = new AC(...a); window.__ctx.push(c); return c; };
      Enr.prototype = AC.prototype;
      window.AudioContext = Enr; if (window.webkitAudioContext) window.webkitAudioContext = Enr;
      const rep = AC.prototype.resume;
      AC.prototype.resume = function (...a) { if (!window.__ctx.includes(this)) window.__ctx.push(this); return rep.apply(this, a); };
    }
    const errOrig = console.error.bind(console);
    console.error = (...a) => { window.__err.push(["console.error", Math.round(performance.now() - t0), a.map(String).join(" ").slice(0, 300)]); errOrig(...a); };
    addEventListener("error", (e) => window.__err.push(["error", Math.round(performance.now() - t0), String(e.message || e.target?.src || e.type).slice(0, 300)]), true);
    addEventListener("unhandledrejection", (e) => window.__err.push(["rejection", Math.round(performance.now() - t0), String(e.reason).slice(0, 300)]));
    const R = (s) => { const e = document.querySelector(s); if (!e || e.closest("[hidden]")) return null; const r = e.getBoundingClientRect(); return r.height ? [Math.round(r.top), Math.round(r.bottom)] : null; };
    const note = (ev) => {
      const vv = visualViewport, cs = getComputedStyle(document.documentElement), app = document.getElementById("app");
      window.__j.push([Math.round(performance.now() - t0), ev, Math.round(vv.height), Math.round(vv.offsetTop), Math.round(scrollY), innerHeight,
        cs.getPropertyValue("--clavier").trim(), cs.getPropertyValue("--vv-haut").trim() || "-", (app.className.match(/etat-\w+/) || ["?"])[0],
        R("#question"), R("#champ"), R("#valider"), document.getElementById("champ").value,
        document.activeElement && document.activeElement.id, window.__ctx.map((c) => `${c.state}:${c.currentTime.toFixed(1)}`).join(","),
        (document.getElementById("aide").textContent || "").slice(0, 40)]);
    };
    window.__ji = setInterval(() => note("."), 100);
    visualViewport.addEventListener("resize", () => note("vv-resize")); visualViewport.addEventListener("scroll", () => note("vv-scroll"));
    document.addEventListener("focusin", (e) => note("focusin:" + e.target.id));
    document.addEventListener("focusout", (e) => note("focusout:" + e.target.id));
    document.addEventListener("touchstart", () => note("TOUCHER"), { capture: true, passive: true });
    document.getElementById("champ").addEventListener("input", () => note("input"));
  });
  await enNatif();
  await fermerAstuces();
  bilan.captures = [await capture("accueil")];
  const jouer = await trouver(`type == "XCUIElementTypeButton" AND label BEGINSWITH[c] "today"`, 30000);
  if (!jouer) throw new Error("bouton Today's game introuvable");
  await jouer.click();
  console.log("Today's game touché", t());

  for (let i = 0; i < 7; i++) {
    const m = { manche: i + 1 };
    const champ = await trouver(`type == "XCUIElementTypeTextField" AND (label CONTAINS[c] "bunnies" OR placeholderValue CONTAINS[c] "type")`, 90000);
    if (!champ) { m.erreur = "champ introuvable"; bilan.manches.push(m); throw new Error(`question ${i + 1} : champ introuvable`); }
    m.question = t();
    console.log("question", i + 1, "champ trouvé", t());
    await champ.click();
    await pause(1800);
    m.clavierIOS = await d.isKeyboardShown().catch(() => "?");
    const clavier = await trouver(`type == "XCUIElementTypeKeyboard"`, 4000);
    m.clavierHaut = clavier ? (await rect(clavier))?.y : null;
    await taper(champ, "abc");
    m.apresLettres = await valeurChamp(champ);
    await taper(champ, "150");
    m.apres150 = await valeurChamp(champ);
    await effacer(champ);
    if (i === 0) {
      await taper(champ, "0");
      m.apres0 = await valeurChamp(champ);
      const v0 = await trouver(`type == "XCUIElementTypeButton" AND label ==[c] "Submit"`, 4000);
      m.validerActifA0 = v0 ? await v0.isEnabled().catch(() => "?") : "introuvable";
      await effacer(champ);
    }
    const rep = String(20 + i * 7);
    await taper(champ, rep);
    m.apresReponse = await valeurChamp(champ);
    const valider = await trouver(`type == "XCUIElementTypeButton" AND label ==[c] "Submit"`, 6000);
    m.champNatif = await rect(champ);
    m.validerNatif = valider ? await rect(valider) : null;
    m.champAuDessusDuClavier = m.clavierHaut && m.champNatif ? m.champNatif.bas <= m.clavierHaut : null;
    m.validerAuDessusDuClavier = m.clavierHaut && m.validerNatif ? m.validerNatif.bas <= m.clavierHaut : null;
    if (i === 0 || i === 3 || i === 6) m.capture = await capture(`q${i + 1}-clavier`);
    if (!valider) { m.erreur = "Submit introuvable"; bilan.manches.push(m); throw new Error(`question ${i + 1} : Submit introuvable`); }
    m.validerActif = await valider.isEnabled().catch(() => "?");
    await valider.click();
    m.valide = t();
    console.log("question", i + 1, "validée", t());
    const suivant = await trouver(`type == "XCUIElementTypeButton" AND (label BEGINSWITH[c] "next" OR label BEGINSWITH[c] "see my")`, 60000);
    m.verdict = suivant ? t() : null;
    console.log("MANCHE", JSON.stringify(m));
    bilan.manches.push(m);
    if (!suivant) throw new Error(`question ${i + 1} : pas de verdict`);
    if (i === 6) bilan.captures.push(await capture("verdict-7"));
    await suivant.click();
  }
  const partager = await trouver(`type == "XCUIElementTypeButton" AND label BEGINSWITH[c] "share"`, 120000);
  bilan.fin = partager ? t() : null;
  bilan.captures.push(await capture("fin"));
  console.log("fin de partie", bilan.fin);
} catch (e) {
  console.error(e);
  bilan.erreurScript = String(e.message || e);
  await d.saveScreenshot("out/erreur.png").catch(() => {});
  process.exitCode = 1;
} finally {
  await finir?.();
  video.kill("SIGINT");
  await pause(3000);
  await d.deleteSession().catch(() => {});
}
