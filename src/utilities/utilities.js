import { getCardMap } from './files.js';

// Reads sets.json and returns it as a map
function getSetMap() {
  return getCardMap(new URL('../data/sets.json', import.meta.url).pathname);
}

export {
  getSetMap,
  getCardMap,
};


const SETS_PATH = '../../assets/sets.json';
const SETLIST_PATH = '../../assets/SetList.json';
const SET_CODE_MAP = getCardMap(SETLIST_PATH).data.reduce((acc, set, i) => {
  acc[set.name.toLowerCase()] = set.code;
  return acc;
}, {});

export const parseFilters = (filters) => {
  const parsedFilters = filters.reduce((acc, filter) => {
    const splitFilter = filter.split(':', 2);
    switch (splitFilter[0]) {
      case 'foil':
        if (splitFilter[1] === 'yes') {
          acc.foil = 1;
          break;
        }
        // Check for specific foil/nonfoil negations
        // e.g. foil:no with no nonfoil filter should result in an explicit { nonfoil: 1 } query option
        if (splitFilter[1] === 'no') {
          acc.nonfoil = 1
        }
        break;
      case 'nonfoil':
        if (splitFilter[1] === 'yes') {
          acc.nonfoil = 1;
          break;
        }
        // nonfoil:no with no foil filter should result in an explicit { foil: 1 } query option
        if (splitFilter[1] === 'no') {
          acc.foil = 1
        }
        break;
      case 'rarity':
        acc['rarity'] = [];
        const rarities = splitFilter[1].split(',');
        rarities.forEach((rarity) => {
          switch (rarity) {
            case 'mythic':
              acc['rarity'].push('M')
              break;
            case 'rare':
              acc['rarity'].push('R')
              break;
            case 'uncommon':
              acc['rarity'].push('U')
              break;
            case 'common':
              acc['rarity'].push('C')
              break;
            case 'basic':
              acc['rarity'].push('L')
              break;
            case 'special':
              acc['rarity'].push('S')
              break;
          }
        });
        break;
      case 'name':
        acc.name = splitFilter[1]
        break;
      case 'price':
        const match = splitFilter[1].match(/(<=|>=)\$?(\d+\.\d\d)/);
        if (match) {
          acc.price_op = match[1];
          acc.price = match[2];
        }
        break;
    }

    return acc;
  }, {});

  return parsedFilters;
}

export const buildQuery = (baseUrl, queryOptions = {}) => {
  const queryString = Object.entries(queryOptions).reduce((acc, [key, value]) => {
    if (key === 'rarity') {
      const rarityFilters = value.reduce((acc, rarity, i) => {
        return acc.concat(`&filter[rarity][${i}]=${rarity}`)
      }, '');
      return acc.concat(rarityFilters);
    }
    return acc.concat(`filter[${key}]=${value}&`);
  }, '?');

  return encodeURI(`${baseUrl}${queryString.slice(0, -1)}`);
}

export const getSetCode = (setName) => {
  let mappedName = setName;
  if (setName.match(/Variants$/)) {
    mappedName = setName.match(/(.+) Variants$/)[1];
  }
  if (setName === 'Commander 2011') {
    mappedName = 'Commander';
  }
  if (setName.match(/Collectors/)) {
    if (setName.match(/Intl/)) {
      mappedName = 'Intl. Collectors’ Edition'
    } else {
      mappedName = 'Collectors’ Edition'
    }
  }

  return SET_CODE_MAP[mappedName.toLowerCase()];
}

export const findSets = (query) => {
  if (!query.length) return [];
  const sets = getCardMap(SETS_PATH);
  const re = new RegExp(query, 'i');
  return Object.keys(sets).filter((set) => {
    return set.match(re)
  })
}
export default {
  getSetMap,
  // add any other exported functions here
};
