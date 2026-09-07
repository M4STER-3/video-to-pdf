// Run the actual app.js with minimal DOM/browser adapters; not a browser test.
export async function runUITests(source, nodes) {
 const assert=(v,m)=>{if(!v)throw Error(m)}, elements=new Map(), all=[], urls=new Set(); let counter=0;
 class Element {
  constructor(tag='div',attrs={}) {this.tagName=tag;this.children=[];this.hidden=false;this.disabled=false;this.style={};this.dataset={};this.attributes={};this.listeners=new Map();this.open=false;this.value='';this.min='';this.max='';this.src='';this.textContent='';this.classes=new Set();this.classList={add:(s)=>this.classes.add(s),remove:(s)=>this.classes.delete(s),toggle:(s,v)=>{v=v===undefined?!this.classes.has(s):v;v?this.classes.add(s):this.classes.delete(s);return v;}};for(const[k,v]of Object.entries(attrs)){this[k]=v;if(k==='hidden')this.hidden=true;if(k.startsWith('data-'))this.dataset[k.slice(5)]=v;}all.push(this);}
  get valueAsNumber(){return this.value===''?NaN:Number(this.value);}
  setAttribute(k,v){this.attributes[k]=v;}
  removeAttribute(k){delete this.attributes[k];if(k==='src')this.src='';}
  append(...xs){this.children.push(...xs);}
  replaceChildren(...xs){this.children=xs;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type){for(const fn of [...(this.listeners.get(type)||[])])fn({target:this,persisted:false});}
  click(){return this.onclick?.({target:this});}
  focus(){} scrollIntoView(){} setPointerCapture(){} getBoundingClientRect(){return {width:400,height:600};}
  querySelector(){return this.children.flatMap(x=>[x,...x.children]).find(x=>x.tagName==='button'&&!x.disabled)||null;}
  showModal(){this.open=true;}
  close(){this.open=false;this.emit('close');}
 }
 for(const n of nodes){const el=new Element(n.tag,n);if(n.id)elements.set(n.id,el);}
 const $=id=>elements.get(id), steps=Array.from({length:5},()=>new Element('li'));
 const video=$('video');video.duration=3;video.videoWidth=144;video.videoHeight=192;video.currentTime=0;video.readyState=2;video.pause=()=>{};video.load=()=>{if(video.src)Promise.resolve().then(()=>video.emit('loadedmetadata'));};
 $('page-filter').value='all';$('pdf-quality').value='high';
 const document={getElementById:$,createElement:tag=>new Element(tag),querySelectorAll(query){if(query==='.steps li')return steps;if(query==='[data-edge]')return all.filter(e=>e.dataset.edge);if(query==='[data-seek]')return all.filter(e=>e.dataset.seek);return all.filter(e=>['button','input','select'].includes(e.tagName));}};
 class ImageElement extends Element{constructor(){super('img');}}
 class File{constructor(parts,name,options){this.name=name;this.type=options?.type;this.size=parts.reduce((n,p)=>n+p.size,0);}}
 class DOMException extends Error{constructor(m,n){super(m);this.name=n;}}
 class AbortController{constructor(){this.signal={aborted:false,addEventListener(){},removeEventListener(){}};}abort(){this.signal.aborted=true;}}
 const URL={createObjectURL(){const u='blob:test-'+(++counter);urls.add(u);return u;},revokeObjectURL:u=>urls.delete(u)};
 const navigator={},window={addEventListener(){}}, location={protocol:'https:'};
 const RECOMMENDED={fps:8,stable:.3,motion:.012,duplicate:.006,settle:.06,jpeg:.96};
 let analyses=0, crops=0;
 const seekVideoTo=async(v,t,signal)=>{if(signal?.aborted)throw new DOMException('Annulé','AbortError');v.currentTime=t;};
 const captureFrame=async(v,c,q)=>({time:v.currentTime,width:c.w,height:c.h,blob:{size:100},thumbnail:{size:20}});
 const detectAutoCrop=async()=>{crops++;return {crop:{x:10,y:12,w:124,h:160},confidence:'high',reason:'Cadrage automatique testé.'};};
 const analyzeVideo=async(v,c,s,signal,onProgress,onPage,options)=>{analyses++;for(let i=0;i<2;i++){v.currentTime=i;await onPage({...await captureFrame(v,c,s.jpeg),id:'auto-'+i,reviewed:i===0,reasons:i?['À vérifier']:[]});onProgress(50+i*50,i+1,'Phase test','');}const result={pages:2,duplicates:[]};options.onFinish(result);return result;};
 const generatePDF=async()=>({size:1000});
 const bindings={document,window,navigator,location,URL,Image:ImageElement,File,DOMException,AbortController,RECOMMENDED,seekVideoTo,captureFrame,detectAutoCrop,analyzeVideo,generatePDF};
 const cleaned=source.replace(/^import .*?;\n/gm,'');
 const api=new Function(...Object.keys(bindings),cleaned+';return {state:()=>({pages,deleted,busy,stage,crop,cropInfo,pdfURL}),task,move,remove,openPreview,closePreview,runAnalysis};')(...Object.values(bindings));
 await $('file-input').onchange({target:{files:[{size:10000,type:'video/mp4',name:'écran.mp4'}],value:'file'}});
 assert(crops===1&&analyses===1&&api.state().pages.length===2&&api.state().stage===4&&!api.state().busy,'import automatique: '+JSON.stringify({crops,analyses,stage:api.state().stage,message:$('message').textContent}));
 assert(api.state().crop.x===10,'recadrage appliqué');
 api.move(1,-1);assert(api.state().pages[0].id==='auto-1','ordre tactile');
 api.remove(0);assert(api.state().pages.length===1&&api.state().deleted.length===1,'suppression');
 $('undo').click();assert(api.state().pages.length===2,'restauration');
 api.openPreview(api.state().pages[0]);assert($('page-preview').open&&urls.has($('preview-image').src),'aperçu original');
 $('approve-page').click();assert(api.state().pages[0].reviewed&&!$('page-preview').open,'validation aperçu');
 $('review-crop').click();$('reset-crop').click();assert(api.state().crop.x===0,'édition recadrage');$('cancel-crop').click();assert(api.state().crop.x===10,'annulation recadrage');
 $('setting-fps').value='99';$('review-crop').click();$('validate-crop').click();assert(api.state().stage===2&&analyses===1,'réglages invalides ne détruisent pas la sélection');$('cancel-crop').click();$('setting-fps').value='8';
 let release;const gate=new Promise(r=>release=r);let calls=0;const pending=api.task(async()=>{calls++;await gate;},'test');await api.task(async()=>{calls++;},'test');assert(calls===1&&api.state().busy,'verrou double traitement');release();await pending;
 assert(!api.state().busy&&!$('undo').disabled===Boolean(api.state().deleted.length),'restauration des contrôles');
 api.openPreview(api.state().pages[0]);$('delete-preview').click();assert(api.state().pages.length===1,'suppression depuis aperçu');
 assert(urls.size===3,'URLs inattendues après fermeture aperçu: '+urls.size); // video + two thumbnail URLs (one undoable)
 return {pass:true,checks:12,description:'Import automatique, recadrage, ordre, suppression/restauration, aperçu, correction annulée, réglages invalides, verrou concurrent, URL libérées'};
};
