// Entirely synthetic. Orders are reproducible; queue dates move with fixture creation/reset.
export function seedData(now = new Date()) {
  const specs = [
    ['National University Hospital','Singapore',[85,55,0],0],
    ['NUH Singapore','Singapore',[25,0,0],0],
    ['Harbour Medical Centre','Singapore',[65,40,15],0],
    ['Orchid Diagnostics','Singapore',[45,0,0],0],
    ['Selangor Healthcare','Malaysia',[100,65,0],-0.045],
    ['Penang Medical Centre','Malaysia',[80,50,20],-0.04],
    ['Johor Distribution','Malaysia',[120,75,0],0,'dropoff'],
    ['Melaka Specialty Clinic','Malaysia',[0,0,45],0],
    ['Siam Hospital Group','Thailand',[210,140,25],0.01],
    ['Bangkok Diagnostics','Thailand',[65,45,0],0],
    ['Chiang Mai Clinic','Thailand',[40,0,0],0],
    ['Jakarta Medical Centre','Indonesia',[95,60,0],0.01],
    ['Surabaya Healthcare','Indonesia',[75,50,20],0.02],
    ['Bali Specialty Clinic','Indonesia',[0,0,55],0],
    ['Medan Diagnostics','Indonesia',[50,0,0],0],
    ['Saigon Medical Centre','Vietnam',[65,45,0],0.10],
    ['Hanoi Healthcare','Vietnam',[55,35,20],0.12],
    ['Da Nang Diagnostics','Vietnam',[40,0,0],0.09]
  ];
  const customers=specs.map(([name,country],i)=>({id:`c${i+1}`,name,country,identifier:i<2?'SG-NUH-001':`DEMO-${i+1}`,email:i<2?'procurement@nuh.example':`procurement${i+1}@example.test`,aliases:i<2?['NUH','National University Hospital Singapore','National University Hospital']:[]}));
  const products=['A','B','C'].map((p,i)=>({id:`p${i+1}`,name:`Product ${p}`,category:'Medical supplies'}));
  const orders=[];
  const add=(i,p,m,quantity,signal)=>orders.push({id:`o${orders.length+1}`,customerId:customers[i].id,productId:`p${p+1}`,country:customers[i].country,month:new Date(Date.UTC(2025,9+m,1)).toISOString().slice(0,7),quantity,signal});
  specs.forEach(([, ,bases,trend,pattern],i)=>{
    for(let m=0;m<12;m++) {
      if(pattern==='dropoff' && m>=9) continue;
      bases.forEach((base,p)=>{
        if(!base) return;
        const variation=1+(((m*7+i*3+p*2)%9)-4)*0.025;
        add(i,p,m,Math.max(5,Math.round(base*(1+trend*m)*variation)),'confirmed');
      });
    }
    // A-only customers have genuine B gaps, even when an enquiry exists.
    if(bases[0] && !bases[1]) {add(i,1,10,30+i,'enquiry');add(i,1,11,45+i,'setup');}
    else if(i%5===0) add(i,2,11,20+i,'enquiry');
  });
  const at=days=>new Date(now.getTime()+days*86400000).toISOString();
  const requests=[
    {id:'REQ-1001',type:'Customer',name:'Mekong New Clinic',country:'Vietnam',identifier:'DEMO-VN-NEW',email:'new@mekong.example',details:{segment:'Direct account',terms:'Net 30',credit:25000,interest:'Product A'},requester:'Linh Nguyen',status:'Pending',stage:'Sales',approvals:[],createdAt:at(-6),deadline:at(1),priority:3},
    {id:'REQ-1002',type:'Vendor',name:'Penang Freight Services',country:'Malaysia',identifier:'DEMO-MY-FREIGHT',email:'ops@freight.example',details:{category:'Logistics',terms:'Net 45',bankCountry:'Malaysia',contact:'Aisha Lim',bankAccount:'SYNTHETIC-000123'},requester:'Aisha Lim',status:'Pending',stage:'Quality',approvals:['Finance'],createdAt:at(-12),deadline:at(-3),priority:3},
    {id:'REQ-1003',type:'Item',name:'Product B sterile kit',country:'Thailand',identifier:'PB-KIT-01',email:'',details:{line:'Product B',uom:'Box',cost:12.5,shelf:24},requester:'Narin Chai',status:'Clarification',stage:'Quality',approvals:[],createdAt:at(-8),deadline:at(3),priority:2},
    {id:'REQ-1004',type:'Cost Center',name:'Vietnam Operations',country:'Vietnam',identifier:'VN-OPS01',email:'',details:{owner:'Minh Tran',unit:'Operations',budget:250000},requester:'Minh Tran',status:'Pending',stage:'BU Head',approvals:['Finance'],createdAt:at(-4),deadline:at(10),priority:1}
  ];
  const audit=requests.flatMap((r,i)=>[
    {id:`AUD-${i}-created`,requestId:r.id,action:'created',actor:'Sales',timestamp:r.createdAt,details:'Synthetic request created'},
    ...r.approvals.map((actor,j)=>({id:`AUD-${i}-${j}`,requestId:r.id,action:'approve',actor,timestamp:at(-2),details:'Synthetic stage approval'})),
    ...(r.status==='Clarification'?[{id:`AUD-${i}-clarify`,requestId:r.id,action:'clarify',actor:r.stage,timestamp:at(-1),details:'Confirm sterile packaging specification and shelf life'}]:[])
  ]);
  return {customers,products,orders,requests,audit};
}
