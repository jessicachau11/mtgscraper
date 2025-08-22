import { getSetCode } from './utilities';

const isReserved = (cardName, cards) => {
  const card = cards.find((card) => {
    return card.name === cardName
  });
  if (card) {
    return card.isReserved || false;
  }
  return false
}

export const exportCardsToCSV = (cards, options = {}) => {
  const cardMap = (typeof cards === 'string') ? getCardMap(cards) : cards;
  const baseHeader = `Card Name,Edition,Foil,Quantity,Rarity`;

  const priceHeader = (options.cashonly)
    ? `${baseHeader},Cash`
    : (options.creditonly)
      ? `${baseHeader},Credit`
      : `${baseHeader},Cash,Credit`;

  const header = (options.rl)
    ? `${priceHeader},RL`
    : `${priceHeader}`;

  let csv = `${header}\n`;

  const cardSetsMap = {};

  Object.entries(cardMap).forEach(([set, cards]) => {
    cards.forEach((card) => {
      const setCode = getSetCode(card.edition) || set;
      if (!cardSetsMap.setCode) {
        const cardFile = getCardMap(`../assets/allSets/${setCode}.json`)
        cardSetsMap[setCode] = cardFile;
      }

      csv += `"${card.title}",${setCode},${card.foil},${card.qty},${card.rarity}`;
      if (options.cashonly) {
        csv += `,${card.cash}`
      } else if (options.creditonly) {
        csv += `,${card.credit}`
      } else {
        csv += `,${card.cash},${card.credit}`
      }
      if (options.rl && cardSetsMap[setCode] && cardSetsMap[setCode].data) {
        const isRL = isReserved(card.title, cardSetsMap[setCode].data.cards || []);
        csv += `,${isRL}\n`;
      } else {
        csv += `\n`;
      }
    });
  });

  return csv;
}

export const mergeFilesForBuylist = (cardFile, buylistFiles, options = {}) => {

}
