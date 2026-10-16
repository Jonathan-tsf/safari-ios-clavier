// Real Mobile Safari (iOS simulator): at the first question of a round, after tapping the answer field,
// is the question still on screen, and is the field above the keyboard?
import { remote } from "webdriverio";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync, spawn } from "node:child_process";

mkdirSync("out", { recursive: true });
const URL = process.env.URL || "https://wonderhop.io/en/";
const devs = JSON.parse(execSync("xcrun simctl list devices available -j").toString()).devices;
const runtime = Object.keys(devs).filter((k) => k.includes("iOS")).sort().pop();
const iphone = devs[runtime].find((d) => d.udid === process.env.UDID) || devs[runtime].find((d) => /^iPhone 1[6-7]( |$)/.test(d.name)) || devs[runtime].find((d) => d.name.startsWith("iPhone"));
const version = runtime.split("iOS-")[1].replace(/-/g, ".");
console.log("device", iphone.name, version);

const d = await remote({
  hostname: "127.0.0.1", port: 4723, logLevel: "warn", connectionRetryTimeout: 1200000, connectionRetryCount: 0,
  capabilities: {
    platformName: "iOS", browserName: "Safari",
    "appium:automationName": "XCUITest", "appium:deviceName": iphone.name, "appium:platformVersion": version,
    "appium:udid": iphone.udid, "appium:connectHardwareKeyboard": false, "appium:nativeWebTap": true,
    "appium:wdaLaunchTimeout": 600000, "appium:simulatorStartupTimeout": 600000, "appium:newCommandTimeout": 600, "appium:safariInitialUrl": "about:blank",
  },
});
const video = spawn("xcrun", ["simctl", "io", iphone.udid, "recordVideo", "-f", "out/run.mp4"]);
const log = [];
let n = 0;
async function natif(f) {
  const ctx = await d.getContext();
  await d.switchContext("NATIVE_APP");
  try { return await f(); } finally { await d.switchContext(ctx); }
}
async function etat(nom) {
  const s = await d.execute(() => {
    const vv = window.visualViewport, c = document.querySelector("input.champ"), q = document.querySelector(".partie-question");
    const r = c?.getBoundingClientRect(), qr = q?.getBoundingClientRect();
    return {
      innerHeight, vvH: vv?.height, vvTop: vv?.offsetTop, scrollY,
      clavierCss: getComputedStyle(document.documentElement).getPropertyValue("--clavier"),
      vvHautCss: getComputedStyle(document.documentElement).getPropertyValue("--vv-haut"),
      actif: document.activeElement?.tagName + "." + (document.activeElement?.className || ""),
      champHaut: r?.top, champBas: r?.bottom, valeur: c?.value,
      questionHaut: qr?.top, questionBas: qr?.bottom, question: q?.textContent,
      champVisible: r && vv ? r.top >= vv.offsetTop - 1 && r.bottom <= vv.offsetTop + vv.height + 1 : null,
      questionVisible: qr && vv ? qr.top >= vv.offsetTop - 1 && qr.bottom <= vv.offsetTop + vv.height + 1 : null,
    };
  });
  s.clavierIOS = await natif(() => d.isKeyboardShown()).catch(() => "?");
  await d.saveScreenshot(`out/${String(++n).padStart(2, "0")}-${nom}.png`);
  console.log("ETAPE " + nom, JSON.stringify(s));
  log.push({ etape: nom, ...s });
  return s;
}
const CHAMP = "-ios class chain:**/XCUIElementTypeWebView/**/XCUIElementTypeTextField";
try {
  await d.url(URL);
  await d.pause(6000);
  const web = (await d.getContexts()).find((c) => String(c.id ?? c).startsWith("WEBVIEW"));
  if (web) await d.switchContext(String(web.id ?? web));
  // wait for the real page (an about:blank document refuses localStorage: "The operation is insecure")
  for (let i = 0; i < 30; i++) {
    const ok = await d.execute(() => location.protocol.startsWith("http") && document.readyState === "complete").catch(() => false);
    if (ok) break;
    await d.pause(1000);
  }
  // test device: measurement off (same flag as Jonathan's own devices), then reload
  await d.execute(() => localStorage.setItem("wonderhop.moi", "1")).catch((e) => console.log("flag moi non posé", e.message));
  await d.url(URL);
  await d.pause(6000);
  await etat("accueil");
  await natif(async () => { const e = await d.$(`-ios predicate string:label BEGINSWITH[c] "sky"`); await e.waitForExist({ timeout: 120000 }); await e.click(); });
  await (await d.$("input.champ")).waitForExist({ timeout: 30000 });
  await d.pause(3000);
  await etat("q1-debut");
  // a person taps the answer field
  await natif(async () => { const f = await d.$(CHAMP); await f.waitForExist({ timeout: 30000 }); await f.click(); });
  await d.pause(2500);
  let s = await etat("q1-champ-touche");
  if (s.clavierIOS !== true) {
    // second try: tap at the field's screen position
    await natif(async () => {
      const f = await d.$(CHAMP); const p = await f.getLocation(), t = await f.getSize();
      await d.execute("mobile: tap", { x: p.x + t.width / 2, y: p.y + t.height / 2 });
    });
    await d.pause(2500);
    s = await etat("q1-champ-touche-2");
  }
  await natif(async () => { const f = await d.$(CHAMP); await f.addValue("cat"); });
  await d.pause(1500);
  await etat("q1-apres-frappe");
} catch (e) {
  console.error(e);
  await d.saveScreenshot("out/erreur.png").catch(() => {});
  process.exitCode = 1;
} finally {
  writeFileSync("out/etats.json", JSON.stringify(log, null, 1));
  video.kill("SIGINT");
  await new Promise((r) => setTimeout(r, 3000));
  await d.deleteSession().catch(() => {});
}
