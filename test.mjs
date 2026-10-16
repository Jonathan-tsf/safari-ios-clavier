// Real Mobile Safari (iOS simulator): at the first question of a round, after tapping the answer field,
// is the question still on screen, and is the field above the keyboard?
// Taps are real touches at screen coordinates (mobile: tap), computed before the round starts,
// so the 30-second question timer is not eaten by slow element lookups.
import { remote } from "webdriverio";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync, spawn } from "node:child_process";

mkdirSync("out", { recursive: true });
const URL = process.env.URL || "https://wonderhop.io/en/";
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
    "appium:wdaLaunchTimeout": 600000, "appium:simulatorStartupTimeout": 600000, "appium:newCommandTimeout": 600, "appium:safariInitialUrl": "about:blank",
    // cold simulator booted by Appium: Safari takes a while to show up in the remote debugger
    "appium:webviewConnectTimeout": 180000, "appium:webkitResponseTimeout": 60000,
  },
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let d;
try { d = await remote(opts); } catch (e) { console.log("session: second try after", e.message); await pause(30000); d = await remote(opts); }

const video = spawn("xcrun", ["simctl", "io", iphone.udid, "recordVideo", "-f", "out/run.mp4"]);
const log = [];
let n = 0;
async function natif(f) {
  const ctx = await d.getContext();
  await d.switchContext("NATIVE_APP");
  try { return await f(); } finally { await d.switchContext(ctx); }
}
const MESURE = () => {
  const vv = window.visualViewport, c = document.querySelector("input.champ"), q = document.querySelector(".partie-question");
  const r = c?.getBoundingClientRect(), qr = q?.getBoundingClientRect();
  const cs = getComputedStyle(document.documentElement);
  return {
    innerHeight, vvH: vv?.height, vvTop: vv?.offsetTop, scrollY,
    clavierCss: cs.getPropertyValue("--clavier"), vvHautCss: cs.getPropertyValue("--vv-haut"),
    actif: document.activeElement?.tagName + "." + (document.activeElement?.className || ""),
    champHaut: r?.top, champBas: r?.bottom, valeur: c?.value,
    questionHaut: qr?.top, questionBas: qr?.bottom, question: q?.textContent,
    champVisible: r && vv ? r.top >= vv.offsetTop - 1 && r.bottom <= vv.offsetTop + vv.height + 1 : null,
    questionVisible: qr && vv ? qr.top >= vv.offsetTop - 1 && qr.bottom <= vv.offsetTop + vv.height + 1 : null,
  };
};
/** Full state: page measurements, iOS keyboard, screenshot. `vite`: page measurements only (no slow calls). */
async function etat(nom, vite = false) {
  const s = await d.execute(MESURE);
  if (!vite) {
    s.clavierIOS = await natif(() => d.isKeyboardShown()).catch(() => "?");
    await d.saveScreenshot(`out/${String(++n).padStart(2, "0")}-${nom}.png`);
  }
  console.log("ETAPE " + nom, new Date().toISOString().slice(11, 19), JSON.stringify(s));
  log.push({ etape: nom, ...s });
  return s;
}
try {
  await d.url(URL);
  const web = (await d.getContexts()).find((c) => String(c.id ?? c).startsWith("WEBVIEW"));
  if (web) await d.switchContext(String(web.id ?? web));
  const pageChargee = async () => {
    for (let i = 0; i < 40; i++) {
      const ok = await d.execute(() => location.protocol.startsWith("http") && document.readyState === "complete" && !!document.querySelector(".mode-bouton")).catch(() => false);
      if (ok) return true;
      await pause(1000);
    }
    return false;
  };
  await pageChargee();
  // test device: measurement off (same flag as Jonathan's own devices), then reload
  await d.execute(() => localStorage.setItem("wonderhop.moi", "1")).catch((e) => console.log("flag moi non posé", e.message));
  await d.url(URL);
  await pageChargee();
  await pause(2000);

  console.log("bundle", await d.execute(() => [...document.scripts].map((s) => s.src).find((s) => s.includes("/assets/index-")) || "?"));
  // where the page sits on the screen (points), once, before the round starts: the SKY button seen natively vs in the page
  const centrePage = (s) => d.execute((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, s);
  const skyPage = await centrePage(".mode-bouton");
  const skyNatif = await natif(async () => { const e = await d.$(`-ios predicate string:label BEGINSWITH[c] "sky"`); await e.waitForExist({ timeout: 60000 }); const p = await e.getLocation(); const t = await e.getSize(); return { x: p.x + t.width / 2, y: p.y + t.height / 2 }; });
  const dx = skyNatif.x - skyPage.x, dy = skyNatif.y - skyPage.y;
  console.log("décalage page → écran", JSON.stringify({ skyPage, skyNatif, dx, dy }));
  const toucher = async (sel) => {
    const r = await centrePage(sel);
    if (!r) return false;
    await d.execute("mobile: tap", { x: r.x + dx, y: r.y + dy });
    return true;
  };
  await etat("accueil");

  // Safari tip bubbles ("View Bookmarks, Share Menu…") cover the bottom of the page: close them
  const fermerAstuces = () => natif(async () => {
    const b = await d.$$(`-ios predicate string:type == "XCUIElementTypeButton" AND (label ==[c] "Close" OR name ==[c] "Close")`);
    for (const x of b) { await x.click().catch(() => {}); console.log("astuce Safari fermée"); }
  }).catch(() => {});
  await fermerAstuces();
  // Appium can block for ~30 s at any page read once the keyboard opens: the page records itself every 100 ms
  // from the home screen on, and nothing reads the page between the SKY tap and the field tap.
  await d.execute(() => {
    window.__j = []; const t0 = performance.now();
    const note = (ev) => {
      const vv = visualViewport, q = document.querySelector(".partie-question"), c = document.querySelector("input.champ");
      const qr = q && q.getBoundingClientRect(), cr = c && c.getBoundingClientRect(), cs = getComputedStyle(document.documentElement);
      window.__j.push([Math.round(performance.now() - t0), ev, Math.round(vv.height), Math.round(vv.offsetTop), scrollY,
        cs.getPropertyValue("--clavier"), cs.getPropertyValue("--vv-haut") || "-", qr ? Math.round(qr.top) : null, qr ? Math.round(qr.bottom) : null,
        cr ? Math.round(cr.top) : null, cr ? Math.round(cr.bottom) : null, document.activeElement && document.activeElement.tagName]);
    };
    window.__ji = setInterval(() => note("."), 100);
    visualViewport.addEventListener("resize", () => note("vv-resize")); visualViewport.addEventListener("scroll", () => note("vv-scroll"));
    document.addEventListener("focusin", () => note("focusin"));
    document.addEventListener("touchstart", () => note("TOUCHER"), { capture: true, passive: true });
  });
  const t0 = Date.now(), t = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
  await toucher(".mode-bouton");                                   // SKY
  console.log("SKY touché", t());
  await pause(5500);                                               // round starts, question opening (1.6 s)
  // the answer field, where it sits at question 1 (measured on earlier runs: mock pages have one more help line)
  const champ = { x: 140, y: URL.includes("mock") ? 606 : 656 };
  console.log("appui sur le champ", JSON.stringify(champ), t());
  await d.execute("mobile: tap", { x: champ.x + dx, y: champ.y + dy });
  console.log("appui fait", t());
  await pause(6000);
  const j = await d.execute(() => { clearInterval(window.__ji); return window.__j; }).catch((e) => { console.log("journal illisible", e.message); return []; });
  writeFileSync("out/journal.json", JSON.stringify(j));
  let avant = "";
  for (const [ms, ev, h, top, sy, cl, vh, qh, qb, ch, cb, f] of j) {
    const l = `vvH ${h} vvTop ${top} scrollY ${sy} --clavier ${cl} --vv-haut ${vh} question ${qh}→${qb} champ ${ch}→${cb} focus ${f}`;
    const cachee = qh !== null && (qb <= top || qh < top - 1) ? "  <-- QUESTION CACHÉE" : "";
    const sous = ch !== null && h < 650 && cb > top + h + 1 ? "  <-- CHAMP SOUS LE CLAVIER" : "";
    if (l !== avant || ev !== ".") console.log(`JOURNAL ${String(ms).padStart(5)} ms ${ev.padEnd(9)} ${l}${cachee}${sous}`);
    avant = l;
  }
  await etat("fin");
} catch (e) {
  console.error(e);
  await d.saveScreenshot("out/erreur.png").catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync("out/etats.json", JSON.stringify(log, null, 1));
  video.kill("SIGINT");
  await pause(3000);
  await d.deleteSession().catch(() => {});
}
