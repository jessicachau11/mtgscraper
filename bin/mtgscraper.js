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

// Seattle timestamp (serial for Sheets + human string)
function getSeattleTimestamp() {
  const now = new Date();
  const seattle = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const serial = (seattle.getTime() - new Date(Date.UTC(1899, 11, 30)).getTime()) / 86400000; // Excel serial
  return { serial, seattleStr: seattle.toISOString().replace("T", " ").split(".")[0] };
}

// Write results into the "CK_buylist_scraper" matrix sheet
async function writeCardsAsRows(cards) {
  const sheetName = "CK_buylist_scraper";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
  });

  const rows = res.data.values || [];
  let header = rows[0] || ["Card Name", "Edition"];
  let existingCards = rows.slice(1).map((r) => r[0]);
  let existingEditions = rows.slice(1).map((r) => r[1]);

  const { serial } = getSeattleTimestamp();
  header.push(serial);

  const newRows = rows.slice(1).map((r) => [...r, ""]);

  for (const card of cards) {
    const idx = existingCards.findIndex(
      (c, i) => c === card.name && existingEditions[i] === card.edition
    );
    if (idx >= 0) {
      newRows[idx][header.length - 1] = card.price !== null ? card.price : "";
    } else {
      const newRow = new Array(header.length).fill("");
      newRow[0] = card.name;
      newRow[1] = card.edition;
      newRow[header.length - 1] = card.price !== null ? card.price : "";
      newRows.push(newRow);
      existingCards.push(card.name);
      existingEditions.push(card.edition);
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [header, ...newRows] },
  });

  console.log(`✅ Updated matrix sheet with ${cards.length} cards.`);
}

// Append results into "CK_buylist_scraper_rows" (row log)
async function writeCardsAsRowLog(cards) {
  const sheetName = "CK_buylist_scraper_rows";
  const { serial } = getSeattleTimestamp();

  const logRows = cards.map((card) => [
    serial,
    card.edition,
    card.name,
    card.price !== null ? card.price : "",
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:D`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: logRows },
  });

  console.log(`📖 Appended ${cards.length} rows into ${sheetName}.`);
}

// ======= Main =======
async function main() {
  // (reuse your scraping + filter code here)
  const filters = []; // replace with getFiltersFromSheet()
  let allCards = []; // replace with scrapeFilteredCards(filters)

  // --- Example test card ---
  allCards.push({ name: "Test Card", edition: "Edge of Eternities", price: 2.5 });

  await writeCardsAsRows(allCards);
  await writeCardsAsRowLog(allCards);
}

main();
