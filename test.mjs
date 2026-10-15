// Real Mobile Safari (iOS simulator): does the on-screen keyboard cover the answer field after a rejected answer?
import { remote } from "webdriverio";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync, spawn } from "node:child_process";

mkdirSync("out", { recursive: true });
const URL = process.env.URL || "https://wonderhop.io/en/";
const devs = JSON.parse(execSync("xcrun simctl list devices available -j").toString()).devices;
const runtime = Object.keys(devs).filter((k) => k.includes("iOS")).sort().pop();
const iphone = devs[runtime].find((d) => /^iPhone 1[6-7]( |$)/.test(d.name)) || devs[runtime].find((d) => d.name.startsWith("iPhone"));
const version = runtime.split("iOS-")[1].replace(/-/g, ".");
console.log("device", iphone.name, version);

const d = await remote({
  hostname: "127.0.0.1", port: 4723, logLevel: "warn",
  capabilities: {
    platformName: "iOS", browserName: "Safari",
    "appium:automationName": "XCUITest", "appium:deviceName": iphone.name, "appium:platformVersion": version,
    "appium:udid": iphone.udid, "appium:connectHardwareKeyboard": false, "appium:nativeWebTap": true,
    "appium:wdaLaunchTimeout": 600000, "appium:newCommandTimeout": 600, "appium:safariInitialUrl": "about:blank",
  },
});
const video = spawn("xcrun", ["simctl", "io", iphone.udid, "recordVideo", "-f", "out/run.mp4"]);
const log = [];
let n = 0;
async function etat(nom) {
  const ctx = await d.getContext();
  const s = await d.execute(() => {
    const vv = window.visualViewport, c = document.querySelector("input.champ");
    const r = c?.getBoundingClientRect();
    return {
      innerHeight, vvH: vv?.height, vvTop: vv?.offsetTop, scrollY,
      clavierCss: getComputedStyle(document.documentElement).getPropertyValue("--clavier"),
      actif: document.activeElement?.tagName + "." + (document.activeElement?.className || ""),
      champHaut: r?.top, champBas: r?.bottom, valeur: c?.value, erreur: document.querySelector("#erreur-saisie")?.textContent,
      champVisible: r && vv ? r.top >= vv.offsetTop - 1 && r.bottom <= vv.offsetTop + vv.height + 1 : null,
    };
  });
  await d.switchContext("NATIVE_APP");
  s.clavierIOS = await d.isKeyboardShown().catch(() => "?");
  await d.switchContext(ctx);
  const f = `out/${String(++n).padStart(2, "0")}-${nom}.png`;
  await d.saveScreenshot(f);
  console.log(nom, JSON.stringify(s));
  log.push({ etape: nom, ...s });
}
async function tapeNatif(texte) {
  const ctx = await d.getContext();
  await d.switchContext("NATIVE_APP");
  await d.execute("mobile: keys", { keys: [...texte] });
  await d.switchContext(ctx);
}
try {
  await d.url(URL);
  await d.pause(6000);
  const web = (await d.getContexts()).find((c) => String(c.id ?? c).startsWith("WEBVIEW"));
  if (web) await d.switchContext(String(web.id ?? web));
  await etat("accueil");
  const ciel = await d.$("//button[normalize-space(.)='SKY' or normalize-space(.)='CIEL']");
  await ciel.waitForExist({ timeout: 30000 });
  await ciel.click();
  await (await d.$("input.champ")).waitForExist({ timeout: 30000 });
  await d.pause(2500);
  await etat("partie-debut");
  // the keyboard may not be open yet: tap the field like a person would
  if (!(log.at(-1).clavierIOS === true)) { await (await d.$("input.champ")).click(); await d.pause(1500); await etat("champ-touche"); }
  await tapeNatif("!!!\n"); // rejected locally ("Type an answer."), no server call
  await d.pause(1500);
  await etat("apres-refus");
  await (await d.$("input.champ")).click();
  await d.pause(2000);
  await etat("champ-retouche");
  await tapeNatif("x");
  await d.pause(800);
  await etat("apres-frappe");
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
