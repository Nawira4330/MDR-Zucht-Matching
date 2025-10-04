/* ---------- 1) Google Sheet CSV URLs ---------- */
const HENGSTE_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRvyxHFLsRMdLYcZR6VhzhDDHJX46TLp3WMUslb53ij2zzAY7R2o9rZjVHpani0cA/pub?output=csv";
const STUTEN_CSV  = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQUZE4HXc1di-ym2n79-_9Rc-vxHbMMniRXmgq1woBSha0MjvANgvYFoqH4w7E2LA/pub?output=csv";

/* ---------- Hilfsfunktionen wie vorher ---------- */
function findColumn(headers, keywords){
  keywords = keywords.map(k => k.toLowerCase());
  for (const h of headers){
    const low = h.toLowerCase();
    for (const k of keywords){
      if(low.includes(k)) return h;
    }
  }
  return null;
}

function canonicalizeAllele(token){
  if(!token) return null;
  token = token.trim();
  if(token.length !== 2){
    token = token.replace(/\s+/g,'');
    if(token.length !== 2) return token;
  }
  const a = token[0];
  const b = token[1];
  if (a === a.toUpperCase() && b === b.toUpperCase()) return "HH";
  if (a === a.toLowerCase() && b === b.toLowerCase()) return "hh";
  return "Hh";
}

function parseTraitString(cell){
  if(!cell || (typeof cell !== 'string')) return {front:[],back:[]};
  let parts = cell.split('|');
  let frontTokens = [], backTokens = [];
  if(parts.length === 2){
    frontTokens = parts[0].trim().split(/\s+/).filter(Boolean);
    backTokens  = parts[1].trim().split(/\s+/).filter(Boolean);
  } else {
    let toks = cell.trim().split(/\s+/).filter(Boolean);
    if(toks.length === 8){
      frontTokens = toks.slice(0,4);
      backTokens  = toks.slice(4,8);
    } else {
      frontTokens = toks.slice(0,4);
      backTokens = toks.slice(4,8);
    }
  }
  frontTokens = frontTokens.map(t => canonicalizeAllele(t));
  backTokens  = backTokens.map(t => canonicalizeAllele(t));
  return {front: frontTokens, back: backTokens};
}

function countFrontMatches(tokens){ if(!tokens) return 0; return tokens.reduce((acc,t)=>acc+((t==="HH"||t==="Hh")?1:0),0); }
function countBackMatches(tokens){ if(!tokens) return 0; return tokens.reduce((acc,t)=>acc+((t==="hh")?1:0),0); }

/* ---------- Berechnung Top Hengste ---------- */
function computeTopStallionsForMare(mare, stallions, traitList) {
  const results = [];
  for (const s of stallions){
    let totalScore = 0;
    let perfectTraits = 0;
    const traitDetails = [];
    for(const trait of traitList){
      const mareCell = mare[trait]||"";
      const stallCell = s[trait]||"";
      const m = parseTraitString(mareCell);
      const h = parseTraitString(stallCell);
      const mFront = countFrontMatches(m.front);
      const mBack = countBackMatches(m.back);
      const hFront = countFrontMatches(h.front);
      const hBack = countBackMatches(h.back);
      const offspringFront = Math.max(mFront,hFront);
      const offspringBack = Math.max(mBack,hBack);
      const traitScore = Math.min(offspringFront,offspringBack);
      if(traitScore===4) perfectTraits++;
      totalScore += traitScore;
      traitDetails.push({trait, mare:{front:mFront,back:mBack}, stallion:{front:hFront,back:hBack}, offspring:{front:offspringFront,back:offspringBack,traitScore}});
    }
    results.push({stallionRow:s, totalScore, perfectTraits, traitDetails});
  }
  results.sort((a,b)=>{
    if(b.totalScore!==a.totalScore) return b.totalScore - a.totalScore;
    if(b.perfectTraits!==a.perfectTraits) return b.perfectTraits - a.perfectTraits;
    const nameA = (a.stallionRow.Name||"").localeCompare((b.stallionRow.Name||""));
    return nameA;
  });
  return results.slice(0,3);
}

/* ---------- UI / Daten ---------- */
const ownerSelect = document.getElementById('ownerSelect');
const mareSelect  = document.getElementById('mareSelect');
const computeBtn  = document.getElementById('computeBtn');
const resultsDiv  = document.getElementById('results');
const infoDiv     = document.getElementById('info');

const reloadBtn = document.createElement('button');
reloadBtn.textContent = "Daten neu laden";
reloadBtn.style.marginLeft="10px";
reloadBtn.addEventListener('click',()=>loadData(true));
document.querySelector('.controls').appendChild(reloadBtn);

let STALLIONS=[], MARES=[], TRAIT_LIST=[];
let nameColMare=null, ownerCol=null, nameColStall=null, colorCol=null;

/* ---------- Daten laden ---------- */
function loadData(force=false){
  infoDiv.textContent = "Daten werden geladen...";
  const stored = (!force) ? localStorage.getItem('horseData') : null;
  if(stored){
    try{
      const obj = JSON.parse(stored);
      STALLIONS = obj.stallions;
      MARES = obj.stuten;
      TRAIT_LIST = obj.traits;
      nameColMare=obj.nameColMare;
      ownerCol=obj.ownerCol;
      nameColStall=obj.nameColStall;
      colorCol=obj.colorCol;
      populateDropdowns();
      infoDiv.textContent="Daten aus localStorage geladen. Lade parallel die aktuelle Version...";
    }catch(e){ console.warn(e); }
  }
  // Immer Google Sheets laden und localStorage aktualisieren
  Promise.all([
    new Promise((resolve)=>Papa.parse(HENGSTE_CSV,{download:true,header:true,skipEmptyLines:true,complete:(r)=>resolve(r.data),error:()=>resolve([])})),
    new Promise((resolve)=>Papa.parse(STUTEN_CSV,{download:true,header:true,skipEmptyLines:true,complete:(r)=>resolve(r.data),error:()=>resolve([])}))
  ]).then(([hengs, stuts])=>{
    if(!hengs.length || !stuts.length){
      infoDiv.textContent="Fehler beim Laden der CSVs.";
      return;
    }
    STALLIONS=hengs; MARES=stuts;
    const mareHeaders = Object.keys(MARES[0]);
    const stallHeaders = Object.keys(STALLIONS[0]);
    nameColMare = findColumn(mareHeaders,['name','stut','stute','pferd']);
    ownerCol = findColumn(mareHeaders,['besitz','owner','halter','besitzer','eigentu']);
    nameColStall = findColumn(stallHeaders,['name','hengst','pferd']);
    colorCol = findColumn(mareHeaders.concat(stallHeaders),['farb','color','farbe','piebald','genetik']);
    const knownTraits=['Kopf','Gebiss','Hals','Halsansatz','Widerrist','Schulter','Brust','Rückenlinie','Rückenlänge','Kruppe','Beinwinkelung','Beinstellung','Fesseln','Hufe'];
    TRAIT_LIST=knownTraits.filter(t=>mareHeaders.includes(t));
    if(TRAIT_LIST.length===0) TRAIT_LIST=mareHeaders.filter(h=>h!==nameColMare && h!==ownerCol && h!==colorCol);
    localStorage.setItem('horseData',JSON.stringify({stallions:STALLIONS, stuten:MARES, traits:TRAIT_LIST, nameColMare, ownerCol, nameColStall, colorCol}));
    populateDropdowns();
    infoDiv.textContent="Daten aktuell geladen ("+MARES.length+" Stuten, "+STALLIONS.length+" Hengste)";
  }).catch(err=>{
    console.error(err);
    infoDiv.textContent="Fehler beim Laden der Daten.";
  });
}

/* ---------- Dropdowns ---------- */
function populateDropdowns(filterOwner){
  const owners = Array.from(new Set(MARES.map(r=>(r[ownerCol]||"").trim()).filter(Boolean))).sort();
  ownerSelect.innerHTML='<option value="">— Alle Besitzer —</option>'+owners.map(o=>`<option value="${o}">${o}</option>`).join('');
  populateMareSelect(filterOwner);
}

function populateMareSelect(filterOwner){
  const mares = (filterOwner)?MARES.filter(r=>(r[ownerCol]||"").trim()===filterOwner):MARES;
  mareSelect.innerHTML='<option value="">— Alle Stuten —</option>'+mares.map(m=>{
    const nm=m[nameColMare]||"";
    return `<option value="${nm}">${nm} ${(m[ownerCol])?'— '+m[ownerCol]:''}</option>`;
  }).join('');
}

ownerSelect.addEventListener('change',(e)=>populateMareSelect(e.target.value));

computeBtn.addEventListener('click',()=>{
  resultsDiv.innerHTML='';
  const selectedOwner = ownerSelect.value;
  const selectedMareName = mareSelect.value;
  let filteredMares = MARES;
  if(selectedOwner) filteredMares = filteredMares.filter(r=>(r[ownerCol]||"").trim()===selectedOwner);
  if(selectedMareName) filteredMares = filteredMares.filter(r=>(r[nameColMare]||"")===selectedMareName);
  if(filteredMares.length===0){ resultsDiv.innerHTML='<div class="info">Keine passende Stute gefunden.</div>'; return; }

  for(const mare of filteredMares){
    const mareName = mare[nameColMare]||"(unbekannt)";
    const top3 = computeTopStallionsForMare(mare,STALLIONS,TRAIT_LIST);
    const card=document.createElement('div'); card.className='result-card';
    const header=document.createElement('div'); header.className='result-row';
    header.innerHTML=`<div style="flex:1"><strong>Stute:</strong> ${mareName} ${(mare[ownerCol])?'— '+mare[ownerCol]:''}<br><span class="small">Farbgenetik: ${mare[colorCol]||'—'}</span></div>`;
    card.appendChild(header);
    top3.forEach((res,idx)=>{
      const sRow=res.stallionRow;
      const sName=sRow[nameColStall]||"(unbekannt)";
      const sOwner=sRow['Besitzer']||'';
      const color=sRow[colorCol]||'—';
      const maxPossible = TRAIT_LIST.length*4;
      const pct = ((res.totalScore/maxPossible)*100).toFixed(1);
      const rDiv=document.createElement('div');
      rDiv.className='result-row'; rDiv.style.marginTop='8px';
      rDiv.innerHTML=`<div class="rank">${idx+1}.</div><div style="flex:1"><div><strong>${sName}</strong> ${sOwner?'— '+sOwner:''}</div><div class="meta small">Score: ${res.totalScore} / ${maxPossible} (${pct}%) • Farbgenetik: ${color}</div></div><div style="min-width:120px;text-align:right" class="small">perfekte Traits: ${res.perfectTraits}</div>`;
      card.appendChild(rDiv);
    });
    resultsDiv.appendChild(card);
  }
});

loadData();
