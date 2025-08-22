const cheerio = require('cheerio');
const { Root, CollectContent } = require('nodejs-web-scraper');
import { buildQuery } from '../utilities/utilities';
import { CKScraper } from '../scraper';

export const getAllSets = async () => {
  const mySets={};
  const getSetInfo = (element) => {
    const $ = cheerio.load(element, null, false);
    $('a').each((i, elem) => {
      mySets[$(elem).text().trim()] = $(elem).attr("href").match(/catalog\/view\/(\d+)$/)[1];
    });
  }

  const setScraper = new CKScraper(buildQuery('catalog/magic_the_gathering/by_az'));

  const sets = new CollectContent('.anchorList table td', {
    contentType: 'html',
    getElementContent: getSetInfo
  });

  const setsRoot = new Root();
  setsRoot.addOperation(sets);

  await setScraper.scrape(setsRoot);

  const blockScraper = new CKScraper(buildQuery('catalog/magic_the_gathering/by_block'));

  const setBlocks = new CollectContent('.shopMain .subpageWrapper div', {
    contentType: 'html',
    getElementContent: getSetInfo
  });

  const blocksRoot = new Root();
  blocksRoot.addOperation(setBlocks);

  await blockScraper.scrape(blocksRoot);

  mySets['All Editions'] = "0";
  mySets['Standard'] = "2779";
  mySets['Modern'] = "2864";

  return mySets;
}

