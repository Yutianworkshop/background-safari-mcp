(function(){
var V=__VER__;
if(window.__sm)return window.__sm.v===V?'ok':'stale';
var S={v:V,n:0,refs:new Map(),ids:new WeakMap(),logs:[],net:[],dialogs:[],inflight:new Map(),rid:0,
       lastMut:Date.now(),actUntil:0,dialogMode:'dismiss',promptText:null,files:{},jobs:{}};
var SKIP=/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|LINK|META|BR|WBR)$/;
var IROLE=/^(button|link|tab|menuitem|menuitemcheckbox|menuitemradio|checkbox|radio|switch|option|combobox|listbox|textbox|searchbox|slider|spinbutton|treeitem|file)$/;
var FOCUSABLE='a[href],button,input,select,textarea,[tabindex],[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';

// ------------------------------------------------------------------ basics
function win(el){return (el.ownerDocument&&el.ownerDocument.defaultView)||window;}
function txt(s){return String(s==null?'':s).replace(/\s+/g,' ').trim();}
function cut(s,n){s=txt(s);return s.length>n?s.slice(0,n-1)+'…':s;}
function par(el){var p=el.parentNode;return p&&p.nodeType===11?p.host:p;}
function frameDoc(n){try{var d=n.contentDocument;return d&&d.documentElement?d:null;}catch(e){return null;}}
function kids(n){
  var out=[];
  if(n.shadowRoot)out.push(n.shadowRoot);
  if(n.tagName==='IFRAME'||n.tagName==='FRAME'){var d=frameDoc(n);if(d)out.push(d.documentElement);}
  var c=n.children;if(c)for(var i=0;i<c.length;i++)out.push(c[i]);
  return out;
}
// Pre-order walk through light DOM, open shadow roots and same-origin frames.
function walk(root,fn){
  var st=[root],seen=0;
  while(st.length){
    var n=st.pop();
    if(n.nodeType===1){if(++seen>60000)return false;if(fn(n)===false)continue;}
    var k=kids(n);for(var i=k.length-1;i>=0;i--)st.push(k[i]);
  }
  return true;
}
function ref(el){var id=S.ids.get(el);if(!id){id='e'+(++S.n);S.ids.set(el,id);S.refs.set(id,new WeakRef(el));}return id;}
function role(el){
  var r=el.getAttribute('role');if(r)return r.trim().split(/\s+/)[0];
  var t=el.tagName;
  if(t==='A')return el.hasAttribute('href')?'link':'';
  if(t==='BUTTON'||t==='SUMMARY')return 'button';
  if(t==='SELECT')return el.multiple?'listbox':'combobox';
  if(t==='TEXTAREA')return 'textbox';
  if(t==='INPUT'){
    var ty=(el.getAttribute('type')||'text').toLowerCase();
    if(ty==='hidden')return '';
    return ({button:'button',submit:'button',reset:'button',image:'button',checkbox:'checkbox',radio:'radio',
             range:'slider',number:'spinbutton',search:'searchbox',file:'file'})[ty]||'textbox';
  }
  if(el.isContentEditable&&!(el.parentElement&&el.parentElement.isContentEditable))return 'textbox';
  return '';
}
function kind(el,cs,parentPointer){
  var r=role(el);
  if(IROLE.test(r))return r;
  if(el.hasAttribute('onclick'))return 'clickable';
  var ti=el.getAttribute('tabindex');
  if(ti!==null&&+ti>=0&&el.tagName!=='IFRAME')return r||'focusable';
  if(cs&&cs.cursor==='pointer'&&!parentPointer)return 'clickable';
  return '';
}
function name(el){
  var D=el.ownerDocument,v,s,t=el.tagName;
  if((v=el.getAttribute('aria-label'))&&txt(v))return txt(v);
  if((v=el.getAttribute('aria-labelledby'))){
    s=txt(v.split(/\s+/).map(function(id){var e=D.getElementById(id);return e?e.textContent:'';}).join(' '));
    if(s)return s;
  }
  if(t==='INPUT'||t==='SELECT'||t==='TEXTAREA'){
    if(t==='INPUT'&&/^(button|submit|reset)$/i.test(el.type)&&el.value)return txt(el.value);
    if(el.labels&&el.labels.length){
      s=txt(Array.prototype.map.call(el.labels,function(l){
        var c=l.cloneNode(true);var x=c.querySelectorAll('select,textarea,script,style');for(var i=0;i<x.length;i++)x[i].remove();
        return c.textContent;}).join(' '));
      if(s)return s;
    }
    return txt(el.getAttribute('placeholder')||el.getAttribute('title')||el.getAttribute('alt')||el.getAttribute('name')||el.id||'');
  }
  if(el.isContentEditable)return txt(el.getAttribute('aria-placeholder')||el.getAttribute('data-placeholder')||el.getAttribute('placeholder')||el.getAttribute('title')||'');
  s=txt(el.innerText!==undefined?el.innerText:el.textContent);
  if(s)return s;
  var im=el.querySelector&&el.querySelector('img[alt],[aria-label],[title]');
  if(im){s=txt(im.getAttribute('alt')||im.getAttribute('aria-label')||im.getAttribute('title'));if(s)return s;}
  return txt(el.getAttribute('title')||el.getAttribute('alt')||el.getAttribute('value')||'');
}
function brief(el){
  var t=(el.tagName||'node').toLowerCase(),n=cut(name(el),50);
  if(t==='input'&&el.type==='password')n=cut(el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.name||'',50);
  return '<'+t+(el.id?'#'+el.id:'')+'>'+(n?' "'+n+'"':'');
}
function desc(el,k){
  var t=el.tagName,s='['+ref(el)+'] '+k,nm=cut(name(el),80),v;
  if(nm)s+=' "'+nm+'"';
  var ty=(el.getAttribute('type')||'').toLowerCase();
  if(t==='INPUT'&&ty&&!/^(text|button|submit|checkbox|radio|file|search|range|number|reset|image)$/.test(ty))s+=' type='+ty;
  if(t==='INPUT'||t==='TEXTAREA'){
    if(k==='checkbox'||k==='radio'){if(el.checked)s+=' checked';}
    else if(k==='file'){if(el.multiple)s+=' multiple';if(el.accept)s+=' accept='+cut(el.accept,60);if(el.files&&el.files.length)s+=' files='+el.files.length;}
    else if(k!=='button'){v=el.value||'';if(v)s+=ty==='password'?' value=•••('+v.length+' chars)':' value="'+cut(v,60)+'"';}
  }else if(t==='SELECT'){
    var so=Array.prototype.filter.call(el.options,function(o){return o.selected;}).map(function(o){return cut(o.text,40);});
    s+=' value="'+so.join(', ')+'"';
    var all=Array.prototype.map.call(el.options,function(o){return cut(o.text,30);});
    s+=' options: '+all.slice(0,12).join(' | ')+(all.length>12?' | …(+'+(all.length-12)+' more)':'');
  }else if(el.isContentEditable){v=cut(el.innerText,60);if(v)s+=' value="'+v+'"';}
  else if(t==='A'){
    var h=el.getAttribute('href')||'';
    if(h&&!/^javascript:/i.test(h)){try{var u=new URL(el.href);h=u.origin===location.origin?u.pathname+u.search+u.hash:el.href;}catch(e){}s+=' → '+(h.length>100?h.slice(0,99)+'…':h);}
    if(el.target==='_blank')s+=' (new tab)';
  }
  var a=el.getAttribute('aria-checked');if(a==='true')s+=' checked';else if(a==='mixed')s+=' mixed';
  a=el.getAttribute('aria-expanded');if(a==='true')s+=' expanded';else if(a==='false')s+=' collapsed';
  if(el.getAttribute('aria-selected')==='true')s+=' selected';
  if(el.getAttribute('aria-pressed')==='true')s+=' pressed';
  if(el.getAttribute('aria-haspopup')&&el.getAttribute('aria-haspopup')!=='false')s+=' haspopup';
  if(el.disabled||el.getAttribute('aria-disabled')==='true')s+=' disabled';
  if(el.required||el.getAttribute('aria-required')==='true')s+=' required';
  if(el.readOnly&&(t==='INPUT'||t==='TEXTAREA'))s+=' readonly';
  if(el.getAttribute('aria-invalid')==='true')s+=' invalid';
  return s;
}

// ------------------------------------------------------------------ snapshot
S.snapshot=function(o){
  o=o||{};
  if(S.refs.size>5000)S.refs.forEach(function(w,k){if(!w.deref())S.refs.delete(k);});
  var q=txt(o.query||'').toLowerCase().split(' ').filter(Boolean),full=o.mode==='full',vp=!!o.viewport,max=o.max||150;
  var lines=[],total=0,ptr=new WeakMap(),cov=new WeakSet();
  function emit(line){
    if(q.length){var l=line.toLowerCase();for(var i=0;i<q.length;i++)if(l.indexOf(q[i])<0)return;}
    total++;if(lines.length<max)lines.push(line);
  }
  var complete=walk(document.documentElement,function(el){
    var t=el.tagName;if(typeof t!=='string')return false;
    if(SKIP.test(t))return false;
    var W=win(el),cs=W.getComputedStyle(el);
    if(cs.display==='none'){
      var fi=el.matches&&el.matches('input[type=file]')?[el]:(el.querySelectorAll?el.querySelectorAll('input[type=file]'):[]);
      for(var i=0;i<fi.length;i++)emit(desc(fi[i],'file')+' (hidden input; upload_file works on it)');
      return false;
    }
    var p=par(el),pp=p?!!ptr.get(p):false;ptr.set(el,cs.cursor==='pointer');
    if(p&&cov.has(p))cov.add(el);
    var r=el.getBoundingClientRect(),shown=r.width>0&&r.height>0&&cs.visibility!=='hidden';
    if(vp&&shown&&(r.bottom<0||r.top>W.innerHeight||r.right<0||r.left>W.innerWidth))shown=false;
    var k=kind(el,cs,pp);
    if(t==='svg'||t==='SVG'||t==='CANVAS'||t==='VIDEO'||t==='AUDIO'||t==='OBJECT'||t==='EMBED'){
      if(k&&shown)emit(desc(el,k));
      else if(full&&shown&&t!=='svg'&&t!=='SVG')emit('['+ref(el)+'] '+t.toLowerCase());
      return false;
    }
    if(t==='IFRAME'||t==='FRAME'){
      if(!shown)return false;
      if(frameDoc(el))emit('--- frame "'+cut(el.getAttribute('title')||el.getAttribute('name')||el.id||el.getAttribute('src')||'',60)+'" (contents follow) ---');
      else emit('['+ref(el)+'] iframe (cross-origin) src='+cut(el.src,140));
      return true;
    }
    if(/^H[1-6]$/.test(t)){
      if(shown){var h=cut(el.innerText,120);if(h)emit('#'.repeat(+t.charAt(1))+' '+h);}
      cov.add(el);return true;
    }
    var rl=el.getAttribute('role');
    if(shown&&((t==='DIALOG'&&el.open)||rl==='dialog'||rl==='alertdialog'||el.getAttribute('aria-modal')==='true')){
      var dn=txt(el.getAttribute('aria-label')||'');
      if(!dn){var lb=el.getAttribute('aria-labelledby');var le=lb&&el.ownerDocument.getElementById(lb.split(/\s+/)[0]);if(le)dn=txt(le.textContent);}
      emit('--- dialog'+(dn?' "'+cut(dn,60)+'"':'')+' ---');
    }
    var always=k==='file'||(t==='INPUT'&&(k==='checkbox'||k==='radio'));
    if(k&&(shown||(always&&!vp))){
      emit(desc(el,k)+(shown?'':' (not visible)'));
      cov.add(el);
      return t!=='SELECT';
    }
    if(full&&shown){
      if(t==='IMG'){if(el.alt)emit('img "'+cut(el.alt,80)+'"');return true;}
      if(!cov.has(el)){
        var s='';for(var c=el.firstChild;c;c=c.nextSibling)if(c.nodeType===3)s+=c.nodeValue;
        s=cut(s,300);if(s.length>1)emit((t==='LABEL'?'label: ':t==='TD'||t==='TH'?'cell: ':t==='LI'?'- ':'text: ')+s);
      }
    }
    return true;
  });
  var se=document.scrollingElement||document.documentElement,diff=null;
  if(o.diff){var strip=function(l){return l;},prev=S.lastSnap||[],ps={},ns={};prev.forEach(function(l){ps[l]=1;});lines.forEach(function(l){ns[l]=1;});
    diff=prev.filter(function(l){return !ns[l];}).map(function(l){return '- '+l;}).concat(lines.filter(function(l){return !ps[l];}).map(function(l){return '+ '+l;}));
    diff={lines:diff,hadPrev:!!S.lastSnap};}
  S.lastSnap=lines.slice();
  return {diff:diff,url:location.href,title:document.title,lines:lines,total:total,complete:complete,
          y:Math.round(window.scrollY),h:se.scrollHeight,vh:window.innerHeight};
};

// ------------------------------------------------------------------ target resolution
function roots(){
  var out=[document];
  walk(document.documentElement,function(el){
    if(typeof el.tagName!=='string')return false;
    if(el.shadowRoot)out.push(el.shadowRoot);
    if(el.tagName==='IFRAME'||el.tagName==='FRAME'){var d=frameDoc(el);if(d)out.push(d);}
    return true;
  });
  return out;
}
function deepQuery(sel){
  var el=document.querySelector(sel);if(el)return el;
  var rs=roots();for(var i=1;i<rs.length;i++){el=rs[i].querySelector(sel);if(el)return el;}
  return null;
}
function byText(s){
  var want=txt(s).toLowerCase(),best=null,bs=0,ptr=new WeakMap();
  if(!want)throw new Error('empty text= target');
  walk(document.documentElement,function(el){
    var t=el.tagName;if(typeof t!=='string'||SKIP.test(t))return false;
    var W=win(el),cs=W.getComputedStyle(el);if(cs.display==='none')return false;
    var p=par(el),pp=p?!!ptr.get(p):false;ptr.set(el,cs.cursor==='pointer');
    var r=el.getBoundingClientRect();
    if(!(r.width>0&&r.height>0)||cs.visibility==='hidden')return true;
    var n=name(el).toLowerCase();if(!n)return t!=='svg';
    var m=n===want?4:n.indexOf(want)===0?2:n.indexOf(want)>=0?1:0;
    if(!m)return t!=='svg'&&t!=='SELECT';
    var k=kind(el,cs,pp),sc=m*2+(k?1:0);
    if(sc>bs||(sc===bs&&!k)){bs=sc;best=el;}
    return t!=='svg'&&t!=='SELECT';
  });
  if(!best)throw new Error('no visible element with text "'+s+'" — take a snapshot to see what is on the page');
  return best;
}
S.el=function(t){
  if(t==null||t==='')throw new Error('a target is required (ref like e12, a CSS selector, or text=Label)');
  t=String(t).trim();
  if(/^x\d+$/.test(t))throw new Error(t+' points into a cross-origin frame. There, only click, trusted_click, fill, get_page_text, native_click, native_type and upload_file(method="picker") work; this tool needs script access to the element.');
  if(/^e\d+$/.test(t)){
    var w=S.refs.get(t),el=w&&w.deref();
    if(!el)throw new Error('ref '+t+' is unknown on this page (it navigated or reloaded) — take a new snapshot');
    if(!el.isConnected)throw new Error('ref '+t+' is stale (the element was removed) — take a new snapshot');
    return el;
  }
  if(t.slice(0,5)==='text=')return byText(t.slice(5));
  if(t.slice(0,4)==='css=')t=t.slice(4);
  var e;try{e=deepQuery(t);}catch(x){throw new Error('invalid CSS selector: '+t+' (for visible text use text=...)');}
  if(!e)throw new Error('no element matches selector '+t);
  return e;
};
function active(){
  var a=document.activeElement;
  for(;;){
    if(a&&a.shadowRoot&&a.shadowRoot.activeElement)a=a.shadowRoot.activeElement;
    else if(a&&(a.tagName==='IFRAME'||a.tagName==='FRAME')){var d=frameDoc(a);if(d&&d.activeElement&&d.activeElement!==d.body)a=d.activeElement;else break;}
    else break;
  }
  return a||document.body;
}

// ------------------------------------------------------------------ actions
function act(mode,ptext){S.actUntil=Date.now()+2500;S.dialogMode=mode==='dismiss'?'dismiss':'accept';S.promptText=ptext==null?null:String(ptext);}
function fire(el,type,init,Ctor){var W=win(el),C=W[Ctor]||W.Event;return el.dispatchEvent(new C(type,init));}
function clickEl(el,o){
  o=o||{};var W=win(el),D=el.ownerDocument;
  if(el.scrollIntoView)el.scrollIntoView({block:'center',inline:'nearest'});
  var r=el.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2),note='';
  if(!(r.width>0&&r.height>0))note+=' (element has no size; events were dispatched anyway)';
  else{
    var root=el.getRootNode?el.getRootNode():D,top=(root&&root.elementFromPoint?root:D).elementFromPoint(x,y);
    if(top&&top!==el&&!el.contains(top)&&!top.contains(el))note+=' (note: its centre is covered by '+brief(top)+', which a real click would hit instead)';
  }
  if(el.disabled||el.getAttribute('aria-disabled')==='true')note+=' (element is disabled)';
  var btn=o.button==='right'?2:0,n=o.button==='double'?2:1;
  function M(type,C,extra){
    var i={bubbles:true,cancelable:true,composed:true,view:W,clientX:x,clientY:y,screenX:x+(W.screenX||0),screenY:y+(W.screenY||0),
           button:btn,buttons:0,detail:0,pointerId:1,pointerType:'mouse',isPrimary:true};
    if(extra)for(var k in extra)i[k]=extra[k];
    return fire(el,type,i,C);
  }
  M('pointerover','PointerEvent');M('mouseover','MouseEvent');M('pointermove','PointerEvent');M('mousemove','MouseEvent');
  for(var c=1;c<=n;c++){
    M('pointerdown','PointerEvent',{buttons:btn?2:1,detail:c});
    if(M('mousedown','MouseEvent',{buttons:btn?2:1,detail:c})){
      var f=el.closest?el.closest(FOCUSABLE):null;
      try{if(f&&f.focus)f.focus({preventScroll:true});else if(D.activeElement&&D.activeElement!==D.body&&D.activeElement.blur)D.activeElement.blur();}catch(e){}
    }
    M('pointerup','PointerEvent',{detail:c});M('mouseup','MouseEvent',{detail:c});
    if(btn)M('contextmenu','MouseEvent');else M('click','MouseEvent',{detail:c});
  }
  if(n===2)M('dblclick','MouseEvent',{detail:2});
  var a=el.closest&&el.closest('a[target=_blank]');
  if(a&&a.href)note+=' (this link targets a new tab; if nothing opened, Safari blocked the popup — use open_url("'+a.href+'", new_tab=True))';
  if(el.tagName==='SELECT')note+=' (a native <select> menu cannot be opened by script — use fill to choose an option)';
  if(el.tagName==='INPUT'&&el.type==='file')note+=' (a file picker cannot be opened by script — use upload_file)';
  return 'clicked '+brief(el)+note;
}
S.click=function(t,o){o=o||{};var el=S.el(t);act(o.dialog,o.promptText);return clickEl(el,o);};
S.hover=function(t){
  var el=S.el(t),W=win(el);el.scrollIntoView({block:'center',inline:'nearest'});
  var r=el.getBoundingClientRect(),i={bubbles:true,cancelable:true,composed:true,view:W,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerId:1,pointerType:'mouse',isPrimary:true};
  var nb={};for(var k in i)nb[k]=i[k];nb.bubbles=false;
  fire(el,'pointerover',i,'PointerEvent');fire(el,'pointerenter',nb,'PointerEvent');fire(el,'mouseover',i,'MouseEvent');fire(el,'mouseenter',nb,'MouseEvent');
  fire(el,'pointermove',i,'PointerEvent');fire(el,'mousemove',i,'MouseEvent');
  return 'hovered '+brief(el)+' (script-driven: JS hover handlers run, CSS :hover styles do not)';
};
function insert(el,text){try{return !!el.ownerDocument.execCommand('insertText',false,text);}catch(e){return false;}}
function setVal(el,v,itype){
  var W=win(el),proto=el.tagName==='TEXTAREA'?W.HTMLTextAreaElement.prototype:el.tagName==='SELECT'?W.HTMLSelectElement.prototype:W.HTMLInputElement.prototype;
  var d=Object.getOwnPropertyDescriptor(proto,'value');
  if(d&&d.set)d.set.call(el,v);else el.value=v;
  var C=W.InputEvent||W.Event;
  el.dispatchEvent(new C('input',{bubbles:true,composed:true,inputType:itype||'insertText',data:typeof v==='string'?v:null}));
}
function editable(el){
  if(el.isContentEditable)return 'ce';
  if(el.tagName==='TEXTAREA')return 'text';
  if(el.tagName==='INPUT'&&/^(|text|search|email|url|tel|password|number)$/.test((el.getAttribute('type')||'').toLowerCase()))return 'text';
  return '';
}
function shownVal(el){
  if(el.tagName==='INPUT'&&el.type==='password')return '•••('+el.value.length+' chars)';
  if(el.tagName==='SELECT')return Array.prototype.filter.call(el.options,function(o){return o.selected;}).map(function(o){return txt(o.text);}).join(', ');
  return cut(el.isContentEditable?el.innerText:el.value,80);
}
function fillEl(el,v){
  var W=win(el),D=el.ownerDocument;
  if(el.tagName==='LABEL'&&el.control)el=el.control;
  var tag=el.tagName,type=(el.getAttribute('type')||'').toLowerCase(),rl=el.getAttribute('role');
  if(el.disabled)throw new Error(brief(el)+' is disabled');
  if(el.scrollIntoView)el.scrollIntoView({block:'center',inline:'nearest'});
  if((tag==='INPUT'&&(type==='checkbox'||type==='radio'))||rl==='checkbox'||rl==='switch'||rl==='radio'){
    var want=v===true||/^(true|1|on|yes|checked)$/i.test(String(v));
    var cur=tag==='INPUT'?el.checked:el.getAttribute('aria-checked')==='true';
    if(cur!==want)clickEl(el);
    cur=tag==='INPUT'?el.checked:el.getAttribute('aria-checked')==='true';
    return (cur===want?'set ':'FAILED to set ')+brief(el)+' → '+(cur?'checked':'unchecked');
  }
  if(tag==='INPUT'&&type==='file')throw new Error('this is a file input — use upload_file');
  if(tag==='SELECT'){
    var wants=Array.isArray(v)?v.map(String):[String(v)],opts=Array.prototype.slice.call(el.options),hit=[];
    wants.forEach(function(w){
      var lw=txt(w).toLowerCase();
      var o=opts.find(function(o){return o.value===w;})||opts.find(function(o){return txt(o.text).toLowerCase()===lw;})||opts.find(function(o){return txt(o.text).toLowerCase().indexOf(lw)>=0;});
      if(!o)throw new Error('no option "'+w+'" in '+brief(el)+'; options: '+opts.slice(0,30).map(function(o){return txt(o.text);}).join(' | '));
      hit.push(o);
    });
    if(el.multiple)opts.forEach(function(o){o.selected=hit.indexOf(o)>=0;});else el.value=hit[0].value;
    el.dispatchEvent(new W.Event('input',{bubbles:true,composed:true}));el.dispatchEvent(new W.Event('change',{bubbles:true,composed:true}));
    return 'selected "'+shownVal(el)+'" in '+brief(el);
  }
  var sv=(typeof v==='object'&&v!==null)?JSON.stringify(v):String(v),ed=editable(el);
  try{el.focus({preventScroll:true});}catch(e){}
  if(ed==='ce'){
    var sel=W.getSelection(),rg=D.createRange();rg.selectNodeContents(el);sel.removeAllRanges();sel.addRange(rg);
    var ok=sv===''?(function(){try{return D.execCommand('delete');}catch(e){return false;}})():insert(el,sv);
    if(!ok||txt(el.innerText)!==txt(sv)){el.textContent=sv;el.dispatchEvent(new (W.InputEvent||W.Event)('input',{bubbles:true,composed:true,inputType:'insertText',data:sv}));}
    return 'filled '+brief(el)+' = "'+shownVal(el)+'"';
  }
  if(tag!=='INPUT'&&tag!=='TEXTAREA')throw new Error(brief(el)+' is not a form field; use click, type_text or press_key on custom widgets');
  var done=false;
  if(ed==='text'){
    try{el.select();}catch(e){}
    if(sv==='')try{done=D.execCommand('delete')||el.value==='';}catch(e){}
    else done=insert(el,sv);
    var capped=el.maxLength>0&&sv.length>el.maxLength;
    if(el.value!==sv&&!(done&&capped))done=false;
  }
  if(!done)setVal(el,sv);
  el.dispatchEvent(new W.Event('change',{bubbles:true,composed:true}));
  var note=(el.type!=='password'&&el.value!==sv)?' (the field now holds a different value than requested: the page reformatted or rejected it)':'';
  return 'filled '+brief(el)+' = "'+shownVal(el)+'"'+note;
}
S.fill=function(t,v,o){o=o||{};var el=S.el(t);act(o.dialog,o.promptText);var r=fillEl(el,v);if(o.submit)r+='; '+keyEl('Enter',el.tagName==='LABEL'&&el.control?el.control:el);return r;};
S.fillForm=function(fields,o){
  o=o||{};act(o.dialog,o.promptText);
  return fields.map(function(f){try{return fillEl(S.el(f.target),f.value);}catch(e){return 'ERROR '+f.target+': '+(e&&e.message||e);}});
};
var KC={Enter:13,Tab:9,Escape:27,Backspace:8,Delete:46,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Home:36,End:35,PageUp:33,PageDown:34,' ':32};
var ALIAS={esc:'Escape',escape:'Escape',enter:'Enter','return':'Enter',tab:'Tab',space:' ',spacebar:' ',backspace:'Backspace','delete':'Delete',del:'Delete',
           up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',arrowup:'ArrowUp',arrowdown:'ArrowDown',arrowleft:'ArrowLeft',arrowright:'ArrowRight',
           home:'Home',end:'End',pageup:'PageUp',pagedown:'PageDown'};
function tabbables(D){
  return Array.prototype.filter.call(D.querySelectorAll(FOCUSABLE),function(e){return e.tabIndex>=0&&!e.disabled&&e.type!=='hidden'&&e.getClientRects().length>0;});
}
function keyEl(combo,el){
  var W=win(el),D=el.ownerDocument,parts=String(combo).split('+'),key=parts.pop();
  if(key===''&&parts.length){key='+';parts.pop();}
  var mods={};parts.forEach(function(m){m=m.toLowerCase();
    if(m==='meta'||m==='cmd'||m==='command')mods.metaKey=true;else if(m==='ctrl'||m==='control')mods.ctrlKey=true;
    else if(m==='alt'||m==='option')mods.altKey=true;else if(m==='shift')mods.shiftKey=true;});
  key=ALIAS[key.toLowerCase()]||key;
  var printable=key.length===1||Array.from(key).length===1;
  var code=key===' '?'Space':/^[a-z]$/i.test(key)?'Key'+key.toUpperCase():/^\d$/.test(key)?'Digit'+key:key;
  var kc=KC[key]||(printable?key.toUpperCase().charCodeAt(0):0);
  var init={key:key,code:code,keyCode:kc,which:kc,bubbles:true,cancelable:true,composed:true,view:W};for(var m in mods)init[m]=true;
  var go=fire(el,'keydown',init,'KeyboardEvent'),plain=!mods.metaKey&&!mods.ctrlKey&&!mods.altKey,ed=editable(el),did='';
  if(go){
    if(printable&&plain&&key!==' '||(key===' '&&plain&&ed)){
      var pi={};for(var k in init)pi[k]=init[k];pi.keyCode=pi.which=pi.charCode=key.charCodeAt(0);
      if(fire(el,'keypress',pi,'KeyboardEvent')&&ed){
        if(!insert(el,key)&&ed==='text')setVal(el,el.value+key);
      }
    }else if(plain&&key==='Enter'){
      var tag=el.tagName,r=role(el);
      if(tag==='TEXTAREA'||ed==='ce'){if(!insert(el,'\n')&&tag==='TEXTAREA')setVal(el,el.value+'\n');}
      else if(tag==='INPUT'&&ed){
        var f=el.form;
        if(f){var sb=f.querySelector('button:not([type]),button[type=submit],input[type=submit],input[type=image]');
          if(sb&&!sb.disabled){clickEl(sb);did=' (submitted the form via its submit button)';}
          else if(!sb){if(f.requestSubmit)f.requestSubmit();else f.submit();did=' (submitted the form)';}}
      }else if(tag==='INPUT'&&(el.type==='checkbox'||el.type==='radio')){
        var cf=el.form,cb=cf&&cf.querySelector('button:not([type]),button[type=submit],input[type=submit],input[type=image]');
        if(cb&&!cb.disabled){clickEl(cb);did=' (submitted the form via its submit button)';}
      }else if(r==='button'||r==='link'||tag==='SUMMARY'||/^(checkbox|radio|menuitem|tab|option|switch)$/.test(r)){clickEl(el);did=' (activated it)';}
    }else if(plain&&key===' '&&!ed){
      if(/^(button|checkbox|radio|switch|tab|menuitem)$/.test(role(el))){clickEl(el);did=' (activated it)';}
    }else if(plain&&key==='Tab'){
      var tb=tabbables(D),i=tb.indexOf(el),nx=tb.length?tb[(i+(mods.shiftKey?-1:1)+tb.length)%tb.length]:null;
      if(nx){nx.focus();did=' (focus moved to '+brief(nx)+')';}
    }else if(plain&&(key==='Backspace'||key==='Delete')&&ed){
      try{D.execCommand(key==='Backspace'?'delete':'forwardDelete');}catch(e){}
    }else if(mods.metaKey&&key.toLowerCase()==='a'&&ed){
      if(ed==='text')try{el.select();}catch(e){}else{var rg=D.createRange();rg.selectNodeContents(el);var s=W.getSelection();s.removeAllRanges();s.addRange(rg);}
    }
  }
  fire(el,'keyup',init,'KeyboardEvent');
  return 'pressed '+combo+' on '+brief(el)+did+(go?'':' (the page handled the key itself)');
}
S.key=function(combo,t,o){
  o=o||{};var el=t?S.el(t):active();
  if(t)try{el.focus({preventScroll:true});}catch(e){}
  act(o.dialog,o.promptText);return keyEl(combo,el);
};
S.type=function(text,t,o){
  o=o||{};var el=t?S.el(t):active();
  if(el.tagName==='LABEL'&&el.control)el=el.control;
  if(t){if(el.scrollIntoView)el.scrollIntoView({block:'center',inline:'nearest'});try{el.focus({preventScroll:true});}catch(e){}}
  if(!editable(el))throw new Error((t?brief(el):'the focused element '+brief(el))+' is not editable; give a target, or click the field first');
  act(o.dialog,o.promptText);
  var chars=Array.from(String(text));
  for(var i=0;i<chars.length;i++){keyEl(chars[i]==='\n'?'Enter':chars[i],el);var a=active();if(a!==el&&editable(a))el=a;}
  return 'typed '+chars.length+' character(s) into '+brief(el)+'; value now "'+shownVal(el)+'"';
};

// ------------------------------------------------------------------ scrolling / reading
function scrollable(e){
  if(e.scrollHeight<=e.clientHeight+1&&e.scrollWidth<=e.clientWidth+1)return false;
  var o=win(e).getComputedStyle(e);return /(auto|scroll|overlay)/.test(o.overflowY+' '+o.overflowX);
}
function scrollerOf(el){for(var e=el;e&&e.nodeType===1;e=par(e))if(e!==document.documentElement&&e!==document.body&&scrollable(e))return e;return null;}
function mainScroller(){
  var d=document.scrollingElement||document.documentElement;
  if(d.scrollHeight>window.innerHeight+1)return null;
  var best=null,ba=0,all=document.querySelectorAll('*'),n=Math.min(all.length,30000);
  for(var i=0;i<n;i++){var e=all[i];if(e.clientHeight>120&&e.scrollHeight>e.clientHeight+1&&scrollable(e)){var a=e.clientWidth*e.clientHeight;if(a>ba){ba=a;best=e;}}}
  return best;
}
S.scroll=function(dir,amt,t){
  var el=t?S.el(t):null;amt=amt||600;
  if(dir==='to'){if(!el)throw new Error('direction "to" needs a target');el.scrollIntoView({block:'center',inline:'nearest'});return 'scrolled '+brief(el)+' into view; page y='+Math.round(window.scrollY);}
  var sc=el?scrollerOf(el):mainScroller(),T=sc||window,se=sc||document.scrollingElement||document.documentElement;
  if(dir==='down')T.scrollBy(0,amt);else if(dir==='up')T.scrollBy(0,-amt);else if(dir==='left')T.scrollBy(-amt,0);else if(dir==='right')T.scrollBy(amt,0);
  else if(dir==='top')T.scrollTo(0,0);else if(dir==='bottom')T.scrollTo(0,se.scrollHeight);
  else throw new Error('direction must be up|down|left|right|top|bottom|to');
  var y=Math.round(sc?sc.scrollTop:window.scrollY),vh=sc?sc.clientHeight:window.innerHeight;
  return 'scrolled '+(sc?'container '+brief(sc):'page')+': y='+y+' of '+se.scrollHeight+' (viewport '+vh+')'+(y+vh>=se.scrollHeight-2?' — at bottom':y<=0?' — at top':'');
};
S.text=function(t){var el=S.el(t);if(el.tagName==='INPUT'&&el.type==='password')return shownVal(el);return el.tagName==='INPUT'||el.tagName==='TEXTAREA'?el.value:(el.innerText!==undefined?el.innerText:el.textContent);};
S.rect=function(t){
  var el=S.el(t);el.scrollIntoView({block:'center',inline:'nearest'});var r=el.getBoundingClientRect();
  return {x:r.left,y:r.top,w:r.width,h:r.height,iw:window.innerWidth,ih:window.innerHeight,ow:window.outerWidth,oh:window.outerHeight};
};
S.check=function(c){
  if(c.selector){var e=null;try{e=deepQuery(c.selector);}catch(x){throw new Error('invalid CSS selector: '+c.selector);}
    var vis=!!e&&e.getClientRects().length>0;if(c.gone?vis:!vis)return false;}
  if(c.text){var has=false,want=String(c.text).toLowerCase(),rs=roots();
    for(var i=0;i<rs.length&&!has;i++){var b=rs[i].body||rs[i];var s=(b.innerText!==undefined?b.innerText:b.textContent)||'';has=s.toLowerCase().indexOf(want)>=0;}
    if(c.gone?has:!has)return false;}
  return true;
};

// ------------------------------------------------------------------ files
S.fileBegin=function(id){S.files[id]=[];return true;};
S.fileChunk=function(id,b64){var bin=atob(b64),n=bin.length,a=new Uint8Array(n);for(var i=0;i<n;i++)a[i]=bin.charCodeAt(i);S.files[id].push(a);return n;};
S.fileDrop=function(ids){ids.forEach(function(id){delete S.files[id];});return true;};
S.attach=function(t,specs,method,o){
  o=o||{};var el=null,inp=null;
  if(method==='drop'&&!t)throw new Error('method="drop" needs target: the dropzone element');
  if(t){el=S.el(t);if(el.tagName==='LABEL'&&el.control)el=el.control;
    if(el.tagName==='INPUT'&&el.type==='file')inp=el;else if(method!=='drop'&&method!=='paste'&&el.querySelector)inp=el.querySelector('input[type=file]');}
  else if(method==='paste')el=active();
  else{var rs=roots();for(var i=0;i<rs.length&&!inp;i++)inp=rs[i].querySelector('input[type=file]');
    if(!inp)throw new Error('no <input type=file> on this page; pass the dropzone as target with method="drop"');}
  if(method==='input'&&!inp)throw new Error('target is not (and does not contain) a file input; try method="drop"');
  var use=method==='auto'?(inp?'input':'drop'):method,tgt=use==='input'?inp:el,W=win(tgt);
  var files=specs.map(function(s){return new W.File(S.files[s.id]||[],s.name,{type:s.mime,lastModified:s.mtime});});
  specs.forEach(function(s){delete S.files[s.id];});
  var dt=new W.DataTransfer();files.forEach(function(f){dt.items.add(f);});
  var list=files.map(function(f){return f.name+' ('+f.size+' B)';}).join(', ');
  act(o.dialog,o.promptText);
  if(use==='input'){
    if(files.length>1&&!inp.multiple)throw new Error('this file input accepts one file only; '+files.length+' given');
    inp.files=dt.files;
    // check before notifying the page: many uploaders (GitHub's among them) read the files in their change handler and then clear the input
    if(inp.files.length!==files.length)throw new Error('Safari did not keep the files on the input');
    inp.dispatchEvent(new W.Event('input',{bubbles:true,composed:true}));inp.dispatchEvent(new W.Event('change',{bubbles:true,composed:true}));
    return 'attached '+files.length+' file(s) to '+brief(inp)+': '+list+(inp.files.length?'':' (the page took them and cleared the input, as uploaders that start at once do)');
  }
  if(use==='paste'){
    var pe=new W.Event('paste',{bubbles:true,cancelable:true,composed:true});Object.defineProperty(pe,'clipboardData',{value:dt});
    var pd=!tgt.dispatchEvent(pe);
    return 'pasted '+files.length+' file(s) into '+brief(tgt)+': '+list+(pd?' — the page handled the paste':' — WARNING: no handler took the paste event');
  }
  tgt.scrollIntoView({block:'center',inline:'nearest'});
  var r=tgt.getBoundingClientRect(),took=false;
  ['dragenter','dragover','drop'].forEach(function(type){
    var i={bubbles:true,cancelable:true,composed:true,view:W,clientX:r.left+r.width/2,clientY:r.top+r.height/2,dataTransfer:dt},ev;
    try{ev=new W.DragEvent(type,i);}catch(e){ev=new W.Event(type,i);}
    if(ev.dataTransfer!==dt)try{Object.defineProperty(ev,'dataTransfer',{value:dt});}catch(e){}
    if(!tgt.dispatchEvent(ev))took=true;
  });
  return 'dropped '+files.length+' file(s) on '+brief(tgt)+': '+list+(took?' — the page handled the drop':' — WARNING: no handler accepted the drop (wrong target element?)');
};

// ------------------------------------------------------------------ dialogs, console, network, settle
['alert','confirm','prompt'].forEach(function(k){
  var orig=window[k];
  window[k]=function(msg,def){
    if(Date.now()>S.actUntil)return orig.apply(window,arguments);
    var acc=S.dialogMode==='accept',res=k==='alert'?undefined:k==='confirm'?acc:(acc?(S.promptText!=null?S.promptText:(def==null?'':String(def))):null);
    S.dialogs.push({type:k,message:String(msg==null?'':msg).slice(0,500),action:k==='alert'?'closed':acc?'accepted':'dismissed'});
    return res;
  };
});
S.takeDialogs=function(){return S.dialogs.splice(0);};
function fmt(a){
  if(typeof a==='string')return a;
  if(a instanceof Error)return a.stack||String(a);
  try{var s=JSON.stringify(a);return s===undefined?String(a):s;}catch(e){return String(a);}
}
function log(level,text){S.logs.push({t:Date.now(),level:level,text:String(text).slice(0,2000)});if(S.logs.length>500)S.logs.shift();}
['log','info','warn','error','debug'].forEach(function(k){
  var o=console[k];if(typeof o!=='function')return;
  console[k]=function(){try{log(k,Array.prototype.map.call(arguments,fmt).join(' '));}catch(e){}return o.apply(console,arguments);};
});
window.addEventListener('error',function(e){
  if(e.target&&e.target!==window&&(e.target.src||e.target.href))log('error','Failed to load '+(e.target.tagName||'').toLowerCase()+' '+(e.target.src||e.target.href));
  else log('error','Uncaught '+(e.message||'error')+(e.filename?' @ '+e.filename+':'+e.lineno:''));
},true);
window.addEventListener('unhandledrejection',function(e){log('error','Unhandled rejection: '+fmt(e.reason));});
S.console=function(level,clear){
  var out=S.logs.filter(function(l){return !level||l.level===level;});
  if(clear)S.logs=[];return out;
};
S.netOpts={bodies:false};S.mocks=[];S.delay=0;S.mid=0;
function hdrs(h){var o={};if(!h)return o;try{
  if(typeof h.forEach==='function'&&!Array.isArray(h))h.forEach(function(v,k){o[k]=v;});
  else if(Array.isArray(h))h.forEach(function(p){o[p[0]]=p[1];});
  else for(var k in h)o[k]=h[k];}catch(e){}return o;}
function matchMock(url,method){
  for(var i=0;i<S.mocks.length;i++){var m=S.mocks[i];if(m.method&&m.method!==method)continue;
    try{if(m.regex?new RegExp(m.pattern).test(url):url.indexOf(m.pattern)>=0){m.hits++;return m;}}catch(e){}}
  return null;}
function rec(type,method,url){
  var id=++S.rid,r={id:id,type:type,method:String(method||'GET').toUpperCase(),url:String(url),status:null,ms:null};
  S.inflight.set(id,Date.now());S.net.push(r);if(S.net.length>400)S.net.shift();
  var t0=performance.now();
  return {r:r,done:function(status,err){S.inflight.delete(id);r.status=status;r.ms=Math.round(performance.now()-t0);if(err)r.error=String(err).slice(0,200);}};
}
if(window.fetch){
  var of=window.fetch;
  window.fetch=function(input,init){
    var self=this,args=arguments,h=null;
    try{
      h=rec('fetch',(init&&init.method)||(input&&input.method)||'GET',new URL((input&&input.url)||input,location.href).href);
      if(S.netOpts.bodies){h.r.reqHeaders=hdrs((init&&init.headers)||(input&&input.headers));if(init&&typeof init.body==='string')h.r.reqBody=init.body.slice(0,20000);}
    }catch(e){}
    var m=h&&matchMock(h.r.url,h.r.method);
    function go(){
      if(m){h.r.mocked=true;try{return Promise.resolve(new Response(/^(101|204|205|304)$/.test(String(m.status))?null:m.body,{status:m.status,headers:m.headers}));}catch(e){return Promise.reject(e);}}
      return of.apply(self,args);
    }
    var wait=(S.delay||0)+((m&&m.delay)||0);
    var p=wait?new Promise(function(res){setTimeout(res,wait);}).then(go):go();
    if(h)p.then(function(r){
      try{if(S.netOpts.bodies){h.r.resHeaders=hdrs(r.headers);r.clone().text().then(function(t){h.r.resBody=t.slice(0,100000);},function(){});}}catch(e){}
      h.done(r.status);
    },function(e){h.done(0,e);});
    return p;
  };
}
if(window.XMLHttpRequest){
  var XP=XMLHttpRequest.prototype,xo=XP.open,xs=XP.send,xh=XP.setRequestHeader;
  XP.open=function(m,u){this.__smq={m:m,u:u,h:{},sync:arguments[2]===false};return xo.apply(this,arguments);};
  XP.setRequestHeader=function(k,v){try{if(this.__smq)this.__smq.h[k]=v;}catch(e){}return xh.apply(this,arguments);};
  XP.send=function(body){
    var x=this,q=x.__smq||{m:'GET',u:'',h:{}},args=arguments,h=null;
    try{h=rec('xhr',q.m,new URL(q.u,location.href).href);
      if(S.netOpts.bodies){h.r.reqHeaders=q.h;if(typeof body==='string')h.r.reqBody=body.slice(0,20000);}
      x.addEventListener('loadend',function(){
        try{if(S.netOpts.bodies){h.r.resHeaders=x.getAllResponseHeaders();if(!x.responseType||x.responseType==='text')h.r.resBody=String(x.responseText).slice(0,100000);}}catch(e){}
        h.done(x.status);});
    }catch(e){}
    var m=h&&matchMock(h.r.url,h.r.method);
    function go(){
      if(!m)return xs.apply(x,args);
      h.r.mocked=true;
      var resp=m.body;if(x.responseType==='json')try{resp=JSON.parse(m.body);}catch(e){resp=null;}
      var vals={readyState:4,status:m.status,statusText:'',responseText:m.body,response:resp,responseURL:h.r.url};
      Object.keys(vals).forEach(function(k){try{Object.defineProperty(x,k,{configurable:true,get:function(){return vals[k];}});}catch(e){}});
      x.getAllResponseHeaders=function(){return Object.keys(m.headers).map(function(k){return k+': '+m.headers[k];}).join('\r\n');};
      x.getResponseHeader=function(k){for(var n in m.headers)if(n.toLowerCase()===String(k).toLowerCase())return m.headers[n];return null;};
      ['readystatechange','load','loadend'].forEach(function(t){x.dispatchEvent(new ProgressEvent(t));});
    }
    var wait=(S.delay||0)+((m&&m.delay)||0);
    if(q.sync)return go();
    if(m||wait){setTimeout(go,wait||0);return;}
    return go();
  };
}
S.network=function(filter,limit){
  filter=String(filter||'').toLowerCase();var seen={},out=[];
  S.net.forEach(function(r){seen[r.url]=1;out.push({id:r.id,type:r.type,method:r.method,url:r.url,status:r.status,ms:r.ms,error:r.error,mocked:r.mocked,detail:!!(r.resHeaders||r.reqHeaders),ws:r.type==='websocket'?'sent '+r.sent+' / received '+r.received+(r.closed?' closed '+r.closed:''):undefined});});
  try{performance.getEntriesByType('resource').forEach(function(e){
    if(seen[e.name])return;
    out.push({type:e.initiatorType||'resource',method:'',url:e.name,status:e.responseStatus||null,ms:Math.round(e.duration),size:e.transferSize||null});
  });}catch(e){}
  if(filter)out=out.filter(function(r){return (r.url+' '+r.type+' '+r.method+' '+r.status).toLowerCase().indexOf(filter)>=0;});
  return {total:out.length,items:out.slice(-(limit||50)),bodies:S.netOpts.bodies};
};
S.netDetail=function(id){for(var i=0;i<S.net.length;i++)if(S.net[i].id===id)return S.net[i];throw new Error('no recorded fetch/XHR with id '+id+' (ids are shown by network_requests)');};
S.netConfig=function(o){if(o.bodies!=null)S.netOpts.bodies=!!o.bodies;if(o.clear){S.net=[];try{performance.clearResourceTimings();}catch(e){}}if(o.delay!=null)S.delay=Math.max(0,+o.delay||0);
  return 'capture: fetch/XHR always recorded; headers+bodies '+(S.netOpts.bodies?'ON':'off')+'; added latency '+S.delay+' ms; '+S.net.length+' recorded; '+S.mocks.length+' mock(s)';};
S.mock=function(o){var m={id:++S.mid,pattern:String(o.pattern),regex:!!o.regex,method:o.method?String(o.method).toUpperCase():'',status:o.status||200,body:o.body==null?'':String(o.body),headers:o.headers||{'Content-Type':o.contentType||'application/json'},delay:o.delay||0,hits:0};
  if(m.regex)new RegExp(m.pattern);S.mocks.push(m);return 'mock #'+m.id+' installed for '+(m.method||'any method')+' '+(m.regex?'/'+m.pattern+'/':'URLs containing "'+m.pattern+'"')+' → '+m.status+' ('+m.body.length+' chars). Applies to fetch/XHR on this document until it navigates.';};
S.mocksClear=function(){var n=S.mocks.length,l=S.mocks.map(function(m){return '#'+m.id+' "'+m.pattern+'" hits='+m.hits;});S.mocks=[];return 'removed '+n+' mock(s)'+(n?': '+l.join('; '):'');};
try{new MutationObserver(function(){S.lastMut=Date.now();}).observe(document,{subtree:true,childList:true,attributes:true,characterData:true});}catch(e){}
S.leaving=0;
window.addEventListener('beforeunload',function(){S.leaving=Date.now();});
window.addEventListener('pagehide',function(){S.leaving=Date.now();});
S.st=function(){
  var now=Date.now(),p=0;S.inflight.forEach(function(t0){if(now-t0<4000)p++;});
  return {p:p,q:now-S.lastMut,d:S.dialogs.length,l:(S.leaving&&now-S.leaving<6000)?1:0};
};

// ------------------------------------------------------------------ async jobs (run_js with await)
S.job=function(id,fn){
  var j=S.jobs[id]={done:false};
  try{Promise.resolve(fn()).then(function(v){j.done=true;j.value=v;},function(e){j.done=true;j.error=String(e&&e.stack||e);});}
  catch(e){j.done=true;j.error=String(e&&e.stack||e);}
  return true;
};
S.jobGet=function(id){var j=S.jobs[id];if(!j)return {done:true,error:'job lost (the page navigated)'};if(j.done)delete S.jobs[id];return j;};
S.str=function(r){return r===undefined?'undefined':(typeof r==='object'&&r!==null)?(function(){try{return JSON.stringify(r);}catch(e){return String(r);}})():String(r);};

// ------------------------------------------------------------------ inspection
function gdesc(el){var k=kind(el,null,true);if(k)return desc(el,k);var n=cut(name(el),80);return '['+ref(el)+'] '+el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(n?' "'+n+'"':'');}
function topXY(el,x,y){var w=win(el);while(w!==window&&w.frameElement){var fr=w.frameElement.getBoundingClientRect();x+=fr.left+w.frameElement.clientLeft;y+=fr.top+w.frameElement.clientTop;w=w.parent;}return [x,y];}
S.getElement=function(t,styles){
  var el=S.el(t),W=win(el),cs=W.getComputedStyle(el),r=el.getBoundingClientRect(),attrs={};
  for(var i=0;i<el.attributes.length&&i<40;i++){var a=el.attributes[i];attrs[a.name]=(a.name==='value'&&el.type==='password')?'•••':String(a.value).slice(0,300);}
  var cx=r.left+r.width/2,cy=r.top+r.height/2,root=el.getRootNode?el.getRootNode():el.ownerDocument,top=(r.width>0&&root.elementFromPoint)?root.elementFromPoint(cx,cy):null;
  var st={};(styles&&styles.length?styles:['display','visibility','opacity','position','z-index','color','background-color','font-size','font-weight','cursor','pointer-events','overflow']).forEach(function(p){st[p]=cs.getPropertyValue(p);});
  var html=el.outerHTML||'';if(el.type==='password')html='(omitted for password field)';
  return {ref:ref(el),tag:el.tagName.toLowerCase(),role:role(el),name:cut(name(el),200),attributes:attrs,
    text:el.type==='password'?'':cut(el.innerText!==undefined?el.innerText:el.textContent,500),value:('value' in el)?shownVal(el):undefined,
    rect:{x:Math.round(r.left),y:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height)},
    visible:r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none',inViewport:r.bottom>0&&r.top<W.innerHeight&&r.right>0&&r.left<W.innerWidth,
    enabled:!(el.disabled||el.getAttribute('aria-disabled')==='true'),checked:el.checked,focused:active()===el,
    coveredBy:(top&&top!==el&&!el.contains(top)&&!top.contains(el))?brief(top):null,
    inFrame:W!==window,inShadow:!!(root&&root.nodeType===11),childCount:el.children?el.children.length:0,styles:st,html:html.length>1500?html.slice(0,1500)+'…':html};
};
S.queryAll=function(sel,limit){
  var rs=roots(),out=[],total=0;limit=limit||50;
  for(var i=0;i<rs.length;i++){var l;try{l=rs[i].querySelectorAll(sel);}catch(e){throw new Error('invalid CSS selector: '+sel);}
    for(var j=0;j<l.length;j++){total++;if(out.length<limit){var e=l[j],r=e.getBoundingClientRect();out.push(gdesc(e)+((r.width>0&&r.height>0)?'':' (not visible)'));}}}
  return {total:total,lines:out};
};
S.computed=function(t,props){
  var el=S.el(t),cs=win(el).getComputedStyle(el),o={};
  if(props&&props.length)props.forEach(function(p){o[p]=cs.getPropertyValue(p);});
  else for(var i=0;i<cs.length;i++){var v=cs.getPropertyValue(cs[i]);if(v&&v!=='none'&&v!=='normal'&&v!=='auto'&&v!=='0px')o[cs[i]]=v;}
  return {element:brief(el),styles:o};
};
S.forms=function(){
  var out=[],rs=roots();
  rs.forEach(function(rt){Array.prototype.forEach.call(rt.querySelectorAll('form'),function(f){
    var fields=[];Array.prototype.forEach.call(f.elements,function(e){if(e.type==='hidden'||e.tagName==='FIELDSET'||e.tagName==='OBJECT')return;var k=kind(e,null,true)||e.tagName.toLowerCase();fields.push(desc(e,k)+(e.name?' name='+e.name:''));});
    var hid=f.querySelectorAll('input[type=hidden]').length;
    out.push({form:'['+ref(f)+'] form'+(f.id?'#'+f.id:'')+(f.getAttribute('name')?' name='+f.getAttribute('name'):'')+' '+(f.method||'get').toUpperCase()+' → '+(f.getAttribute('action')||'(same URL)')+(hid?' ('+hid+' hidden fields)':''),fields:fields});
  });});
  var loose=0;rs.forEach(function(rt){Array.prototype.forEach.call(rt.querySelectorAll('input:not([type=hidden]),select,textarea'),function(e){if(!e.form)loose++;});});
  return {forms:out,fieldsOutsideForms:loose};
};
S.verify=function(exp){
  return exp.map(function(x){
    try{var el=S.el(x.target);if(el.tagName==='LABEL'&&el.control)el=el.control;
      var isBox=(el.tagName==='INPUT'&&(el.type==='checkbox'||el.type==='radio'))||/^(checkbox|switch|radio)$/.test(el.getAttribute('role')||'');
      var actual=isBox?String(el.tagName==='INPUT'?el.checked:el.getAttribute('aria-checked')==='true'):el.tagName==='SELECT'?shownVal(el):el.isContentEditable?txt(el.innerText):el.value!==undefined?String(el.value):txt(el.innerText);
      var want=isBox?String(x.value===true||/^(true|1|on|yes|checked)$/i.test(String(x.value))):String(x.value);
      var ok=actual===want||(el.tagName==='SELECT'&&el.value===want)||txt(actual)===txt(want);
      return (ok?'OK   ':'DIFF ')+brief(el)+(ok?'':' expected "'+cut(want,80)+'" but '+(el.type==='password'?'the password field differs':'found "'+cut(actual,80)+'"'));
    }catch(e){return 'ERR  '+x.target+': '+(e&&e.message||e);}
  });
};

// ------------------------------------------------------------------ drag and drop
S.drag=function(src,dst,o){
  o=o||{};var a=S.el(src),W=win(a);a.scrollIntoView({block:'center',inline:'nearest'});
  var ra=a.getBoundingClientRect(),x0=ra.left+ra.width/2,y0=ra.top+ra.height/2,b=null,x1,y1;
  if(dst){b=S.el(dst);var rb=b.getBoundingClientRect();if(rb.bottom<0||rb.top>W.innerHeight){b.scrollIntoView({block:'center',inline:'nearest'});ra=a.getBoundingClientRect();x0=ra.left+ra.width/2;y0=ra.top+ra.height/2;rb=b.getBoundingClientRect();}
    x1=rb.left+rb.width/2;y1=rb.top+rb.height/2;}
  else{x1=x0+(o.dx||0);y1=y0+(o.dy||0);}
  act(o.dialog);
  function at(x,y){var e=a.ownerDocument.elementFromPoint(x,y);return e||b||a;}
  function M(el,type,C,x,y,extra){var i={bubbles:true,cancelable:true,composed:true,view:W,clientX:x,clientY:y,screenX:x+(W.screenX||0),screenY:y+(W.screenY||0),button:0,buttons:1,pointerId:1,pointerType:'mouse',isPrimary:true};
    if(extra)for(var k in extra)i[k]=extra[k];var Ct=W[C]||W.Event,ev;try{ev=new Ct(type,i);}catch(e){ev=new W.Event(type,i);}
    if(i.dataTransfer&&ev.dataTransfer!==i.dataTransfer)try{Object.defineProperty(ev,'dataTransfer',{value:i.dataTransfer});}catch(e){}
    return el.dispatchEvent(ev);}
  M(a,'pointerover','PointerEvent',x0,y0,{buttons:0});M(a,'pointermove','PointerEvent',x0,y0,{buttons:0});M(a,'mousemove','MouseEvent',x0,y0,{buttons:0});
  M(a,'pointerdown','PointerEvent',x0,y0);M(a,'mousedown','MouseEvent',x0,y0);
  var dt=new W.DataTransfer(),html5=!!(a.closest&&a.closest('[draggable=true]'))||a.tagName==='IMG'||a.tagName==='A',started=false,dropped=false,steps=o.steps||8;
  if(html5){var da=a.closest('[draggable=true]')||a;started=M(da,'dragstart','DragEvent',x0,y0,{dataTransfer:dt});}
  var last=a;
  for(var s=1;s<=steps;s++){
    var x=x0+(x1-x0)*s/steps,y=y0+(y1-y0)*s/steps,over=(s===steps&&b)?b:at(x,y);
    M(over,'pointermove','PointerEvent',x,y);M(over,'mousemove','MouseEvent',x,y);
    if(html5&&started){M(a,'drag','DragEvent',x,y,{dataTransfer:dt});if(over!==last){M(over,'dragenter','DragEvent',x,y,{dataTransfer:dt});if(last!==a)M(last,'dragleave','DragEvent',x,y,{dataTransfer:dt});}
      if(!M(over,'dragover','DragEvent',x,y,{dataTransfer:dt})&&s===steps)dropped=true;}
    last=over;
  }
  if(html5&&started){if(dropped)M(last,'drop','DragEvent',x1,y1,{dataTransfer:dt});M(a,'dragend','DragEvent',x1,y1,{dataTransfer:dt});}
  M(last,'pointerup','PointerEvent',x1,y1,{buttons:0});M(last,'mouseup','MouseEvent',x1,y1,{buttons:0});
  return 'dragged '+brief(a)+' to '+(b?brief(b):'('+Math.round(x1)+','+Math.round(y1)+')')+' using '+(html5&&started?'HTML5 drag events'+(dropped?' (the target accepted the drop)':' (WARNING: the target did not accept dragover, so no drop fired)'):'pointer/mouse events (for libraries that track the mouse)')+'. Check the page to confirm the result; if nothing moved, use native_drag.';
};

// ------------------------------------------------------------------ framework widgets
function fiber(el){for(var k in el)if(k.indexOf('__reactFiber$')===0||k.indexOf('__reactInternalInstance$')===0)return el[k];return null;}
function rsProps(t){
  var el=S.el(t),f=null;for(var e=el;e&&!f;e=e.parentElement)f=fiber(e);
  if(!f)throw new Error(brief(el)+' is not inside a React tree');
  for(var n=0;f&&n<80;f=f.return,n++){var p=f.memoizedProps;if(p&&Array.isArray(p.options)&&typeof p.onChange==='function')return {p:p,el:el};}
  throw new Error('no react-select (options + onChange props) found around '+brief(el));
}
function rsFlat(opts){var out=[];opts.forEach(function(o){if(o&&Array.isArray(o.options))out=out.concat(o.options);else out.push(o);});return out;}
function rsLabel(p,o){try{if(p.getOptionLabel)return String(p.getOptionLabel(o));}catch(e){}return String(o&&o.label!=null?o.label:o&&o.name!=null?o.name:o);}
function rsValue(p,o){try{if(p.getOptionValue)return String(p.getOptionValue(o));}catch(e){}return String(o&&o.value!=null?o.value:o&&o.id!=null?o.id:o);}
S.rsList=function(t){var r=rsProps(t),p=r.p,cur=p.value==null?[]:[].concat(p.value);
  return {multi:!!p.isMulti,current:cur.map(function(o){return rsLabel(p,o);}),options:rsFlat(p.options).slice(0,300).map(function(o){return {label:rsLabel(p,o),value:rsValue(p,o),disabled:!!(o&&o.isDisabled)};}),total:rsFlat(p.options).length};};
S.rsSet=function(t,vals){
  var r=rsProps(t),p=r.p,all=rsFlat(p.options),want=[].concat(vals).map(String),picked=want.map(function(w){
    var lw=w.toLowerCase(),o=all.find(function(o){return rsValue(p,o)===w;})||all.find(function(o){return rsLabel(p,o).toLowerCase()===lw;})||all.find(function(o){return rsLabel(p,o).toLowerCase().indexOf(lw)>=0;});
    if(!o)throw new Error('no option "'+w+'"; options: '+all.slice(0,40).map(function(o){return rsLabel(p,o);}).join(' | '));return o;});
  act();
  if(p.isMulti)p.onChange(picked,{action:'select-option',option:picked[picked.length-1],name:p.name});
  else p.onChange(picked[0],{action:'select-option',option:picked[0],name:p.name});
  return 'react-select set to "'+picked.map(function(o){return rsLabel(p,o);}).join(', ')+'" via its onChange prop';
};
S.setEditor=function(t,text){
  var el=S.el(t),W=win(el),host;text=String(text);act();
  try{if(W.monaco&&W.monaco.editor){var eds=W.monaco.editor.getEditors?W.monaco.editor.getEditors():[];
    for(var i=0;i<eds.length;i++){var dn=eds[i].getDomNode&&eds[i].getDomNode();if(dn&&(dn.contains(el)||el.contains(dn))){eds[i].setValue(text);return 'Monaco editor content replaced ('+text.length+' chars)';}}
    var mh=el.closest('.monaco-editor');if(mh&&W.monaco.editor.getModels().length===1){W.monaco.editor.getModels()[0].setValue(text);return 'Monaco model content replaced ('+text.length+' chars)';}}}catch(e){}
  host=el.closest('.CodeMirror')||(el.querySelector&&el.querySelector('.CodeMirror'));
  if(host&&host.CodeMirror){host.CodeMirror.setValue(text);return 'CodeMirror 5 content replaced ('+text.length+' chars)';}
  host=el.closest('.cm-editor')||(el.querySelector&&el.querySelector('.cm-editor'));
  if(host){var c=host.querySelector('.cm-content'),v=c&&c.cmView&&(c.cmView.view||(c.cmView.rootView&&c.cmView.rootView.view));
    if(v&&v.dispatch){v.dispatch({changes:{from:0,to:v.state.doc.length,insert:text}});return 'CodeMirror 6 content replaced ('+text.length+' chars)';}}
  host=el.closest('.ace_editor')||(el.querySelector&&el.querySelector('.ace_editor'));
  if(host){var ae=(host.env&&host.env.editor)||(W.ace&&W.ace.edit(host));if(ae){ae.setValue(text,-1);return 'Ace editor content replaced ('+text.length+' chars)';}}
  host=el.closest('.ql-container')||(el.querySelector&&el.querySelector('.ql-container'));
  if(host&&host.__quill){host.__quill.setText(text,'user');return 'Quill editor content replaced ('+text.length+' chars)';}
  var ce=el.isContentEditable?el:(el.querySelector&&el.querySelector('[contenteditable=""],[contenteditable=true],[contenteditable="plaintext-only"]'));
  if(ce){while(ce.parentElement&&ce.parentElement.isContentEditable)ce=ce.parentElement;
    var kindE=ce.classList.contains('ProseMirror')?'ProseMirror':ce.hasAttribute('data-slate-editor')?'Slate':ce.hasAttribute('data-lexical-editor')?'Lexical':ce.closest('.DraftEditor-root')?'Draft.js':'contenteditable';
    return kindE+': '+fillEl(ce,text)+' (through the insertText input pipeline)';}
  var ta=el.tagName==='TEXTAREA'?el:(el.querySelector&&el.querySelector('textarea'));
  if(ta)return 'textarea: '+fillEl(ta,text);
  throw new Error('no known editor (Monaco, CodeMirror, Ace, Quill, ProseMirror, Slate, Lexical, Draft.js, contenteditable, textarea) at '+brief(el));
};

// ------------------------------------------------------------------ cookies and storage
function cookieList(){return document.cookie?document.cookie.split('; ').map(function(c){var i=c.indexOf('=');return {name:i<0?c:c.slice(0,i),value:i<0?'':c.slice(i+1)};}):[];}
function cookieDel(name){
  var hosts=[''],parts=location.hostname.split('.');for(var i=0;i<parts.length-1;i++){hosts.push(parts.slice(i).join('.'));hosts.push('.'+parts.slice(i).join('.'));}
  var paths=['/'],segs=location.pathname.split('/').filter(Boolean),acc='';segs.forEach(function(s){acc+='/'+s;paths.push(acc);paths.push(acc+'/');});
  hosts.forEach(function(h){paths.forEach(function(p){document.cookie=name+'=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path='+p+(h?'; domain='+h:'');});});
}
S.cookies=function(action,o){
  o=o||{};
  if(action==='get'){var l=cookieList();if(o.name)l=l.filter(function(c){return c.name===o.name;});return {cookies:l,note:'HttpOnly cookies are invisible to page scripts and are not listed'};}
  if(action==='set'){if(!o.name)throw new Error('name is required');
    var s=o.name+'='+(o.value==null?'':o.value)+'; path='+(o.path||'/');if(o.domain)s+='; domain='+o.domain;if(o.maxAge!=null)s+='; max-age='+o.maxAge;if(o.expires)s+='; expires='+new Date(o.expires).toUTCString();
    if(o.secure)s+='; secure';if(o.sameSite)s+='; samesite='+o.sameSite;document.cookie=s;
    var ok=cookieList().some(function(c){return c.name===o.name;});return ok?'cookie '+o.name+' set':'the browser did not keep cookie '+o.name+' (domain/secure/samesite mismatch?)';}
  if(action==='delete'){var names=o.name?[o.name]:cookieList().map(function(c){return c.name;});names.forEach(cookieDel);
    var left=cookieList().filter(function(c){return names.indexOf(c.name)>=0;}).map(function(c){return c.name;});
    return 'deleted '+(names.length-left.length)+' cookie(s)'+(left.length?'; could not delete: '+left.join(', ')+' (set with another path/domain)':'')+'. HttpOnly cookies cannot be deleted from script.';}
  throw new Error('action must be get | set | delete');
};
S.storage=function(kind,action,key,value){
  var st=kind==='session'?window.sessionStorage:kind==='local'?window.localStorage:null;if(!st)throw new Error('kind must be local | session');
  if(action==='get'){if(key!=null&&key!=='')return {key:key,value:st.getItem(key)};var o={};for(var i=0;i<st.length;i++){var k=st.key(i),v=st.getItem(k);o[k]=v.length>2000?v.slice(0,2000)+'…('+v.length+' chars)':v;}return {count:st.length,items:o};}
  if(action==='set'){st.setItem(key,String(value));return kind+'Storage['+key+'] set ('+String(value).length+' chars)';}
  if(action==='delete'){var had=st.getItem(key)!==null;st.removeItem(key);return had?kind+'Storage['+key+'] deleted':'no such key '+key;}
  if(action==='clear'){var n=st.length;st.clear();return kind+'Storage cleared ('+n+' keys)';}
  throw new Error('action must be get | set | delete | clear');
};
S.storageExport=function(){var d=function(st){var o={};for(var i=0;i<st.length;i++)o[st.key(i)]=st.getItem(st.key(i));return o;};
  return {origin:location.origin,url:location.href,exported:new Date().toISOString(),cookies:cookieList(),localStorage:d(localStorage),sessionStorage:d(sessionStorage)};};
S.storageImport=function(d,o){o=o||{};
  if(d.origin&&d.origin!==location.origin&&!o.force)throw new Error('this export is from '+d.origin+' but the tab is on '+location.origin+'; open that site first or pass force=True');
  var n=[0,0,0];(d.cookies||[]).forEach(function(c){document.cookie=c.name+'='+c.value+'; path=/';n[0]++;});
  Object.keys(d.localStorage||{}).forEach(function(k){localStorage.setItem(k,d.localStorage[k]);n[1]++;});
  Object.keys(d.sessionStorage||{}).forEach(function(k){sessionStorage.setItem(k,d.sessionStorage[k]);n[2]++;});
  return 'imported '+n[0]+' cookie(s), '+n[1]+' localStorage and '+n[2]+' sessionStorage key(s) into '+location.origin+'; reload the page for the site to pick them up';};
S.idbList=function(){if(!indexedDB.databases)throw new Error('indexedDB.databases() is not available');
  return indexedDB.databases().then(function(dbs){return Promise.all(dbs.map(function(d){return new Promise(function(res){var rq=indexedDB.open(d.name);
    rq.onsuccess=function(){var db=rq.result,st=Array.prototype.slice.call(db.objectStoreNames);db.close();res({name:d.name,version:d.version,stores:st});};rq.onerror=function(){res({name:d.name,version:d.version,error:String(rq.error)});};});}));});};
S.idbGet=function(name,store,limit,key){return new Promise(function(res,rej){var rq=indexedDB.open(name),made=false;
  rq.onupgradeneeded=function(e){if(e.oldVersion===0){made=true;try{rq.transaction.abort();}catch(x){}}};
  rq.onerror=function(e){if(made){try{e.preventDefault();}catch(x){}rej(new Error('no IndexedDB database named "'+name+'" on this site'));}else rej(rq.error);};
  rq.onsuccess=function(){var db=rq.result;try{var os=db.transaction(store,'readonly').objectStore(store);
    if(key!=null&&key!==''){var g=os.get(key);g.onsuccess=function(){db.close();res({key:key,value:g.result});};g.onerror=function(){db.close();rej(g.error);};return;}
    var out=[],cn=os.count(),total=0;cn.onsuccess=function(){total=cn.result;};
    var c=os.openCursor();c.onsuccess=function(){var cur=c.result;if(cur&&out.length<(limit||20)){var v;try{v=JSON.parse(JSON.stringify(cur.value));}catch(e){v=String(cur.value);}out.push({key:cur.key,value:v});cur.continue();}else{db.close();res({store:store,keyPath:os.keyPath,total:total,records:out});}};
    c.onerror=function(){db.close();rej(c.error);};}catch(e){db.close();rej(e);}};});};

// ------------------------------------------------------------------ extraction and analysis
S.tables=function(t,maxRows){
  var list=t?[S.el(t)]:Array.prototype.slice.call(document.querySelectorAll('table')),out=[];maxRows=maxRows||50;
  list.forEach(function(tb){if(tb.tagName!=='TABLE'){var inner=tb.querySelector&&tb.querySelector('table');if(!inner)return;tb=inner;}
    var r=tb.getBoundingClientRect();if(!t&&!(r.width>0&&r.height>0))return;
    var rows=Array.prototype.map.call(tb.rows,function(tr){return Array.prototype.map.call(tr.cells,function(c){return cut(c.innerText,200);});});
    var cap=tb.caption?txt(tb.caption.innerText):'';out.push({ref:ref(tb),caption:cap,rowCount:rows.length,rows:rows.slice(0,maxRows)});});
  return out;};
S.meta=function(){
  var m={},g=function(s){var e=document.querySelector(s);return e?(e.getAttribute('content')||e.getAttribute('href')||''):undefined;};
  m.title=document.title;m.url=location.href;m.lang=document.documentElement.lang||undefined;m.description=g('meta[name=description]');m.canonical=g('link[rel=canonical]');m.robots=g('meta[name=robots]');m.author=g('meta[name=author]');
  var og={},tw={},cit={};Array.prototype.forEach.call(document.querySelectorAll('meta[property^="og:"],meta[name^="twitter:"],meta[name^="citation_"],meta[name^="dc."],meta[name^="DC."]'),function(e){
    var k=e.getAttribute('property')||e.getAttribute('name'),v=cut(e.getAttribute('content'),300);if(k.indexOf('og:')===0)og[k]=v;else if(k.indexOf('twitter:')===0)tw[k]=v;else{if(cit[k]===undefined)cit[k]=v;else cit[k]=[].concat(cit[k],v);}});
  if(Object.keys(og).length)m.openGraph=og;if(Object.keys(tw).length)m.twitter=tw;if(Object.keys(cit).length)m.citation=cit;
  var ld=[];Array.prototype.forEach.call(document.querySelectorAll('script[type="application/ld+json"]'),function(s){try{var j=JSON.parse(s.textContent);[].concat(j['@graph']||j).forEach(function(x){ld.push({type:x['@type'],name:x.name||x.headline,url:x.url});});}catch(e){}});
  if(ld.length)m.jsonLd=ld.slice(0,20);
  m.feeds=Array.prototype.map.call(document.querySelectorAll('link[type="application/rss+xml"],link[type="application/atom+xml"]'),function(l){return l.href;});if(!m.feeds.length)delete m.feeds;
  return m;};
S.images=function(limit,minSize){
  var out=[],all=document.images,total=0;minSize=minSize||0;
  for(var i=0;i<all.length;i++){var im=all[i];if(Math.max(im.naturalWidth,im.naturalHeight)<minSize)continue;total++;if(out.length<(limit||50))out.push({src:im.currentSrc||im.src,alt:im.alt||'',width:im.naturalWidth,height:im.naturalHeight,ref:ref(im)});}
  return {total:total,images:out};};
S.links=function(filter,limit){
  filter=String(filter||'').toLowerCase();var out=[],seen={},total=0;
  Array.prototype.forEach.call(document.links,function(a){var h=a.href;if(!h||/^javascript:/i.test(h))return;var tx=cut(name(a),100);if(filter&&(h+' '+tx).toLowerCase().indexOf(filter)<0)return;
    var k=h+'|'+tx;if(seen[k])return;seen[k]=1;total++;if(out.length<(limit||100))out.push({text:tx,href:h,external:a.origin!==location.origin||undefined,rel:a.rel||undefined});});
  return {total:total,links:out};};
function allFrames(){var out=[];walk(document.documentElement,function(el){if(typeof el.tagName!=='string')return false;if(el.tagName==='IFRAME'||el.tagName==='FRAME')out.push(el);return true;});return out;}
S.frames=function(){
  var out=allFrames().map(function(f,i){var d=frameDoc(f),r=f.getBoundingClientRect(),rt=f.getRootNode?f.getRootNode():document;
    return {frame:String(i),ref:ref(f),src:f.src||(f.getAttribute('srcdoc')?'(srcdoc)':''),title:f.title||f.name||f.id||'',size:Math.round(r.width)+'x'+Math.round(r.height),
      reachable:!!d,inShadow:rt.nodeType===11||undefined,url:d?d.location.href:undefined,textLength:d&&d.body?d.body.innerText.length:undefined};});
  return {main:{url:location.href,textLength:document.body?document.body.innerText.length:0},frames:out};};
S.frameWin=function(id){
  var f=allFrames()[+id];if(!f)throw new Error('no frame '+id+' (see list_frames)');
  if(!frameDoc(f))throw new Error('frame '+id+' is cross-origin: scripts in this tab cannot run inside it. snapshot shows its content with x-refs for click / fill / get_page_text.');
  return f.contentWindow;};
S.frameCheck=function(id){S.frameWin(id);return true;};
S.cssCoverage=function(){
  var sheets=[],used=0,unused=0,blocked=0,un=[];
  Array.prototype.forEach.call(document.styleSheets,function(sh){
    var rules;try{rules=sh.cssRules;}catch(e){blocked++;sheets.push({href:sh.href,error:'cross-origin stylesheet: rules not readable'});return;}
    var u=0,n=0;(function eat(rs){Array.prototype.forEach.call(rs||[],function(r){
      if(r.cssRules&&r.type!==1){eat(r.cssRules);return;}
      if(r.type!==1||!r.selectorText)return;
      var sel=r.selectorText.replace(/::?(before|after|first-line|first-letter|selection|placeholder|marker|backdrop|hover|focus(-visible|-within)?|active|visited|checked|disabled|target)\b(\([^)]*\))?/g,'');
      var hit=false;try{hit=!!document.querySelector(sel||'*');}catch(e){hit=true;}
      if(hit){u++;used++;}else{n++;unused++;if(un.length<40)un.push(cut(r.selectorText,80));}
      if(r.cssRules&&r.cssRules.length)eat(r.cssRules);});})(rules);
    sheets.push({href:sh.href||'(inline <style>)',usedRules:u,unusedRules:n});});
  return {usedRules:used,unusedRules:unused,unusedPercent:used+unused?Math.round(unused*100/(used+unused)):0,unreadableSheets:blocked,sheets:sheets,sampleUnusedSelectors:un,
          note:'static estimate for the current DOM state: a rule counts as used when its selector matches an element now'};};
S.analyze=function(){
  var c={},q=function(s){return document.querySelectorAll(s).length;},fw=[],W=window;
  var anyEl=document.querySelector('#root,#app,#__next,[data-reactroot],body > div');
  if(W.React||q('[data-reactroot]')||(anyEl&&fiber(anyEl))||Array.prototype.some.call(document.querySelectorAll('body *'),function(e,i){return i<300&&fiber(e);}))fw.push('React');
  if(W.__NEXT_DATA__||q('#__next'))fw.push('Next.js');if(W.__NUXT__)fw.push('Nuxt');
  if(W.Vue||q('[data-v-app]')||Array.prototype.some.call(document.querySelectorAll('body *'),function(e,i){return i<300&&(e.__vue__||e.__vue_app__);}))fw.push('Vue');
  if(q('[ng-version]'))fw.push('Angular '+document.querySelector('[ng-version]').getAttribute('ng-version'));
  if(q('[class*="svelte-"]'))fw.push('Svelte');if(W.jQuery)fw.push('jQuery '+(W.jQuery.fn&&W.jQuery.fn.jquery));if(W.Ember)fw.push('Ember');if(W.htmx)fw.push('htmx');if(W.Alpine)fw.push('Alpine');
  var shadow=0,cross=0,same=0;walk(document.documentElement,function(e){if(typeof e.tagName!=='string')return false;if(e.shadowRoot)shadow++;if(e.tagName==='IFRAME'){if(frameDoc(e))same++;else cross++;}return true;});
  var cap=[];if(q('iframe[src*="recaptcha"],.g-recaptcha'))cap.push('reCAPTCHA');if(q('iframe[src*="hcaptcha"],.h-captcha'))cap.push('hCaptcha');if(q('iframe[src*="challenges.cloudflare.com"],.cf-turnstile'))cap.push('Cloudflare Turnstile');
  var se=document.scrollingElement||document.documentElement,ms=mainScroller();
  return {title:document.title,url:location.href,lang:document.documentElement.lang||null,readyState:document.readyState,domNodes:q('*'),
    counts:{links:q('a[href]'),buttons:q('button,[role=button],input[type=submit],input[type=button]'),inputs:q('input:not([type=hidden]),select,textarea'),forms:q('form'),images:q('img'),tables:q('table'),fileInputs:q('input[type=file]'),
            sameOriginFrames:same,crossOriginFrames:cross,openShadowRoots:shadow,contentEditable:q('[contenteditable=""],[contenteditable=true]')},
    frameworks:fw,captcha:cap,loginForm:q('input[type=password]')>0,openDialogs:q('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]'),
    scroll:{pageHeight:se.scrollHeight,viewport:innerHeight,scrollsIn:ms?'inner container '+brief(ms):'the page itself'},
    headings:Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3'),0,20).map(function(h){return '#'.repeat(+h.tagName.charAt(1))+' '+cut(h.innerText,80);}).filter(function(s){return s.length>3;}),
    textLength:document.body?document.body.innerText.length:0};};
S.perf=function(){
  var o={url:location.href},nv=performance.getEntriesByType('navigation')[0];
  if(nv)o.navigation={type:nv.type,ttfbMs:Math.round(nv.responseStart),domInteractiveMs:Math.round(nv.domInteractive),domContentLoadedMs:Math.round(nv.domContentLoadedEventEnd),loadMs:Math.round(nv.loadEventEnd),transferBytes:nv.transferSize||null,redirects:nv.redirectCount};
  performance.getEntriesByType('paint').forEach(function(p){o[p.name==='first-contentful-paint'?'firstContentfulPaintMs':'firstPaintMs']=Math.round(p.startTime);});
  var res=performance.getEntriesByType('resource'),by={},bytes=0;res.forEach(function(r){var k=r.initiatorType||'other';by[k]=by[k]||{count:0,bytes:0};by[k].count++;by[k].bytes+=r.transferSize||0;bytes+=r.transferSize||0;});
  o.resources={count:res.length,transferBytes:bytes,byType:by,slowest:res.slice().sort(function(a,b){return b.duration-a.duration;}).slice(0,5).map(function(r){return {ms:Math.round(r.duration),url:cut(r.name,140)};})};
  o.domNodes=document.querySelectorAll('*').length;o.scripts=document.scripts.length;o.stylesheets=document.styleSheets.length;
  if(performance.memory)o.jsHeapMB=Math.round(performance.memory.usedJSHeapSize/1048576);
  return new Promise(function(done){var fin=function(){done(o);};
    try{var po=new PerformanceObserver(function(l){var e=l.getEntries();if(e.length)o.largestContentfulPaintMs=Math.round(e[e.length-1].startTime);});po.observe({type:'largest-contentful-paint',buffered:true});setTimeout(function(){try{po.disconnect();}catch(e){}fin();},150);}catch(e){fin();}});};

// ------------------------------------------------------------------ environment overrides
S.geo=function(lat,lon,acc){
  var g=navigator.geolocation;if(!S.geoOrig)S.geoOrig={get:g.getCurrentPosition,watch:g.watchPosition};
  if(lat==null){g.getCurrentPosition=S.geoOrig.get;g.watchPosition=S.geoOrig.watch;return 'geolocation override removed';}
  var mk=function(){return {coords:{latitude:+lat,longitude:+lon,accuracy:acc||20,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:Date.now()};};
  g.getCurrentPosition=function(ok){setTimeout(function(){ok(mk());},10);};g.watchPosition=function(ok){setTimeout(function(){ok(mk());},10);return 1;};
  return 'geolocation overridden to '+lat+', '+lon+' for scripts on this document (lost on navigation; it bypasses the permission prompt)';};
S.emulate=function(o){
  var nav=navigator,set=function(obj,k,v){try{Object.defineProperty(obj,k,{configurable:true,get:function(){return v;}});}catch(e){}};
  if(!o){['userAgent','platform','maxTouchPoints','vendor'].forEach(function(k){try{delete nav[k];}catch(e){}});try{delete window.ontouchstart;}catch(e){}window.dispatchEvent(new Event('resize'));return 'page-side emulation removed';}
  if(o.ua)set(nav,'userAgent',o.ua);if(o.platform)set(nav,'platform',o.platform);
  if(o.touch){set(nav,'maxTouchPoints',5);if(!('ontouchstart' in window))window.ontouchstart=null;}
  window.dispatchEvent(new Event('resize'));
  return {innerWidth:innerWidth,innerHeight:innerHeight,userAgent:nav.userAgent,maxTouchPoints:nav.maxTouchPoints};};
S.dims=function(){return {iw:innerWidth,ih:innerHeight,ow:outerWidth,oh:outerHeight,sx:screenX,sy:screenY,dpr:devicePixelRatio};};
S.viewportInfo=function(){
  var mv=document.querySelector('meta[name=viewport]'),se=document.scrollingElement||document.documentElement,wide=[];
  if(se.scrollWidth>innerWidth+1){var all=document.querySelectorAll('body *');for(var i=0;i<all.length&&i<8000&&wide.length<6;i++){var r=all[i].getBoundingClientRect();if(r.right>innerWidth+1&&r.width>0&&r.width<=se.scrollWidth)wide.push(brief(all[i])+' right='+Math.round(r.right));}}
  var vv=window.visualViewport;
  return {metaViewport:mv?mv.getAttribute('content'):null,innerWidth:innerWidth,innerHeight:innerHeight,devicePixelRatio:devicePixelRatio,clientWidth:document.documentElement.clientWidth,
    visualViewport:vv?{width:Math.round(vv.width),height:Math.round(vv.height),scale:vv.scale}:null,orientation:(screen.orientation&&screen.orientation.type)||null,
    horizontalOverflow:se.scrollWidth>innerWidth+1,scrollWidth:se.scrollWidth,elementsWiderThanViewport:wide,
    issues:[mv?null:'no <meta name=viewport>: iOS renders at 980px and scales down',mv&&/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(mv.getAttribute('content')||'')?'zoom is disabled or capped (accessibility issue)':null,
            se.scrollWidth>innerWidth+1?'content is wider than the viewport (horizontal scrolling)':null].filter(Boolean)};};
S.safeArea=function(){
  var d=document.createElement('div');d.style.cssText='position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.documentElement.appendChild(d);var cs=getComputedStyle(d),o={top:cs.paddingTop,right:cs.paddingRight,bottom:cs.paddingBottom,left:cs.paddingLeft};d.remove();
  var mv=document.querySelector('meta[name=viewport]'),cover=!!mv&&/viewport-fit\s*=\s*cover/.test(mv.getAttribute('content')||''),uses=0;
  Array.prototype.forEach.call(document.styleSheets,function(sh){try{Array.prototype.forEach.call(sh.cssRules,function(r){if(r.cssText&&r.cssText.indexOf('safe-area-inset')>=0)uses++;});}catch(e){}});
  return {insets:o,viewportFitCover:cover,cssRulesUsingSafeArea:uses,note:'insets are 0px on a Mac; this reports whether the page is prepared for notched iPhones (viewport-fit=cover plus env(safe-area-inset-*) rules)'};};
S.pwa=function(){
  var g=function(s,a){var e=document.querySelector(s);return e?e.getAttribute(a||'content'):null;},o={https:location.protocol==='https:',manifest:g('link[rel=manifest]','href'),
    appleTouchIcon:g('link[rel~="apple-touch-icon"]','href'),appleWebAppCapable:g('meta[name="apple-mobile-web-app-capable"]')||g('meta[name="mobile-web-app-capable"]'),
    appleStatusBarStyle:g('meta[name="apple-mobile-web-app-status-bar-style"]'),themeColor:g('meta[name="theme-color"]'),serviceWorkerSupported:'serviceWorker' in navigator};
  var jobs=[];
  if(o.serviceWorkerSupported)jobs.push(navigator.serviceWorker.getRegistrations().then(function(r){o.serviceWorkers=r.map(function(x){return x.scope;});},function(){}));
  if(o.manifest)jobs.push(fetch(new URL(o.manifest,location.href).href).then(function(r){return r.json();}).then(function(m){o.manifestData={name:m.name,short_name:m.short_name,display:m.display,start_url:m.start_url,theme_color:m.theme_color,icons:(m.icons||[]).map(function(i){return i.sizes;})};},function(e){o.manifestError=String(e);}));
  return Promise.all(jobs).then(function(){var is=[];if(!o.https)is.push('not served over HTTPS');if(!o.manifest)is.push('no web app manifest');if(!o.appleTouchIcon)is.push('no apple-touch-icon (iOS home-screen icon)');
    if(o.serviceWorkers&&!o.serviceWorkers.length)is.push('no service worker registered (no offline support)');o.issues=is;return o;});};
S.webkitCompat=function(){
  var f={},t=function(n,v){f[n]=!!v;},sup=function(p,v){try{return CSS.supports(p,v);}catch(e){return false;}},sel=function(s){try{return CSS.supports('selector('+s+')');}catch(e){return false;}};
  t('Notification',window.Notification);t('PushManager',window.PushManager);t('serviceWorker','serviceWorker' in navigator);t('SharedWorker',window.SharedWorker);t('BroadcastChannel',window.BroadcastChannel);
  t('requestIdleCallback',window.requestIdleCallback);t('navigator.share',navigator.share);t('navigator.clipboard',navigator.clipboard);t('WebUSB',navigator.usb);t('Web Bluetooth',navigator.bluetooth);t('Web Serial',navigator.serial);t('WebHID',navigator.hid);
  t('WebGPU',navigator.gpu);t('OffscreenCanvas',window.OffscreenCanvas);t('File System Access (showOpenFilePicker)',window.showOpenFilePicker);t('EyeDropper',window.EyeDropper);t('navigator.vibrate',navigator.vibrate);t('Battery API',navigator.getBattery);
  t('Network Information',navigator.connection);t('Document Picture-in-Picture',window.documentPictureInPicture);t('View Transitions',document.startViewTransition);t('Popover API',HTMLElement.prototype.hasOwnProperty('popover'));
  t('Navigation API',window.navigation);t('Intl.Segmenter',window.Intl&&Intl.Segmenter);t('Temporal',window.Temporal);t('structuredClone',window.structuredClone);t('CompressionStream',window.CompressionStream);t('WebCodecs VideoEncoder',window.VideoEncoder);
  t('CSS :has()',sel(':has(a)'));t('CSS container queries',sup('container-type','inline-size'));t('CSS anchor positioning',sup('anchor-name','--a'));t('CSS text-wrap: balance',sup('text-wrap','balance'));t('CSS scrollbar-gutter',sup('scrollbar-gutter','stable'));
  t('CSS nesting',sel('&'));t('CSS subgrid',sup('grid-template-columns','subgrid'));t('CSS @scope / scroll-timeline',sup('animation-timeline','scroll()'));t('CSS field-sizing',sup('field-sizing','content'));
  var miss=Object.keys(f).filter(function(k){return !f[k];});
  return {userAgent:navigator.userAgent,unsupportedHere:miss,supportedHere:Object.keys(f).filter(function(k){return f[k];}),note:'feature detection in this Safari; a page that depends on an unsupported feature needs a fallback'};};

// ------------------------------------------------------------------ support for native (OS-level) input
S.natHook=function(w){
  if(w.__smNat)return;w.__smNat=true;
  w.addEventListener('mousemove',function(e){if(e.isTrusted&&S.nat){var p=topXY(e.target,e.clientX,e.clientY);S.nat.off={dx:e.screenX-p[0],dy:e.screenY-p[1],cx:p[0],cy:p[1]};}},true);
  ['mousedown','mouseup','click','contextmenu','dblclick'].forEach(function(k){w.addEventListener(k,function(e){
    if(!e.isTrusted||!S.nat)return;var el=S.nat.el,h=S.nat.hit=S.nat.hit||{events:[]};h.events.push(k);h.target=brief(e.target);
    h.on=!el||e.target===el||el.contains(e.target)||e.target.contains(el);},true);});
  ['keydown','input','paste'].forEach(function(k){w.addEventListener(k,function(e){if(e.isTrusted&&S.nat){S.nat.keys=(S.nat.keys||0)+1;S.nat.keyTarget=brief(e.target);}},true);});
};
S.nativeArm=function(t,focus){
  var el=t?S.el(t):null;S.nat={el:el,off:null,hit:null,keys:0};S.natHook(window);
  roots().forEach(function(r){if(r.defaultView&&r.defaultView!==window)try{S.natHook(r.defaultView);}catch(e){}});
  if(!el)return {what:brief(active()),focused:document.hasFocus()};
  el.scrollIntoView({block:'center',inline:'nearest'});
  if(focus)try{el.focus({preventScroll:true});}catch(e){}
  var r=el.getBoundingClientRect(),p=topXY(el,r.left+r.width/2,r.top+r.height/2);
  return {cx:p[0],cy:p[1],x:window.screenX+(window.outerWidth-window.innerWidth)+p[0],y:window.screenY+(window.outerHeight-window.innerHeight)+p[1],
          w:r.width,h:r.height,iw:innerWidth,ih:innerHeight,what:brief(el),focused:document.hasFocus()};
};
S.natClear=function(){if(S.nat)S.nat.off=null;return true;};
S.nativeState=function(){var n=S.nat||{};return {off:n.off||null,hit:n.hit||null,keys:n.keys||0,keyTarget:n.keyTarget||null,active:brief(active()),value:editable(active())?shownVal(active()):undefined};};
S.focusEl=function(t){var el=S.el(t);if(el.tagName==='LABEL'&&el.control)el=el.control;el.scrollIntoView({block:'center',inline:'nearest'});el.focus({preventScroll:true});return brief(el);};
S.pointOf=function(t){var el=S.el(t),r=el.getBoundingClientRect(),p=topXY(el,r.left+r.width/2,r.top+r.height/2);return {cx:p[0],cy:p[1],iw:innerWidth,ih:innerHeight,what:brief(el)};};
S.axTag=function(t){
  var el=S.el(t);if(el.tagName==='LABEL'&&el.control)el=el.control;
  if(el.tagName==='INPUT'&&el.type==='file')throw new Error('a trusted press on a file input opens the system file picker, which blocks Safari \u2014 use upload_file');
  if(el.tagName==='SELECT')throw new Error('a trusted press on a native <select> opens a system menu \u2014 use fill to choose an option');
  if(el.scrollIntoView)el.scrollIntoView({block:'center',inline:'nearest'});
  S.nat={el:el,off:null,hit:null,keys:0};S.natHook(win(el));S.natHook(window);
  var id=el.id,temp=false,rt=el.getRootNode?el.getRootNode():document;
  if(!id||rt.querySelectorAll('[id="'+String(id).replace(/["\\]/g,'\\$&')+'"]').length!==1){temp=true;S.axOld=el.getAttribute('id');id='smax'+Date.now().toString(36)+(++S.n);el.id=id;S.axEl=el;}
  return {id:id,temp:temp,what:brief(el).replace('#'+id,''),disabled:!!(el.disabled||el.getAttribute('aria-disabled')==='true')};
};
S.axUntag=function(){var el=S.axEl;if(el){if(S.axOld==null)el.removeAttribute('id');else el.id=S.axOld;S.axEl=null;}return true;};
S.jobCall=function(id,fn,args){return S.job(id,function(){return S[fn].apply(S,args||[]);});};

// ------------------------------------------------------------------ downloads and raw HTTP from the page's session
S.dl={};
S.hrefOf=function(t){var el=S.el(t),a=el.closest&&el.closest('a[href]'),u=(a&&a.href)||el.currentSrc||el.src||el.href||(el.tagName==='FORM'&&el.action)||'';
  if(!u)throw new Error(brief(el)+' has no URL of its own (href/src): use method="browser" to click it and catch the download');
  return {url:u,name:(a&&a.getAttribute('download'))||''};};
S.dlFetch=function(id,url){
  return fetch(url,{credentials:'include'}).then(function(r){
    var cd=r.headers.get('content-disposition')||'',m=/filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd)||/filename\s*=\s*"?([^";]+)"?/i.exec(cd),nm='';
    try{nm=m?decodeURIComponent(m[1]):'';}catch(e){nm=m?m[1]:'';}
    return r.blob().then(function(b){S.dl[id]=b;return {status:r.status,ok:r.ok,size:b.size,type:b.type||r.headers.get('content-type')||'',name:nm,url:r.url};});});};
S.dlChunk=function(id,off,len){var b=S.dl[id];if(!b)throw new Error('download buffer lost (the page navigated)');
  return b.slice(off,off+len).arrayBuffer().then(function(ab){var u=new Uint8Array(ab),s='';for(var i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s);});};
S.dlDone=function(id){delete S.dl[id];return true;};
S.dlFrame=function(url){var f=document.createElement('iframe');f.style.cssText='display:none';f.src=url;document.documentElement.appendChild(f);setTimeout(function(){try{f.remove();}catch(e){}},60000);return true;};
S.httpRequest=function(o){
  var t0=performance.now();
  return fetch(o.url,{method:o.method||'GET',headers:o.headers||undefined,body:o.body==null?undefined:o.body,credentials:o.credentials||'include',redirect:'follow'}).then(function(r){
    return r.text().then(function(tx){return {status:r.status,statusText:r.statusText,url:r.url,redirected:r.redirected,ms:Math.round(performance.now()-t0),headers:hdrs(r.headers),bodyLength:tx.length,body:tx.slice(0,o.max||20000)};});});};
S.origin=function(){return location.origin;};
// more of the page's traffic: WebSocket, sendBeacon, form submissions
if(window.WebSocket){
  var OW=window.WebSocket,NW=function(url,protocols){
    var ws=Reflect.construct(OW,protocols===undefined?[url]:[url,protocols],new.target||NW);
    try{var h=rec('websocket','WS',new URL(url,location.href).href),t0=Date.now();S.inflight.delete(h.r.id);h.r.sent=0;h.r.received=0;h.r.frames=[];
      var keep=function(d,dir){if(S.netOpts.bodies&&typeof d==='string'){h.r.frames.push(dir+' '+d.slice(0,500));if(h.r.frames.length>30)h.r.frames.shift();}};
      ws.addEventListener('open',function(){h.r.status=101;h.r.ms=Date.now()-t0;});
      ws.addEventListener('message',function(e){h.r.received++;keep(e.data,'<');});
      ws.addEventListener('close',function(e){h.r.closed=e.code;});
      ws.addEventListener('error',function(){h.r.error='websocket error';if(h.r.ms==null)h.r.ms=Date.now()-t0;});
      var os=ws.send;ws.send=function(d){h.r.sent++;keep(d,'>');return os.apply(ws,arguments);};}catch(e){}
    return ws;};
  NW.prototype=OW.prototype;['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){NW[k]=OW[k];});
  try{window.WebSocket=NW;}catch(e){}
}
if(navigator.sendBeacon){var ob=navigator.sendBeacon;navigator.sendBeacon=function(url,data){try{var h=rec('beacon','POST',new URL(url,location.href).href);S.inflight.delete(h.r.id);h.r.ms=0;if(S.netOpts.bodies&&typeof data==='string')h.r.reqBody=data.slice(0,20000);}catch(e){}return ob.apply(navigator,arguments);};}
document.addEventListener('submit',function(e){try{var f=e.target,h=rec('form',(f.getAttribute('method')||'GET'),new URL(f.getAttribute('action')||location.href,location.href).href);S.inflight.delete(h.r.id);h.r.ms=0;
  if(S.netOpts.bodies){var o={};new FormData(f).forEach(function(v,k){var el=f.elements[k];o[k]=(el&&el.type==='password')?'•••':(typeof v==='string'?v.slice(0,500):'(file '+v.name+')');});h.r.reqBody=JSON.stringify(o);}}catch(x){}},true);

Object.defineProperty(window,'__sm',{value:S,configurable:false,enumerable:false,writable:false});
return 'ok';
})()
