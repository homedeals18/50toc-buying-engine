// Entirely synthetic; this connector never makes network or paid API calls.
const categories=[{category_id:'100',name:'Grocery & Snacks',slug:'grocery-snacks'},{category_id:'101',name:'Health & Beauty',slug:'health-beauty'},{category_id:'102',name:'Home & Kitchen',slug:'home-kitchen'}];
const items=[
  {item_number:'DEMO-101',product_id:'DEMO-P101',title:'Example Brand Chocolate Protein Shake, 14 fl oz, 10-pack',brand:'Example Brand',price:29.99,upc:null,pack_count:10,size:'14 fl oz',on_sale:true},
  {item_number:'DEMO-102',product_id:'DEMO-P102',title:'Example Brand Laundry Detergent, Fresh Scent, 150 fl oz',brand:'Example Brand',price:24.99},
  {item_number:'DEMO-103',product_id:'DEMO-P103',title:'Example Brand Sparkling Water, Variety Pack, 12 fl oz, 24-pack',brand:'Example Brand',price:14.99}
];
export class DemoProvider {
  constructor(){this.calls=[];}
  configured(){return true;}
  async usage(){return {connected:true,creditBalance:0,demo:true};}
  async call(endpoint,body={}){
    this.calls.push({endpoint,body});
    await new Promise(r=>setTimeout(r,60));
    let data;
    if(endpoint==='costco/categories')data={categories};
    else if(endpoint==='costco/warehouses')data={warehouses:[{warehouse_id:'1062',name:'Example Warehouse North',address:'Synthetic demonstration location'},{warehouse_id:'306',name:'Example Warehouse South',address:'Synthetic demonstration location'}]};
    else if(endpoint==='costco/coupons')data={valid_from:'2026-11-01',valid_to:'2026-11-30',coupons:[{...items[0],discount:{amount_off:3,final_price:16.97},applies_to:'warehouse'}]};
    else {
      const page=body.page??1;
      const categoryOffset=body.category==='health-beauty'?1:body.category==='home-kitchen'?2:0;
      const row=items[(page-1+categoryOffset)%items.length];
      data={page,total_pages:2,results:[{...row,warehouse:{warehouse_id:body.warehouse_id,price:page===1?19.97:16.88,availability:'in_stock'}}]};
    }
    return {json:{data},observedAt:new Date().toISOString(),cached:false};
  }
}
