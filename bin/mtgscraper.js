// ... your existing code above unchanged ...

// ===== Targeted write: only the new timestamp column + append new rows (A:B only) =====
async function writeCardsAsRows(cards) {
  const sheetName = "CK_buylist_scraper";

  // Read existing grid
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:ZZZ`,
  });
  const rows = res.data.values || [];
  const header = rows[0] || ["Card Name", "Edition"];
  const dataRows = rows.slice(1);

  // Compute header position for new time-series column
  let lastNonEmpty = 0;
  for (let i = header.length - 1; i >= 0; i--) {
    if ((header[i] ?? "") !== "") { lastNonEmpty = i + 1; break; }
  }
  const baseCols   = Math.max(header.length, lastNonEmpty);
  const newColIndex = baseCols + 1;
  const newColA1    = colToA1(newColIndex);

  await ensureColumnCapacity(sheetName, newColIndex);

  // write serial to header
  const serial = toSheetsSerial();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${newColA1}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[serial]] },
  });

  // ✅ enforce datetime format with desired pattern
  const ssMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetId = ssMeta.data.sheets.find(s => s.properties.title === sheetName).properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: newColIndex - 1,
            endColumnIndex: newColIndex
          },
          cell: { userEnteredFormat: { numberFormat: { type: "DATE_TIME", pattern: "MM-dd-yyyy hh:mm AM/PM" } } },
          fields: "userEnteredFormat.numberFormat"
        }
      }]
    }
  });

  // ... rest of writeCardsAsRows unchanged ...
}

// ... scrapeBulkPage unchanged ...

// Write to CK_bulk_scraper: names in col A (row2+), new price column per run
async function writeBulkPrices(items) {
  const sheetName = "CK_bulk_scraper";

  // Read existing grid
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:ZZZ`,
  });
  const rows = res.data.values || [];
  const header = rows[0] || [];
  const dataRows = rows.slice(1);

  // Column math — next empty col
  let lastNonEmpty = 0;
  for (let i = header.length - 1; i >= 0; i--) {
    if ((header[i] ?? "") !== "") { lastNonEmpty = i + 1; break; }
  }
  const baseCols = Math.max(header.length, lastNonEmpty, 1);
  const newColIndex = Math.max(baseCols + 1, 2);
  const newColA1 = colToA1(newColIndex);

  await ensureColumnCapacity(sheetName, newColIndex);

  // header serial
  const serial = toSheetsSerial();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${newColA1}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[serial]] },
  });

  // ✅ enforce datetime format in header
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetId = meta.data.sheets.find(s => s.properties.title === sheetName).properties.sheetId;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0, endRowIndex: 1,
            startColumnIndex: newColIndex - 1, endColumnIndex: newColIndex,
          },
          cell: { userEnteredFormat: { numberFormat: { type: "DATE_TIME", pattern: "MM-dd-yyyy hh:mm AM/PM" } } },
          fields: "userEnteredFormat.numberFormat"
        }
      }]
    }
  });

  // ... rest of writeBulkPrices unchanged ...
}
