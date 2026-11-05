/* Run before styles paint, so a saved dark appearance does not flash white. */
(()=>{
  const key='campus-island-theme',system=matchMedia('(prefers-color-scheme: dark)');
  const valid=value=>value==='dark'||value==='light';
  const read=()=>{try{const value=localStorage.getItem(key);return valid(value)?value:null;}catch{return null;}};
  let preference=read();
  function apply(){
    const theme=preference||(system.matches?'dark':'light');
    document.documentElement.dataset.theme=theme;
    document.documentElement.style.colorScheme=theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#15171c':'#faf9f6');
    document.querySelectorAll('[data-set-theme]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.setTheme===theme)));
  }
  apply();document.addEventListener('DOMContentLoaded',apply);
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-set-theme]');if(!button||!valid(button.dataset.setTheme))return;
    preference=button.dataset.setTheme;apply();
    try{localStorage.setItem(key,preference);}catch{}
  });
  system.addEventListener('change',()=>{if(!preference)apply();});
  window.addEventListener('storage',event=>{if(event.key===key||event.key===null){preference=read();apply();}});
})();
