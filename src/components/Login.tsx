import { useState, type FormEvent } from 'react';
import { signIn, confirmSignIn, resetPassword, confirmResetPassword } from 'aws-amplify/auth';
import { editorSession, isCloud, logout } from '../lib/api';
import { beginCoreLogin, isCore } from '../lib/core';
import { Axolotl } from './Axolotl';
export function Login({onLogin}:{onLogin:()=>void}){
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[code,setCode]=useState(''),[stage,setStage]=useState<'login'|'newPassword'|'reset'|'resetConfirm'|'code'>('login'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  function openCore(action: 'login' | 'signup') { setBusy(true); setError(''); void beginCoreLogin(action).catch(e => { setError(e.message); setBusy(false); }); }
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{
    if(stage==='reset'){await resetPassword({username:email});setStage('resetConfirm');}
    else if(stage==='resetConfirm'){await confirmResetPassword({username:email,confirmationCode:code,newPassword:password});setStage('login');setPassword('');}
    else {
      const result=stage==='login'?await signIn({username:email,password}):await confirmSignIn({challengeResponse:stage==='newPassword'?password:code});
      if(result.isSignedIn){if(await editorSession())onLogin();else{await logout();throw new Error('This account needs the Editors group. Ask the parent who set up the site.');}}
      else switch(result.nextStep.signInStep){case 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED':setStage('newPassword');setPassword('');break;case 'RESET_PASSWORD':setStage('reset');break;case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':case 'CONFIRM_SIGN_IN_WITH_SMS_CODE':setStage('code');break;default:throw new Error('This sign-in step is not supported. Check the Cognito settings in the deployment guide.');}
    }
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <main className="login-page"><div className="login-art"><Axolotl/><span className="eyebrow">THE AXOLOTL NEWSROOM</span><h1>Little ideas.<br/>Big adventures.</h1><p>Your next axolotl story starts here.</p></div><div className="login-card"><span className="eyebrow">EDITOR’S DESK</span><h2>{stage==='newPassword'?'Choose your new password':stage.startsWith('reset')?'Reset your password':stage==='code'?'Enter your sign-in code':'Welcome to the newsroom'}</h2>
    {isCore?<><p>Sign in to create your next axolotl story.</p><button className="button primary" disabled={busy} onClick={()=>openCore('login')}>{busy?'Opening…':'Sign in →'}</button><button className="text-button" disabled={busy} onClick={()=>openCore('signup')}>Create account with invitation</button>{error&&<p className="error" role="alert">{error}</p>}<small>One account for connected apps. Your parent manages newsroom access.</small></>:!isCloud?<><p>This is your free local preview. Drafts and uploads stay in this browser.</p><button className="button primary" onClick={onLogin}>Open local editor →</button><small>AWS sign-in will be enabled after you follow the deployment guide.</small></>:<form onSubmit={submit}>
      <p>Sign in with the account your parent invited.</p>
      {['login','reset','resetConfirm'].includes(stage)&&<label>Email<input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label>}
      {['login','newPassword','resetConfirm'].includes(stage)&&<label>{stage==='login'?'Password':'New password'}<input type="password" required minLength={stage==='login'?1:8} autoComplete={stage==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>}
      {['code','resetConfirm'].includes(stage)&&<label>Verification code<input required autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)}/></label>}
      {error&&<p className="error" role="alert">{error}</p>}
      <button className="button primary" disabled={busy}>{busy?'Working…':stage==='login'?'Sign in →':stage==='reset'?'Send reset code':'Continue →'}</button>
      <button type="button" className="text-button" disabled={busy} onClick={()=>{setStage(stage==='login'?'reset':'login');setError('');setPassword('');}}>{stage==='login'?'Forgot your password?':'Back to sign in'}</button>
    </form>}
  </div></main>;
}
