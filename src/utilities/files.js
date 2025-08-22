import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Reads a JSON file and returns it as an object
function getCardMap(file) {
  const data = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  return JSON.parse(data);
}

export { getCardMap };