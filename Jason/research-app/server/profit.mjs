import {AppError} from './errors.mjs';

export const profitDefaults={revision:0,minRoi:null,minProfit:null,maxRank:null,minVelocity:null,closeRoi:null,closeProfit:null,closeRank:null,closeVelocity:null,
  workerAllowance:0.75,prepShipping:0.75,rebundle:0.75,dailyBudget:null,weeklyBudget:null,categoryOverrides:[],timezone:'America/New_York',freshHours:24};
export const known=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function number(value,label,{nullable=false,integer=false,max=1e9,min=0}={}){
  if(nullable&&(value===null||value===undefined||value===''))return null;
  if(!['string','number'].includes(typeof value)||typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value))throw new AppError('NUMBER_INVALID','Enter a valid '+label+'.');
  const n=Number(value);if(!Number.isFinite(n)||n<min||n>max||integer&&!Number.isSafeInteger(n))throw new AppError('NUMBER_INVALID','Enter a valid '+label+'.');return n;
}
export function money(value,label,nullable=false){const n=number(value,label,{nullable,max:1e7});if(n!==null&&Math.abs(n*100-Math.round(n*100))>0.00001)throw new AppError('MONEY_INVALID',label+' must have at most two decimal places.');return n;}
export function text(value,label,{max=2000,required=false}={}){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)||required&&!value.trim())throw new AppError('TEXT_INVALID','Enter '+label+'.');return value.trim();}
export const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export function validateProfitSettings(input){
  const result={...profitDefaults};
  for(const k of ['minRoi','minProfit','maxRank','minVelocity','closeRoi','closeProfit','closeRank','closeVelocity','dailyBudget','weeklyBudget'])result[k]=number(input[k],k,{nullable:true});
  for(const k of ['workerAllowance','prepShipping','rebundle'])result[k]=money(input[k],k);
  if(!Array.isArray(input.categoryOverrides)||input.categoryOverrides.length>500)throw new AppError('CONTROLS_INVALID','Enter category overrides as a list.');
  const ids=new Set();
  result.categoryOverrides=input.categoryOverrides.map(c=>{
    const id=text(c.categoryId,'category ID',{max:100,required:true});if(ids.has(id))throw new AppError('CONTROLS_INVALID','Each category can have only one override.');ids.add(id);
    return {categoryId:id,...Object.fromEntries(['maxRank','minVelocity','closeRank','closeVelocity'].map(k=>[k,number(c[k],k,{nullable:true})]))};
  });
  return result;
}
export function evaluateProfit(input,settings=profitDefaults,{matchRoute='exact',blocked=false,expired=false,stale=false}={}){
  const category=settings.categoryOverrides.find(c=>c.categoryId===input.categoryId),rules={...settings,...Object.fromEntries(Object.entries(category??{}).filter(([k,v])=>v!==null))};
  const missing=[],warnings=[],failures=[],close=[];
  const need=(value,label)=>{if(!known(value))missing.push(label);};
  for(const [k,label]of [['clubPrice','Club price'],['taxPerClub','Tax per club package'],['workerAllowance','Worker allowance'],['prepShipping','Prep and shipping'],['otherCost','Other cost'],['buyBoxPrice','Current Buy Box price'],['amazonFees','Total Amazon fee estimate']])need(input[k],label);
  if(!input.feesConfirmed)missing.push('Confirmation that fees cover the intended total at this selling price');
  if(!input.feeSource)missing.push('Fee evidence source');
  if(!input.priceSource)missing.push('Buy Box evidence source');
  if(input.priceKind!=='current_buy_box')missing.push('A current Buy Box price, not another offer or historical price');
  if(!input.observedAt||!Number.isFinite(Date.parse(input.observedAt)))missing.push('Price observation date');
  else if(Date.now()-Date.parse(input.observedAt)>settings.freshHours*3600000||Date.parse(input.observedAt)>Date.now()+300000)missing.push('A current price observation');
  if(matchRoute!=='exact')missing.push('Reviewed exact product and package identity');
  if(stale)missing.push('Recheck changed club or Amazon identity');
  if(input.eligibility==='restricted')failures.push('Known selling restriction');
  if(input.eligibility!=='eligible')warnings.push('Account eligibility has not been confirmed by an Amazon connection.');
  for(const k of ['minRoi','minProfit','maxRank','minVelocity','closeRoi','closeProfit','closeRank','closeVelocity'])if(!known(rules[k]))missing.push('Configure '+k+' in Profit Controls');
  need(input.rank,'Sales rank');need(input.monthlyVelocity,'Monthly listing sales estimate');
  if(!input.categoryId)missing.push('Sales-rank category ID');
  if(!input.velocitySource)missing.push('Velocity source and assumptions');
  const completeCost=['clubPrice','taxPerClub','workerAllowance','prepShipping','otherCost'].every(k=>known(input[k]))?round(input.clubPrice+input.taxPerClub+input.workerAllowance+input.prepShipping+input.otherCost):null;
  const netProceeds=known(input.buyBoxPrice)&&known(input.amazonFees)?round(input.buyBoxPrice-input.amazonFees):null;
  const profit=completeCost!==null&&netProceeds!==null?round(netProceeds-completeCost):null,roi=completeCost>0&&profit!==null?round(profit/completeCost*100):null;
  if(completeCost===0)missing.push('Positive complete cost for ROI');
  const check=(label,value,cutoff,tolerance,direction)=>{if(!known(value)||!known(cutoff)||!known(tolerance))return;const distance=direction==='min'?cutoff-value:value-cutoff;if(distance>0)(distance<=tolerance?close:failures).push(label+' is '+(distance<=tolerance?'close to':'outside')+' the configured threshold.');};
  check('ROI',roi,rules.minRoi,rules.closeRoi,'min');check('Dollar profit',profit,rules.minProfit,rules.closeProfit,'min');check('Rank',input.rank,rules.maxRank,rules.closeRank,'max');check('Velocity',input.monthlyVelocity,rules.minVelocity,rules.closeVelocity,'min');
  let route=blocked?'blocked':profit!==null&&profit<0?'reject':expired?'hold':missing.length?'needs_information':failures.length?'reject':close.length?'close':'normal';
  if(blocked)failures.unshift('A permanent product or mapping block is active.');if(expired)failures.push('The known offer expiration has passed.');
  if(matchRoute==='potential'&&route==='needs_information')route='special_review';
  return {route,completeCost,netProceeds,profit,roi,missing:[...new Set(missing)],warnings,failures,close,rules,purchaseApproved:false,amazonUnitsPerClub:1,
    quantityRecommendation:null,quantityNote:'Enter a club-unit target manually. Seller-share and four-to-six-week quantity recommendations remain deferred.'};
}
