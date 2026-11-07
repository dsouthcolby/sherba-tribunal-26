(() => {
const CFG = window.SHERBA_CONFIG || {};
const TYPES = {
  rank:{label:"Rank the group", hint:"Order all of you, first to last"},
  person:{label:"Pick a person", hint:"One name from the group"},
  options:{label:"Custom options", hint:"You write the choices"},
  yesno:{label:"Yes or no", hint:"Quick poll"}
};
const S = {
  sb:null, session:null, me:null, phase:"loading", authMode:"signup",
  members:{}, topics:[], results:{}, tab:"open", rankDraft:{}, editing:{}, confirm:null, busy:false,
  draft:{title:"", type:"rank", options:["",""], anonTopic:false, anonVotes:true}
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast.h); toast.h=setTimeout(()=>t.hidden=true,3000); }
function errText(e){ return (e && e.message) ? e.message : "Something went wrong. Check your connection and try again."; }
async function rpc(name, args){ const {data, error} = await S.sb.rpc(name, args); if(error) throw error; return data; }

/* ---------- data ---------- */
async function loadAll(){
  if(!S.me) return;
  try{
    const [{data:m, error:me}, t] = await Promise.all([
      S.sb.from("members").select("user_id,nick,joined_at").order("joined_at"),
      rpc("list_topics")
    ]);
    if(me) throw me;
    S.members = Object.fromEntries((m||[]).map(r=>[r.user_id, r]));
    S.topics = t || [];
    for(const top of S.topics){
      if(top.status==="closed" && !S.results[top.id]){
        S.results[top.id] = await rpc("topic_results", {p_topic: top.id});
      }
    }
    S.phase = "app";
  }catch(e){
    if(/Join the group first/.test(errText(e))) S.phase = "join";
    else toast(errText(e));
  }
  paint();
}
async function checkMembership(){
  const {data, error} = await S.sb.from("members").select("user_id").eq("user_id", S.me).maybeSingle();
  if(error){ toast(errText(error)); }
  S.phase = data ? "app" : "join";
  if(S.phase==="app") await loadAll(); else paint();
}

/* ---------- helpers ---------- */
function memberIds(){ return Object.keys(S.members); }
function nameOf(id){ return (S.members[id] && S.members[id].nick) || "Someone"; }
function colorOf(id){ let h=0; for(const ch of String(id)) h=(h*31+ch.charCodeAt(0))>>>0; return `hsl(${h%360} 45% 42%)`; }
function initials(n){ return n.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase() || "?"; }
function candidates(t){ return (t.type==="rank"||t.type==="person") ? (t.participants||[]) : t.type==="yesno" ? ["yes","no"] : (t.options||[]).map((_,i)=>String(i)); }
function candLabel(t,c){ return (t.type==="rank"||t.type==="person") ? nameOf(c) : t.type==="yesno" ? (c==="yes"?"Yes":"No") : ((t.options||[])[+c] ?? "?"); }
function ballotsFor(t){ return (S.results[t.id]||[]).map(r=>({voter:r.voter, v:r.ballot})); }

function tally(t){
  const bs = ballotsFor(t), cands = candidates(t);
  if(t.type==="rank"){
    const rows = cands.map(c=>{
      const ps = bs.map(b=>Array.isArray(b.v)?b.v.indexOf(c):-1).filter(p=>p>=0);
      return {c, avg: ps.length ? ps.reduce((a,p)=>a+p+1,0)/ps.length : null};
    }).sort((a,b)=>(a.avg??99)-(b.avg??99));
    return {kind:"rank", rows, total:bs.length};
  }
  const counts = Object.fromEntries(cands.map(c=>[c,0]));
  bs.forEach(b=>{ const k=String(b.v); if(k in counts) counts[k]++; });
  return {kind:"count", rows: cands.map(c=>({c, n:counts[c]})).sort((a,b)=>b.n-a.n), total:bs.length};
}

/* ---------- actions ---------- */
async function act(fn, okMsg){
  if(S.busy) return; S.busy=true;
  try{ await fn(); if(okMsg) toast(okMsg); }catch(e){ toast(errText(e)); }
  S.busy=false; await loadAll();
}
function castVote(t, v){ act(()=>rpc("cast_vote",{p_topic:t.id, p_ballot:v}), Array.isArray(v)?"Ranking saved":"Vote saved"); }

/* ---------- render ---------- */
function paint(){
  const signedIn = !!S.me;
  $("#signout").hidden = !signedIn;
  $("nav").hidden = S.phase!=="app";
  const main = $("#main");

  if(!CFG.supabaseUrl || /YOUR-PROJECT/.test(CFG.supabaseUrl)){
    main.innerHTML = `<div class="note">This site isn't connected to a database yet. Add your Supabase URL and key to config.js.</div>`; return;
  }
  if(S.phase==="loading"){ main.innerHTML = `<div class="empty"><h2>Loading the docket</h2></div>`; return; }

  if(S.phase==="signin"){
    const up = S.authMode==="signup";
    main.innerHTML = `<form class="card" id="signin">
      <h2>${up?"Create your account":"Sign in to the Tribunal"}</h2>
      <p class="sub">${up?"First time here? Pick any email and a password of at least 8 characters. Nothing is emailed to you.":"Use the email and password you signed up with."}</p>
      <label class="f" for="email">Email<input type="email" id="email" required autocomplete="email" placeholder="you@example.com"></label>
      <label class="f" for="password">Password<input type="password" id="password" required minlength="${up?8:1}" autocomplete="${up?"new-password":"current-password"}"></label>
      ${up?`<label class="f" for="password2">Password again<input type="password" id="password2" required minlength="8" autocomplete="new-password"></label>`:""}
      <div class="row"><button class="btn" type="submit" id="authbtn">${up?"Create account":"Sign in"}</button>
        <button class="btn ghost" type="button" id="switch">${up?"I already have an account":"First time? Create an account"}</button></div>
      ${up?"":`<p class="hint">Forgot your password? Ask Danielle to reset it for you.</p>`}
    </form>`;
    $("#switch").onclick=()=>{ S.authMode = up ? "signin" : "signup"; paint(); };
    $("#signin").onsubmit = async e => { e.preventDefault();
      const email=$("#email").value.trim(), password=$("#password").value;
      if(up && password!==$("#password2").value){ toast("The two passwords don't match."); return; }
      $("#authbtn").disabled=true;
      const {data, error} = up ? await S.sb.auth.signUp({email, password}) : await S.sb.auth.signInWithPassword({email, password});
      $("#authbtn") && ($("#authbtn").disabled=false);
      if(error){
        const m = errText(error);
        if(/already registered/i.test(m)) toast("That email already has an account. Sign in instead.");
        else if(/invalid login/i.test(m)) toast("Wrong email or password.");
        else if(/not confirmed/i.test(m)) toast("Sign-in is blocked by an email setting. Ask Danielle to turn off Confirm email in Supabase.");
        else toast(m);
        return;
      }
      if(up && !data.session) toast("Account made, but Supabase wants email confirmation. Ask Danielle to turn off Confirm email.");
    };
    return;
  }

  if(S.phase==="join"){
    main.innerHTML = `<form class="card" id="join"><h2>Join the Sherba Tribunal</h2><p class="sub">Enter the group code and the name the rest of Sherba will see.</p>
      <label class="f" for="code">Group code<input type="text" id="code" required autocomplete="off" autocapitalize="off"></label>
      <label class="f" for="nick">Your name<input type="text" id="nick" maxlength="24" required placeholder="e.g. Danielle"></label>
      <div class="row"><button class="btn" type="submit">Join</button></div></form>`;
    $("#join").onsubmit = async e => { e.preventDefault();
      try{ await rpc("join_group",{p_code:$("#code").value, p_nick:$("#nick").value.trim()}); S.phase="app"; await loadAll(); }
      catch(err){ toast(errText(err)); } };
    return;
  }

  const open = S.topics.filter(t=>t.status==="open"), closed = S.topics.filter(t=>t.status==="closed");
  $("#n-open").textContent = open.length || "";
  $("#n-closed").textContent = closed.length || "";
  document.querySelectorAll("nav button").forEach(b=>b.setAttribute("aria-selected", String(b.dataset.tab===S.tab)));
  const mids = memberIds();
  $("#crew").innerHTML = mids.slice(0,6).map(id=>`<span class="av" style="background:${colorOf(id)}" title="${esc(nameOf(id))}">${esc(initials(nameOf(id)))}</span>`).join("") + (mids.length?`<span class="more">${mids.length} in</span>`:"");

  let html="";
  if(S.tab==="new") html = newForm();
  else {
    const list = S.tab==="open" ? open : closed;
    if(!list.length) html = S.tab==="open"
      ? `<div class="card empty"><h2>The court is in recess</h2><p>Put something to a vote. Everyone who has joined can weigh in until the person who posted it closes it.</p><div class="row" style="justify-content:center"><button class="btn" data-act="starter">Start with "Who's the most Type A?"</button></div></div>`
      : `<div class="card empty"><h2>No verdicts yet</h2><p>When someone closes a topic, the ruling is saved here for the rest of the trip.</p></div>`;
    else list.forEach(t=>html+=topicCard(t));
  }
  main.innerHTML = html;
  if(S.tab==="new") wireForm();
}

function topicCard(t){
  const by = t.anon_topic ? (t.is_mine ? "Posted anonymously by you" : "Posted anonymously") : `Posted by ${esc(nameOf(t.creator))}`;
  const total = Math.max(memberIds().length,1);
  const chips = `<span class="chip ${t.status}">${t.status==="open"?"Voting open":"Closed"}</span><span class="chip">${esc(TYPES[t.type].label)}</span><span class="chip">${t.anon_votes?"Anonymous votes":"Votes shown"}</span>`;
  let body="";
  if(t.status==="open"){
    body += `<div class="progress"><div class="bar"><i style="width:${Math.min(100,t.vote_count/total*100)}%"></i></div>${t.vote_count} of ${total} voted</div>`;
    body += voteUI(t);
    if(t.is_mine){
      if(S.confirm===t.id) body += `<div class="confirm">Close voting and reveal the result to everyone? <button class="btn" data-act="close" data-id="${t.id}">Close and reveal</button><button class="btn ghost" data-act="cancel">Keep open</button></div>`;
      else if(S.confirm==="del:"+t.id) body += `<div class="confirm">Delete this topic and its votes? <button class="btn warn" data-act="del" data-id="${t.id}">Delete</button><button class="btn ghost" data-act="cancel">Cancel</button></div>`;
      else body += `<div class="row"><button class="btn ghost" data-act="ask-close" data-id="${t.id}">Close voting</button><button class="btn warn" data-act="ask-del" data-id="${t.id}">Delete</button></div>`;
    }
  } else body += resultsUI(t);
  return `<article class="card"><div class="meta">${chips}</div><h2>${esc(t.title)}</h2><p class="sub">${by}</p>${body}</article>`;
}

function voteUI(t){
  const mine = t.my_ballot;
  if(t.type==="rank"){
    const voted = Array.isArray(mine), editing = S.editing[t.id] || !voted;
    if(!editing) return `<p class="hint">Your ranking (you can change it until voting closes)</p><ol class="ranked">${mine.map((c,i)=>`<li><span class="pos">${i+1}</span><span class="nm">${esc(nameOf(c))}</span></li>`).join("")}</ol><div class="row"><button class="btn ghost" data-act="rerank" data-id="${t.id}">Change ranking</button></div>`;
    const d = S.rankDraft[t.id] || [], rest = (t.participants||[]).filter(c=>!d.includes(c));
    return `<p class="hint">${d.length?"Keep tapping in order.":"Tap names in order, starting with #1."}</p>
      ${d.length?`<ol class="ranked">${d.map((c,i)=>`<li><span class="pos">${i+1}</span><span class="nm">${esc(nameOf(c))}</span><button class="x" aria-label="Remove ${esc(nameOf(c))}" data-act="unrank" data-id="${t.id}" data-c="${esc(c)}">✕</button></li>`).join("")}</ol>`:""}
      ${rest.length?`<div class="choices">${rest.map(c=>`<button class="opt" data-act="rank" data-id="${t.id}" data-c="${esc(c)}"><span class="av" style="background:${colorOf(c)}">${esc(initials(nameOf(c)))}</span><span>${esc(nameOf(c))}</span></button>`).join("")}</div>`:""}
      <div class="row"><button class="btn" data-act="submit-rank" data-id="${t.id}" ${rest.length?"disabled":""}>Submit ranking</button>${d.length?`<button class="btn ghost" data-act="clear-rank" data-id="${t.id}">Start over</button>`:""}${voted?`<button class="btn ghost" data-act="cancel-rank" data-id="${t.id}">Cancel</button>`:""}</div>`;
  }
  return `<p class="hint">${mine!=null?"Your vote is in. Tap another to change it.":"Tap to vote."}</p><div class="choices">${candidates(t).map(c=>`<button class="opt" aria-pressed="${mine===c}" data-act="pick" data-id="${t.id}" data-c="${esc(c)}">${t.type==="person"?`<span class="av" style="background:${colorOf(c)}">${esc(initials(nameOf(c)))}</span>`:""}<span>${esc(candLabel(t,c))}</span></button>`).join("")}</div>`;
}

function resultsUI(t){
  const r = tally(t), bs = ballotsFor(t);
  if(!r.total) return `<p class="sub">Closed with no votes.</p>`;
  let rows;
  if(r.kind==="rank"){
    const n=(t.participants||[]).length||1, best=r.rows[0].avg; let place=0, prev=null;
    rows = r.rows.map((row,i)=>{ if(row.avg!==prev){place=i+1; prev=row.avg;} const pct=row.avg?((n-row.avg+1)/n*100):0;
      return `<li class="${row.avg===best?"win":""}"><span class="pos">${place}</span><span class="nm">${esc(candLabel(t,row.c))}</span><span class="score">${row.avg?`avg spot ${row.avg.toFixed(1)}`:"unranked"}</span><span class="track"><i style="width:${pct}%"></i></span></li>`; }).join("");
  } else {
    const top=r.rows[0].n;
    rows = r.rows.map(row=>`<li class="${row.n===top&&top>0?"win":""}"><span class="pos">${row.n}</span><span class="nm">${esc(candLabel(t,row.c))}</span><span class="score">${Math.round(row.n/r.total*100)}%</span><span class="track"><i style="width:${row.n/r.total*100}%"></i></span></li>`).join("");
  }
  const tie = r.kind==="rank" ? r.rows.filter(x=>x.avg===r.rows[0].avg).length>1 : r.rows.filter(x=>x.n===r.rows[0].n).length>1;
  const when = t.closed_at ? new Date(t.closed_at).toLocaleDateString(undefined,{month:"short",day:"numeric"}) : "";
  let out = `<p class="sub">${r.total} vote${r.total===1?"":"s"}${when?` · closed ${esc(when)}`:""}${tie?" · it's a tie at the top":""}${r.kind==="rank"?" · ranked by average position":""}</p><ul class="results">${rows}</ul>`;
  if(!t.anon_votes) out += `<details><summary>Who voted what</summary><ul class="ballots">${bs.map(b=>`<li><b>${esc(nameOf(b.voter))}:</b> ${Array.isArray(b.v)?b.v.map((c,i)=>`${i+1}. ${esc(nameOf(c))}`).join(", "):esc(candLabel(t,String(b.v)))}</li>`).join("")}</ul></details>`;
  return out;
}

function newForm(){
  const d=S.draft;
  return `<form class="card" id="newf">
    <h2>Bring a case to Sherba</h2>
    <label class="f" for="t-title">Question<input type="text" id="t-title" maxlength="120" placeholder="Who's the most Type A?" value="${esc(d.title)}"></label>
    <div class="f">Vote type<div class="seg">${Object.entries(TYPES).map(([k,v])=>`<button type="button" aria-pressed="${d.type===k}" data-type="${k}">${v.label}<small>${v.hint}</small></button>`).join("")}</div></div>
    ${d.type==="options"?`<div style="display:flex;flex-direction:column;gap:8px">${d.options.map((o,i)=>`<div class="row" style="flex-wrap:nowrap"><input type="text" id="opt-${i}" data-opt="${i}" maxlength="60" placeholder="Option ${i+1}" value="${esc(o)}">${d.options.length>2?`<button type="button" class="x" data-rmopt="${i}" aria-label="Remove option ${i+1}">✕</button>`:""}</div>`).join("")}<div class="row"><button type="button" class="btn ghost" id="addopt" ${d.options.length>=12?"disabled":""}>Add option</button></div></div>`:""}
    ${d.type==="rank"||d.type==="person"?`<p class="hint">Uses everyone who has joined so far (${memberIds().length}). Get the whole group to join before posting.</p>`:""}
    <label class="tog" for="t-anonTopic"><input type="checkbox" id="t-anonTopic" ${d.anonTopic?"checked":""}><span>Post anonymously<small>Your name won't show on this topic.</small></span></label>
    <label class="tog" for="t-anonVotes"><input type="checkbox" id="t-anonVotes" ${d.anonVotes?"checked":""}><span>Anonymous votes<small>Results show totals only, not who voted what.</small></span></label>
    <div class="row"><button class="btn" type="submit">Post topic</button></div>
  </form>`;
}
function wireForm(){
  const f=$("#newf"), d=S.draft;
  $("#t-title").oninput=e=>d.title=e.target.value;
  $("#t-anonTopic").onchange=e=>d.anonTopic=e.target.checked;
  $("#t-anonVotes").onchange=e=>d.anonVotes=e.target.checked;
  f.querySelectorAll("[data-type]").forEach(b=>b.onclick=()=>{d.type=b.dataset.type; paint();});
  f.querySelectorAll("[data-opt]").forEach(i=>i.oninput=e=>d.options[+i.dataset.opt]=e.target.value);
  f.querySelectorAll("[data-rmopt]").forEach(b=>b.onclick=()=>{d.options.splice(+b.dataset.rmopt,1); paint();});
  const add=$("#addopt"); if(add) add.onclick=()=>{d.options.push(""); paint(); const l=$("#opt-"+(d.options.length-1)); if(l) l.focus();};
  f.onsubmit=e=>{ e.preventDefault();
    const title=d.title.trim(); if(!title){ toast("Add a question first."); return; }
    const opts=d.options.map(o=>o.trim()).filter(Boolean);
    if(d.type==="options" && opts.length<2){ toast("Add at least two options."); return; }
    act(async()=>{
      await rpc("create_topic",{p_title:title, p_type:d.type, p_options: d.type==="options"?opts:null, p_anon_topic:d.anonTopic, p_anon_votes:d.anonVotes});
      S.draft={title:"", type:"rank", options:["",""], anonTopic:false, anonVotes:true}; S.tab="open";
    }, "Topic posted");
  };
}

/* ---------- events ---------- */
document.querySelector("nav").addEventListener("click", e=>{
  const b=e.target.closest("button[data-tab]"); if(!b) return;
  S.tab=b.dataset.tab; S.confirm=null; paint(); window.scrollTo({top:0});
});
$("#signout").onclick = async () => { await S.sb.auth.signOut(); };
$("#main").addEventListener("click", e=>{
  const b=e.target.closest("[data-act]"); if(!b) return;
  const a=b.dataset.act, t=S.topics.find(x=>x.id===b.dataset.id), c=b.dataset.c;
  switch(a){
    case "starter": S.draft={title:"Who's the most Type A?", type:"rank", options:["",""], anonTopic:false, anonVotes:true}; S.tab="new"; paint(); break;
    case "pick": castVote(t,c); break;
    case "rank": (S.rankDraft[t.id] ||= []).push(c); paint(); break;
    case "unrank": S.rankDraft[t.id]=(S.rankDraft[t.id]||[]).filter(x=>x!==c); paint(); break;
    case "clear-rank": S.rankDraft[t.id]=[]; paint(); break;
    case "rerank": S.editing[t.id]=true; S.rankDraft[t.id]=[]; paint(); break;
    case "cancel-rank": S.editing[t.id]=false; paint(); break;
    case "submit-rank": { const d=S.rankDraft[t.id]||[]; if(d.length!==(t.participants||[]).length) return; S.editing[t.id]=false; S.rankDraft[t.id]=[]; castVote(t,[...d]); break; }
    case "ask-close": S.confirm=t.id; paint(); break;
    case "ask-del": S.confirm="del:"+t.id; paint(); break;
    case "cancel": S.confirm=null; paint(); break;
    case "close": S.confirm=null; S.tab="closed"; act(()=>rpc("close_topic",{p_topic:t.id}), "Verdict revealed"); break;
    case "del": S.confirm=null; act(()=>rpc("delete_topic",{p_topic:t.id}), "Topic deleted"); break;
  }
});

/* ---------- boot ---------- */
if(!CFG.supabaseUrl || /YOUR-PROJECT/.test(CFG.supabaseUrl) || !window.supabase){ paint(); return; }
S.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
S.sb.auth.onAuthStateChange((_evt, session) => {
  const id = session ? session.user.id : null;
  if(id === S.me && S.phase!=="loading") return;
  S.me = id;
  if(!id){ S.phase="signin"; S.members={}; S.topics=[]; S.results={}; paint(); return; }
  setTimeout(checkMembership, 0);
});
// Refresh every 8 seconds while the page is visible, and when you come back to it.
setInterval(()=>{ if(S.phase==="app" && S.tab!=="new" && !document.hidden && !S.busy) loadAll(); }, 8000);
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && S.phase==="app" && S.tab!=="new") loadAll(); });
})();
