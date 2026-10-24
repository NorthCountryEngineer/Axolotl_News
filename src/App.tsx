import { useCallback, useEffect, useRef, useState } from 'react';
import { Axolotl } from './components/Axolotl';
import { Login } from './components/Login';
import { Studio } from './components/Studio';
import { GameStudio } from './components/GameStudio';
import { FeedbackComposer, FeedbackWorkspace } from './components/Feedback';
import './feedback.css';
import { Games, GamePage } from './components/Games';
import './games.css';
import { useConfirm } from './components/Confirm';
import { DocumentView, Media } from './components/Document';
import { accountAdminSession, agentAdminSession, adminSession, deletePost, duplicatePost, editorSession, isCloud, listPosts, logout } from './lib/api';
import { parseDocument, type Post } from './lib/model';
import { completeCoreLogin, coreConfig, corePlayerSession, isCore } from './lib/core';
import { StoryVideo } from './components/StoryVideo';
import { ItemActions } from './components/ItemActions';
import './app-admin.css';
type ContentAction = 'update' | 'duplicate' | 'delete';
type ContentControls = { enabled: boolean; busy: boolean; onAction: (action: ContentAction, post: Post) => Promise<void> };
const readPath = () => location.pathname + location.search;
const source='https://animals.sandiegozoo.org/animals/axolotl';
const facts=[{number:'01',title:'Those are gills!',text:'The feathery branches around an axolotl’s head help it breathe underwater.',icon:'✳'},{number:'02',title:'Forever a water baby',text:'Axolotls keep youthful features, including external gills, as adults. Scientists call this neoteny.',icon:'≈'},{number:'03',title:'A remarkable regrower',text:'An axolotl can regrow a lost limb. Scientists study how this regeneration works.',icon:'✦'},{number:'04',title:'A very special home',text:'Axolotls come from Mexico’s lake habitats. Protecting the waterways around Xochimilco helps protect them.',icon:'⌂'}];
function Header({navigate,studio,games,signed,playerSigned,adminAllowed,adminMode,checkingAdmin,onToggleAdmin,onLogout,onFeedback}:{navigate:(path:string)=>Promise<void>;studio:boolean;games:boolean;signed:boolean;playerSigned:boolean;adminAllowed:boolean;adminMode:boolean;checkingAdmin:boolean;onToggleAdmin:()=>Promise<void>;onLogout:()=>Promise<void>;onFeedback:()=>void}){
  const go=async(id:string)=>{await navigate('/');setTimeout(()=>document.getElementById(id)?.scrollIntoView({behavior:'smooth'}),20);};
  return <><a className="skip-link" href="#main">Skip to content</a><header className="site-header"><a className="brand" href="/" onClick={e=>{e.preventDefault();void navigate('/');}}><img src="/assets/axolotl-mark.svg" alt=""/><span>axolotl<span className="brand-dot">.</span>news</span></a><nav aria-label="Main navigation"><button className={!studio&&!games?'active':''} onClick={()=>void go('stories')}>The latest</button><button onClick={()=>void go('presentation')}>The story</button><button onClick={()=>void go('facts')}>Fun facts</button><button className={games?'active':''} onClick={()=>void navigate('/games')}>Games</button></nav><button className="editor-link" onClick={()=>void navigate('/studio')}>{studio?'Editor’s desk':'✎ Editor’s desk'}<span>↗</span></button>{signed&&<button className="text-button feedback-header-link" onClick={onFeedback}>Share an idea ✦</button>}{signed&&adminAllowed&&<button className={`admin-toggle ${adminMode?'enabled':''}`} aria-pressed={adminMode} disabled={checkingAdmin} onClick={()=>void onToggleAdmin()}>Admin actions: {adminMode?'On':'Off'}</button>}{studio&&signed&&isCore&&<a className="text-button" href={coreConfig?.issuer}>Core workspace ↗</a>}{(signed||playerSigned)&&<button className="text-button" onClick={()=>void onLogout()}>Sign out</button>}</header></>;
}
function PostCard({post,navigate,controls}:{post:Post;navigate:(path:string)=>Promise<void>;controls:ContentControls}){
  const d=parseDocument(post.document),cover=(post.coverKey?d.blocks.find(b=>b.type==='image'&&b.key===post.coverKey):undefined)||d.blocks.find(b=>b.type==='image');
  const path=`/posts/${post.slug}/${post.id}`;
  return <article className="post-card-shell"><a className="post-card" href={path} onClick={e=>{e.preventDefault();void navigate(path);}}><div className={`post-cover theme-${d.theme}`}>{cover?<Media block={cover} compact/>:<Axolotl/>}<span className="post-category">{post.category}</span></div><div className="post-card-copy"><span className="eyebrow">{post.publishedAt?new Date(post.publishedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'NEW STORY'}</span><h3>{post.title}</h3><p>{post.excerpt}</p><span className="read-story">Read the story <span>↗</span></span></div></a>{controls.enabled&&<div className="post-card-actions"><ItemActions label={post.title} disabled={controls.busy} onUpdate={()=>controls.onAction('update',post)} onDuplicate={()=>controls.onAction('duplicate',post)} onDelete={()=>controls.onAction('delete',post)}/></div>}</article>;
}
function Home({posts,navigate,error,loading,controls}:{posts:Post[];navigate:(path:string)=>Promise<void>;error:string;loading:boolean;controls:ContentControls}){
  const [filter,setFilter]=useState('All');const latest=posts;const filtered=latest.filter(p=>filter==='All'||p.category===filter);
  return <main id="main"><section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="tiny-spark">✦</span> A LITTLE NEWSROOM. A LOT OF CURIOSITY.</span><h1>Small creature.<br/>Big <span>stories.</span></h1><p>A happy little corner of the internet for axolotl stories, fun facts, and the things that make us say “whoa!”</p><div className="hero-actions"><button className="button primary" onClick={()=>document.getElementById('presentation')?.scrollIntoView({behavior:'smooth'})}>Meet our first story <span>→</span></button><a href="#facts" className="hero-secondary">Learn a little something ↗</a></div><div className="hero-caption"><span>✎</span> Made by a curious kid. For curious people.</div></div><div className="hero-art"><Axolotl/><div className="floating-note">oh, hello there!<span>↙</span></div><span className="specimen-label">AMBYSTOMA MEXICANUM<br/><strong>100% extraordinary</strong></span></div></section>
    <div className="ticker" aria-hidden="true"><span>STORIES FROM THE WATER</span><b>✦</b><span>FEATHERY GILLS</span><b>✦</b><span>BIG LITTLE ADVENTURES</span><b>✦</b><span>A WHOLE LOTL TO LOVE</span><b>✦</b></div>
    <section id="stories" className="latest-section"><div className="section-heading"><div><span className="eyebrow">FRESH FROM THE NEWSROOM</span><h2>The latest little discoveries</h2></div><span className="section-stamp">GOOD NEWS<br/>WITH GILLS ✦</span></div><div className="filter-tabs" role="group" aria-label="Filter stories">{['All','Stories','Fun facts','Photos','Videos','Newsletters'].map(c=><button aria-pressed={filter===c} className={filter===c?'active':''} key={c} onClick={()=>setFilter(c)}>{c}</button>)}</div>
      {error?<p className="error" role="alert">The newsroom could not load: {error}</p>:loading?<p className="empty-posts">Loading the newsroom…</p>:filtered.length?<div className="post-grid">{filtered.map(p=><PostCard key={p.id} post={p} navigate={navigate} controls={controls}/>)}</div>:<div className="first-edition"><div className="first-edition-art"><img src="/assets/axolotl-mark.svg" alt=""/><span>ISSUE<br/>NO. 001</span></div><div><span className="eyebrow">{latest.length?'KEEP EXPLORING':'OUR FIRST EDITION IS JUST BEGINNING'}</span><h3>{latest.length?'No discoveries in this section yet.':'Every newsroom starts with a story.'}</h3><p>{latest.length?'Try another category to see more from the newsroom.':'Read the original axolotl adventure below. New facts, photos, and videos will appear here as our young editor publishes them.'}</p><button className="text-button" onClick={()=>document.getElementById('presentation')?.scrollIntoView({behavior:'smooth'})}>Read The Axolotl →</button></div><span className="edition-spark">✦</span></div>}
    </section><StoryVideo/><section id="facts" className="facts-section"><div className="section-heading"><div><span className="eyebrow">THE LITTLE FIELD GUIDE</span><h2>There’s a whole lotl to learn.</h2></div><p>Four reasons these salamanders<br/>are wonderfully extraordinary.</p></div><div className="facts-grid">{facts.map(f=><article className="fact-card" key={f.number}><div><span>{f.number}</span><b>{f.icon}</b></div><h3>{f.title}</h3><p>{f.text}</p></article>)}</div><p className="facts-source">Curiosity, checked. Facts adapted from <a href={source} target="_blank" rel="noopener noreferrer">San Diego Zoo Wildlife Alliance ↗</a>. Updated October 2026.</p></section><section className="closing-note"><img src="/assets/axolotl-mark.svg" alt=""/><div><span className="eyebrow">STAY CURIOUS</span><h2>Big adventures start small.</h2><p>There’s always another story beneath the surface.</p></div><span>≈</span></section>
  </main>;
}
function Article({post,navigate,loading,controls}:{post?:Post;navigate:(path:string)=>Promise<void>;loading:boolean;controls:ContentControls}){
  if(!post)return <main id="main" className="article-page"><h1>{loading?'Loading story…':'This story isn’t here.'}</h1><p>{loading?'One little moment.':'It may have been unpublished or the link may have changed.'}</p><button className="button primary" onClick={()=>navigate('/')}>Back to the newsroom</button></main>;
  return <main id="main" className="article-page"><div className="article-admin-heading"><button className="text-button" onClick={()=>void navigate('/')}>← Back to the newsroom</button>{controls.enabled&&<ItemActions label={post.title} disabled={controls.busy} onUpdate={()=>controls.onAction('update',post)} onDuplicate={()=>controls.onAction('duplicate',post)} onDelete={()=>controls.onAction('delete',post)}/>}</div><span className="eyebrow">{post.category} · {post.publishedAt&&new Date(post.publishedAt).toLocaleDateString(undefined,{dateStyle:'long'})}</span><h1>{post.title}</h1><p className="article-excerpt">{post.excerpt}</p><DocumentView value={post.document}/><div className="article-footer"><img src="/assets/axolotl-mark.svg" alt=""/><span>A little creation from Axolotl News</span><button className="text-button" onClick={()=>window.print()}>Print / save PDF ↓</button></div></main>;
}
export default function App(){
  const confirm=useConfirm();
  const [path,setPath]=useState(readPath),[posts,setPosts]=useState<Post[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[signed,setSigned]=useState(false),[playerSigned,setPlayerSigned]=useState(false),[dirty,setDirty]=useState(false);
  const [adminAllowed,setAdminAllowed]=useState(false),[adminMode,setAdminMode]=useState(false),[checkingAdmin,setCheckingAdmin]=useState(false);
  const [canManageAccounts,setCanManageAccounts]=useState(false),[canConfigureAgents,setCanConfigureAgents]=useState(false);
  const [actionBusy,setActionBusy]=useState(false),[actionError,setActionError]=useState(''),[actionNotice,setActionNotice]=useState('');
  const [failedDelete,setFailedDelete]=useState<Post>();
  const operation=useRef(false);
  const [loginError,setLoginError]=useState('');
  const [feedbackOpen,setFeedbackOpen]=useState(false);
  const [feedbackRevision,setFeedbackRevision]=useState(0);
  const [accountNotice,setAccountNotice]=useState(isCore&&new URLSearchParams(location.search).get('account')==='created');
  const [returningFromCore]=useState(isCore&&location.pathname==='/oauth/callback');
  const [checkingLogin,setCheckingLogin]=useState(returningFromCore);
  useEffect(()=>{
    let active=true;
    void (async()=>{
      try {
        if(returningFromCore)await completeCoreLogin();
        if(!active)return;
        const player=isCore?await corePlayerSession():undefined;
        const session=player?(player.canEdit?await editorSession():false):await editorSession();
        if(!active)return;
        setSigned(isCloud?session:false);setPlayerSigned(isCore?player?.authenticated===true:isCloud&&session);
        if(isCloud&&session){
          const [allowed,accountsAllowed,agentsAllowed]=await Promise.all([adminSession().catch(()=>false),accountAdminSession().catch(()=>false),agentAdminSession().catch(()=>false)]);
          if(active){setAdminAllowed(allowed);setCanManageAccounts(accountsAllowed);setCanConfigureAgents(agentsAllowed);}
        }
        if(returningFromCore&&active)setPath(readPath());
      }catch(e){
        if(!active)return;
        setSigned(false);setPlayerSigned(false);setAdminAllowed(false);setAdminMode(false);setCanManageAccounts(false);setCanConfigureAgents(false);
        if(returningFromCore){history.replaceState({},'','/studio');setPath('/studio');}
        setLoginError((e as Error).message);
      }finally{if(active)setCheckingLogin(false);}
    })();
    return()=>{active=false;};
  },[returningFromCore]);
  useEffect(()=>{
    if(!signed&&!playerSigned)return;
    let active=true,generation=0;
    const clearAdmin=()=>{setAdminAllowed(false);setAdminMode(false);setCanManageAccounts(false);setCanConfigureAgents(false);};
    const verify=()=>{const request=++generation;void(async()=>{
      try{
        if(isCore){
          const player=await corePlayerSession();
          if(!active||request!==generation)return;
          setPlayerSigned(player.authenticated);
          if(!player.canEdit){setSigned(false);setFeedbackOpen(false);clearAdmin();return;}
        }
        if(!signed)return;
        const [allowed,accountsAllowed,agentsAllowed]=await Promise.all([adminSession(),accountAdminSession(),agentAdminSession()]);
        if(active&&request===generation){setAdminAllowed(allowed);setCanManageAccounts(accountsAllowed);setCanConfigureAgents(agentsAllowed);if(!allowed)setAdminMode(false);}
      }catch(e){if(active&&request===generation){clearAdmin();if([401,403].includes((e as {status?:number}).status||0)){setPlayerSigned(false);setSigned(false);setFeedbackOpen(false);}}}
    })();};
    window.addEventListener('focus',verify);
    return()=>{active=false;window.removeEventListener('focus',verify);};
  },[signed,playerSigned]);
  const reload=useCallback(()=>{setLoading(true);void listPosts(true).then(p=>{setPosts(p.filter(p=>{try{parseDocument(p.document);return true;}catch{return false;}}));setError('');}).catch(e=>setError((e as Error).message)).finally(()=>setLoading(false));},[]);
  const onDirty=useCallback((v:boolean)=>setDirty(v),[]);
  useEffect(()=>{reload();},[reload]);
  useEffect(()=>{const pop=async()=>{if(dirty&&!await confirm('Leave this draft without saving?')){history.pushState({},'',path);return;}setPath(readPath());setDirty(false);window.scrollTo(0,0);};window.addEventListener('popstate',pop);const unload=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{window.removeEventListener('popstate',pop);window.removeEventListener('beforeunload',unload);};},[dirty,path,confirm]);
  async function navigate(next:string){if(next!==path&&dirty&&!await confirm('Leave this draft without saving?'))return;if(next!==path){history.pushState({},'',next);setPath(next);setDirty(false);window.scrollTo(0,0);}}
  async function login(){setSigned(true);setPlayerSigned(true);setLoginError('');const [allowed,accountsAllowed,agentsAllowed]=await Promise.all([adminSession().catch(()=>false),accountAdminSession().catch(()=>false),agentAdminSession().catch(()=>false)]);setAdminAllowed(allowed);setCanManageAccounts(accountsAllowed);setCanConfigureAgents(agentsAllowed);}
  async function toggleAdmin(){
    if(adminMode){setAdminMode(false);return;}
    setCheckingAdmin(true);setActionError('');
    try{const allowed=await adminSession();setAdminAllowed(allowed);setAdminMode(allowed);if(!allowed)setActionError('Your account needs editing and publishing permissions to use admin actions.');}
    catch(e){setAdminAllowed(false);setAdminMode(false);setActionError((e as Error).message);}
    finally{setCheckingAdmin(false);}
  }
  async function signOut(){
    if(dirty&&!await confirm('Sign out without saving your draft?'))return;
    await logout();setFeedbackOpen(false);setDirty(false);setSigned(false);setPlayerSigned(false);setAdminAllowed(false);setAdminMode(false);setCanManageAccounts(false);setCanConfigureAgents(false);setFailedDelete(undefined);setActionError('');setLoginError('');history.pushState({},'','/');setPath('/');window.scrollTo(0,0);
  }
  async function actOnPost(action:ContentAction,post:Post){
    if(!signed||!adminAllowed||!adminMode||operation.current)return;
    operation.current=true;setActionBusy(true);setActionError('');setActionNotice('');
    try{
      if(action==='delete'&&!await confirm(`Permanently delete “${post.title}”? This removes the published post, its draft, and its uploaded files. This cannot be undone.`))return;
      if(!await adminSession()){setAdminMode(false);setAdminAllowed(false);throw new Error('Your newsroom admin access has changed. Sign in again to continue.');}
      if(action==='update'){await navigate(`/studio?post=${encodeURIComponent(post.id)}`);return;}
      if(action==='duplicate'){
        const copy=await duplicatePost(post);setActionNotice('Copy created as a private draft.');await navigate(`/studio?post=${encodeURIComponent(copy.id)}`);
      }else{
        await deletePost(post);setFailedDelete(undefined);setActionNotice('Post and uploaded files deleted.');reload();if(path.startsWith('/posts/'))await navigate('/');
      }
    }catch(e){setActionError((e as Error).message);if(action==='delete'){setFailedDelete(post);reload();}}
    finally{operation.current=false;setActionBusy(false);}
  }
  const pathname=path.split('?')[0],query=new URLSearchParams(path.split('?')[1]||'');
  const gameStudio=pathname==='/game-studio',feedback=pathname==='/feedback';
  const games=pathname==='/games'||pathname.startsWith('/games/')||gameStudio;
  const studio=pathname==='/studio'||gameStudio||feedback||checkingLogin;
  const gameId=pathname.startsWith('/games/')?pathname.split('/')[2]:undefined;
  const id=pathname.startsWith('/posts/')?pathname.split('/').pop():undefined;
  const controls={enabled:signed&&adminAllowed&&adminMode,busy:actionBusy,onAction:actOnPost};
  return <><Header navigate={navigate} studio={studio} games={games} signed={signed} playerSigned={playerSigned} adminAllowed={adminAllowed} adminMode={adminMode} checkingAdmin={checkingAdmin} onToggleAdmin={toggleAdmin} onLogout={signOut} onFeedback={()=>setFeedbackOpen(true)}/>{!isCloud&&<div className="local-banner"><span>LOCAL PREVIEW</span> No AWS connection. Creations stay in this browser.</div>}{controls.enabled&&<div className="admin-mode-strip" role="status">Admin actions are on. Use an item’s … menu to update, duplicate, or delete it.</div>}{accountNotice&&<div className="account-notice" role="status"><p>Your shared Core account is ready. Sign in from the Editor’s desk to use your assigned newsroom access.</p><button className="text-button" onClick={()=>setAccountNotice(false)} aria-label="Dismiss account notice">Dismiss</button></div>}{loginError&&<p className="error" role="alert">{loginError}</p>}{actionError&&<div className="content-action-message error" role="alert"><p>{actionError}</p>{failedDelete&&controls.enabled&&<button className="button secondary" disabled={actionBusy} onClick={()=>void actOnPost('delete',failedDelete)}>Retry deleting {failedDelete.title}</button>}</div>}{actionNotice&&<p className="content-action-message" role="status">{actionNotice}</p>}{checkingLogin?<main id="main" className="login-page"><p role="status">Finishing Core sign-in…</p></main>:studio?signed?feedback?<FeedbackWorkspace refreshToken={feedbackRevision} adminMode={controls.enabled} onDirty={onDirty} navigate={navigate}/>:gameStudio?<GameStudio adminMode={controls.enabled} onDirty={onDirty} navigate={navigate} initialGameId={query.get('game')||undefined}/>:<Studio onCreateGame={()=>void navigate('/game-studio')} onFeedback={()=>void navigate('/feedback')} onChanged={reload} onDirty={onDirty} adminMode={controls.enabled} canConfigureAgents={signed&&canConfigureAgents} canManageAccounts={signed&&canManageAccounts} initialPostId={query.get('post')||undefined} initialBlockId={query.get('block')||undefined}/>:<Login onLogin={()=>void login()}/>:gameId?<GamePage id={gameId} navigate={navigate} adminMode={controls.enabled} signed={signed} playerSigned={playerSigned}/>:pathname==='/games'?<Games navigate={navigate} adminMode={controls.enabled} signed={signed} playerSigned={playerSigned}/>:id?<Article loading={loading} post={posts.find(p=>p.id===id)} navigate={navigate} controls={controls}/>:<Home posts={posts} navigate={navigate} error={error} loading={loading} controls={controls}/>}{signed&&feedbackOpen&&<FeedbackComposer page={path} onSaved={()=>setFeedbackRevision(value=>value+1)} onClose={()=>setFeedbackOpen(false)} onViewFeedback={()=>{setFeedbackOpen(false);void navigate('/feedback');}}/>}{!studio&&<footer className="site-footer"><a className="brand" href="/" onClick={e=>{e.preventDefault();void navigate('/');}}><img src="/assets/axolotl-mark.svg" alt=""/><span>axolotl.news</span></a><p>Made with curiosity, creativity, and a whole lotl of love.</p><button onClick={()=>void navigate('/studio')} className="text-button">Editor’s desk ↗</button></footer>}</>;
}
