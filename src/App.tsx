import { useCallback, useEffect, useState } from 'react';
import { Axolotl } from './components/Axolotl';
import { Login } from './components/Login';
import { Studio } from './components/Studio';
import { useConfirm } from './components/Confirm';
import { DocumentView, Media } from './components/Document';
import { editorSession, isCloud, listPosts, logout } from './lib/api';
import { parseDocument, type Post } from './lib/model';
import { completeCoreLogin, coreConfig, isCore } from './lib/core';
import { StoryVideo } from './components/StoryVideo';
const source='https://animals.sandiegozoo.org/animals/axolotl';
const facts=[{number:'01',title:'Those are gills!',text:'The feathery branches around an axolotl’s head help it breathe underwater.',icon:'✳'},{number:'02',title:'Forever a water baby',text:'Axolotls keep youthful features, including external gills, as adults. Scientists call this neoteny.',icon:'≈'},{number:'03',title:'A remarkable regrower',text:'An axolotl can regrow a lost limb. Scientists study how this regeneration works.',icon:'✦'},{number:'04',title:'A very special home',text:'Axolotls come from Mexico’s lake habitats. Protecting the waterways around Xochimilco helps protect them.',icon:'⌂'}];
function Header({navigate,studio,signed}:{navigate:(path:string)=>void;studio:boolean;signed:boolean}){
  const go=async(id:string)=>{await navigate('/');setTimeout(()=>document.getElementById(id)?.scrollIntoView({behavior:'smooth'}),20);};
  return <><a className="skip-link" href="#main">Skip to content</a><header className="site-header"><a className="brand" href="/" onClick={e=>{e.preventDefault();navigate('/');}}><img src="/assets/axolotl-mark.svg" alt=""/><span>axolotl<span className="brand-dot">.</span>news</span></a><nav aria-label="Main navigation"><button className={!studio?'active':''} onClick={()=>go('stories')}>The latest</button><button onClick={()=>go('presentation')}>The story</button><button onClick={()=>go('facts')}>Fun facts</button></nav><button className="editor-link" onClick={()=>navigate('/studio')}>{studio?'Editor’s desk':'✎ Editor’s desk'}<span>↗</span></button>{studio&&signed&&isCore&&<a className="text-button" href={coreConfig?.issuer}>Core workspace ↗</a>}{studio&&signed&&isCloud&&<button className="text-button" onClick={()=>void logout().then(()=>location.assign('/'))}>Sign out</button>}</header></>;
}
function PostCard({post,navigate}:{post:Post;navigate:(path:string)=>void}){
  const d=parseDocument(post.document),cover=d.blocks.find(b=>b.key===post.coverKey)||d.blocks.find(b=>b.type==='image');
  const path=`/posts/${post.slug}/${post.id}`;
  return <a className="post-card" href={path} onClick={e=>{e.preventDefault();navigate(path);}}><div className={`post-cover theme-${d.theme}`}>{cover?<Media block={cover} compact/>:<Axolotl/>}<span className="post-category">{post.category}</span></div><div className="post-card-copy"><span className="eyebrow">{post.publishedAt?new Date(post.publishedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'NEW STORY'}</span><h3>{post.title}</h3><p>{post.excerpt}</p><span className="read-story">Read the story <span>↗</span></span></div></a>;
}
function Home({posts,navigate,error,loading}:{posts:Post[];navigate:(path:string)=>void;error:string;loading:boolean}){
  const [filter,setFilter]=useState('All');const latest=posts;const filtered=latest.filter(p=>filter==='All'||p.category===filter);
  return <main id="main"><section className="hero"><div className="hero-copy"><span className="eyebrow"><span className="tiny-spark">✦</span> A LITTLE NEWSROOM. A LOT OF CURIOSITY.</span><h1>Small creature.<br/>Big <span>stories.</span></h1><p>A happy little corner of the internet for axolotl stories, fun facts, and the things that make us say “whoa!”</p><div className="hero-actions"><button className="button primary" onClick={()=>document.getElementById('presentation')?.scrollIntoView({behavior:'smooth'})}>Meet our first story <span>→</span></button><a href="#facts" className="hero-secondary">Learn a little something ↗</a></div><div className="hero-caption"><span>✎</span> Made by a curious kid. For curious people.</div></div><div className="hero-art"><Axolotl/><div className="floating-note">oh, hello there!<span>↙</span></div><span className="specimen-label">AMBYSTOMA MEXICANUM<br/><strong>100% extraordinary</strong></span></div></section>
    <div className="ticker" aria-hidden="true"><span>STORIES FROM THE WATER</span><b>✦</b><span>FEATHERY GILLS</span><b>✦</b><span>BIG LITTLE ADVENTURES</span><b>✦</b><span>A WHOLE LOTL TO LOVE</span><b>✦</b></div>
    <section id="stories" className="latest-section"><div className="section-heading"><div><span className="eyebrow">FRESH FROM THE NEWSROOM</span><h2>The latest little discoveries</h2></div><span className="section-stamp">GOOD NEWS<br/>WITH GILLS ✦</span></div><div className="filter-tabs" role="group" aria-label="Filter stories">{['All','Stories','Fun facts','Photos','Videos','Newsletters'].map(c=><button aria-pressed={filter===c} className={filter===c?'active':''} key={c} onClick={()=>setFilter(c)}>{c}</button>)}</div>
      {error?<p className="error" role="alert">The newsroom could not load: {error}</p>:loading?<p className="empty-posts">Loading the newsroom…</p>:filtered.length?<div className="post-grid">{filtered.map(p=><PostCard key={p.id} post={p} navigate={navigate}/>)}</div>:<div className="first-edition"><div className="first-edition-art"><img src="/assets/axolotl-mark.svg" alt=""/><span>ISSUE<br/>NO. 001</span></div><div><span className="eyebrow">{latest.length?'KEEP EXPLORING':'OUR FIRST EDITION IS JUST BEGINNING'}</span><h3>{latest.length?'No discoveries in this section yet.':'Every newsroom starts with a story.'}</h3><p>{latest.length?'Try another category to see more from the newsroom.':'Read the original axolotl adventure below. New facts, photos, and videos will appear here as our young editor publishes them.'}</p><button className="text-button" onClick={()=>document.getElementById('presentation')?.scrollIntoView({behavior:'smooth'})}>Read The Axolotl →</button></div><span className="edition-spark">✦</span></div>}
    </section><StoryVideo/><section id="facts" className="facts-section"><div className="section-heading"><div><span className="eyebrow">THE LITTLE FIELD GUIDE</span><h2>There’s a whole lotl to learn.</h2></div><p>Four reasons these salamanders<br/>are wonderfully extraordinary.</p></div><div className="facts-grid">{facts.map(f=><article className="fact-card" key={f.number}><div><span>{f.number}</span><b>{f.icon}</b></div><h3>{f.title}</h3><p>{f.text}</p></article>)}</div><p className="facts-source">Curiosity, checked. Facts adapted from <a href={source} target="_blank" rel="noopener noreferrer">San Diego Zoo Wildlife Alliance ↗</a>. Updated October 2026.</p></section><section className="closing-note"><img src="/assets/axolotl-mark.svg" alt=""/><div><span className="eyebrow">STAY CURIOUS</span><h2>Big adventures start small.</h2><p>There’s always another story beneath the surface.</p></div><span>≈</span></section>
  </main>;
}
function Article({post,navigate,loading}:{post?:Post;navigate:(path:string)=>void;loading:boolean}){
  if(!post)return <main id="main" className="article-page"><h1>{loading?'Loading story…':'This story isn’t here.'}</h1><p>{loading?'One little moment.':'It may have been unpublished or the link may have changed.'}</p><button className="button primary" onClick={()=>navigate('/')}>Back to the newsroom</button></main>;
  return <main id="main" className="article-page"><button className="text-button" onClick={()=>navigate('/')}>← Back to the newsroom</button><span className="eyebrow">{post.category} · {post.publishedAt&&new Date(post.publishedAt).toLocaleDateString(undefined,{dateStyle:'long'})}</span><h1>{post.title}</h1><p className="article-excerpt">{post.excerpt}</p><DocumentView value={post.document}/><div className="article-footer"><img src="/assets/axolotl-mark.svg" alt=""/><span>A little creation from Axolotl News</span><button className="text-button" onClick={()=>window.print()}>Print / save PDF ↓</button></div></main>;
}
export default function App(){
  const confirm=useConfirm();
  const [path,setPath]=useState(location.pathname),[posts,setPosts]=useState<Post[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[signed,setSigned]=useState(false),[dirty,setDirty]=useState(false);
  const [loginError,setLoginError]=useState('');
  const [returningFromCore]=useState(isCore&&location.pathname==='/oauth/callback');
  const [checkingLogin,setCheckingLogin]=useState(returningFromCore);
  useEffect(()=>{
    let active=true;
    void (async()=>{
      try {
        if(returningFromCore)await completeCoreLogin();
        if(!active)return;
        const session=await editorSession();
        if(!active)return;
        setSigned(isCloud?session:false);
        if(returningFromCore)setPath('/studio');
      }catch(e){
        if(!active)return;
        setSigned(false);
        if(returningFromCore){history.replaceState({},'','/studio');setPath('/studio');}
        setLoginError((e as Error).message);
      }finally{if(active)setCheckingLogin(false);}
    })();
    return()=>{active=false;};
  },[returningFromCore]);
  const reload=useCallback(()=>{setLoading(true);void listPosts(true).then(p=>{setPosts(p.filter(p=>{try{parseDocument(p.document);return true;}catch{return false;}}));setError('');}).catch(e=>setError((e as Error).message)).finally(()=>setLoading(false));},[]);
  const onDirty=useCallback((v:boolean)=>setDirty(v),[]);
  useEffect(()=>{reload();},[reload]);
  useEffect(()=>{const pop=async()=>{if(dirty&&!await confirm('Leave this draft without saving?')){history.pushState({},'',path);return;}setPath(location.pathname);window.scrollTo(0,0);};window.addEventListener('popstate',pop);const unload=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{window.removeEventListener('popstate',pop);window.removeEventListener('beforeunload',unload);};},[dirty,path,confirm]);
  async function navigate(next:string){if(next!==path&&dirty&&!await confirm('Leave this draft without saving?'))return;if(next!==path){history.pushState({},'',next);setPath(next);setDirty(false);window.scrollTo(0,0);}}
  const studio=path==='/studio'||checkingLogin;
  const id=path.startsWith('/posts/')?path.split('/').pop():undefined;
  return <><Header navigate={navigate} studio={studio} signed={signed}/>{!isCloud&&<div className="local-banner"><span>LOCAL PREVIEW</span> No AWS connection. Creations stay in this browser.</div>}{loginError&&<p className="error" role="alert">{loginError}</p>}{checkingLogin?<main id="main" className="login-page"><p role="status">Finishing Core sign-in…</p></main>:studio?signed?<Studio onChanged={reload} onDirty={onDirty}/>:<Login onLogin={()=>setSigned(true)}/>:id?<Article loading={loading} post={posts.find(p=>p.id===id)} navigate={navigate}/>:<Home posts={posts} navigate={navigate} error={error} loading={loading}/>}{!studio&&<footer className="site-footer"><a className="brand" href="/" onClick={e=>{e.preventDefault();navigate('/');}}><img src="/assets/axolotl-mark.svg" alt=""/><span>axolotl.news</span></a><p>Made with curiosity, creativity, and a whole lotl of love.</p><button onClick={()=>navigate('/studio')} className="text-button">Editor’s desk ↗</button></footer>}</>;
}
