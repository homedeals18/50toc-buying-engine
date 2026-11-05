const BASE='https://api.scavio.dev';
const ENDPOINTS=Object.freeze({
  costcoClearance:'/api/v1/costco/clearance',
  costcoDeals:'/api/v1/costco/deals',
  costcoWarehouses:'/api/v1/costco/warehouses',
  costcoProduct:'/api/v1/costco/product',
  samsClearance:'/api/v1/samsclub/category',
  samsSavings:'/api/v1/samsclub/savings',
  samsProduct:'/api/v1/samsclub/product',
  samsClubs:'/api/v1/samsclub/clubs'
});
export function createScavioClient({apiKey=process.env.SCAVIO_API_KEY,fetchImpl=fetch}={}){
  if(!apiKey) throw new Error('SCAVIO_API_KEY is required. Configure a GitHub Actions secret; never commit a key.');
  return {
    async request(kind,body={}){
      const endpoint=ENDPOINTS[kind];
      if(!endpoint) throw new Error('Unsupported Scavio endpoint');
      const response=await fetchImpl(BASE+endpoint,{
        method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
        body:JSON.stringify(body),signal:AbortSignal.timeout(120000)
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error('Scavio request failed: HTTP '+response.status+' ('+kind+')');
      if(!payload || typeof payload!=='object'||!('data' in payload)) throw new Error('Unexpected Scavio response');
      return payload;
    }
  };
}
