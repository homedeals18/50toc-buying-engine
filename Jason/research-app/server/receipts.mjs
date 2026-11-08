import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './errors.mjs';
import {money,number,text,round} from './profit.mjs';
const ns='jason_research.',json=JSON.stringify;
function bytes(input){
  if(typeof input.base64!=='string'||input.base64.length>12*1024*1024||!/^[a-zA-Z0-9+/]*={0,2}$/.test(input.base64))throw new AppError('RECEIPT_INVALID','Choose a PDF, JPEG, PNG or WebP receipt up to 8 MB.');
  const data=Buffer.from(input.base64,'base64');if(!data.length||data.length>8*1024*1024)throw new AppError('RECEIPT_SIZE','Receipt must be between 1 byte and 8 MB.');
  const mime=data.subarray(0,5).toString()==='%PDF-'?'application/pdf':data.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP'?'image/webp':null;
  if(!mime||mime!==input.mime)throw new AppError('RECEIPT_TYPE','The receipt content does not match its declared PDF or image type.');return {data,mime};
}
export class ReceiptService{
  constructor(db){this.db=db;}
  async upload(input,actor){
    const {data,mime}=bytes(input),hash=createHash('sha256').update(data).digest('hex'),ids=input.purchaseIds;
    if(!input.submissionId&&(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string')))throw new AppError('RECEIPT_PURCHASE_REQUIRED','Choose the existing purchases this receipt supports.');
    const name=text(input.name,'receipt name',{max:200,required:true}).replace(/[<>:"/\\|?*]/g,'_');
    return this.db.transaction(async db=>{
      await db.query("INSERT INTO "+ns+"settings VALUES('receipt_upload_lock','{}') ON CONFLICT DO NOTHING");await db.query("SELECT key FROM "+ns+"settings WHERE key='receipt_upload_lock' FOR UPDATE");
      let purchases=[];
      if(input.submissionId){const submission=(await db.query('SELECT worker_id FROM '+ns+'worker_submissions WHERE id=$1 FOR UPDATE',[input.submissionId])).rows[0];if(!submission||actor.role!=='manager'&&submission.worker_id!==actor.id)throw new AppError('RECEIPT_ACCESS','Choose your own store submission.',{status:403});}
      else{purchases=(await db.query('SELECT id,worker_id,body FROM '+ns+'purchases WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[[...new Set(ids)]])).rows;if(purchases.length!==new Set(ids).size||purchases.some(p=>actor.role!=='manager'&&p.worker_id!==actor.id))throw new AppError('RECEIPT_ACCESS','Choose only your existing purchases.',{status:403});}
      const old=(await db.query('SELECT id,body FROM '+ns+'receipts WHERE sha256=$1',[hash])).rows[0];
      const record=old?.body??{id:randomUUID(),sha256:hash,name,mime,size:data.length,uploadedBy:actor.id,uploadedAt:new Date().toISOString(),status:'awaiting_review'};
      if(old&&actor.role!=='manager'&&record.uploadedBy!==actor.id)throw new AppError('RECEIPT_ACCESS','This image is already attached under another user. Ask a full-access user to review.',{status:403});
      await db.query('INSERT INTO '+ns+'receipts VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(sha256) DO NOTHING',[record.id,hash,mime,data,json(record)]);
      if(input.submissionId)await db.query('INSERT INTO '+ns+'submission_files VALUES($1,$2) ON CONFLICT DO NOTHING',[input.submissionId,record.id]);
      for(const p of purchases){await db.query('INSERT INTO '+ns+'receipt_links VALUES($1,$2) ON CONFLICT DO NOTHING',[record.id,p.id]);const body=p.body;if(body.receiptStatus==='awaiting_receipt'){body.receiptStatus='receipt_attached';body.revision++;await db.query('UPDATE '+ns+'purchases SET revision=$2,body=$3::jsonb WHERE id=$1',[p.id,body.revision,json(body)]);}}
      return {receipt:record,duplicate:!!old};
    });
  }
  async read(id,actor){
    const r=(await this.db.query('SELECT * FROM '+ns+'receipts WHERE id=$1',[id])).rows[0];if(!r)throw new AppError('RECEIPT_NOT_FOUND','Receipt not found.',{status:404});
    const allowed=actor.role==='manager'||(await this.db.query('SELECT p.id FROM '+ns+'purchases p JOIN '+ns+'receipt_links l ON l.purchase_id=p.id WHERE l.receipt_id=$1 AND p.worker_id=$2',[id,actor.id])).rows.length>0||(await this.db.query('SELECT s.id FROM '+ns+'worker_submissions s JOIN '+ns+'submission_files f ON f.submission_id=s.id WHERE f.receipt_id=$1 AND s.worker_id=$2',[id,actor.id])).rows.length>0;
    if(!allowed)throw new AppError('RECEIPT_ACCESS','This receipt belongs to another worker.',{status:403});
    return {...r.body,base64:Buffer.from(r.content).toString('base64')};
  }
  async reconcile(input,actor){
    if(actor.role!=='manager')throw new AppError('MANAGER_REQUIRED','Full access is required.',{status:403});
    const quantity=number(input.quantity,'receipt-line club units',{integer:true,min:1}),lineTotal=money(input.lineTotal,'receipt line total after discounts'),note=text(input.note,'receipt evidence note',{required:true});
    return this.db.transaction(async db=>{
      const linked=(await db.query('SELECT p.body FROM '+ns+'purchases p JOIN '+ns+'receipt_links l ON l.purchase_id=p.id WHERE p.id=$1 AND l.receipt_id=$2 FOR UPDATE OF p',[input.purchaseId,input.receiptId])).rows[0];
      if(!linked)throw new AppError('RECEIPT_LINK_REQUIRED','Attach the receipt to this purchase first.');
      const p=linked.body;if(p.revision!==input.revision)throw new AppError('PURCHASE_CHANGED','The purchase changed. Refresh before reconciling.',{status:409});
      const matches=quantity===p.quantity&&Math.abs(lineTotal-round(p.quantity*p.unitPrice))<0.011;
      p.receiptStatus=matches?'reconciled':'discrepancy_to_review';p.reconciliation={receiptId:input.receiptId,quantity,lineTotal,note,actor:actor.username,at:new Date().toISOString(),basis:'Selected item line after discounts, excluding separately recorded tax. Not the receipt grand total.'};p.revision++;
      await db.query('UPDATE '+ns+'purchases SET revision=$2,body=$3::jsonb WHERE id=$1',[p.id,p.revision,json(p)]);
      await db.query('INSERT INTO '+ns+'workflow_audit VALUES($1,$2,$3,$4::jsonb)',[randomUUID(),p.id,new Date().toISOString(),json({action:'receipt_reconciliation',actor:{id:actor.id,username:actor.username},evidence:p.reconciliation,result:p.receiptStatus})]);return {purchase:p};
    });
  }
}
