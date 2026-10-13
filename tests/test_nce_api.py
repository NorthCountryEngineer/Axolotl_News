"""Offline security/contract tests. No SDK install, network or AWS calls."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

sys.modules.setdefault('boto3', types.SimpleNamespace())
sys.modules.setdefault('botocore', types.SimpleNamespace())
sys.modules.setdefault('botocore.config', types.SimpleNamespace(Config=lambda **kw: kw))
spec = importlib.util.spec_from_file_location('api', Path(__file__).parents[1] / 'backend/nce_api/handler.py')
api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
PID = '11111111-1111-4111-8111-111111111111'
ORG = '22222222-2222-4222-8222-222222222222'
SERVICE = '33333333-3333-4333-8333-333333333333'
ASSET = '44444444-4444-4444-8444-444444444444'
REV = '55555555-5555-4555-8555-555555555555'

class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'CORE_ISSUER':'https://core.example.com','CORE_ORGANIZATION_ID':ORG,'CORE_SERVICE_ID':SERVICE,'PRIVATE_TABLE':'private','PUBLIC_TABLE':'public','MEDIA_BUCKET':'media','CORE_CREDENTIALS_PARAMETER':'/test/secret'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.claims = {'active': True, 'iss':'https://core.example.com','organization_id':ORG,'service_id':SERVICE,'aud':'urn:core:service:'+SERVICE,'sub':PID,'exp':9999999999,'scope':'openid authorization','token_type':'Bearer','permissions':['posts-write','posts-publish']}
        self.response = Mock(); self.response.__enter__ = Mock(return_value=self.response); self.response.__exit__ = Mock(return_value=False)
        self.response.read = lambda n: json.dumps(self.claims).encode()
        self.opener = Mock(); self.opener.open.return_value = self.response
        self.open_patch = patch.object(api, 'build_opener', return_value=self.opener); self.open_patch.start(); self.addCleanup(self.open_patch.stop)
        self.creds = patch.object(api, 'credentials', return_value={'client_id':'private','client_secret':'secret'}); self.creds.start(); self.addCleanup(self.creds.stop)
        self.ddb, self.s3, self.ssm = Mock(), Mock(), Mock()
        self.client_patch = patch.object(api, 'clients', return_value=(self.ddb,self.s3,self.ssm)); self.client_patch.start(); self.addCleanup(self.client_patch.stop)
        self.ddb.Table.return_value.get_item.return_value = {}
    def event(self, path='/session', method='GET', body=None, token=True):
        return {'requestContext':{'http':{'method':method}},'rawPath':path,'headers':{'authorization':'Bearer opaque-token'} if token else {},'body':json.dumps(body) if body is not None else None}
    def error(self, status, event):
        r = api.handler(event, None); self.assertEqual(r['statusCode'],status,r); return r
    def test_missing_bearer_is_denied(self): self.error(401,self.event(token=False)); self.opener.open.assert_not_called()
    def test_forwarded_browser_preflights_succeed_without_identity_or_data_access(self):
        for path, method in [('/session', 'GET'), ('/posts', 'GET'), ('/media/upload', 'POST'),
                             ('/posts/' + PID, 'PUT'), ('/published/' + PID, 'DELETE')]:
            with self.subTest(path=path):
                event = self.event(path, 'OPTIONS', token=False)
                event['headers'] = {'origin': 'https://axolotl.news',
                    'access-control-request-method': method,
                    'access-control-request-headers': 'authorization,content-type'}
                result = api.handler(event, None)
                self.assertEqual(result['statusCode'], 204)
                self.assertEqual(result['body'], '')
                self.assertNotIn('Access-Control-Allow-Origin', result['headers'])
        api.clients.assert_not_called()
        api.credentials.assert_not_called()
        self.opener.open.assert_not_called()
        self.error(401, self.event('/session', token=False))
        self.error(401, self.event('/media/upload', 'POST', {}, token=False))
    def test_correct_session_uses_live_introspection(self):
        self.assertEqual(api.handler(self.event(),None)['statusCode'],200)
        self.claims['permissions'] = []
        self.error(403,self.event()); self.assertEqual(self.opener.open.call_count,2)
    def test_wrong_identity_bindings_are_denied(self):
        for field in ['iss','organization_id','service_id','aud']:
            with self.subTest(field=field):
                original=self.claims[field]; self.claims[field]='wrong'; self.error(401,self.event()); self.claims[field]=original
    def test_inactive_expired_and_missing_authorization_scope(self):
        for field,value in [('active',False),('active','true'),('exp',1),('exp',True),('scope','openid')]:
            original=self.claims[field]; self.claims[field]=value; self.error(401,self.event()); self.claims[field]=original
    def test_identity_outage_denies_request(self): self.opener.open.side_effect=api.URLError('unavailable'); self.error(503,self.event())
    def test_public_archive_never_reads_private_table_or_core(self):
        self.ddb.Table.return_value.scan.return_value={'Items':[]}
        self.assertEqual(api.handler(self.event('/published',token=False),None)['statusCode'],200)
        self.ddb.Table.assert_called_once_with('public'); self.opener.open.assert_not_called()
    def test_draft_archive_requires_permission(self): self.claims['permissions']=[]; self.error(403,self.event('/posts')); self.ddb.Table.assert_not_called()
    def test_draft_asset_requires_auth(self):
        e=self.event('/media/read',token=False); e['queryStringParameters']={'key':f'drafts/{PID}/{ASSET}.png'}; self.error(401,e); self.s3.generate_presigned_url.assert_not_called()
    def test_public_asset_has_short_url(self):
        self.s3.generate_presigned_url.return_value='signed'
        e=self.event('/media/read',token=False);e['queryStringParameters']={'key':f'published/{PID}/{REV}/{ASSET}.png'}
        self.assertEqual(api.handler(e,None)['statusCode'],200); self.assertEqual(self.s3.generate_presigned_url.call_args.kwargs['ExpiresIn'],300);self.opener.open.assert_not_called()
    def test_upload_policy_limits_exact_size_type_key_and_lifetime(self):
        self.s3.generate_presigned_post.return_value={'url':'https://s3.example','fields':{}}
        body={'key':f'drafts/{PID}/{ASSET}.png','mime':'image/png','size':100}
        self.assertEqual(api.handler(self.event('/media/upload','POST',body),None)['statusCode'],200)
        options=self.s3.generate_presigned_post.call_args.kwargs
        self.assertIn(['content-length-range',100,100],options['Conditions']);self.assertIn({'Content-Type':'image/png'},options['Conditions']);self.assertEqual(options['ExpiresIn'],60)
        for change in [{'size':0},{'size':11*1024*1024},{'mime':'text/html'},{'key':f'published/{PID}/{REV}/{ASSET}.png'},{'key':'drafts/../secrets.png'}]: self.error(400,self.event('/media/upload','POST',{**body,**change}))
    def test_copy_publishes_saved_draft_into_new_revision(self):
        self.ddb.Table.return_value.get_item.return_value={'Item':{'id':PID,'organization_id':ORG}}
        missing=Exception('missing'); missing.response={'Error':{'Code':'404'}}
        self.s3.head_object.side_effect=missing
        body={'source':f'drafts/{PID}/{ASSET}.png','key':f'published/{PID}/{REV}/{ASSET}.png'}
        self.assertEqual(api.handler(self.event('/media/copy','POST',body),None)['statusCode'],200)
        self.s3.copy_object.assert_called_once()
        self.s3.head_object.side_effect=None
        self.error(409,self.event('/media/copy','POST',body))
    def test_cleanup_blocks_new_upload_and_copy(self):
        self.ddb.Table.return_value.get_item.return_value={'Item':{'id':PID,'organization_id':ORG,'mediaCleanup':'locked'}}
        body={'key':f'drafts/{PID}/{ASSET}.png','mime':'image/png','size':100}
        self.error(409,self.event('/media/upload','POST',body))
        self.error(409,self.event('/media/copy','POST',{'source':body['key'],'key':f'published/{PID}/{REV}/{ASSET}.png'}))
        self.s3.generate_presigned_post.assert_not_called();self.s3.copy_object.assert_not_called()
    def test_write_only_account_cannot_publish_or_copy(self):
        self.claims['permissions']=['posts-write'];self.error(403,self.event('/published/'+PID,'PUT',{}));self.error(403,self.event('/media/copy','POST',{}));self.s3.copy_object.assert_not_called()
    def valid(self, key=None):
        block={'id':'block','type':'text','nodes':[]}
        if key: block={'id':'block','type':'image','key':key}
        return {'id':PID,'title':'Hello','slug':'hello','excerpt':'','category':'Stories','document':json.dumps({'version':1,'theme':'cream','layout':'story','blocks':[block]})}
    def test_publication_rejects_draft_keys_and_other_story_media(self):
        for key in [f'drafts/{PID}/{ASSET}.png',f'published/{ORG}/{REV}/{ASSET}.png']:
            self.error(400,self.event('/published/'+PID,'PUT',self.valid(key)))
        self.s3.head_object.assert_not_called()
    def test_publish_transaction_checks_private_cleanup_lock(self):
        self.ddb.Table.return_value.get_item.return_value={'Item':{'id':PID,'organization_id':ORG}}
        self.assertEqual(api.handler(self.event('/published/'+PID,'PUT',self.valid()),None)['statusCode'],200)
        tx=self.ddb.meta.client.transact_write_items.call_args.kwargs['TransactItems']
        self.assertIn('attribute_not_exists(mediaCleanup)',tx[0]['Update']['ConditionExpression']);self.assertEqual(tx[1]['Put']['TableName'],'public')
    def test_cleanup_checks_no_live_post_in_same_transaction_as_lock(self):
        self.ddb.Table.return_value.get_item.return_value={'Item':{'id':PID,'organization_id':ORG}}
        self.s3.get_paginator.return_value.paginate.return_value=[]
        self.assertEqual(api.handler(self.event('/media/cleanup/'+PID,'DELETE'),None)['statusCode'],200)
        tx=self.ddb.meta.client.transact_write_items.call_args.kwargs['TransactItems']
        self.assertEqual(tx[0]['ConditionCheck']['TableName'],'public');self.assertIn('attribute_not_exists(id)',tx[0]['ConditionCheck']['ConditionExpression']);self.assertIn('mediaCleanupExpires',tx[1]['Update']['UpdateExpression'])
    def test_private_response_hides_identity_and_lock_metadata(self):
        self.ddb.Table.return_value.scan.return_value={'Items':[{'id':PID,'organization_id':ORG,'title':'Hello','mediaCleanup':'secret'}]}
        result=json.loads(api.handler(self.event('/posts'),None)['body']);self.assertEqual(result['posts'],[{'id':PID,'title':'Hello'}])

if __name__ == '__main__': unittest.main()
