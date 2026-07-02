/* ======================================================================
   Messaging module — end-to-end test harness (Phase 4)
   Zero test-framework dependency: a tiny runner over Playwright core.
   Run:  node tests/messaging.test.mjs
   Exits non-zero if any assertion fails.
   ====================================================================== */
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// --- Resolve Playwright whether installed locally or globally -----------
let pw;
try { pw = await import("playwright"); }
catch { pw = await import("/opt/node22/lib/node_modules/playwright/index.js"); }
const chromium = pw.chromium || (pw.default && pw.default.chromium);

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = pathToFileURL(join(__dirname, "..", "messaging.html")).href;
const EXEC = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";

// --- Minimal assertion + reporting -------------------------------------
let passed = 0, failed = 0;
const results = [];
function ok(cond, name, detail = "") {
  if (cond) { passed++; results.push(`  ✓ ${name}`); }
  else { failed++; results.push(`  ✗ ${name}${detail ? "  — " + detail : ""}`); }
}
const eq = (a, b, name) => ok(a === b, name, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// --- Browser bootstrap --------------------------------------------------
async function launch() {
  try { return await chromium.launch({ executablePath: EXEC }); }
  catch { return await chromium.launch(); }
}
async function fresh(browser, colorScheme = "light") {
  const ctx = await browser.newContext({ colorScheme, viewport: { width: 760, height: 760 } });
  const page = await ctx.newPage();
  await page.goto(APP_URL);
  await page.waitForSelector("#input");
  return { ctx, page };
}
const bodies = (page) => page.$$eval(".msg__body", els => els.map(e => e.textContent));

// ========================================================================
const browser = await launch();
try {
  // --- 1. Send + render ------------------------------------------------
  {
    const { ctx, page } = await fresh(browser);
    await page.fill("#input", "hello world");
    await page.click("#send");
    const b = await bodies(page);
    ok(b.includes("hello world"), "send: message renders in log");
    eq(await page.inputValue("#input"), "", "send: input clears after send");
    await ctx.close();
  }

  // --- 2. Persistence across reload ------------------------------------
  {
    const { ctx, page } = await fresh(browser);
    await page.fill("#input", "persist me");
    await page.click("#send");
    await page.reload();
    await page.waitForSelector(".msg__body");
    ok((await bodies(page)).includes("persist me"), "persistence: message survives reload");
    await ctx.close();
  }

  // --- 3. XSS safety ---------------------------------------------------
  {
    const { ctx, page } = await fresh(browser);
    let alertFired = false;
    page.on("dialog", async d => { if (d.type() === "alert") alertFired = true; await d.dismiss(); });
    const payload = '<img src=x onerror="window.__xss=1">';
    await page.fill("#input", payload);
    await page.click("#send");
    await page.waitForTimeout(200);
    ok(!alertFired, "xss: no alert dialog fired");
    eq(await page.evaluate(() => window.__xss), undefined, "xss: onerror handler did not execute");
    eq(await page.$eval(".msg__body", e => e.querySelectorAll("img").length), 0, "xss: payload not parsed as an <img> element");
    ok((await bodies(page)).includes(payload), "xss: payload preserved as literal text");
    await ctx.close();
  }

  // --- 4. Keyboard: Enter sends, Shift+Enter newlines, empty blocked ---
  {
    const { ctx, page } = await fresh(browser);
    await page.focus("#input");
    await page.keyboard.type("via enter");
    await page.keyboard.press("Enter");
    ok((await bodies(page)).includes("via enter"), "keyboard: Enter sends");

    await page.focus("#input");
    await page.keyboard.type("line1");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("line2");
    ok((await page.inputValue("#input")).includes("\n"), "keyboard: Shift+Enter inserts newline (no send)");

    // clear, try sending whitespace only
    await page.fill("#input", "   ");
    eq(await page.getAttribute("#send", "disabled") !== null ? "disabled" : "enabled", "disabled", "keyboard: whitespace-only keeps Send disabled");
    await ctx.close();
  }

  // --- 5. Edit ---------------------------------------------------------
  {
    const { ctx, page } = await fresh(browser);
    await page.fill("#input", "editable"); await page.click("#send");
    await page.hover(".msg");
    await page.click('[data-action="edit"]');
    await page.fill(".edit__input", "edited text");
    await page.click('[data-action="edit-save"]');
    ok((await bodies(page)).includes("edited text"), "edit: body updates");
    ok(await page.$(".msg__edited") !== null, "edit: '· edited' marker appears");
    await ctx.close();
  }

  // --- 6. Delete + reply re-pointing ----------------------------------
  {
    const { ctx, page } = await fresh(browser);
    page.on("dialog", async d => { await d.accept(); }); // confirm()
    await page.fill("#input", "parent"); await page.click("#send");
    // reply to parent
    await page.hover(".msg");
    await page.click('[data-action="reply"]');
    ok(await page.isVisible("#replying"), "reply: banner shows when replying");
    await page.fill("#input", "child reply"); await page.click("#send");
    ok(await page.$(".msg__replyref") !== null, "reply: reply reference renders on child");

    // delete the parent (first message)
    await page.hover(".msg:first-child");
    await page.click(".msg:first-child [data-action='delete']");
    const b = await bodies(page);
    ok(!b.includes("parent"), "delete: parent removed");
    ok(b.includes("child reply"), "delete: reply survives");
    const refText = await page.$eval(".msg__replyref", e => e.textContent);
    ok(/deleted message/i.test(refText), "delete: orphaned reply shows 'deleted message'");
    await ctx.close();
  }

  // --- 7. Import validation (hostile / malformed JSON) -----------------
  {
    const { ctx, page } = await fresh(browser);
    // 7a. junk file rejected
    const junk = join(tmpdir(), "junk.json");
    writeFileSync(junk, "not json at all {{{");
    await page.setInputFiles("#importFile", junk);
    await page.waitForTimeout(150);
    ok((await page.textContent("#status")).toLowerCase().includes("import failed"), "import: malformed JSON rejected with error");

    // 7b. valid file with a bad entry -> only valid messages imported
    page.once("dialog", async d => { await d.accept(); }); // confirm replace
    const good = join(tmpdir(), "good.json");
    writeFileSync(good, JSON.stringify({
      schemaVersion: 1,
      messages: [
        { id: "x", author: "You", body: "imported ok", createdAt: Date.now(), editedAt: null, replyTo: null },
        { id: 42, body: 123 } // invalid -> must be dropped
      ]
    }));
    await page.setInputFiles("#importFile", good);
    await page.waitForTimeout(150);
    const b = await bodies(page);
    ok(b.includes("imported ok"), "import: valid message imported");
    eq(b.length, 1, "import: invalid entry dropped by validation");
    await ctx.close();
  }

  // --- 8. Export produces valid JSON of current state -----------------
  {
    const { ctx, page } = await fresh(browser);
    await page.fill("#input", "to export"); await page.click("#send");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#export"),
    ]);
    const stream = await download.createReadStream();
    let text = "";
    for await (const chunk of stream) text += chunk;
    const parsed = JSON.parse(text);
    ok(Array.isArray(parsed.messages) && parsed.messages.some(m => m.body === "to export"),
       "export: downloaded JSON contains current messages");
    ok(/\.json$/.test(download.suggestedFilename()), "export: filename ends in .json");
    await ctx.close();
  }

  // --- 9. Accessibility structure -------------------------------------
  {
    const { ctx, page } = await fresh(browser);
    eq(await page.getAttribute("#log", "role"), "log", "a11y: log has role=log");
    eq(await page.getAttribute("#log", "aria-live"), "polite", "a11y: log is aria-live=polite");
    ok(await page.$("label[for='input']") !== null, "a11y: composer textarea has a label");
    await ctx.close();
  }

} finally {
  await browser.close();
}

// --- Report -------------------------------------------------------------
console.log("\nMessaging module — Phase 4 test run\n" + "-".repeat(38));
console.log(results.join("\n"));
console.log("-".repeat(38));
console.log(`${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
