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
  console.log("ETAPE " + nom, JSON.stringify(s));
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

  const partieLancee = async (ms) => (await d.$("input.champ")).waitForExist({ timeout: ms }).then(() => true, () => false);
  await toucher(".mode-bouton");                                   // SKY
  if (!(await partieLancee(6000))) { console.log("SKY : second appui"); await toucher(".mode-bouton"); }
  if (!(await partieLancee(6000))) { console.log("SKY : clic de secours"); await d.execute(() => document.querySelector(".mode-bouton")?.click()); }
  await (await d.$("input.champ")).waitForExist({ timeout: 20000 });
  await pause(2200);                                               // opening of the question (1.6 s)
  await etat("q1-avant-appui", true);
  await toucher("input.champ");                                    // a person taps the answer field
  await pause(1500);
  await etat("q1-champ-touche");
  await pause(2000);
  await etat("q1-2s-plus-tard");
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
