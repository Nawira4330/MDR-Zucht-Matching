/* script.js
   Nutzungsweise:
   - Einfach in dieselbe Ordnerstruktur legen wie index.html/styles.css
   - Die beiden Google-Sheets-Links (pubhtml) wurden in CSV-pub-Links umgewandelt.
     Falls nötig, passe die URLs unten an.
*/

/* ---------- 1) Hier die CSV-Publikations-URLs (aus deinen pubhtml-Links abgeleitet) ---------- */
const HENGSTE_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRvyxHFLsRMdLYcZR6VhzhDDHJX46TLp3WMUslb53ij2zzAY7R2o9rZjVHpani0cA/pub?output=csv";
const STUTEN_CSV  = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQUZE4HXc1di-ym2n79-_9Rc-vxHbMMniRXmgq1woBSha0MjvANgvYFoqH4w7E2LA/pub?output=csv";

/* ---------- Hilfsfunktionen ---------- */
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
    // evtl ohne Leerzeichen eingetragen, trotzdem versuchen:
    token = token.replace(/\s+/g,'');
    if(token.length !== 2) return token;
  }
  // Normiere Groß-/Kleinschreibung
  const a = token[0];
  const b = token[1];
  if (a === a.toUpperCase() && b === b.toUpperCase()) return "HH";
  if (a === a.toLowerCase() && b === b.toLowerCase()) return "hh";
  // heterozygot
  return "Hh";
}
function parseTraitString(cell){
  // erwartet z.B. "hh hh hH hH | hh Hh Hh hh" oder "hh hh hH hH hh Hh Hh hh"
  if(!cell || (typeof cell !== 'string')) return {front:[],back:[]};
  let parts = cell.split('|');
  let frontTokens = [], backTokens = [];
  if(parts.length === 2){
    frontTokens = parts[0].trim().split(/\s+/).filter(Boolean);
    backTokens  = parts[1].trim().split(/\s+/).filter(Boolean);
  } else {
    // keine | - versuche 8 tokens zu teilen
    let toks = cell.trim().split(/\s+/).filter(Boolean);
    if(toks.length === 8){
      frontTokens = toks.slice(0,4);
      backTokens  = toks.slice(4,8);
    } else {
      // unklare Formatierung -> nimm erste 4 als front, rest als back (best effort)
      frontTokens = toks.slice(0,4);
      backTokens = toks.slice(4,8);
    }
  }
  // canonicalize
  frontTokens = frontTokens.map(t => canonicalizeAllele(t));
  backTokens  = backTokens.map(t => canonicalizeAllele(t));
  return {front: frontTokens, back: backTokens};
}
function countFrontMatches(tokens){
  // front match = HH oder Hh
  if(!tokens) return 0;
  return tokens.reduce((acc,t) => acc + ((t === "HH" || t === "Hh")?1:0), 0);
}
function countBackMatches(tokens){
  // back match = hh
  if(!tokens) return 0;
  return tokens.reduce((acc,t) => acc + ((t === "hh")?1:0), 0);
}

/* ---------- Kern-Funktion: berechne Kompatibilität einer Stute mit allen Hengsten ---------- */
function computeTopStallionsForMare(mare, stallions, traitList, opts = {}) {
  const results = [];
  for (const s of stallions){
    let totalScore = 0;
    let perfectTraits = 0;
    const traitDetails = [];

    for (const trait of traitList){
      const mareCell = mare[trait] || "";
      const stallCell = s[trait] || "";

      const m = parseTraitString(mareCell);
      const h = parseTraitString(stallCell);

      const mFront = countFrontMatches(m.front);
      const mBack  = countBackMatches(m.back);
      const hFront = countFrontMatches(h.front);
      const hBack  = countBackMatches(h.back);

      const offspringFront = Math.max(mFront, hFront);
      const offspringBack  = Math.max(mBack, hBack);
      const traitScore = Math.min(offspringFront, offspringBack); // 0..4

      if(traitScore === 4) perfectTraits++;

      totalScore += traitScore;
      traitDetails.push({
        trait, mare:{front:mFront,back:mBack,raw:m},
        stallion:{front:hFront,back:hBack,raw:h},
        offspring:{front:offspringFront,back:offspringBack,traitScore}
      });
    }

    results.push({
      stallionRow: s,
      totalScore,
      perfectTraits,
      traitDetails
    });
  }

  // Sortiere: höherer totalScore, mehr perfectTraits, dann Name
  results.sort((a,b) => {
    if(b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if(b.perfectTraits !== a.perfectTraits) return b.perfectTraits - a.perfectTraits;
    const nameA = (a.stallionRow.Name || a.stallionRow.Hengst || "").localeCompare((b.stallionRow.Name || b.stallionRow.Hengst || ""));
    return nameA;
  });

  return results.slice(0,3);
}

/* ---------- UI / Daten laden ---------- */
const ownerSelect = document.getElementById('ownerSelect');
const mareSelect  = document.getElementById('mareSelect');
const computeBtn  = document.getElementById('computeBtn');
const resultsDiv  = document.getElementById('results');
const infoDiv     = document.getElementById('info');

let STALLIONS = [], MARES = [], TRAIT_LIST = [];
let nameColMare = null, ownerCol = null, nameColStall = null, colorCol = null;

function init(){
  infoDiv.textContent = "Daten werden geladen...";
  Promise.all([
    new Promise((resolve) => Papa.parse(HENGSTE_CSV, {download:true, header:true, skipEmptyLines:true, complete: (r)=>resolve(r.data), error:()=>resolve([])})),
    new Promise((resolve) => Papa.parse(STUTEN_CSV,  {download:true, header:true, skipEmptyLines:true, complete: (r)=>resolve(r.data), error:()=>resolve([])}))
  ]).then(([hengs, stuts])=>{
    STALLIONS = hengs;
    MARES = stuts;

    if(!STALLIONS.length || !MARES.length){
      infoDiv.innerHTML = "Fehler: Eine oder beide Tabellen konnten nicht geladen werden. Prüfe, ob die Google Sheets wirklich 'veröffentlicht' sind (Publish to web).";
      return;
    }

    // Finde Spalten
    const mareHeaders = Object.keys(MARES[0]);
    const stallHeaders = Object.keys(STALLIONS[0]);

    nameColMare = findColumn(mareHeaders, ['name','stut','stute','pferd']);
    ownerCol = findColumn(mareHeaders, ['besitz','owner','halter','besitzer','eigentu']);
    nameColStall = findColumn(stallHeaders, ['name','hengst','pferd']);
    colorCol = findColumn(mareHeaders.concat(stallHeaders), ['farb','color','farbe','piebald','genetik']);

    // Traitliste: versuche die bekannten Trait-Spalten zu verwenden, sonst: alles außer name/owner/color
    const knownTraits = ['Kopf','Gebiss','Hals','Halsansatz','Widerrist','Schulter','Brust','Rückenlinie','Rückenlänge','Kruppe','Beinwinkelung','Beinstellung','Fesseln','Hufe'];
    TRAIT_LIST = knownTraits.filter(t => mareHeaders.includes(t));

    if(TRAIT_LIST.length === 0){
      // Fallback -> alle Spalten außer Name/Owner/Color
      TRAIT_LIST = mareHeaders.filter(h => h !== nameColMare && h !== ownerCol && h !== colorCol);
    }

    // Fülle Owner-Dropdown
    const owners = Array.from(new Set(MARES.map(r => (r[ownerCol]||"").trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
    ownerSelect.innerHTML = '<option value="">— Alle Besitzer —</option>' + owners.map(o => `<option value="${o}">${o}</option>`).join('');
    // Fülle mare dropdown mit allen stuten
    populateMareSelect();

    infoDiv.innerHTML = `Daten geladen. ${MARES.length} Stuten, ${STALLIONS.length} Hengste. Erkannte Traits: ${TRAIT_LIST.join(', ')}`;
  }).catch(err=>{
    console.error(err);
    infoDiv.textContent = "Fehler beim Laden der Daten. Schau in die Konsole.";
  });
}

function populateMareSelect(filterOwner){
  const mares = (filterOwner) ? MARES.filter(r => (r[ownerCol]||"").trim() === filterOwner) : MARES;
  const options = ['<option value="">— Alle Stuten —</option>'].concat(mares.map(m => {
    const nm = m[nameColMare] || m['Name'] || m['Stute'] || "";
    return `<option value="${nm}">${nm} ${ (m[ownerCol]) ? ' — ' + m[ownerCol] : '' }</option>`;
  }));
  mareSelect.innerHTML = options.join('');
}

/* Events */
ownerSelect.addEventListener('change', (e) => {
  const owner = e.target.value;
  populateMareSelect(owner || null);
  // wenn nur Besitzer gewählt ist, wollen wir nicht automatisch rechnen — der Button löst alles aus
});

computeBtn.addEventListener('click', ()=>{
  resultsDiv.innerHTML = '';
  const selectedOwner = ownerSelect.value;
  const selectedMareName = mareSelect.value;

  // Filter stuten
  let filteredMares = MARES;
  if(selectedOwner) filteredMares = filteredMares.filter(r => (r[ownerCol]||"").trim() === selectedOwner);
  if(selectedMareName) filteredMares = filteredMares.filter(r => {
    const nm = r[nameColMare] || r['Name'] || r['Stute'] || "";
    return nm === selectedMareName;
  });

  if(filteredMares.length === 0){
    resultsDiv.innerHTML = '<div class="info">Keine passende Stute gefunden für die Auswahl.</div>';
    return;
  }

  // Für jede Stute: berechne top 3
  for (const mare of filteredMares){
    const mareName = mare[nameColMare] || mare['Name'] || mare['Stute'] || "(unbekannter Name)";
    const top3 = computeTopStallionsForMare(mare, STALLIONS, TRAIT_LIST);

    // render
    const card = document.createElement('div');
    card.className = 'result-card';

    const header = document.createElement('div');
    header.className = 'result-row';
    header.innerHTML = `<div style="flex:1"><strong>Stute:</strong> ${mareName} ${ (mare[ownerCol]) ? ' — ' + mare[ownerCol] : '' }<br><span class="small">Farbgenetik: ${mare[colorCol] || '—'}</span></div>`;
    card.appendChild(header);

    if(top3.length === 0){
      card.innerHTML += '<div class="info">Keine Hengste gefunden.</div>';
      resultsDiv.appendChild(card);
      continue;
    }

    top3.forEach((res, idx) => {
      const sRow = res.stallionRow;
      const sName = sRow[nameColStall] || sRow['Name'] || sRow['Hengst'] || '(unbekannt)';
      const sOwner = sRow['Besitzer'] || sRow['Owner'] || sRow['Halter'] || '';
      const color = sRow[colorCol] || sRow['Farbe'] || '—';
      const maxPossible = TRAIT_LIST.length * 4;
      const pct = ((res.totalScore / maxPossible)*100).toFixed(1);

      const rDiv = document.createElement('div');
      rDiv.className = 'result-row';
      rDiv.style.marginTop = '8px';
      rDiv.innerHTML = `
        <div class="rank">${idx+1}.</div>
        <div style="flex:1">
          <div><strong>${sName}</strong> ${ sOwner ? '— ' + sOwner : '' }</div>
          <div class="meta small">Score: ${res.totalScore} / ${maxPossible} (${pct}%) • Farbgenetik: ${color}</div>
        </div>
        <div style="min-width:120px;text-align:right" class="small">perfekte Traits: ${res.perfectTraits}</div>
      `;
      card.appendChild(rDiv);

      // kleine Trait-Tabelle (optional ausklappbar — hier immer sichtbar, kompakt)
      const table = document.createElement('table');
      table.className = 'trait-table';
      const thead = `<tr><th>Trait</th><th>Stute (v/h)</th><th>Hengst (v/h)</th><th>Offspring (v/h)</th><th>TraitScore</th></tr>`;
      const rows = res.traitDetails.map(td => {
        const m = td.mare;
        const h = td.stallion;
        const o = td.offspring;
        return `<tr>
          <td>${td.trait}</td>
          <td>${m.front}/${m.back}</td>
          <td>${h.front}/${h.back}</td>
          <td>${o.front}/${o.back}</td>
          <td>${o.traitScore}</td>
        </tr>`;
      }).join('');
      table.innerHTML = thead + rows;
      card.appendChild(table);
    });

    resultsDiv.appendChild(card);
  }
});

/* Start */
init();
