import {randomUUID,createHash} from 'node:crypto';
import {AppError} from './errors.mjs';
import {profitDefaults,validateProfitSettings,evaluateProfit,number,money,text,round} from './profit.mjs';
import {exactMatch} from './exact-rules.mjs';
import {normalizeOffer} from './costco.mjs';
import {decoratePrice} from './pricing.mjs';
const ns='jason_research.',json=JSON.stringify,keyFor=(...xs)=>createHash('sha256').update(json(xs)).digest('hex');
const now=()=>new Date().toISOString();
const manager=actor=>{if(actor?.role!=='manager')throw new AppError('MANAGER_REQUIRED','Full access is required.',{status:403});};
const requestId=input=>{if(!/^[a-zA-Z0-9-]{12,100}$/.test(input))throw new AppError('REQUEST_ID_INVALID','Refresh the form and retry.');return input;};
async function audit(db,id,action,actor,before,after,note=''){await db.query('INSERT INTO '+ns+'workflow_audit VALUES($1,$2,$3,$4::jsonb)',[randomUUID(),id,now(),json({action,actor:{id:actor.id,username:actor.username},before,after,note})]);}
function checkRevision(input,current){if(input.revision!==(current?.revision??0))throw new AppError('WORKFLOW_CHANGED','This record changed. Refresh before saving.',{status:409});}
const rows=async(db,table)=> (await db.query('SELECT body FROM '+ns+table)).rows.map(r=>r.body);
const purchaseFor=(p,actor)=>{const {approvalSnapshot,...workerRecord}=p;return actor.role==='manager'?p:workerRecord;};
const offerEnd=offer=>[offer?.saleEndDate,offer?.coupon?.validTo,offer?.sourceData?.item?.promotion_end,offer?.sourceData?.item?.sale_end].find(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v)&&Number.isFinite(Date.parse(v)))??null;
const purchasePrice=offer=>Object.hasOwn(offer??{},'warehousePurchasePrice')?offer.warehousePurchasePrice:offer?decoratePrice(offer).warehousePurchasePrice:null;
async function pricedOffer(db,offer){if(!offer)return null;const check=(await db.query('SELECT body FROM '+ns+'warehouse_price_checks WHERE offer_id=$1',[offer.id])).rows[0]?.body;return decoratePrice(offer,check);}
const expired=offer=>{const end=offerEnd(offer);if(!end||!Number.isFinite(Date.parse(end)))return false;if(String(end).length===10)return new Intl.DateTimeFormat('en-CA',{timeZone:offer.retailer==='costco'?'America/Los_Angeles':'America/New_York'}).format(new Date())>end;return Date.parse(end)<Date.now();};

export class WorkflowService{
  constructor(store,matching,catalog){Object.assign(this,{store,matching,catalog});this.db=store.db;}
  async settings(db=this.db){return (await db.query("SELECT body FROM "+ns+"settings WHERE key='profit_controls'")).rows[0]?.body??profitDefaults;}
  async saveSettings(input,actor){
    manager(actor);const next=validateProfitSettings(input);
    return this.db.transaction(async db=>{
      await db.query("INSERT INTO "+ns+"settings VALUES('profit_controls',$1::jsonb) ON CONFLICT DO NOTHING",[json(profitDefaults)]);
      const old=(await db.query("SELECT body FROM "+ns+"settings WHERE key='profit_controls' FOR UPDATE")).rows[0].body;checkRevision(input,old);
      Object.assign(next,{revision:old.revision+1,updatedAt:now(),actor:actor.username});
      await db.query("UPDATE "+ns+"settings SET body=$1::jsonb WHERE key='profit_controls'",[json(next)]);await audit(db,'profit_controls','settings',actor,old,next);return next;
    });
  }
  async state(actor){
    manager(actor);
    const [items,targets,purchases,payments,blocks,submissions,adjustments]=await Promise.all(['workflow_items','buying_targets','purchases','payments','product_blocks','worker_submissions','payment_adjustments'].map(t=>rows(this.db,t)));
    const links=(await this.db.query('SELECT * FROM '+ns+'receipt_links')).rows;
    const receipts=(await this.db.query('SELECT id,body FROM '+ns+'receipts')).rows.map(r=>({...r.body,purchaseIds:links.filter(l=>l.receipt_id===r.id).map(l=>l.purchase_id)}));
    const files=(await this.db.query('SELECT f.submission_id,r.body FROM '+ns+'submission_files f JOIN '+ns+'receipts r ON r.id=f.receipt_id')).rows;
    for(const s of submissions)s.files=files.filter(f=>f.submission_id===s.id).map(f=>f.body);
    const offers=await this.store.offers(),dealAlerts=targets.flatMap(t=>offers.filter(o=>o.productKey===t.productKey&&t.warehouses.includes(o.warehouseId)).flatMap(o=>{
      const result=[];if(purchasePrice(o)!==null&&purchasePrice(o)<t.maxPrice)result.push({type:'price_drop',targetId:t.id,title:t.title,warehouseId:o.warehouseId,price:purchasePrice(o),approvedPrice:t.maxPrice,observedAt:o.observedAt});const end=offerEnd(o);if(end)result.push({type:'sale_date',targetId:t.id,title:t.title,warehouseId:o.warehouseId,end,expired:expired(o)});return result;
    }));
    return {settings:await this.settings(),items,targets,purchases,payments,blocks,submissions,adjustments,receipts,dealAlerts,visits:await rows(this.db,'visit_plans'),reservations:(await this.db.query('SELECT * FROM '+ns+'unit_reservations WHERE units>0')).rows,localOnly:true,smsConnected:false,receiptOcrConnected:false};
  }
  async context(productKey,asin){
    const c=await this.matching.get(productKey),candidate=c.candidates.find(v=>v.asin===asin);
    if(!candidate)throw new AppError('MAPPING_REQUIRED','Choose a saved Amazon candidate.');
    return {...c,candidate,offers:(await this.store.offers()).filter(o=>o.productKey===productKey)};
  }
  cleanInput(input,settings){
    const n={};
    for(const k of ['clubPrice','taxPerClub','buyBoxPrice','amazonFees'])n[k]=money(input[k],k,true);
    for(const k of ['workerAllowance','prepShipping'])n[k]=money(input[k]===null||input[k]===undefined||input[k]===''?settings[k]:input[k],k);
    n.otherCost=money(input.otherCost,'other cost',true);
    for(const k of ['rank','monthlyVelocity'])n[k]=number(input[k],k,{nullable:true});
    for(const k of ['categoryId','feeSource','priceSource','velocitySource','note'])n[k]=text(input[k]??'',k,{max:2000});
    if(!['eligible','restricted','not_checked'].includes(input.eligibility))throw new AppError('ELIGIBILITY_INVALID','Choose the eligibility check state.');
    n.eligibility=input.eligibility;n.priceKind=input.priceKind==='current_buy_box'?'current_buy_box':'unknown';n.feesConfirmed=input.feesConfirmed===true;
    n.observedAt=typeof input.observedAt==='string'&&Number.isFinite(Date.parse(input.observedAt))?new Date(input.observedAt).toISOString():null;
    return n;
  }
  async analyze(input,actor){
    manager(actor);const {productKey,asin,offerId}=input,context=await this.context(productKey,asin),settings=await this.settings();
    const offer=context.offers.find(o=>o.id===offerId);if(!offer)throw new AppError('OFFER_REQUIRED','Choose a saved warehouse offer.');
    const values=this.cleanInput(input.values??{},settings),id=keyFor(productKey,asin),blocks=await rows(this.db,'product_blocks');
    const isBlocked=blocks.some(b=>b.active&&b.productKey===productKey&&(!b.asin||b.asin===asin));
    const result=evaluateProfit(values,settings,{matchRoute:context.candidate.result.route,blocked:isBlocked,expired:expired(offer),stale:context.profile.sourceChanged});
    if(purchasePrice(offer)===null||values.clubPrice!==purchasePrice(offer)){result.missing.push('Confirm the selected warehouse price and any warehouse coupon through current price checking.');if(!['blocked','reject'].includes(result.route))result.route='needs_information';}
    if(Date.now()-Date.parse(offer.warehousePriceObservedAt??offer.observedAt)>24*3600000){result.missing.push('Refresh the warehouse price; its observation is stale.');if(!['blocked','reject'].includes(result.route))result.route='needs_information';}
    return this.db.transaction(async db=>{
      await db.query('SELECT id FROM '+ns+'products WHERE id=$1 FOR UPDATE',[productKey]);
      const old=(await db.query('SELECT body FROM '+ns+'workflow_items WHERE id=$1 FOR UPDATE',[id])).rows[0]?.body;checkRevision(input,old);
      const record={id,productKey,asin,offerId,title:context.profile.title,amazonTitle:context.candidate.title,warehouseId:offer.warehouseId,revision:(old?.revision??0)+1,
        profileRevision:context.profile.revision,sourceSignature:context.profile.sourceSignature,candidateRevision:context.candidate.revision,upcRevision:context.upc?.revision??0,offer,values,result,settingsRevision:settings.revision,
        analyzedAt:now(),analyzedBy:actor.username,status:result.route,decision:old?.decision??null};
      const analysisId=randomUUID();record.analysisId=analysisId;
      await db.query('INSERT INTO '+ns+'workflow_items VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,body=EXCLUDED.body',[id,productKey,asin,record.revision,json(record)]);
      await db.query('INSERT INTO '+ns+'analysis_history VALUES($1,$2,$3,$4::jsonb)',[analysisId,id,record.analyzedAt,json(record)]);
      const target=(await db.query('SELECT body FROM '+ns+'buying_targets WHERE id=$1 FOR UPDATE',[id])).rows[0]?.body;
      if(target&&target.remainingUnits>0&&target.status!=='cancelled'){target.status='held';target.holdReason='A new analysis requires human reapproval before further buying.';target.revision++;await this.writeTarget(db,target);}
      await audit(db,id,'analysis',actor,old??null,record);
      return {item:record};
    });
  }
  async block(input,actor){
    manager(actor);const productKey=text(input.productKey,'product ID',{max:1000,required:true}),asin=input.asin?text(input.asin,'ASIN',{max:10,required:true}):null;
    await this.matching.get(productKey);const note=text(input.note,'block reason',{required:true}),id=keyFor('block',productKey,asin);
    if(typeof input.active!=='boolean')throw new AppError('BLOCK_STATE_INVALID','Choose whether the block is active.');
    return this.db.transaction(async db=>{
      await db.query('SELECT id FROM '+ns+'products WHERE id=$1 FOR UPDATE',[productKey]);
      const old=(await db.query('SELECT body FROM '+ns+'product_blocks WHERE id=$1 FOR UPDATE',[id])).rows[0]?.body;
      const b={id,productKey,asin,active:input.active,note,actor:actor.username,updatedAt:now()};
      await db.query('INSERT INTO '+ns+'product_blocks VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO UPDATE SET active=EXCLUDED.active,body=EXCLUDED.body',[id,productKey,asin,b.active,json(b)]);
      for(const row of(await db.query('SELECT body FROM '+ns+'buying_targets WHERE product_key=$1 FOR UPDATE',[productKey])).rows){const t=row.body;if(input.active&&(!asin||t.asin===asin)){t.status='held';t.holdReason='Permanent '+(asin?'mapping':'product')+' block';t.revision++;await this.writeTarget(db,t);}}
      await audit(db,id,input.active?'block':'unblock',actor,old??null,b,note);return b;
    });
  }
  async decision(input,actor){
    manager(actor);const action=input.action,note=text(input.note??'','decision note');
    if(!['approve','reject'].includes(action))throw new AppError('DECISION_INVALID','Choose approve or reject.');
    const snapshot=(await this.db.query('SELECT body FROM '+ns+'workflow_items WHERE id=$1',[input.itemId])).rows[0]?.body;
    if(!snapshot)throw new AppError('ANALYSIS_REQUIRED','Analyze the opportunity first.');
    const context=await this.context(snapshot.productKey,snapshot.asin),settings=await this.settings();
    return this.db.transaction(async db=>{
      await db.query('SELECT id FROM '+ns+'products WHERE id=$1 FOR UPDATE',[snapshot.productKey]);
      const item=(await db.query('SELECT body FROM '+ns+'workflow_items WHERE id=$1 FOR UPDATE',[input.itemId])).rows[0].body;checkRevision(input,item);
      const before=structuredClone(item);
      if(action==='approve'){
        const currentProfile=(await db.query('SELECT body FROM '+ns+'enrichment_profiles WHERE product_key=$1',[item.productKey])).rows[0]?.body;
        const currentCandidate=(await db.query('SELECT body FROM '+ns+'amazon_candidates WHERE product_key=$1 AND asin=$2',[item.productKey,item.asin])).rows[0]?.body;
        const currentUpc=(await db.query('SELECT body FROM '+ns+'product_upcs WHERE product_key=$1',[item.productKey])).rows[0]?.body;
        const currentOffer=await pricedOffer(db,(await db.query('SELECT body FROM '+ns+'offers WHERE id=$1',[item.offerId])).rows[0]?.body);
        const liveSettings=await this.settings(db);
        if(!currentOffer||purchasePrice(currentOffer)===null||purchasePrice(currentOffer)>item.values.clubPrice||Date.now()-Date.parse(currentOffer.warehousePriceObservedAt??currentOffer.observedAt)>24*3600000)throw new AppError('PRICE_REANALYZE','Refresh and analyze the current warehouse price, including verified warehouse coupons, before approving.');
        const blocks=(await db.query('SELECT body FROM '+ns+'product_blocks WHERE product_key=$1 AND active=TRUE',[item.productKey])).rows.map(r=>r.body);
        const result=evaluateProfit(item.values,liveSettings,{matchRoute:currentCandidate&&currentProfile?exactMatch(currentProfile,currentUpc,currentCandidate).route:'needs_information',blocked:blocks.some(b=>!b.asin||b.asin===item.asin),expired:expired(currentOffer),stale:currentProfile?.sourceChanged||currentProfile?.sourceSignature!==item.sourceSignature||currentProfile?.revision!==item.profileRevision||currentCandidate?.revision!==item.candidateRevision||(currentUpc?.revision??0)!==item.upcRevision});
        if(!['normal','close'].includes(result.route))throw new AppError('APPROVAL_BLOCKED','This opportunity cannot be approved: '+[...result.missing,...result.failures].join(' '));
        if(result.route==='close'&&(!input.exception||!note))throw new AppError('EXCEPTION_REASON_REQUIRED','A Close approval needs an explicit exception and reason.');
        if(item.values.eligibility==='not_checked'&&input.acknowledgeEligibility!==true)throw new AppError('ELIGIBILITY_ACK_REQUIRED','Acknowledge that account eligibility has not been checked.');
        const targetUnits=number(input.targetUnits,'total club units',{integer:true,min:1,max:10000000}),maxPrice=money(input.maxPrice,'maximum club price');
        if(maxPrice>item.values.clubPrice)throw new AppError('PRICE_REANALYZE','Analyze the higher price before raising the purchase limit.');
        const warehouses=input.warehouses;if(!Array.isArray(warehouses)||!warehouses.length||warehouses.some(w=>typeof w!=='string'||!context.offers.some(o=>o.warehouseId===w)))throw new AppError('WAREHOUSE_SCOPE_REQUIRED','Choose warehouses with saved offers for this product.');
        const existingTargets=(await db.query('SELECT body FROM '+ns+'buying_targets WHERE product_key=$1 FOR UPDATE',[item.productKey])).rows.map(r=>r.body);
        if(existingTargets.some(t=>t.asin!==item.asin&&t.remainingUnits>0&&t.status!=='cancelled'))throw new AppError('TARGET_ALREADY_EXISTS','This club product already has an outstanding target for another mapping. Review that target first.');
        const old=existingTargets.find(t=>t.id===item.id),bought=old?.purchasedUnits??0;if(targetUnits<bought)throw new AppError('TARGET_BELOW_PURCHASED','Total target cannot be below units already bought.');
        const allTargets=(await db.query('SELECT body FROM '+ns+'buying_targets')).rows.map(r=>r.body),commitment=round(allTargets.filter(t=>t.id!==item.id&&t.status!=='cancelled').reduce((sum,t)=>sum+t.maxPrice*t.remainingUnits,0)+maxPrice*(targetUnits-bought));
        const purchases=(await db.query('SELECT body FROM '+ns+'purchases')).rows.map(r=>r.body),date=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone}).format(new Date()),spentToday=purchases.filter(p=>new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone}).format(new Date(p.boughtAt))===date).reduce((s,p)=>s+p.totalPaid,0),spentWeek=purchases.filter(p=>Date.now()-Date.parse(p.boughtAt)<7*86400000).reduce((s,p)=>s+p.totalPaid,0);
        const budgetWarnings=[];if(settings.dailyBudget!==null&&commitment+spentToday>settings.dailyBudget)budgetWarnings.push('Daily budget warning');if(settings.weeklyBudget!==null&&commitment+spentWeek>settings.weeklyBudget)budgetWarnings.push('Rolling seven-day budget warning');
        if(budgetWarnings.length&&(!input.budgetOverride||!note))throw new AppError('BUDGET_WARNING',budgetWarnings.join('. ')+'. A full-access override and reason are required.');
        const target={id:item.id,itemId:item.id,productKey:item.productKey,asin:item.asin,title:item.title,itemNumber:context.profile.itemNumber,imageUrl:context.profile.sourceSnapshot.find(s=>s.imageUrl)?.imageUrl??null,
          targetUnits,purchasedUnits:bought,remainingUnits:targetUnits-bought,maxPrice,warehouses:[...new Set(warehouses)],status:targetUnits===bought?'complete':'active',holdReason:null,
          revision:(old?.revision??0)+1,approvedAt:now(),approvedBy:actor.username,analysisSnapshot:{...item,result,settingsRevision:liveSettings.revision,approvedControls:liveSettings},sourceSignature:item.sourceSignature,candidateRevision:item.candidateRevision,note,budgetWarnings,budgetOverride:input.budgetOverride===true,
          lastCheckAt:now(),lastSuccessfulCheckAt:now(),lastSourceObservedAt:item.values.observedAt,reviewException:result.route==='close'};
        await this.writeTarget(db,target);await audit(db,target.id,'purchase_approval',actor,old??null,target,note);
      }
      item.revision++;item.status=action==='approve'?'approved':'rejected';item.decision={action,note,actor:actor.username,at:now()};
      await db.query('UPDATE '+ns+'workflow_items SET revision=$2,body=$3::jsonb WHERE id=$1',[item.id,item.revision,json(item)]);await audit(db,item.id,action,actor,before,item,note);return {item};
    });
  }
  async writeTarget(db,t){await db.query('INSERT INTO '+ns+'buying_targets VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,body=EXCLUDED.body',[t.id,t.productKey,t.revision,json(t)]);}
  async monitor(actor){
    manager(actor);const settings=await this.settings(),date=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone}).format(new Date());
    const targets=await rows(this.db,'buying_targets'),offers=await this.store.offers();let checked=0;
    for(const old of targets){
      if(old.remainingUnits<=0||old.status==='cancelled'||old.checkDate===date)continue;
      const context=await this.context(old.productKey,old.asin);
      await this.db.transaction(async db=>{
        const t=(await db.query('SELECT body FROM '+ns+'buying_targets WHERE id=$1 FOR UPDATE',[old.id])).rows[0].body;if(t.checkDate===date)return;
        const reasons=[],currentOffers=offers.filter(o=>o.productKey===t.productKey&&t.warehouses.includes(o.warehouseId));
        if(context.profile.sourceSignature!==t.sourceSignature||context.profile.revision!==t.analysisSnapshot.profileRevision||context.candidate.revision!==t.candidateRevision||(context.upc?.revision??0)!==t.analysisSnapshot.upcRevision)reasons.push('Package or mapping evidence changed.');
        if(currentOffers.some(o=>purchasePrice(o)!==null&&purchasePrice(o)>t.maxPrice))reasons.push('A permitted warehouse reports a higher price.');
        if(currentOffers.some(expired))reasons.push('A known offer expired.');
        if(!currentOffers.length||currentOffers.every(o=>purchasePrice(o)===null||Date.now()-Date.parse(o.warehousePriceObservedAt??o.observedAt)>settings.freshHours*3600000))reasons.push('Current warehouse price or coupon needs verifying.');
        const economics=evaluateProfit(t.analysisSnapshot.values,settings,{matchRoute:context.candidate.result.route});
        if(!['normal','close'].includes(economics.route)||economics.route==='close'&&!t.reviewException)reasons.push('Economics or controls require review.');
        t.checkDate=date;t.lastCheckAt=now();t.lastCheckResult=reasons.length?'held':'passed';if(reasons.length){t.status='held';t.holdReason=reasons.join(' ');}else t.lastSuccessfulCheckAt=now();
        t.revision++;await this.writeTarget(db,t);await audit(db,t.id,'daily_available_data_check',actor,old,t);checked++;
      });
    }
    return {checked,date,source:'Saved source observations; this check does not claim a fresh API request.',policy:'Hold outstanding buying when required price or economics evidence is stale. Refresh Research and analysis, then reapprove.'};
  }
  async workerState(actor){
    const targets=await rows(this.db,'buying_targets'),purchases=(await rows(this.db,'purchases')).filter(p=>actor.role==='manager'||p.workerId===actor.id);
    const reservations=(await this.db.query('SELECT * FROM '+ns+'unit_reservations')).rows;
    return {targets:targets.filter(t=>t.status!=='cancelled').map(t=>({id:t.id,title:t.title,itemNumber:t.itemNumber,imageUrl:t.imageUrl,targetUnits:t.targetUnits,purchasedUnits:t.purchasedUnits,remainingUnits:t.remainingUnits,
      maxPrice:t.maxPrice,warehouses:t.warehouses,status:t.status,holdReason:t.holdReason,revision:t.revision,lastCheckAt:t.lastCheckAt,
      reservedByYou:reservations.find(r=>r.target_id===t.id&&r.worker_id===actor.id)?.units??0,availableToReserve:t.remainingUnits-reservations.filter(r=>r.target_id===t.id).reduce((s,r)=>s+r.units,0)})),
      purchases:actor.role==='manager'?purchases:purchases.map(({approvalSnapshot,...p})=>p),visits:(await rows(this.db,'visit_plans')).filter(v=>!v.workerId||v.workerId===actor.id),submissions:(await rows(this.db,'worker_submissions')).filter(s=>actor.role==='manager'||s.workerId===actor.id),receipts:(await this.db.query('SELECT r.id,r.body FROM '+ns+'receipts r JOIN '+ns+'receipt_links l ON l.receipt_id=r.id JOIN '+ns+'purchases p ON p.id=l.purchase_id WHERE p.worker_id=$1',[actor.id])).rows.map(r=>r.body)};
  }
  async target(db,id){const t=(await db.query('SELECT body FROM '+ns+'buying_targets WHERE id=$1 FOR UPDATE',[id])).rows[0]?.body;if(!t)throw new AppError('TARGET_NOT_FOUND','Approved buying target not found.',{status:404});return t;}
  async reserve(input,actor){
    const units=number(input.units,'reserved club units',{integer:true,max:10000000});
    return this.db.transaction(async db=>{
      const t=await this.target(db,input.targetId);checkRevision(input,t);
      if(t.status!=='active'&&units>0)throw new AppError('BUYING_HELD','This target is not currently approved for buying.');
      const reservations=(await db.query('SELECT * FROM '+ns+'unit_reservations WHERE target_id=$1',[t.id])).rows,other=reservations.filter(r=>r.worker_id!==actor.id).reduce((s,r)=>s+r.units,0);
      if(units>t.remainingUnits-other)throw new AppError('QUANTITY_UNAVAILABLE','Other workers have reserved some of the remaining quantity.',{status:409});
      await db.query('INSERT INTO '+ns+'unit_reservations VALUES($1,$2,$3) ON CONFLICT(target_id,worker_id) DO UPDATE SET units=EXCLUDED.units',[t.id,actor.id,units]);t.revision++;await this.writeTarget(db,t);await audit(db,t.id,'reserve_units',actor,null,{units});return {units};
    });
  }
  async purchase(input,actor){
    const rid=requestId(input.requestId),quantity=number(input.quantity,'club units bought',{integer:true,min:1,max:10000000}),unitPrice=money(input.unitPrice,'club unit price'),tax=money(input.tax??0,'tax paid'),warehouse=text(input.warehouse,'warehouse',{max:100,required:true});
    return this.db.transaction(async db=>{
      const t=await this.target(db,input.targetId),duplicate=(await db.query('SELECT body FROM '+ns+'purchases WHERE request_id=$1',[rid])).rows[0]?.body;
      if(duplicate){if(duplicate.workerId!==actor.id||duplicate.targetId!==t.id||duplicate.quantity!==quantity||duplicate.unitPrice!==unitPrice||duplicate.tax!==tax||duplicate.warehouse!==warehouse)throw new AppError('REQUEST_REUSED','This form was already submitted with different details.',{status:409});return {purchase:purchaseFor(duplicate,actor),duplicate:true};}
      checkRevision(input,t);
      const context=(await db.query('SELECT body FROM '+ns+'enrichment_profiles WHERE product_key=$1',[t.productKey])).rows[0]?.body;
      const candidate=(await db.query('SELECT body FROM '+ns+'amazon_candidates WHERE product_key=$1 AND asin=$2',[t.productKey,t.asin])).rows[0]?.body;
      const upc=(await db.query('SELECT body FROM '+ns+'product_upcs WHERE product_key=$1',[t.productKey])).rows[0]?.body;
      const controls=await this.settings(db),blocks=(await db.query('SELECT body FROM '+ns+'product_blocks WHERE product_key=$1 AND active=TRUE',[t.productKey])).rows.map(r=>r.body);
      if(!t.warehouses.includes(warehouse))throw new AppError('WAREHOUSE_NOT_APPROVED','This warehouse is outside the approved scope.');
      const currentOffer=await pricedOffer(db,(await db.query('SELECT body FROM '+ns+'offers WHERE product_id=$1 AND warehouse_id=$2',[t.productKey,warehouse])).rows[0]?.body);
      if(!currentOffer||purchasePrice(currentOffer)===null||Date.now()-Date.parse(currentOffer.warehousePriceObservedAt??currentOffer.observedAt)>24*3600000||expired(currentOffer))throw new AppError('BUYING_HELD','Refresh the current warehouse price, coupon or expired offer before buying.');
      const economics=evaluateProfit(t.analysisSnapshot.values,controls,{matchRoute:context&&candidate?exactMatch(context,upc,candidate).route:'needs_information',blocked:blocks.some(b=>!b.asin||b.asin===t.asin)});
      if(t.status!=='active'||context?.sourceSignature!==t.sourceSignature||context?.revision!==t.analysisSnapshot.profileRevision||candidate?.revision!==t.candidateRevision||(upc?.revision??0)!==t.analysisSnapshot.upcRevision||!['normal','close'].includes(economics.route)||economics.route==='close'&&(!t.reviewException||t.analysisSnapshot.settingsRevision!==controls.revision))throw new AppError('BUYING_HELD','Buying is held or approval evidence needs refreshing. Ask a full-access user to review.');
      if(unitPrice>t.maxPrice)throw new AppError('PRICE_ABOVE_APPROVAL','The price is above the approved maximum. Submit a price-change request before buying.');
      if(quantity>t.remainingUnits)throw new AppError('QUANTITY_EXCEEDS_TARGET','Quantity exceeds the shared remaining target.',{status:409});
      const reservations=(await db.query('SELECT * FROM '+ns+'unit_reservations WHERE target_id=$1',[t.id])).rows,mine=reservations.find(r=>r.worker_id===actor.id)?.units??0;
      if(quantity>mine)throw new AppError('RESERVATION_REQUIRED','Reserve the units you plan to buy first. This prevents two workers buying the same remaining units.');
      if(!Number.isSafeInteger(Math.round(unitPrice*100)*quantity+Math.round(tax*100)))throw new AppError('AMOUNT_TOO_LARGE','The purchase amount exceeds supported exact-cent arithmetic.');
      const p={id:randomUUID(),requestId:rid,targetId:t.id,productKey:t.productKey,asin:t.asin,title:t.title,workerId:actor.id,workerName:actor.username,warehouse,quantity,unitPrice,tax,totalPaid:round(quantity*unitPrice+tax),boughtAt:now(),revision:1,receiptStatus:'awaiting_receipt',paidPaymentId:null,approvalSnapshot:t};
      await db.query('INSERT INTO '+ns+'purchases VALUES($1,$2,$3,$4,$5,$6,NULL,1,$7::jsonb)',[p.id,rid,t.id,actor.id,p.boughtAt,quantity,json(p)]);
      await db.query('UPDATE '+ns+'unit_reservations SET units=units-$3 WHERE target_id=$1 AND worker_id=$2',[t.id,actor.id,quantity]);
      t.purchasedUnits+=quantity;t.remainingUnits-=quantity;t.revision++;if(!t.remainingUnits)t.status='complete';await this.writeTarget(db,t);await audit(db,p.id,'purchase',actor,null,p);return {purchase:purchaseFor(p,actor)};
    });
  }
  async submit(input,actor){
    const rid=requestId(input.requestId),type=input.type;
    if(!['new_deal','price_changed','not_found','correction'].includes(type))throw new AppError('SUBMISSION_INVALID','Choose a supported submission type.');
    const submission={id:randomUUID(),requestId:rid,workerId:actor.id,workerName:actor.username,type,title:text(input.title??'','product title',{max:1000}),itemNumber:text(input.itemNumber??'','item number',{max:100}),warehouse:text(input.warehouse??'','warehouse',{max:100}),price:money(input.price,'observed price',true),note:text(input.note??'','submission note',{required:true}),
      targetId:input.targetId??null,purchaseId:input.purchaseId??null,createdAt:now(),status:'needs_information',urgent:true,qualified:false};
    return this.db.transaction(async db=>{
      const duplicate=(await db.query('SELECT body FROM '+ns+'worker_submissions WHERE request_id=$1',[rid])).rows[0]?.body;if(duplicate){if(duplicate.workerId!==actor.id)throw new AppError('SUBMISSION_CONFLICT','Refresh the form.',{status:409});return duplicate;}
      if(submission.purchaseId){const p=(await db.query('SELECT worker_id FROM '+ns+'purchases WHERE id=$1',[submission.purchaseId])).rows[0];if(!p||actor.role!=='manager'&&p.worker_id!==actor.id)throw new AppError('PURCHASE_NOT_FOUND','Your purchase was not found.',{status:404});}
      if(submission.targetId&&type==='price_changed'){
        const t=await this.target(db,submission.targetId);if(submission.price>t.maxPrice){t.status='held';t.holdReason='Worker reported a higher price; urgent review required.';t.revision++;await this.writeTarget(db,t);}
      }
      await db.query('INSERT INTO '+ns+'worker_submissions VALUES($1,$2,$3,$4,$5::jsonb)',[submission.id,rid,actor.id,submission.createdAt,json(submission)]);await audit(db,submission.id,'worker_submission',actor,null,submission);return submission;
    });
  }
  async correct(input,actor){
    manager(actor);const quantity=number(input.quantity,'corrected club units',{integer:true,min:1,max:10000000}),unitPrice=money(input.unitPrice,'corrected unit price'),tax=money(input.tax,'corrected tax'),note=text(input.note,'correction reason',{required:true});
    const ref=(await this.db.query('SELECT target_id FROM '+ns+'purchases WHERE id=$1',[input.purchaseId])).rows[0];if(!ref)throw new AppError('PURCHASE_NOT_FOUND','Purchase not found.',{status:404});
    return this.db.transaction(async db=>{
      const t=await this.target(db,ref.target_id),p=(await db.query('SELECT body FROM '+ns+'purchases WHERE id=$1 FOR UPDATE',[input.purchaseId])).rows[0].body;checkRevision(input,p);const before=structuredClone(p),delta=quantity-p.quantity;
      if(t.purchasedUnits+delta>t.targetUnits)throw new AppError('CORRECTION_EXCEEDS_TARGET','Review and increase the total target before recording an over-purchase.');
      Object.assign(p,{quantity,unitPrice,tax,totalPaid:round(quantity*unitPrice+tax),revision:p.revision+1,correctionNote:note,receiptStatus:'discrepancy_to_review'});
      await db.query('UPDATE '+ns+'purchases SET quantity=$2,revision=$3,body=$4::jsonb WHERE id=$1',[p.id,quantity,p.revision,json(p)]);
      t.purchasedUnits+=delta;t.remainingUnits-=delta;t.revision++;if(t.remainingUnits>0&&t.status==='complete'){t.status='held';t.holdReason='Purchase correction reopened outstanding quantity. Reapprove before buying.';}await this.writeTarget(db,t);
      if(p.paidPaymentId&&delta){const adjustment={id:randomUUID(),workerId:p.workerId,purchaseId:p.id,previousPaymentId:p.paidPaymentId,unitDelta:delta,status:'needs_review',createdAt:now(),note};await db.query('INSERT INTO '+ns+'payment_adjustments VALUES($1,$2,$3,$4::jsonb)',[adjustment.id,p.workerId,p.id,json(adjustment)]);}
      await audit(db,p.id,'purchase_correction',actor,before,p,note);return {purchase:p};
    });
  }
  async calculatePay(input,actor,db=this.db){
    manager(actor);const workerId=text(input.workerId,'worker ID',{max:100,required:true}),from=text(input.from,'start date',{max:10,required:true}),to=text(input.to,'end date',{max:10,required:true});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||from>to)throw new AppError('PAY_PERIOD_INVALID','Choose a valid date range.');
    const settings=await this.settings(db),date=p=>new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone}).format(new Date(p.boughtAt));
    const purchases=(await rows(db,'purchases')).filter(p=>p.workerId===workerId&&!p.paidPaymentId&&date(p)>=from&&date(p)<=to),groups=[];
    for(const key of new Set(purchases.map(p=>p.productKey))){const selected=purchases.filter(p=>p.productKey===key),rate=money(input.rates?.[key],'pay rate per club package',true);groups.push({productKey:key,title:selected[0].title,units:selected.reduce((s,p)=>s+p.quantity,0),rate,amount:rate===null?null:round(selected.reduce((s,p)=>s+p.quantity,0)*rate)});}
    const quote={workerId,from,to,groups,purchases:purchases.map(p=>({id:p.id,revision:p.revision,quantity:p.quantity})),total:groups.every(g=>g.amount!==null)?round(groups.reduce((s,g)=>s+g.amount,0)):null,calculatedAt:now()};
    quote.fingerprint=keyFor(workerId,from,to,groups,quote.purchases);return quote;
  }
  async markPaid(input,actor){
    manager(actor);const rid=requestId(input.requestId);
    return this.db.transaction(async db=>{
      // Serialize worker payments; a purchase row can be included in only one immutable payment.
      await db.query("INSERT INTO "+ns+"settings VALUES('pay_lock','{}') ON CONFLICT DO NOTHING");await db.query("SELECT key FROM "+ns+"settings WHERE key='pay_lock' FOR UPDATE");
      const duplicate=(await db.query('SELECT body FROM '+ns+'payments WHERE request_id=$1',[rid])).rows[0]?.body;if(duplicate){if(duplicate.fingerprint!==input.fingerprint||duplicate.workerId!==input.workerId)throw new AppError('REQUEST_REUSED','That payment form was used with different details.',{status:409});return {payment:duplicate,duplicate:true};}
      const quote=await this.calculatePay(input,actor,db);if(quote.fingerprint!==input.fingerprint)throw new AppError('PAY_WORK_CHANGED','Unpaid work or rates changed. Calculate again.',{status:409});
      if(quote.total===null||!quote.purchases.length)throw new AppError('PAY_NOT_READY','Choose unpaid work and enter every applicable rate.');
      const payment={...quote,id:randomUUID(),requestId:rid,createdAt:now(),recordedBy:actor.username,note:text(input.note??'','payment note'),recordsPaymentOnly:true};
      await db.query('INSERT INTO '+ns+'payments VALUES($1,$2,$3,$4,$5::jsonb)',[payment.id,rid,payment.workerId,payment.createdAt,json(payment)]);
      for(const ref of quote.purchases){const row=(await db.query('SELECT body FROM '+ns+'purchases WHERE id=$1 FOR UPDATE',[ref.id])).rows[0],p=row.body;if(p.paidPaymentId||p.revision!==ref.revision)throw new AppError('PAY_WORK_CHANGED','A purchase changed. Calculate again.',{status:409});p.paidPaymentId=payment.id;p.revision++;await db.query('UPDATE '+ns+'purchases SET paid_payment_id=$2,revision=$3,body=$4::jsonb WHERE id=$1',[p.id,payment.id,p.revision,json(p)]);}
      await audit(db,payment.id,'mark_paid',actor,null,payment);return {payment};
    });
  }
  async history(id,actor){manager(actor);return (await this.db.query('SELECT created_at,body FROM '+ns+'workflow_audit WHERE record_id=$1 ORDER BY created_at',[id])).rows;}
  async intake(input,actor){
    manager(actor);if(input.confirmed!==true)throw new AppError('SHELF_CONFIRM_REQUIRED','Confirm the current shelf identity and price first.');
    const title=text(input.title,'product title',{max:1000,required:true}),brand=text(input.brand,'brand',{max:200,required:true}),itemNumber=text(input.itemNumber,'club item number',{max:20,required:true}),warehouse=text(input.warehouse,'warehouse',{max:8,required:true}),price=money(input.price,'shelf price');
    if(!/^\d+$/.test(itemNumber)||!/^\d+$/.test(warehouse))throw new AppError('SHELF_ID_INVALID','Use the numeric club item and warehouse numbers.');
    return this.db.transaction(async db=>{
      const submission=(await db.query('SELECT body FROM '+ns+'worker_submissions WHERE id=$1 FOR UPDATE',[input.submissionId])).rows[0]?.body;if(!submission)throw new AppError('SUBMISSION_NOT_FOUND','Submission not found.');
      if(submission.productKey)return {productKey:submission.productKey,duplicate:true};
      const scanId='manual-'+submission.id,observedAt=now();
      const offer=normalizeOffer({item_number:itemNumber,title,brand,warehouse:{warehouse_id:warehouse,price,availability:'unknown'}},{warehouse,categories:[],types:['manual_shelf_find'],scanId,endpoint:'manual/shelf',observedAt});
      offer.sourceData={...offer.sourceData,provenance:{source:'Human-confirmed shelf observation',submissionId:submission.id,workerId:submission.workerId,confirmedBy:actor.username,confirmedAt:observedAt}};
      await this.store.saveJob({id:scanId,createdAt:observedAt,status:'complete',tasks:[],pages:1,received:1,matched:1,calls:0,cacheHits:0,scope:{source:'manual_shelf',warehouses:[warehouse]}},db);
      await this.store.saveOffer(db,scanId,offer);submission.productKey=offer.productKey;submission.status='in_research';submission.verifiedBy=actor.username;
      await db.query('UPDATE '+ns+'worker_submissions SET body=$2::jsonb WHERE id=$1',[submission.id,json(submission)]);await audit(db,submission.id,'manual_shelf_intake',actor,null,{productKey:offer.productKey,offerId:offer.id});return {productKey:offer.productKey};
    });
  }
  async visit(input,actor){
    manager(actor);const date=text(input.date,'visit date',{max:10,required:true}),warehouse=text(input.warehouse,'warehouse number',{max:8,required:true});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||!/^\d+$/.test(warehouse))throw new AppError('VISIT_INVALID','Choose a valid date and warehouse number.');
    const workerId=text(input.workerId??'','worker ID',{max:100});if(workerId&&!(await this.db.query('SELECT id FROM '+ns+'accounts WHERE id=$1 AND active=TRUE',[workerId])).rows.length)throw new AppError('WORKER_NOT_FOUND','Choose an active account.');
    const visit={id:randomUUID(),date,warehouse,workerId,note:text(input.note??'','visit instructions'),createdAt:now(),createdBy:actor.username};
    await this.db.transaction(async db=>{await db.query('INSERT INTO '+ns+'visit_plans VALUES($1,$2::jsonb)',[visit.id,json(visit)]);await audit(db,visit.id,'visit_plan',actor,null,visit);});return visit;
  }
  async releaseReservation(input,actor){
    manager(actor);const note=text(input.note,'release reason',{required:true});
    return this.db.transaction(async db=>{const t=await this.target(db,input.targetId);checkRevision(input,t);await db.query('UPDATE '+ns+'unit_reservations SET units=0 WHERE target_id=$1 AND worker_id=$2',[t.id,input.workerId]);t.revision++;await this.writeTarget(db,t);await audit(db,t.id,'manager_release_reservation',actor,null,{workerId:input.workerId},note);return {ok:true};});
  }
}
