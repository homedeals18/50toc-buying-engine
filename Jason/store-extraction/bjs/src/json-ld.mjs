// Adapted from Nir's BJ's product-page JSON-LD extraction approach.
// Parses supplied JSON-LD text offline. Does not fetch websites or bypass access controls.
const clean = value => typeof value === 'string' ? value.trim() || null : null;
function flatten(node) {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (!node || typeof node !== 'object') return [];
  return [node, ...flatten(node['@graph'] ?? [])];
}
function productNodes(scripts) {
  return scripts.flatMap(text => {
    try { return flatten(JSON.parse(text)); } catch { return []; }
  }).filter(x => {
    const types=Array.isArray(x['@type'])?x['@type']:[x['@type']];
    return types.some(t=>typeof t==='string' && /(^|[/#])Product$/i.test(t));
  });
}
const pick = (obj, ...fields) => fields.map(k=>obj?.[k]).find(v=>v!==undefined&&v!==null&&v!=='');
const absolute = (url, base) => { try { return url ? new URL(url,base).href : null; } catch { return null; } };
export function extractProductFromJsonLd(scripts, {productUrl=null, sku=null}={}) {
  const products=productNodes(scripts);
  const selected=products.find(p=>sku&&String(p.sku)===String(sku))??products[0];
  if(!selected) return null;
  const offer=Array.isArray(selected.offers)?selected.offers[0]:selected.offers;
  const brand=typeof selected.brand==='string'?selected.brand:selected.brand?.name;
  const image=Array.isArray(selected.image)?selected.image[0]:selected.image;
  const upc=pick(selected,'gtin12','gtin13','gtin14','gtin','gtin8');
  return {
    productName:clean(selected.name),
    sku:clean(String(selected.sku??'')),
    upc:upc==null?null:clean(String(upc)),
    brand:clean(brand),
    currentPrice:pick(offer,'price')??pick(offer?.priceSpecification,'price')??null,
    availability:clean(offer?.availability),
    imageUrl:absolute(typeof image==='string'?image:image?.url,productUrl),
    productUrl:productUrl??clean(selected.url),
    description:clean(selected.description),
    evidence:{source:'json-ld',productType:selected['@type'],matchedSku:sku?String(selected.sku)===String(sku):null}
  };
}
