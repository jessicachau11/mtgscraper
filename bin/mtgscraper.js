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
function makeKey({ name, edition, rarity }) {
  return `${name}::${edition}::${rarity || ""}`;
}

function toNumOrBlank(x) {
  if (x === null || x === undefined || x === "") return "";
  const n = Number(x);
  return isNaN(n) ? "" : n;
}

function toSheetsSerial() {
  const now = new Date();
  const utc = Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds()
  );
  return utc / 86400000 + 25569; // Excel/Sheets serial
}

function colToA1(col) {
  let s = "";
  while (col > 0) {
    let m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

function seattleStampStr() {
  return new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
}

// ======= Scraping Bulk Page =======
async function scrapeBulkPage(url) {
  console.log(`🌐 Fetching bulk page ${url}`);
  const res = await fetch(url);
  const html = await res.text();
  const $ = load(html);

  const cards = [];
  $("div.itemContentWrapper").each((_, el) => {
    const name = $(el).find("span.productDetailTitle a").text().trim();
    const edition = $(el).find("div.productDetailSet").text().trim();
    const rarity = $(el).find("div.productDetailRarity").text().trim();
    const priceText = $(el).find("div.creditSellPrice span.sellDollarAmount").first().text().trim();
    const condition = $(el).find("div.productDetailCondition").text().trim();
    const collectorNumber = $(el).find("div.collectorNumber").text().trim();

    let price = null;
    if (priceText && !/out of stock/i.test(priceText)) {
      price = parseFloat(priceText.replace("$", ""));
    }

    if (name && price !== null) {
      cards.push({ name, edition, rarity, price, condition, collectorNumber });
    }
  });

  return cards;
}

// ======= Write Bulk Prices =======
async function writeBulkPrices(cards) {
  const sheetName = "CK_bulk_prices";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:ZZZ`,
  });

  const rows = res.data.values || [];
  const header = rows[0] || ["Card Name", "Edition", "Rarity"];
  const dataRows = rows.slice(1);

  // Existing row lookup
  const existingMap = new Map();
  dataRows.forEach((r, i) => {
    const key = makeKey({ name: r[0], edition: r[1], rarity: r[2] || "" });
    existingMap.set(key, i + 2);
  });

  // Find new col
  let lastNonEmpty = 0;
  for (let i = header.length - 1; i >= 0; i--) {
    if ((header[i] ?? "") !== "") {
      lastNonEmpty = i + 1;
      break;
    }
  }
  const baseCols = Math.max(header.length, lastNonEmpty);
  const newColIndex = baseCols + 1;
  const newColA1 = colToA1(newColIndex);

  // Write header serial
  const serial = toSheetsSerial();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${newColA1}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[serial]] },
  });

  // Build updates
  const priceByRow = new Array(dataRows.length).fill("");
  const minimalRowsToAppend = [];
  const pricesForNewRows = [];

  for (const c of cards) {
    const key = makeKey(c);
    const price = toNumOrBlank(c.price);

    if (existingMap.has(key)) {
      const rowIndex = existingMap.get(key);
      priceByRow[rowIndex - 2] = price;
    } else {
      minimalRowsToAppend.push([c.name, c.edition, c.rarity]);
      pricesForNewRows.push(price);
    }
  }

  // Update existing rows
  if (dataRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!${newColA1}2:${newColA1}${dataRows.length + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: priceByRow.map((v) => [v]) },
    });
  }

  // Append new rows
  if (minimalRowsToAppend.length > 0) {
    const appendResp = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: minimalRowsToAppend },
    });

    const updatedRange = appendResp?.data?.updates?.updatedRange;
    const startRow = dataRows.length + 2;
    const endRow = startRow + minimalRowsToAppend.length - 1;

    const tsRange = `${sheetName}!${newColA1}${startRow}:${newColA1}${endRow}`;
    const tsValues = pricesForNewRows.map((v) => [v]);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: tsRange,
      valueInputOption: "RAW",
      requestBody: { values: tsValues },
    });
  }

  console.log(`✅ Bulk prices updated with ${cards.length} entries at ${seattleStampStr()}`);
}

// ======= Main =======
async function main() {
  const url = "https://www.cardkingdom.com/purchasing/mtg_singles?filter[sort]=price_desc&filter[search]=mtg_advanced&filter[singles]=1&filter[edition]=edge-of-eternities";
  const cards = await scrapeBulkPage(url);
  await writeBulkPrices(cards);
}

main();
