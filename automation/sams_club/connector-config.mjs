export const samsClubConnectorConfig = {
  supplier: "Sam's Club",
  baseUrl: 'https://www.samsclub.com',
  clubLocation: 'Secaucus, NJ 07094',
  clubZipCode: '07094',
  dealSource: {
    name: 'Clearance'
  },
  fallbackDealSource: {
    name: 'Savings'
  },
  maxProducts: Number(process.env.SAMS_CLUB_MAX_CLEARANCE_PRODUCTS ?? 10),
  maxListingScreenshots: Number(process.env.SAMS_CLUB_MAX_LISTING_SCREENSHOTS ?? 2),
  relevantCategoryPatterns: [
    /dry\s+grocery/i,
    /grocery/i,
    /snacks?/i,
    /candy/i,
    /beverages?/i,
    /health\s*&?\s*beauty/i,
    /personal\s+care/i,
    /household/i,
    /cleaning/i,
    /paper/i,
    /pet/i,
    /office/i
  ],
  excludedCategoryPattern: /fresh|produce|dairy|milk|cheese|yogurt|butter|eggs?|meat|beef|pork|poultry|chicken|turkey|seafood|fish|frozen|refrigerated|bakery|deli|furniture|patio|garden|outdoor|automotive|tires?|clothing|apparel|jewelry|electronics?|appliances?|toys?|seasonal|lawn|grill/i,
  noCommerceActions: {
    login: false,
    password: false,
    membershipAuthentication: false,
    addToCart: false,
    checkout: false,
    purchase: false
  }
};
