/**
 * Builds the bookmarklet: run on any site using Axeptio, it finds the project ID and opens
 * Cookies Atlas with the page's language settings prefilled in the simulator.
 * Only the path is passed along (never the query string, which can hold personal data).
 */
export function bookmarkletCode(appUrl: string, notFoundMessage: string): string {
  const code = `(function(){
var id='',s=window.axeptioSettings||{},ok=function(v){return typeof v==='string'&&/^[a-f0-9]{24}$/i.test(v);};
if(ok(s.clientId))id=s.clientId;
if(!id){try{var k=window.__axeptioSDK;if(k&&k.config&&ok(k.config.projectId))id=k.config.projectId;}catch(e){}}
if(!id){try{var r=performance.getEntriesByType('resource');for(var i=0;i<r.length;i++){var m=/client\\.axept\\.io\\/projectconfigurations\\/brands\\/([a-f0-9]{24})\\.json/i.exec(r[i].name);if(m){id=m[1];break;}}}catch(e){}}
if(!id){var d=document.createElement('div');d.textContent=${JSON.stringify(notFoundMessage)};d.setAttribute('style','position:fixed;z-index:2147483647;top:16px;right:16px;max-width:320px;background:#262625;color:#fff;padding:12px 16px;border-radius:10px;font:15px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)');document.body.appendChild(d);setTimeout(function(){d.remove();},4500);return;}
var p=new URLSearchParams();p.set('project',id.toLowerCase());p.set('tab','simulator');
if(s.useDocumentLang)p.set('logic','html');
p.set('hlang',document.documentElement.lang||'');
if(navigator.language)p.set('blang',navigator.language);
if(typeof s.cookiesVersion==='string'&&s.cookiesVersion)p.set('cv',s.cookiesVersion);
if(location.pathname&&location.pathname!=='/')p.set('page',location.pathname.slice(0,200));
window.open(${JSON.stringify(appUrl)}+'?'+p.toString(),'_blank','noopener');
})();`;
  return 'javascript:' + encodeURIComponent(code.replace(/\n/g, ''));
}

/** The app's own URL without query or hash (works on GitHub Pages and locally). */
export const appUrl = () => `${window.location.origin}${window.location.pathname}`;
