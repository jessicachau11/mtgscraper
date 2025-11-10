#!/usr/bin/env node

import { google } from "googleapis";
import fetch from "node-fetch";
import { load } from "cheerio";
import mysql from "mysql2/promise";

// ======= Google Sheets setup =======
const KEYFILEPATH = "/Users/Jessica/mtgscraper/core-trees-469300-m2-e8526e6ceb46.json";
const SPREADSHEET_ID = "1_yLY6WHXpDq974gWveUHs_A1zF8jl3E4xmSKjnQqfcs";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});
const sheets = google.sheets({ version: "v4", auth });

// ======= MySQL setup =======
const db = await mysql.createConnection({
  host: "34.42.89.251", // Example: 34.72.123.45
  user: "root",
  password: "Fergus123!",
  database: "mtg_scraper-db",
});
console.log("✅ Connected to MySQL");

// ======= Helpers =======

// Read filters from "Filters" sheet
async function getFiltersFromSheet() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Filters!A2:F",
  });
  const rows = res.data.values || [];
  return rows.map((row) => ({
    edition: row[0] || "",
    rarity: (row[1] || "").split(",").map((r) => r.trim()).filter(Boolean),
    format: row[2] || "",
    sort: row[3] || "price_desc",
    perPage: row[4] || "100",
    name: row[5] || "",
  }));
}

// Build Card Kingdom filter URL with pagination
function buildFilterUrl({ edition, rarity, format, sort, perPage, name }, page = 1) {
  const params = new URLSearchParams();
  params.set("filter[sort]", sort);
  params.set("filter[search]", "mtg_advanced");
  params.set("filter[singles]", "1");
  params.set("filter[edition]", edition);
  if (name) params.set("filter[name]", name);
  if (format) params.set("filter[format]", format);
  if (rarity.length > 0) {
    rarity.forEach((r, i) => params.set(`filter[rarity][${i}]`, r));
  }
  params.set("page_size", perPage);
  params.set("page", page);

  return `https://www.cardkingdom.com/purchasing/mtg_singles?${params.toString()}`;
}

// Scrape cards for given filter (all pages)
async function scrapeFilteredCards(filter, maxPages = 3) {
  let allCards = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = buildFilterUrl(filter, page);
    console.log(`🌐 Fetching ${url}`);
    const res = await fetch(url);
    const html = await res.text();
    const $ = load(html);

    const cards = [];
    $("div.itemContentWrapper").each((_, el) => {
      const name = $(el).find("span.productDetailTitle a").text().trim();
      const edition = $(el).find("div.productDetailSet").text().trim();
      const rarity = $(el).find("div.productDetailRarity").text().trim();
      const priceText = $(el).find("div.creditSellPrice span.sellDollarAmount").first().text().trim();
      const price = priceText ? parseFloat(priceText.replace("$", "")) : null;
      const condition = $(el).find("div.productDetailCondition").text().trim();
      const collectorNumber = $(el).find("div.productDetailCollectorNumber").text().trim();

      if (name) {
        cards.push({ name, edition, rarity, price, condition, collectorNumber });
      }
    });

    if (cards.length === 0) break; // stop when no more results
    allCards = allCards.concat(cards);
  }
  return allCards;
}

// Write results as rows (cards) and columns (timestamps)
async function writeCardsAsRows(cards) {
  const sheetName = "CK_buylist_scraper";
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
  });

  const rows = res.data.values || [];
  let header = rows[0] || ["Card Name", "Edition", "Rarity", "Price", "Condition", "Collector #"];
  let existingCards = rows.slice(1).map((r) => r[0]);

  const seattleDate = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const [month, day, year, time] = seattleDate.match(/(\d+)\/(\d+)\/(\d+),\s*(.+)/).slice(1);
  const timestamp = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${time}`;
  header.push(timestamp);

  const newRows = rows.slice(1).map((r) => [...r, ""]);

  for (const card of cards) {
    const idx = existingCards.findIndex((c) => c === card.name);
    if (idx >= 0) newRows[idx][header.length - 1] = card.price !== null ? card.price : "";
    else {
      const newRow = new Array(header.length).fill("");
      newRow[0] = card.name;
      newRow[1] = card.edition;
      newRow[2] = card.rarity;
      newRow[3] = card.price !== null ? card.price : "";
      newRow[4] = card.condition;
      newRow[5] = card.collectorNumber;
      newRow[header.length - 1] = card.price !== null ? card.price : "";
      newRows.push(newRow);
      existingCards.push(card.name);
    }
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [header, ...newRows] },
  });

  console.log(`✅ Updated sheet with ${cards.length} cards.`);
}

// Write results to MySQL
async function writeCardsToMySQL(cards) {
  const now = new Date();
  const sql = `
    INSERT INTO buylist_prices (date_collected, edition, card_name, price)
    VALUES (?, ?, ?, ?)
  `;
  for (const card of cards) {
    const price = card.price !== null ? card.price : 0;
    await db.execute(sql, [now, card.edition, card.name, price]);
  }
  console.log(`✅ Inserted ${cards.length} rows into MySQL`);
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
  await writeCardsToMySQL(allCards);
}

main();
