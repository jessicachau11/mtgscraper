const { Scraper, Root, CollectContent } = require('nodejs-web-scraper');

const baseConfig = {
  baseSiteUrl: `https://cardkingdom.com`,
  filePath: './cards/',
  logPath: './logs/',
  delay: 1000
}

export class CKScraper {
  constructScraper(query) {
    return new Scraper({
      ...baseConfig,
      startUrl: `https://cardkingdom.com/${query}`,
    });
  }

  constructor(query) {
    this.scraper = this.constructScraper(query);
  }

  async scrape(root) {
    await this.scraper.scrape(root)
  }

  async getPageCount() {
    const pageRoot = new Root();
    const pageCount = new CollectContent('.mainListing .pagination li a', { name: 'page' });
    pageRoot.addOperation(pageCount);

    await this.scrape(pageRoot);
    const pageNumbers = pageCount.getData().map((page) => {
      return Number.parseInt(page);
    }).filter((num) => {
      return Number.isInteger(num);
    }).sort((a, b) => {
      return a - b;
    });

    return pageNumbers[pageNumbers.length-1];
  }

  async getPaginationConfig() {
    return {
      queryString: 'page',
      begin: 1,
      end: await this.getPageCount()
    }
  }
}
