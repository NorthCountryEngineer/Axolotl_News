import * as core from './core';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession, getCurrentUser, signOut } from 'aws-amplify/auth';
import { getUrl, copy, uploadData, remove, list, downloadData } from 'aws-amplify/storage';
import type { Schema } from '../../amplify/data/resource';
import { localPosts, putLocalAsset, localAsset, removeLocalAssets } from './local';
import { mediaKeys, publicDocument, validatePost, validateFile, extensionFor, type Post, type StoryDocument } from './model';
const outputs=import.meta.glob('../../amplify_outputs.json',{eager:true,import:'default'});
export const isCloud=['cloud','nce'].includes(import.meta.env.VITE_APP_MODE);
export const isCore=core.isCore;
const config=Object.values(outputs)[0];
if(isCloud&&!isCore){if(!config)throw new Error('AWS configuration is missing. Follow the deployment guide.');Amplify.configure(config as Parameters<typeof Amplify.configure>[0]);}
const client=isCloud&&!isCore?generateClient<Schema>():undefined;
function checkErrors<T>(r:{data:T;errors?:readonly {message:string}[]}):T {if(r.errors?.length)throw new Error(r.errors.map(e=>e.message).join('; '));return r.data;}
function mapPost(raw:unknown,published=false):Post{const p=raw as Post;return {...p,status:published?'Published':p.status||'Draft',coverKey:p.coverKey||undefined,publishedAt:p.publishedAt||undefined};}
export async function editorSession():Promise<boolean>{if(isCore)return core.coreSession();if(!isCloud)return true;try{await getCurrentUser();const s=await fetchAuthSession();const groups=s.tokens?.accessToken.payload['cognito:groups'];return Array.isArray(groups)&&groups.includes('Editors');}catch{return false;}}
export async function logout(){if(isCore)return core.coreLogout();if(isCloud)await signOut();}
export async function listPosts(published=false):Promise<Post[]>{
  if(isCore)return core.coreList(published);
  if(!client)return (await localPosts.list(published)).sort(sortPosts);
  let authMode:'userPool'|'identityPool'='userPool';
  if(published){try{await getCurrentUser();}catch{authMode='identityPool';}}
  const all:Post[]=[];let nextToken:string|undefined;
  do {
    const r=published?await client.models.PublishedPost.list({authMode,limit:100,nextToken}):await client.models.Post.list({authMode:'userPool',limit:100,nextToken});
    const data=checkErrors<unknown[]>(r);all.push(...data.map(p=>mapPost(p,published)));nextToken=r.nextToken||undefined;
    if(all.length>=1000&&nextToken)throw new Error('The archive is too large for this view. Add server-side pagination before publishing more than 1,000 posts.');
  }while(nextToken);
  return all.sort(sortPosts);
}
function sortPosts(a:Post,b:Post){return (b.publishedAt||b.updatedAt||'').localeCompare(a.publishedAt||a.updatedAt||'');}
export async function savePost(post:Post):Promise<Post>{
  if(isCore)return core.coreSave(post);
  validatePost(post);const now=new Date().toISOString();const clean={...post,document:JSON.stringify(validatePost(post)),updatedAt:now};
  if(!client){await localPosts.save(clean);return clean;}
  const input={id:clean.id,title:clean.title,slug:clean.slug,excerpt:clean.excerpt,category:clean.category,document:clean.document,status:clean.status,coverKey:clean.coverKey||null,publishedAt:clean.publishedAt||null};
  const exists=checkErrors(await client.models.Post.get({id:post.id},{authMode:'userPool'}));
  const r=exists?await client.models.Post.update(input,{authMode:'userPool'}):await client.models.Post.create(input,{authMode:'userPool'});
  const result=checkErrors(r);if(!result)throw new Error('The API did not return the saved draft.');return mapPost(result);
}
export async function uploadFile(postId:string,file:File,onProgress?:(percent:number)=>void):Promise<{key:string;type:'image'|'video'|'file'}>{
  if(isCore)return core.coreUpload(postId,file,onProgress);
  const type=validateFile(file),key=`drafts/${postId}/${crypto.randomUUID()}.${extensionFor(file.type)}`;
  if(!isCloud){await putLocalAsset(key,file);onProgress?.(100);}else{await uploadData({path:key,data:file,options:{contentType:file.type,contentDisposition:type==='file'?'attachment':'inline',onProgress:({transferredBytes,totalBytes})=>onProgress?.(totalBytes?Math.round(transferredBytes/totalBytes*100):0)}}).result;}
  return {key,type};
}
export async function assetURL(key:string):Promise<string>{if(isCore)return core.coreAssetURL(key);if(!isCloud)return URL.createObjectURL(await localAsset(key));return (await getUrl({path:key,options:{expiresIn:900,validateObjectExistence:true}})).url.toString();}
export async function assetBlob(key:string):Promise<Blob>{if(isCore)return core.coreAssetBlob(key);if(!isCloud)return localAsset(key);const r=await downloadData({path:key}).result;return r.body.blob();}
export async function publishPost(post:Post):Promise<Post>{
  if(isCore)return core.corePublish(post);
  const doc=validatePost(post);const draft=await savePost(post);const revision=crypto.randomUUID();const keys=new Map<string,string>();const staged:string[]=[];let committed=false,publicationAttempted=false;
  try {
    for(const key of mediaKeys(doc)){
      if(!key.startsWith(`drafts/${post.id}/`))throw new Error('Published media must belong to this draft. Re-upload this file.');
      const target=`published/${post.id}/${revision}/${key.split('/').pop()}`;
      if(!isCloud)await putLocalAsset(target,await localAsset(key));else await copy({source:{path:key},destination:{path:target}});
      staged.push(target);keys.set(key,target);
    }
    const published={...draft,document:JSON.stringify(publicDocument(doc,keys)),coverKey:post.coverKey?keys.get(post.coverKey):undefined,status:'Published',publishedAt:new Date().toISOString()};
    if(!client)await localPosts.save(published,true);
    else {
      const input={id:published.id,title:published.title,slug:published.slug,excerpt:published.excerpt,category:published.category,document:published.document,coverKey:published.coverKey||null,publishedAt:published.publishedAt};
      const existing=checkErrors(await client.models.PublishedPost.get({id:post.id},{authMode:'userPool'}));
      publicationAttempted=true;
      const saved=checkErrors(existing?await client.models.PublishedPost.update(input,{authMode:'userPool'}):await client.models.PublishedPost.create(input,{authMode:'userPool'}));
      if(!saved?.id)throw new Error('Publication could not be confirmed. Reload the newsroom to check whether the post is live.');
    }
    committed=true;
    try {await savePost({...draft,status:'Published',publishedAt:published.publishedAt});}
    catch {throw new Error('The post is live, but its draft status could not be updated. Reload the newsroom to reconcile it before publishing again.');}
    return published;
  }catch(e){
    // Never delete media after an uncertain API response: publication may have committed.
    // Pre-publication copies remain until the explicit media cleanup action.
    if(!committed && !publicationAttempted) await Promise.allSettled(staged.map(k=>isCloud?remove({path:k}):removeLocalAssets(k)));
    throw e;
  }
}
export async function unpublishPost(post:Post){
  if(isCore)return core.coreUnpublish(post);
  const draft=await savePost(post);
  if(!client)await localPosts.delete(post.id,true);else checkErrors(await client.models.PublishedPost.delete({id:post.id},{authMode:'userPool'}));
  try{await savePost({...draft,status:'Draft',publishedAt:undefined});}catch{throw new Error('The public post was removed, but the draft status could not be updated. Reload the newsroom before continuing.');}
}
export async function cleanupPublishedMedia(postId:string){
  if(isCore)return core.coreCleanup(postId);
  const live=(await listPosts(true)).find(p=>p.id===postId);
  if(live)throw new Error('Unpublish this post before clearing its published media. Keep it unpublished until cleanup finishes.');
  const prefix=`published/${postId}/`;
  if(!isCloud){
    await removeLocalAssets(prefix);return;
  }
  let nextToken:string|undefined;
  do {const r=await list({path:prefix,options:{pageSize:100,nextToken}});for(const item of r.items)await remove({path:item.path});nextToken=r.nextToken;}while(nextToken);
}
export async function deleteDraft(post:Post){
  if(isCore)return core.coreDelete(post);
  if((await listPosts(true)).some(p=>p.id===post.id))throw new Error('Unpublish this post before deleting its draft.');
  await cleanupPublishedMedia(post.id);
  if(!client){await removeLocalAssets(`drafts/${post.id}/`);await localPosts.delete(post.id);}
  else{
    let nextToken:string|undefined;
    do{const r=await list({path:`drafts/${post.id}/`,options:{pageSize:100,nextToken}});for(const item of r.items)await remove({path:item.path});nextToken=r.nextToken;}while(nextToken);
    checkErrors(await client.models.Post.delete({id:post.id},{authMode:'userPool'}));
  }
}
