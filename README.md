# M:TG Buylist Scraper

This tool is designed to provide a lightweight command line utility to scrape the [CardKingdom.com](https://cardkingdom.com/purchasing/mtg_singles) buylist.

## Installation

`npm install -g @dgoings/mtgscraper`

## Development

## Use

```txt
mtgscraper <cmd> [args]

Commands:
  mtgscraper code <setNames..>                        Get the Wizards three-letter code for a set
  mtgscraper update                                   Update the setlist mapping
  mtgscraper search <query>                           Search all sets for possible options to scrape, query is any valid JS regex
  mtgscraper scrape [sets] [filters] [file] [search]  Scrape all provided sets                                                                                                              [aliases: sc]
  mtgscraper csv <input> <output> [options]           export cards to csv file

Options:
  --version  Show version number                                                                                                                                                                [boolean]
  --help     Show help                                                                                                                                                                          [boolean]

Examples:
  mtgscraper update                                       Update the CardKingdom setlist mapping for scraping (run before your first scrape)
  mtgscraper scrape --sets "Fallen Empires" "Chronicles"  Scrape the FEM and CHR sets
  mtgscraper scrape --sets Kaldheim --filters foil:no -u  Scrape the KLD set excluding foils, after updating the set list
  mtgscraper sc -s Kaldheim -f rarity:mythic              Scrape the KLD set for just mythics
  mtgscraper code Kaldheim                                Get the Wizards TLA set code for the set
  mtgscraper sc -s Kaldheim --file kld.json               Write the scrape results to the file kld.json
  mtgscraper csv --input ./kld.json --output ./kld.csv    Convert all scraped cards to a .csv file
  mtgscraper scrape -s Legends --csv --file legends.csv   Export results directly to csv file
  mtgscraper search theros                                Get list of all sets with "theros" in the name
  mtgscraper scrape --sets Kaldheim --search theros       Scrape Kaldheim plus all sets that match the search "theros"
```
