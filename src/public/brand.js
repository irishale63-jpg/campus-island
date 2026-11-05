/* Original, code-drawn artwork for 校园岛. No remote assets or tracking. */
function islandArt(kind='scene') {
  return `<svg class="island-art ${kind}" viewBox="0 0 440 270" fill="none" aria-hidden="true">
    <ellipse class="island-water" cx="224" cy="224" rx="130" ry="15" fill="#DDD7EE"/>
    <ellipse cx="224" cy="224" rx="104" ry="9" stroke="#C9C0DF" stroke-dasharray="4 7"/>
    <path d="M63 139C73 55 189 28 291 53C389 77 401 175 324 210" stroke="#D6CCE6" stroke-dasharray="4 7"/>
    <g class="island-float">
      <path d="M109 167L147 205L221 232L296 209L332 166" fill="#9E8BC6"/>
      <path d="M147 184L165 209L219 226L204 185" fill="#B8A8D9"/>
      <path d="M250 184L240 225L288 207L302 182" fill="#8873B2"/>
      <path d="M109 166C108 142 153 129 180 126C186 106 202 83 229 88C255 88 271 110 279 130C308 130 337 145 332 166C327 187 276 200 223 199C165 199 115 188 109 166Z" fill="#B9DCC7" stroke="#6C9D88" stroke-width="2"/>
      <path d="M120 165C143 181 182 184 223 182C274 181 311 172 327 159" stroke="#DDF0E2" stroke-width="5" stroke-linecap="round"/>
      <path d="M180 126C191 127 201 132 208 141M279 130C267 131 259 136 254 143" stroke="#91BCA5" stroke-width="2" stroke-linecap="round"/>
      <g class="island-eyes"><ellipse cx="209" cy="155" rx="3" ry="4" fill="#476757"/><ellipse cx="238" cy="155" rx="3" ry="4" fill="#476757"/></g>
      <path d="M219 162Q224 168 230 162" stroke="#476757" stroke-width="2" stroke-linecap="round"/>
      <ellipse cx="200" cy="162" rx="7" ry="3" fill="#EBC5BC"/><ellipse cx="247" cy="162" rx="7" ry="3" fill="#EBC5BC"/>
      <g class="island-tree"><path d="M165 137L168 95" stroke="#7C6B70" stroke-width="4" stroke-linecap="round"/>
      <path d="M168 115C142 116 145 90 157 89C150 68 180 66 180 87C198 91 192 114 168 115Z" fill="#92BEA6" stroke="#6C9D88" stroke-width="2"/></g>
      <path d="M281 137V97" stroke="#8875A8" stroke-width="3" stroke-linecap="round"/>
      <path class="island-flag" d="M282 95L309 104L282 114" fill="#EAC6A3" stroke="#BA906B" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M149 153L153 147L157 153M285 162L289 156L293 162" stroke="#7EAA91" stroke-width="2" stroke-linecap="round"/>
    </g>
    <g class="island-note"><rect x="315" y="54" width="57" height="43" rx="10" fill="#FFFDF8" stroke="#CEC4DF" stroke-width="1.5"/>
      <path d="M328 67H359V85H328V67ZM328 68L343 78L359 68" stroke="#9D88B5" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M342 71L339 68C335 64 342 59 345 64C349 59 355 65 351 69L345 75" fill="#DFA7B7"/>
    </g>
    <g class="island-spark" stroke="#C39D68" stroke-width="2" stroke-linecap="round"><path d="M104 76V90M97 83H111M335 171V183M329 177H341"/></g>
    <g fill="#C6BCD9"><circle cx="79" cy="163" r="3"/><circle cx="292" cy="37" r="3"/><circle cx="369" cy="136" r="2"/></g>
    <path class="island-heart" d="M87 115C80 106 67 119 87 132C107 119 94 106 87 115Z" fill="#D8A5B7"/>
  </svg>`;
}

function animatePage() {
  const main=document.querySelector('#main');
  main.classList.remove('page-enter');
  requestAnimationFrame(()=>main.classList.add('page-enter'));
}

function celebrate() {
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const target=document.querySelector('#detail-content');
  if(!target||!document.querySelector('#detail-dialog').open)return;
  const burst=document.createElement('div');burst.className='kindness-burst';burst.setAttribute('aria-hidden','true');
  burst.innerHTML=Array.from({length:9},(_,i)=>`<i style="--i:${i};--turn:${i*40}deg"></i>`).join('');
  target.prepend(burst);setTimeout(()=>burst.remove(),1100);
}
