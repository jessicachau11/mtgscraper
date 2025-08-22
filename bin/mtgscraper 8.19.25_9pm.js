#!/usr/bin/env node

import { google } from "googleapis";
import fetch from "node-fetch";
import { load } from "cheerio";

// ======= Google Sheets setup =======
const KEYFILEPATH = "/Users/Jessica/mtgscraper/core-trees-469300-m2-e8526e6ceb46.json";
const SPREADSHEET_ID = "1_yLY6WHXpDq974gWveUHs_A1zF8jl3E4xmSKjnQqfcs";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});
const sheets = google.sheets({ version: "v4", auth });

// ======= Helpers =======

function seattleStamp() {
  const s = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const m = s.match(/(\d+)\/(\d+)\/(\d+),\s*(.+)/);
  const [month, day, year, time] = m.slice(1);
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")} ${time}`;
}

// Ensure the sheet has at least `neededCols` columns
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

// Read filters from "Filters" sheet and stamp Last Attempt in col I
async function getFiltersFromSheet() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Filters!A2:I", // include Last Attempt (col I)
  });

  const rows = res.data.values || [];
  const filters = [];
  const updates = [];
  const stampNow = seattleStamp(); // single timestamp for this run

  rows.forEach((row, i) => {
    const edition     = row[0] || "";
    const rarity      = (row[1] || "").split(",").map((r) => r.trim()).filter(Boolean);
    const format      = row[2] || "";
    const sort        = row[3] || "price_desc";
    const perPage     = row[4] || "100";
    const name        = row[5] || "";
    // NOTE: your logic treats "no" as includeFoil=false ⇒ non-foil only
    const includeFoil = (row[6] || "").toLowerCase() === "no";
    const track       = (row[7] || "").toLowerCase() === "yes";

    if (track) {
      filters.push({ edition, rarity, format, sort, perPage, name, includeFoil, track });
      const rowIndex = i + 2; // A2 is row 2
      updates.push({ range: `Filters2!I${rowIndex}`, values: [[stampNow]] });
      // If you prefer "only if blank", check row[8] first.
    }
  });

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }

  return filters;
}

// Build CK filter URL with pagination
function buildFilterUrl({ edition, rarity, format, sort, perPage, name, includeFoil }, page = 1) {
  const params = new URLSearchParams();
  params.set("filter[sort]", sort);
  params.set("filter[search]", "mtg_advanced");
  params.set("filter[singles]", "1");
  params.set("filter[edition]", edition);
  if (name) params.set("filter[name]", name);
  if (format) params.set("filter[format]", format);
  if (!includeFoil) params.set("filter[foil]", "0"); // only non-foil
  if (rarity.length > 0) rarity.forEach((r, i) => params.set(`filter[rarity][${i}]`, r));
  params.set("page_size", perPage);
  params.set("page", page);
  return `https://www.cardkingdom.com/purchasing/mtg_singles?${params.toString()}`;
}

// Scrape cards for a given filter (all pages)
function norm(s) { return String(s ?? "").trim().toLowerCase(); }
function makeKey({ name, edition, rarity, condition, collectorNumber }) {
  return [name, edition, rarity, condition, collectorNumber].map(norm).join("||");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrapeFilteredCards(filter) {
  const perPage = Number(filter.perPage || 100);
  const seenCardKeys = new Set();
  const seenPageFingerprints = new Set();
  const allCards = [];
  let page = 1;

  while (true) {
    const url = buildFilterUrl(filter, page);
    console.log(`🌐 Fetching ${url}`);
    let html;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ck-scraper/1.0)" }
      });
      if (!res.ok) {
        console.warn(`⚠️ HTTP ${res.status} on page ${page}; stopping pagination for this filter.`);
        break;
      }
      html = await res.text();
    } catch (e) {
      console.warn(`⚠️ Network error on page ${page}: ${e?.message || e}; stopping.`);
      break;
    }

    const $ = load(html);
    const pageCards = [];
    $("div.itemContentWrapper").each((_, el) => {
      const name = $(el).find("span.productDetailTitle a").text().trim();
      const edition = $(el).find("div.productDetailSet").text().trim();
      const rarity = $(el).find("div.productDetailRarity").text().trim();
      const priceText = $(el).find("div.creditSellPrice span.sellDollarAmount").first().text().trim();
      const price = priceText ? parseFloat(priceText.replace("$", "")) : null;
      const condition = $(el).find("div.productDetailCondition").text().trim();
      const collectorNumber = $(el).find("div.productDetailCollectorNumber").text().trim();
      if (name) pageCards.push({ name, edition, rarity, price, condition, collectorNumber });
    });

    if (pageCards.length === 0) { console.log(`ℹ️ Page ${page} returned 0 items. Stopping.`); break; }

    const pageFingerprint = pageCards.map(makeKey).join("::");
    if (seenPageFingerprints.has(pageFingerprint)) { console.log(`ℹ️ Page ${page} repeats. Stopping.`); break; }
    seenPageFingerprints.add(pageFingerprint);

    let addedThisPage = 0;
    for (const card of pageCards) {
      const k = makeKey(card);
      if (!seenCardKeys.has(k)) { seenCardKeys.add(k); allCards.push(card); addedThisPage++; }
    }
    console.log(`✅ Page ${page}: found ${pageCards.length}, added ${addedThisPage}, total ${allCards.length}.`);

    const nextHref = $(`a[href*="page=${page + 1}"]`).attr("href");
    const likelyHasNext = Boolean(nextHref);
    const isLastByCount = pageCards.length < perPage;
    if (!likelyHasNext || isLastByCount) { console.log(`ℹ️ End on page ${page}.`); break; }

    page += 1;
    await sleep(350);
  }
  return allCards;
}

// ===== Targeted write: only the new timestamp column + append new rows =====
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
  const baseCols = Math.max(header.length, lastNonEmpty); // current occupied width
  const newColIndex = baseCols + 1;                       // new timestamp column (1-based)
  const newColA1 = colToA1(newColIndex);

  // 🔸 Ensure grid is wide enough for the new column (prevents "exceeds grid limits")
  await ensureColumnCapacity(sheetName, newColIndex);

  // Map existing rows by Card Name + Edition (your current uniqueness rule)
  const existingNames = dataRows.map(r => r?.[0] ?? "");
  const existingEditions = dataRows.map(r => r?.[1] ?? "");
  const priceByRow = dataRows.map(() => ""); // value for the new column per existing row

  const rowsToAppend = []; // brand-new rows to add (A..newColIndex)

  for (const card of cards) {
    const idx = existingNames.findIndex((c, i) => c === card.name && existingEditions[i] === card.edition);
    if (idx >= 0) {
      priceByRow[idx] = card.price ?? "";
    } else {
      const row = new Array(newColIndex).fill("");
      row[0] = card.name ?? "";
      row[1] = card.edition ?? "";
      row[2] = card.rarity ?? "";
      // row[3] = card.price ?? ""; // keep static Price blank if you rely on time-series
      row[4] = card.condition ?? "";
      row[5] = card.collectorNumber ?? "";
      row[newColIndex - 1] = card.price ?? ""; // put price into the new timestamp column
      rowsToAppend.push(row);
    }
  }

  // 1) Write only the NEW header cell
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${newColA1}1`,
    valueInputOption: "RAW",
    requestBody: { values: [[timestamp]] },
  });

  // 2) Write only the NEW timestamp column values for existing rows
  if (dataRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!${newColA1}2:${newColA1}${dataRows.length + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: priceByRow.map(v => [v]) },
    });
  }

  // 3) Append brand-new rows (doesn't touch existing cells/formulas)
  if (rowsToAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rowsToAppend },
    });
  }

  console.log(`✅ Added header ${timestamp} at ${newColA1}1; updated ${dataRows.length} cells in ${newColA1}; appended ${rowsToAppend.length} rows.`);
}

// ======= Main =======
async function main() {
  const filters = await getFiltersFromSheet();
  if (filters.length === 0) {
    console.error("❌ No filters found in sheet.");
    return;
  }

  const allCardsNested = await Promise.all(filters.map((f) => scrapeFilteredCards(f)));
  const allCards = allCardsNested.flat();

  await writeCardsAsRows(allCards);
}

main();