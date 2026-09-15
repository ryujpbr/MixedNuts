import { randomInt } from 'node:crypto';
export function secureShuffle<T>(arr:readonly T[]):T[]{const out=[...arr];for(let i=out.length-1;i>0;i--){const j=randomInt(0,i+1);const a=out[i]!;out[i]=out[j]!;out[j]=a;}return out;}
export function seededShuffle<T>(arr:readonly T[],seed:number):T[]{let a=seed>>>0;const rng=()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};const out=[...arr];for(let i=out.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));const b=out[i]!;out[i]=out[j]!;out[j]=b;}return out;}
