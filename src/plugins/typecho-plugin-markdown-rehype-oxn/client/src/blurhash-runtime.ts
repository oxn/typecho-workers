type BlurhashRuntimeApi = { initialize(root: Element): void };
declare global { interface Window { __oxnMarkdownBlurhashRuntime?: BlurhashRuntimeApi } }

(() => {
 const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
 const selector = 'img[src*="#blurhash="]';
 const processed = new WeakSet<HTMLImageElement>();
 const originalStyles = new WeakMap<HTMLImageElement, {opacity:string;transition:string;backgroundImage:string;backgroundSize:string;backgroundPosition:string}>();

 function decode83(value:string,start:number,length:number):number {
  let result=0;
  for(let i=start;i<start+length;i++){const digit=alphabet.indexOf(value[i]);if(digit<0)throw new Error('Invalid BlurHash character');result=result*83+digit;}
  return result;
 }
 function srgbToLinear(value:number):number {const v=value/255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
 function linearToSrgb(value:number):number {const v=Math.max(0,Math.min(1,value));const s=v<=0.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-0.055;return Math.max(0,Math.min(255,Math.round(s*255)));}
 function signPow(value:number,exponent:number):number{return Math.sign(value)*Math.pow(Math.abs(value),exponent);}
 function decodeDC(value:number):number[]{return[srgbToLinear(value>>16),srgbToLinear((value>>8)&255),srgbToLinear(value&255)];}
 function decodeAC(value:number,maximum:number):number[]{const r=Math.floor(value/(19*19))-9,g=Math.floor(value/19)%19-9,b=value%19-9;return[signPow(r/9,2)*maximum,signPow(g/9,2)*maximum,signPow(b/9,2)*maximum];}
 function decodeBlurhash(hash:string,width:number,height:number):Uint8ClampedArray {
  if(hash.length<6)throw new Error('BlurHash is too short');
  const sizeFlag=decode83(hash,0,1),componentsX=sizeFlag%9+1,componentsY=Math.floor(sizeFlag/9)+1;
  if(componentsX>9||componentsY>9||hash.length!==4+2*componentsX*componentsY)throw new Error('Invalid BlurHash dimensions or length');
  const maximum=(decode83(hash,1,1)+1)/166;
  const colors:number[][]=[decodeDC(decode83(hash,2,4))];
  for(let i=1;i<componentsX*componentsY;i++)colors.push(decodeAC(decode83(hash,4+i*2,2),maximum));
  const pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   let red=0,green=0,blue=0;
   for(let j=0;j<componentsY;j++)for(let i=0;i<componentsX;i++){
    const basis=Math.cos(Math.PI*x*i/width)*Math.cos(Math.PI*y*j/height),color=colors[i+j*componentsX];
    red+=color[0]*basis;green+=color[1]*basis;blue+=color[2]*basis;
   }
   const offset=4*(x+y*width);pixels[offset]=linearToSrgb(red);pixels[offset+1]=linearToSrgb(green);pixels[offset+2]=linearToSrgb(blue);pixels[offset+3]=255;
  }
  return pixels;
 }
 // Decode only valid %HH triplets. A stray literal '%' is preserved instead of throwing.
 function decodePercent(value:string):string{return value.replace(/%([0-9a-f]{2})/gi,(_m,hex:string)=>String.fromCharCode(parseInt(hex,16)));}
 function dimension(value:string|undefined):number|undefined {if(!value||!/^\d+$/.test(value))return;const n=Number(value);return Number.isSafeInteger(n)&&n>0&&n<=100000?n:undefined;}
 function parseSource(img:HTMLImageElement):{src:string;hash:string;width?:number;height?:number}|null {
  const raw=img.getAttribute('src');if(!raw)return null;const marker=raw.indexOf('#');if(marker<0)return null;
  const base=raw.slice(0,marker),parts=raw.slice(marker+1).split('&'),remaining:string[]=[];
  let hash:string|undefined,width:number|undefined,height:number|undefined;
  for(const part of parts){
   const eq=part.indexOf('='),key=decodePercent(eq<0?part:part.slice(0,eq)),value=eq<0?'':part.slice(eq+1);
   if(key==='blurhash')hash=decodePercent(value);
   else if(key==='width')width=dimension(decodePercent(value));
   else if(key==='height')height=dimension(decodePercent(value));
   else if(part)remaining.push(part);
  }
  if(!hash)return null;
  return{src:base+(remaining.length?'#'+remaining.join('&'):''),hash,width,height};
 }
 function restore(img:HTMLImageElement):void {
  const old=originalStyles.get(img);if(!old)return;
  img.style.opacity=old.opacity;img.style.transition=old.transition;img.style.backgroundImage=old.backgroundImage;
  img.style.backgroundSize=old.backgroundSize;img.style.backgroundPosition=old.backgroundPosition;originalStyles.delete(img);
 }
 function preview(img:HTMLImageElement,hash:string,width?:number,height?:number):void {
  if(img.complete&&img.naturalWidth>0)return;
  try{
   const ratio=width&&height?width/height:img.naturalWidth&&img.naturalHeight?img.naturalWidth/img.naturalHeight:1;
   const w=Math.max(1,Math.min(32,Math.round(ratio>=1?32:32*ratio))),h=Math.max(1,Math.min(32,Math.round(ratio>=1?32/ratio:32)));
   const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
   const context=canvas.getContext('2d');if(!context)return;
   context.putImageData(new ImageData(decodeBlurhash(hash,w,h),w,h),0,0);
   const data=canvas.toDataURL('image/png');
   originalStyles.set(img,{opacity:img.style.opacity,transition:img.style.transition,backgroundImage:img.style.backgroundImage,backgroundSize:img.style.backgroundSize,backgroundPosition:img.style.backgroundPosition});
   img.style.backgroundImage='url("'+data+'")';img.style.backgroundSize='cover';img.style.backgroundPosition='center';
   img.style.transition=img.style.transition||'opacity 180ms ease';img.style.opacity='0';
   const finish=()=>restore(img);img.addEventListener('load',finish,{once:true});img.addEventListener('error',finish,{once:true});
  }catch(error){console.warn('[Markdown Rehype OXN] Invalid BlurHash:',error);}
 }
 function process(img:HTMLImageElement):void {
  if(processed.has(img))return;const parsed=parseSource(img);if(!parsed)return;processed.add(img);
  img.dataset.oxnBlurhash=parsed.hash;if(parsed.width)img.dataset.oxnWidth=String(parsed.width);if(parsed.height)img.dataset.oxnHeight=String(parsed.height);
  if(parsed.width&&!img.hasAttribute('width'))img.setAttribute('width',String(parsed.width));
  if(parsed.height&&!img.hasAttribute('height'))img.setAttribute('height',String(parsed.height));
  preview(img,parsed.hash,parsed.width,parsed.height);
  if(parsed.src!==img.getAttribute('src'))img.setAttribute('src',parsed.src);
  if(img.complete&&img.naturalWidth>0)restore(img);
 }
 function initialize(root:Element):void {
  const images=Array.from(root.querySelectorAll<HTMLImageElement>(selector));
  if(root.matches(selector))images.unshift(root as HTMLImageElement);
  images.forEach(process);
 }
 window.__oxnMarkdownBlurhashRuntime={initialize};
})();
