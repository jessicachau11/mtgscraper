const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
import { getCardsFromSets } from './queries/getAllFromSet';
import { getAllSets } from './queries/getAllSets';
import { getSetCode, findSets } from './utilities/utilities';
import { exportCardsToCSV } from './utilities/csv';

export async function mtgscraper() {
  const argv = yargs(hideBin(process.argv))
    .usage('$0 <cmd> [args]')
    .command({
      command: 'code <setNames..>',
      describe: 'Get the Wizards three-letter code for a set',
      builder: (yargs) => {
        yargs.positional('setNames', {
          type: 'array',
          describe: 'List of names to search'
        })
      },
      handler: (argv) => {
        argv.setNames.forEach((set) => console.log(getSetCode(set)))
      }
    })
    .command({
      command: 'update',
      alias: 'u',
      describe: 'Update the setlist mapping'
    })
    .command({
      command: 'search <query>',
      describe: 'Search all sets for possible options to scrape, query is any valid JS regex',
      handler: (argv) => {
        console.log(findSets(argv.query))
      }
    })
    .command({
      command: 'scrape [sets] [filters] [file] [search]',
      aliases: ['sc'],
      describe: 'Scrape all provided sets',
      builder: (yargs) => {
        yargs.option('sets', {
          alias: ['editions','s'],
          type: 'array',
          group: 'Sets:',
          describe: `List all set names to scrape
Must wrap multi-word names in quotes
Default output file: mtgscraper.json

Special set options:
All Editions - Don't filter by set (only use in conjunction with other filters)
Standard - Search standard legal sets
Modern - Search modern legal sets`
        }).option('filters', {
          alias: ['f'],
          group: 'Filters:',
          describe: `Available filters:

nonfoil:yes|no - Show nonfoil cards (default yes)

foil:yes|no - Show foil cards (default yes).
Note that cards with no nonfoil printing (e.g. FTV cards) may still show up with foil:no

rarity:mythic|rare|uncommon|common|basic|special - Which rarities to show
Can use comma separated list for multiple rarities

"name:cardname" - Search for cardname in card titles (regex only on whole words)

"price:(<=|>=)XX.YY" - Specify price operator and value in XX dollars YY cents`,
          type: 'array'
        }).option('file', {
          describe: 'Filepath for output file',
          type: 'string'
        }).option('csv', {
          describe: 'Convert results directly to CSV',
          type: 'boolean',
          default: false
        }).option('search', {
          alias: 'query',
          describe: 'Scrape all sets that match the search query. Can be combined with --sets',
          type: 'string'
        }).option('update', {
          alias: 'u',
          describe: 'Update setlist before scraping',
          type: 'boolean',
          default: false
        })
      }
    })
    .command({
      command: 'csv <input> <output> [options]',
      describe: 'export cards to csv file',
      builder: (yargs) => {
        yargs.option('input', {
          alias: ['inputFile', 'in', 'read'],
          describe: 'Filepath to read input JSON file to be converted',
          type: 'string'
        }).option('output', {
          alias: ['outputFile', 'out', 'write'],
          describe: 'Filepath to write output CSV file to',
          type: 'string'
        }).option('options', {
          describe: 'Set processing options for the output csv file',
          type: 'array',
          choices: ['rl', 'cashonly', 'creditonly']
        })
      }
    })
    .example('$0 update', 'Update the CardKingdom setlist mapping for scraping (run before your first scrape)')
    .example('$0 scrape --sets "Fallen Empires" "Chronicles"', 'Scrape the FEM and CHR sets')
    .example('$0 scrape --sets Kaldheim --filters foil:no -u', 'Scrape the KLD set excluding foils, after updating the set list')
    .example('$0 sc -s Kaldheim -f rarity:mythic', 'Scrape the KLD set for just mythics')
    .example('$0 code Kaldheim', 'Get the Wizards TLA set code for the set')
    .example('$0 sc -s Kaldheim --file kld.json', 'Write the scrape results to the file kld.json')
    .example('$0 csv --input ./kld.json --output ./kld.csv', 'Convert all scraped cards to a .csv file')
    .example('$0 scrape -s Legends --csv --file legends.csv', 'Export results directly to csv file')
    .example('$0 search theros', 'Get list of all sets with "theros" in the name')
    .example('$0 scrape --sets Kaldheim --search theros', 'Scrape Kaldheim plus all sets that match the search "theros"')
    .help()
    .wrap(yargs.terminalWidth())
    .argv

  // console.log(argv)

  const cmd = argv._[0];

  if (argv.update || (cmd === 'update') || (cmd === 'u')) {
    console.log('updating set file');
    const sets = await getAllSets();
    fs.writeFileSync(path.join(__dirname, '../assets/sets.json'), JSON.stringify(sets), () => { });
  }

  if (cmd === 'scrape' || cmd === 'sc') {
    const sets = argv.sets || [];
    const querySets = findSets(argv.query || '');
    const myCards = await getCardsFromSets(sets.concat(querySets), argv.filters);

    const output = (argv.csv)
      ? exportCardsToCSV(myCards)
      : JSON.stringify(myCards);

    const outputFile = (argv.file)
      ? argv.file
      : (argv.csv)
        ? 'mtgscraper.csv'
        : 'mtgscraper.json';

    fs.writeFileSync(path.join(process.cwd(), outputFile), output, () => { });
  }

  if (cmd === 'csv') {
    const options = {
      rl: argv.options.includes('rl'),
      cashonly: argv.options.includes('cashonly'),
      creditonly: argv.options.includes('creditonly')
    }
    const csv = exportCardsToCSV(argv.inputFile || 'mtgscraper.json', options);
    fs.writeFileSync(path.resolve(process.cwd(), argv.outputFile || 'mtgscraper.csv'), csv, () => { });
  }
};
