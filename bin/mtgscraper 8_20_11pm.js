#!/usr/bin/env node

import { google } from "googleapis";
import fetch from "node-fetch";
import { load } from "cheerio";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process"; // ⬅️ use spawn (detached) instead of exec
import puppeteer from "puppeteer";

// ======= Debug helpers =======
const DEBUG = process.env.CK_DEBUG === "1" || false;          // flip to false or use env
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
function dbg(...args) { if (DEBUG) console.log("[DBG]", ...args); }

const DUMP_HTML = process.env.CK_DUMP === "1" || true;       // save rendered HTML
const AUTO_OPEN_HTML = process.env.CK_OPEN === "1" || true;  // open rendered HTML
const NORMALIZE_RARITY = process.env.CK_NORMALIZE_RARITY === "1"; // OFF by default

function safeSlug(s) {
  return String(s || "unknown").toLowerCase().replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80);
}
function outPathFor(edition, page, runId) {
  const slug = safeSlug(edition);
  return path.join(os.tmpdir(), `ck_${slug}_${runId}_p${page}.html`);
}
function maybeOpen(filePath) {
  if (!AUTO_OPEN_HTML) return;
  const plat = process.platform;
  let cmd, args;
  if (plat === "darwin") { cmd = "open"; args = [filePath]; }
  else if (plat === "win32") { cmd = "cmd"; args = ["/c", "start", "", filePath]; }
  else { cmd = "xdg-open"; args = [filePath]; }

  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.unref(); // ⬅️ don’t keep the event loop alive
    console.log("🔎 Opened:", filePath);
  } catch (err) {
    console.warn("⚠️ Failed to open HTML in browser:", err?.message || err);
  }
}

// ======= Google Sheets setup =======
const KEYFILEPATH = "/Users/Jessica/mtgscraper/core-trees-469300-m2-e8526e6ceb46.json";
const SPREADSHEET_ID = "1_yLY6WHXpDq974gWveUHs_A1zF8jl3E4xmSKjnQqfcs";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const auth = new google.auth.GoogleAuth({ keyFile: KEYFILEPATH, scopes: SCOPES });
const sheets = google.sheets({ version: "v4", auth });

// ======= Helpers =======
function seattleStamp() {
  const s = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const m = s.match(/(\d+)\/(\d+)\/(\d+),\s*(.+)/);
  const [month, day, year, time] = m.slice(1);
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")} ${time}`;
}

async function ensureColumnCapacity(sheetTitle, neededCols) {
  const ss = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = ss.data.sheets.find(s => s.properties?.title === sheetTitle);
  if (!sheet) throw new Error(`Sheet "${sheetTitle}" not found`);
  const sheetId = sheet.properties.sheetId;
  const currentCols = sheet.properties.gridProperties?.columnCount ?? 26;
  if (currentCols < neededCols) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { columnCount: neededCols } },
            fields: "gridProperties.columnCount",
          }
        }]
      }
    });
    dbg("ensureColumnCapacity: expanded", { from: currentCols, to: neededCols });
  }
}

// A1 column letters from 1-based index
function colToA1(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ===== Rarity normalization (opt-in) =====
const RARITY_MAP = {
  c: "Common", common: "Common",
  u: "Uncommon", uncommon: "Uncommon",
  r: "Rare", rare: "Rare",
  m: "Mythic", mythic: "Mythic", "mythic rare": "Mythic",
  s: "Special", special: "Special"
};
function normalizeRarities(rarityArr) {
  if (!NORMALIZE_RARITY) return rarityArr || [];
  return (rarityArr || [])
    .map(r => {
      const k = String(r || "").trim().toLowerCase();
      return RARITY_MAP[k] || r;
    })
    .filter(Boolean);
}

// ===== Read filters from "Filters" and stamp Last Attempt in col I =====
async function getFiltersFromSheet() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Filters!A2:I",
  });

  const rows = res.data.values || [];
  const filters = [];
  const updates = [];
  const stampNow = seattleStamp();

  rows.forEach((row, i) => {
    const edition     = row[0] || "";
    const rarity      = (row[1] || "").split(",").map((r) => r.trim()).filter(Boolean);
    const format      = row[2] || "";
    const sort        = row[3] || "price_desc";
    const perPage     = row[4] || "100";
    const name        = row[5] || "";
    // Your logic: "No" means includeFoil === false → show non-foil only
    const includeFoil = (row[6] || "").toLowerCase() === "no";
    const track       = (row[7] || "").toLowerCase() === "yes";

    dbg("FILTER ROW", {
      row: i + 2, edition, rarityRaw: rarity, format, sort, perPage, name, includeFoil, track
    });

    if (track) {
      filters.push({ edition, rarity, format, sort, perPage, name, includeFoil, track });
      const rowIndex = i + 2; // A2 is row 2
      updates.push({ range: `Filters!I${rowIndex}`, values: [[stampNow]] });
    }
  });

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }

  dbg("FILTERS READY", { count: filters.length });
  return filters;
}

// ===== Build CK filter URL (unchanged; rarity normalization is opt-in) =====
function buildFilterUrl({ edition, rarity, format, sort, perPage, name, includeFoil }, page = 1) {
  const params = new URLSearchParams();
  params.set("filter[sort]", sort || "price_desc");
  params.set("filter[search]", "mtg_advanced");
  params.set("filter[singles]", "1");
  if (edition) params.set("filter[edition]", edition);
  if (name) params.set("filter[name]", name);
  if (format) params.set("filter[format]", format);
  if (includeFoil === false) params.set("filter[foil]", "0"); // non-foil only

  const normRarities = normalizeRarities(rarity);
  normRarities.forEach((r, i) => params.set(`filter[rarity][${i}]`, r));

  params.set("page_size", String(perPage || "100"));
  params.set("page", String(page));
  const url = `https://www.cardkingdom.com/purchasing/mtg_singles?${params.toString()}`;

  const debugParams = {};
  for (const [k, v] of params.entries()) {
    if (!debugParams[k]) debugParams[k] = [];
    debugParams[k].push(v);
  }
  dbg("BUILD URL", {
    page,
    edition,
    rarityRaw: rarity,
    raritySent: normRarities,
    includeFoil,
    name,
    perPage,
    urlPreview: `...${params.toString().slice(0, 200)}${params.toString().length > 200 ? "…" : ""}`
  });

  return url;
}

// ===== page → product normalization =====
function norm(s) { return String(s ?? "").trim().toLowerCase(); }
// ⬇️ collectorNumber removed from de-dupe key
function makeKey({ name, edition, rarity /*, condition*/ }) {
  return [name, edition, rarity].map(norm).join("||");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== Credit-only price helper (no cash fallback) =====
function pickCreditPrice(p) {
  const creditCandidates = [
    p?.price?.credit,
    p?.creditSellPrice,
    p?.credit_price,
    p?.credit,
    p?.prices?.credit,
    p?.price?.storeCredit,
    p?.storeCredit,
  ];
  for (const v of creditCandidates) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return null;
}

// ===== Puppeteer-powered scraper: JSON-first, DOM fallback =====
async function scrapeFilteredCards(filter) {
  const perPage = Number(filter.perPage || 100);
  const seenCardKeys = new Set();
  const allCards = [];
  let pageNum = 1;

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari"
  );

  const jsonBatches = [];
  const responseListener = async (res) => {
    try {
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      if (!ct.includes("application/json")) return;

      const url = res.url();
      const body = await res.json().catch(() => null);
      if (!body) return;

      const candidates = [];
      if (Array.isArray(body)) candidates.push(body);
      if (Array.isArray(body?.items)) candidates.push(body.items);
      if (Array.isArray(body?.results)) candidates.push(body.results);
      if (Array.isArray(body?.products)) candidates.push(body.products);
      if (Array.isArray(body?.data)) candidates.push(body.data);

      for (const arr of candidates) {
        const products = arr.filter(
          (x) =>
            x &&
            (x.name || x.productName || x.title) &&
            (x.set || x.edition || x.productSet || x.setName)
        );
        if (products.length) {
          dbg("JSON endpoint:", url, "items:", products.length);
          jsonBatches.push(
            products.map((p) => ({
              name: p.name || p.productName || p.title || "",
              edition: p.edition || p.productSet || p.setName || "",
              rarity: p.rarity || p.printingRarity || "",
              price: pickCreditPrice(p), // ✅ credit only
              // condition intentionally kept if present (not used in key)
              condition: p.condition || "",
              // ⛔ collectorNumber removed
            }))
          );
        }
      }
    } catch (_) {}
  };

  page.on("response", responseListener);

  try {
    while (true) {
      const url = buildFilterUrl(filter, pageNum);
      dbg("NAV →", { pageNum, url });

      await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });

      // give JS a moment to render items
      try {
        await page.waitForSelector(".itemContentWrapper, .productItem, .productGrid, .productItemView", { timeout: 4000 });
      } catch (_) {}

      if (DUMP_HTML && pageNum === 1) {
        const renderedHtml = await page.content();
        const filePath = outPathFor(filter.edition, pageNum, RUN_ID);
        try {
          fs.writeFileSync(filePath, renderedHtml);
          dbg("WROTE_RENDERED_HTML", filePath);
          maybeOpen(filePath);
        } catch (e) {
          console.warn("⚠️ Failed to write rendered HTML snapshot:", e?.message || e);
        }
      }

      // prefer any JSON captured during this navigation
      let found = [];
      if (jsonBatches.length) {
        found = jsonBatches.flat();
        jsonBatches.length = 0;
        dbg("Using JSON batch:", found.length);
      } else {
        // DOM fallback (after JS) — credit price only
        found = await page.$$eval(
          "div.itemContentWrapper, div.productItemView, div.productItem",
          (els) =>
            els
              .map((el) => {
                const q = (sel) => el.querySelector(sel);
                const txt = (sel) => (q(sel)?.textContent || "").trim();
                const parsePrice = (s) => {
                  const m = String(s || "").match(/[\d.]+/);
                  return m ? parseFloat(m[0]) : null;
                };

                const name = txt("span.productDetailTitle a, a.productDetailTitle, .productDetailTitle");
                const edition = txt("div.productDetailSet, .productDetailSet, .setName");
                const rarity = txt("div.productDetailRarity, .productDetailRarity, .rarity");

                // ✅ CREDIT ONLY
                let price = null;
                let t =
                  txt(".creditSellPrice .sellDollarAmount") ||
                  txt(".creditSellPrice") ||
                  txt("[data-credit-price]");
                if (!t) {
                  const creditNode =
                    q(".creditSellPrice") ||
                    q(".buylist-credit") ||
                    q("[data-credit-price]");
                  if (creditNode) t = creditNode.textContent;
                }
                if (t) price = parsePrice(t);

                const condition = txt("div.productDetailCondition, .productDetailCondition, .condition");

                return name ? { name, edition, rarity, price, condition } : null; // ⛔ no collectorNumber
              })
              .filter(Boolean)
        );
        dbg("Using DOM-extracted items:", found.length);
      }

      if (pageNum === 1) {
        dbg("PAGE1_SAMPLE", found.slice(0, 10).map(c => ({
          name: c.name, rarity: c.rarity, edition: c.edition, price: c.price
        })));
      }

      if (!found.length) {
        dbg("No items found on page", pageNum, "— stopping.");
        break;
      }

      // de-dupe across pages (key excludes collectorNumber)
      let addedThisPage = 0;
      for (const c of found) {
        const key = makeKey(c);
        if (!seenCardKeys.has(key)) {
          seenCardKeys.add(key);
          allCards.push(c);
          addedThisPage++;
        }
      }
      console.log(`✅ Page ${pageNum}: found ${found.length}, added ${addedThisPage}, total ${allCards.length}.`);

      // pagination heuristic:
      const lastByCount = found.length < perPage;
      let hasNext = !lastByCount;
      if (!hasNext) {
        const maybeNext = await page.$(`a[href*="page=${pageNum + 1}"]`);
        hasNext = Boolean(maybeNext);
      }
      dbg("PAGINATION", { page: pageNum, hasNext, lastByCount });

      if (!hasNext) break;
      pageNum += 1;
      await sleep(300);
    }

    console.log(`ℹ️ ${filter.edition} ${filter.rarity?.join(",") || ""}: total ${allCards.length} items.`);
    return allCards;

  } finally {
    try { page.removeListener("response", responseListener); } catch {}
    try { await page.close({ runBeforeUnload: false }); } catch {}
    try { await browser.close(); } catch {}
  }
}

// ===== Helper: parse an updated A1 range into coordinates =====
function parseUpdatedRange(a1) {
  if (!a1) return null;
  const m = String(a1).match(/^(.*?)!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i);
  if (!m) return null;
  return {
    sheet: m[1],
    col1: m[2].toUpperCase(),
    row1: Number(m[3]),
    col2: m[4].toUpperCase(),
    row2: Number(m[5]),
  };
}

// ===== Targeted write: only the new timestamp column + append new rows (A:B only) =====
async function writeCardsAsRows(cards) {
  const sheetName = "CK_buylist_scraper";

  // Read existing grid for header & data
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:ZZ`,
  });
  const rows = res.data.values || [];
  const header = rows[0] || ["Card Name", "Edition"];
  const dataRows = rows.slice(1);

  // Build timestamp label for NEW price column
  const seattleDate = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const m = seattleDate.match(/(\d+)\/(\d+)\/(\d+),\s*(.+)/);
  const [month, day, year, time] = m.slice(1);
  const timestamp = `${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")} ${time}`;

  // Find rightmost non-empty header cell, then add one new column
  let lastNonEmpty = 0; // 1-based; 0 if none
  for (let i = header.length - 1; i >= 0; i--) {
    if ((header[i] ?? "") !== "") { lastNonEmpty = i + 1; break; }
  }
  const baseCols   = Math.max(header.length, lastNonEmpty);
  const newColIndex = baseCols + 1;   // new timestamp column (1-based)
  const newColA1    = colToA1(newColIndex);

  // Ensure grid is wide enough
  await ensureColumnCapacity(sheetName, newColIndex);

  dbg("WRITE_PLAN", {
    sheetName,
    headerWidth: header.length,
    lastNonEmptyHeaderCol: lastNonEmpty || null,
    newColIndex,
    newColA1,
    existingRows: dataRows.length,
    timestamp
  });

  // Build lookup by (Card Name, Edition) for existing rows
  const existingNames = dataRows.map(r => r?.[0] ?? "");
  const existingEditions = dataRows.map(r => r?.[1] ?? "");
  const priceByRow = dataRows.map(() => ""); // values for existing rows in new timestamp col

  // Collect new rows (A:B only) + the prices for those rows
  const minimalRowsToAppend = []; // [[name, edition], ...]
  const pricesForNewRows    = []; // [price, ...]

  for (const card of cards) {
    const idx = existingNames.findIndex((nm, i) =>
      nm === (card.name ?? "") && existingEditions[i] === (card.edition ?? "")
    );
    if (idx >= 0) {
      priceByRow[idx] = card.price ?? "";
    } else {
      minimalRowsToAppend.push([card.name ?? "", card.edition ?? ""]); // ⬅️ only A & B
      pricesForNewRows.push(card.price ?? "");
    }
  }

  // 1) Write only the NEW header cell (timestamp label)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${newColA1}1`,
    valueInputOption: "RAW",
    requestBody: { values: [[timestamp]] },
  });

  // 2) Write the NEW timestamp column for existing rows (doesn't touch C–F)
  if (dataRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!${newColA1}2:${newColA1}${dataRows.length + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: priceByRow.map(v => [v]) },
    });
  }

  // 3) Append brand-new rows with ONLY A:B (no hidden "" in C–F)
  if (minimalRowsToAppend.length > 0) {
    const appendResp = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: minimalRowsToAppend },
    });

    // Determine the exact rows appended so we can fill prices in the new timestamp column
    const updatedRange = appendResp?.data?.updates?.updatedRange; // e.g. 'CK_buylist_scraper!A101:B120'
    const parsed = parseUpdatedRange(updatedRange);

    let startRow, endRow;
    if (parsed && parsed.sheet === sheetName && parsed.row1 >= 1 && parsed.row2 >= parsed.row1) {
      startRow = parsed.row1;
      endRow   = parsed.row2;
    } else {
      // Fallback: infer from existing row count
      startRow = Math.max(2, dataRows.length + 2);
      endRow   = startRow + minimalRowsToAppend.length - 1;
    }

    const newCount = endRow - startRow + 1;
    const tsRange  = `${sheetName}!${newColA1}${startRow}:${newColA1}${endRow}`;
    const tsValues = Array.from({ length: newCount }, (_, i) => [pricesForNewRows[i] ?? ""]);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: tsRange,
      valueInputOption: "RAW",
      requestBody: { values: tsValues },
    });
  }

  console.log(
    `✅ ${timestamp} → ${newColA1}1; updated ${dataRows.length} existing; appended ${minimalRowsToAppend.length} new (A:B only).`
  );
}

// ======= Main =======
async function main() {
  const filters = await getFiltersFromSheet();
  if (filters.length === 0) {
    console.error("❌ No filters found in sheet.");
    return;
  }

  for (const f of filters) {
    dbg("FILTER DEBUG →", {
      edition: f.edition,
      rawRarity: f.rarity,
      normRarity: normalizeRarities(f.rarity),
      includeFoil: f.includeFoil,
      name: f.name || "",
      perPage: f.perPage,
      sort: f.sort
    });
  }

  const allCardsNested = await Promise.all(filters.map((f) => scrapeFilteredCards(f)));
  const allCards = allCardsNested.flat();

  const MUST_HAVE = [
    "Desculpting Blast",
    "All-Fates Stalker",
    "Seedship Agrarian",
  ].map(s => s.toLowerCase());
  const gotNames = new Set(allCards.map(c => String(c.name||"").toLowerCase()));
  const missing = MUST_HAVE.filter(n => !gotNames.has(n));
  dbg("POST_SCRAPE_CHECK", { total: allCards.length, missing });

  await writeCardsAsRows(allCards);
}

main().finally(() => {
  if (process.env.EXIT_ON_FINISH === "1") {
    setImmediate(() => process.exit(0));
  }
});