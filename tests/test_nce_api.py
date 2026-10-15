"""Offline security/contract tests. No SDK install, network or AWS calls."""
import importlib.util
from copy import deepcopy
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
TARGET = '66666666-6666-4666-8666-666666666666'


class ConditionalFailure(Exception):
    response = {'Error': {'Code': 'ConditionalCheckFailedException'}}


class MemoryTable:
    """Exercise the actual transaction conditions without a cloud connection."""
    def __init__(self, database, name): self.database, self.name = database, name
    def get_item(self, Key, **kwargs):
        value = self.database.rows[self.name].get(Key['id'])
        return {'Item': deepcopy(value)} if value else {}
    def condition(self, expression, item, names=None, values=None):
        import re
        names, values = names or {}, values or {}
        tokens = re.findall(r'attribute_(?:not_)?exists\([#\w]+\)|[#:][\w]+|[\w]+|[()=<>]', expression)
        offset = 0
        def atom():
            nonlocal offset
            token = tokens[offset]; offset += 1
            if token == '(':
                value = either(); self_assert(tokens[offset] == ')'); offset += 1; return value
            if token.startswith('attribute_'):
                field = token[token.index('(') + 1:-1]; exists = names.get(field, field) in item
                return not exists if token.startswith('attribute_not') else exists
            field = names.get(token, token); operator = tokens[offset]; operand = values[tokens[offset + 1]]; offset += 2
            if operator == '=': return field in item and item[field] == operand
            if operator == '<': return field in item and item[field] < operand
            raise AssertionError('Unsupported condition comparison')
        def both():
            nonlocal offset
            value = atom()
            while offset < len(tokens) and tokens[offset] == 'AND': offset += 1; other = atom(); value = value and other
            return value
        def either():
            nonlocal offset
            value = both()
            while offset < len(tokens) and tokens[offset] == 'OR': offset += 1; other = both(); value = value or other
            return value
        def self_assert(value):
            if not value: raise AssertionError('Malformed expression')
        result = either(); self_assert(offset == len(tokens))
        return result
    def validate(self, item, options):
        if options.get('ConditionExpression') and not self.condition(options['ConditionExpression'], item,
                options.get('ExpressionAttributeNames'), options.get('ExpressionAttributeValues')): raise ConditionalFailure()
    def put_item(self, Item, **options):
        self.validate(self.database.rows[self.name].get(Item['id'], {}), options)
        self.database.rows[self.name][Item['id']] = deepcopy(Item)
        return {}
    def update_item(self, Key, UpdateExpression, **options):
        item = deepcopy(self.database.rows[self.name].get(Key['id'], {'id': Key['id']}))
        # An absent key does not satisfy attribute_exists(id).
        self.validate(self.database.rows[self.name].get(Key['id'], {}), options)
        values = options.get('ExpressionAttributeValues', {})
        if UpdateExpression.startswith('SET '):
            for clause in UpdateExpression[4:].split(','):
                field, value = clause.strip().split(' = '); field = options.get('ExpressionAttributeNames', {}).get(field, field); item[field] = deepcopy(values[value])
        elif UpdateExpression.startswith('REMOVE '):
            for field in UpdateExpression[7:].split(','): item.pop(field.strip(), None)
        else: raise AssertionError('Unsupported update')
        self.database.rows[self.name][Key['id']] = item
        return {}
    def delete_item(self, Key, **options):
        self.validate(self.database.rows[self.name].get(Key['id'], {}), options)
        self.database.rows[self.name].pop(Key['id'], None)
        return {}
    def scan(self, **options): return {'Items': deepcopy(list(self.database.rows[self.name].values()))}


class MemoryDatabase:
    def __init__(self, private=None, public=None):
        self.rows = {'private': deepcopy(private or {}), 'public': deepcopy(public or {})}
        self.meta = types.SimpleNamespace(client=types.SimpleNamespace(transact_write_items=Mock(side_effect=self.transact)))
    def Table(self, name): return MemoryTable(self, name)
    def transact(self, TransactItems):
        previous = deepcopy(self.rows)
        try:
            for operation in TransactItems:
                kind, options = next(iter(operation.items())); options = dict(options)
                table = self.Table(options.pop('TableName'))
                if kind == 'ConditionCheck':
                    item = self.rows[table.name].get(options.pop('Key')['id'], {}); table.validate(item, options)
                else: getattr(table, {'Put': 'put_item', 'Update': 'update_item', 'Delete': 'delete_item'}[kind])(**options)
        except Exception:
            self.rows = previous
            raise

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
        self.ddb.Table.return_value.get_item.return_value={'Item': {**self.valid(f'published/{PID}/{REV}/{ASSET}.png'), 'organization_id': ORG}}
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

    def memory(self, private=None, public=None):
        database = MemoryDatabase(private, public)
        api.clients.return_value = (database, self.s3, self.ssm)
        self.s3.get_paginator.return_value.paginate.return_value = []
        self.s3.delete_objects.return_value = {}
        self.s3.head_object.return_value = {'ETag': '"source-version"'}
        return database

    def story(self, key=None, published=False):
        return {**self.valid(key), 'organization_id': ORG, 'createdAt': 'old-created', 'updatedAt': 'old-updated',
            'status': 'Published' if published else 'Draft', **({'publishedAt': 'old-published'} if published else {})}

    def test_admin_actions_require_both_permissions_and_signed_in_session(self):
        for path, method, body in [(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET}), (f'/posts/{PID}/content', 'DELETE', {})]:
            with self.subTest(path=path):
                self.error(401, self.event(path, method, body, token=False))
                for permissions in [[], ['posts-write'], ['posts-publish']]:
                    self.claims['permissions'] = permissions
                    self.error(403, self.event(path, method, body))
        self.ddb.Table.assert_not_called(); self.s3.copy_object.assert_not_called(); self.s3.delete_objects.assert_not_called()

    def test_admin_actions_reject_another_organization_before_mutation(self):
        database = self.memory({PID: {**self.story(), 'organization_id': SERVICE}})
        for path, method, body in [(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET}), (f'/posts/{PID}/content', 'DELETE', {})]:
            self.error(403, self.event(path, method, body))
        database.meta.client.transact_write_items.assert_not_called()
        self.s3.copy_object.assert_not_called(); self.s3.delete_objects.assert_not_called()

    def test_duplicate_remaps_blocks_cover_and_media_to_independent_private_draft(self):
        key = f'drafts/{PID}/{ASSET}.png'
        original = {**self.story(key, published=True), 'coverKey': key}
        database = self.memory({PID: original})
        result = api.handler(self.event(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET}), None)
        self.assertEqual(result['statusCode'], 200, result)
        clone = json.loads(result['body']); block = json.loads(clone['document'])['blocks'][0]
        self.assertEqual(clone['status'], 'Draft'); self.assertNotIn('publishedAt', clone)
        self.assertNotEqual(clone['createdAt'], original['createdAt']); self.assertNotEqual(block['id'], 'block')
        self.assertTrue(block['key'].startswith(f'drafts/{TARGET}/')); self.assertEqual(clone['coverKey'], block['key'])
        self.assertEqual(database.rows['private'][PID], original)
        self.assertNotIn(TARGET, database.rows['public'])
        copy = self.s3.copy_object.call_args.kwargs
        self.assertEqual(copy['CopySource'], {'Bucket': 'media', 'Key': key})
        self.assertEqual(copy['Key'], block['key']); self.assertEqual(copy['CopySourceIfMatch'], '"source-version"')
        self.s3.delete_objects.assert_not_called()

    def test_duplicate_falls_back_to_published_snapshot_without_a_private_draft(self):
        key = f'published/{PID}/{REV}/{ASSET}.png'
        database = self.memory(public={PID: self.story(key, published=True)})
        result = api.handler(self.event(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET}), None)
        self.assertEqual(result['statusCode'], 200, result)
        self.assertNotIn(PID, database.rows['private']); self.assertIn(PID, database.rows['public'])
        self.assertEqual(json.loads(result['body'])['status'], 'Draft')

    def test_duplicate_retry_returns_same_finished_copy_without_copying_again(self):
        database = self.memory({PID: self.story()})
        event = self.event(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET})
        first = api.handler(event, None); transactions = database.meta.client.transact_write_items.call_count
        second = api.handler(event, None)
        self.assertEqual(first['statusCode'], 200, first); self.assertEqual(first['body'], second['body'])
        self.assertEqual(database.meta.client.transact_write_items.call_count, transactions)
        self.s3.copy_object.assert_not_called()

    def test_duplicate_receipt_survives_edits_without_accepting_client_receipts(self):
        database = self.memory({PID: self.story()})
        duplicate = self.event(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET})
        first = api.handler(duplicate, None)
        self.assertEqual(first['statusCode'], 200, first)
        edited = {**json.loads(first['body']), 'title': 'An edited copy', 'duplicateSource': SERVICE, 'duplicateComplete': False}
        saved = api.handler(self.event('/posts/' + TARGET, 'PUT', edited), None)
        self.assertEqual(saved['statusCode'], 200, saved)
        self.assertEqual(database.rows['private'][TARGET]['duplicateSource'], PID)
        self.assertTrue(database.rows['private'][TARGET]['duplicateComplete'])
        repeated = api.handler(duplicate, None)
        self.assertEqual(repeated['statusCode'], 200, repeated)
        self.assertEqual(json.loads(repeated['body'])['title'], 'An edited copy')
        original = {**self.valid(), 'duplicateSource': SERVICE, 'duplicateComplete': True}
        self.assertEqual(api.handler(self.event('/posts/' + PID, 'PUT', original), None)['statusCode'], 200)
        self.assertNotIn('duplicateSource', database.rows['private'][PID])

    def test_duplicate_never_overwrites_existing_draft_or_live_target(self):
        for private, public in [({PID: self.story(), TARGET: {**self.story(), 'id': TARGET}}, {}),
                                ({PID: self.story()}, {TARGET: {**self.story(), 'id': TARGET}})]:
            database = self.memory(private, public)
            self.error(409, self.event(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET}))
            database.meta.client.transact_write_items.assert_not_called()
        self.error(400, self.event(f'/posts/{PID}/duplicate', 'POST', {'id': PID}))
        self.error(400, self.event(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET, 'status': 'Published'}))

    def test_interrupted_copy_remains_removable_and_retry_resumes_same_independent_media(self):
        key = f'drafts/{PID}/{ASSET}.png'
        database = self.memory({PID: self.story(key)})
        self.s3.copy_object.side_effect = OSError('temporary failure')
        event = self.event(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET})
        self.error(503, event)
        self.assertEqual(database.rows['private'][TARGET]['duplicateState'], 'copying')
        self.assertNotIn('mediaCleanup', database.rows['private'][PID])
        archive = json.loads(api.handler(self.event('/posts'), None)['body'])
        self.assertCountEqual([post['id'] for post in archive['posts']], [PID, TARGET])
        pending = next(post for post in archive['posts'] if post['id'] == TARGET)
        self.assertEqual(pending['adminState'], 'copying'); self.assertEqual(pending['duplicateSourceId'], PID)
        self.assertNotIn('duplicateEtags', pending); self.assertNotIn('duplicateFingerprint', pending)
        destination = self.s3.copy_object.call_args.kwargs['Key']
        self.s3.copy_object.side_effect = None
        self.assertEqual(api.handler(event, None)['statusCode'], 200)
        self.assertEqual(self.s3.copy_object.call_args.kwargs['Key'], destination)
        self.assertEqual(self.s3.head_object.call_count, 1)
        self.s3.delete_objects.assert_not_called()

    def test_copy_can_reclaim_an_expired_lease_after_process_termination(self):
        key = f'drafts/{PID}/{ASSET}.png'
        database = self.memory({PID: self.story(key)})
        self.s3.copy_object.side_effect = OSError('temporary failure')
        event = self.event(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET})
        self.error(503, event)
        for pid in (PID, TARGET):
            database.rows['private'][pid].update(mediaCleanup='crashed-worker', mediaCleanupExpires=1)
        self.s3.copy_object.side_effect = None
        self.assertEqual(api.handler(event, None)['statusCode'], 200)
        self.assertNotIn('mediaCleanup', database.rows['private'][PID])

    def test_copy_cannot_reference_another_storys_files(self):
        self.memory({PID: self.story(f'drafts/{TARGET}/{ASSET}.png')})
        self.error(400, self.event(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET}))
        self.s3.head_object.assert_not_called(); self.s3.copy_object.assert_not_called()

    def test_delete_rejects_active_copy_lease_without_unpublishing(self):
        original = {**self.story(), 'mediaCleanup': 'active-copy', 'mediaCleanupExpires': 9999999999}
        database = self.memory({PID: original}, {PID: self.story(published=True)})
        self.error(409, self.event(f'/posts/{PID}/content', 'DELETE'))
        self.assertIn(PID, database.rows['public']); self.assertEqual(database.rows['private'][PID], original)
        database.meta.client.transact_write_items.assert_not_called(); self.s3.delete_objects.assert_not_called()

    def test_copy_rechecks_source_snapshot_before_final_commit(self):
        key = f'drafts/{PID}/{ASSET}.png'
        database = self.memory({PID: self.story(key)})
        self.s3.copy_object.side_effect = lambda **kwargs: database.rows['private'][PID].update(title='Changed concurrently')
        self.error(409, self.event(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET}))
        self.assertNotIn('duplicateComplete', database.rows['private'][TARGET])
        self.assertNotIn(TARGET, database.rows['public'])
        self.s3.delete_objects.assert_not_called()

    def test_content_delete_unpublishes_in_same_transaction_as_permanent_write_lock(self):
        database = self.memory({PID: self.story()}, {PID: self.story(published=True)})
        result = api.handler(self.event(f'/posts/{PID}/content', 'DELETE'), None)
        self.assertEqual(result['statusCode'], 200, result)
        transaction = database.meta.client.transact_write_items.call_args_list[0].kwargs['TransactItems']
        self.assertEqual(transaction[0]['Delete']['TableName'], 'public')
        self.assertIn('contentDeleting', transaction[1]['Update']['UpdateExpression'])
        self.assertIn('organization_id = :org', transaction[1]['Update']['ConditionExpression'])
        self.assertNotIn(PID, database.rows['public'])
        self.assertEqual(database.rows['private'][PID], {'id': PID, 'organization_id': ORG, 'contentDeleted': True})
        self.assertEqual(json.loads(api.handler(self.event('/posts'), None)['body'])['posts'], [])
        self.error(409, self.event('/posts/' + PID, 'PUT', self.valid()))
        self.error(409, self.event('/published/' + PID, 'PUT', self.valid()))
        self.error(409, self.event('/media/upload', 'POST', {'key': f'drafts/{PID}/{ASSET}.png', 'mime': 'image/png', 'size': 5}))
        self.error(409, self.event(f'/posts/{PID}/duplicate', 'POST', {'id': TARGET}))

    def test_delete_only_sweeps_exact_post_prefixes_and_keeps_unrelated_posts(self):
        database = self.memory({PID: self.story(), TARGET: {**self.story(), 'id': TARGET}})
        own_draft, own_public = f'drafts/{PID}/{ASSET}.png', f'published/{PID}/{REV}/{ASSET}.png'
        foreign = f'drafts/{TARGET}/{ASSET}.png'
        def pages(**kwargs): return [{'Contents': [{'Key': own_draft}, {'Key': own_public}, {'Key': foreign}]}]
        self.s3.get_paginator.return_value.paginate.side_effect = pages
        self.assertEqual(api.handler(self.event(f'/posts/{PID}/content', 'DELETE'), None)['statusCode'], 200)
        deleted = [item['Key'] for call in self.s3.delete_objects.call_args_list for item in call.kwargs['Delete']['Objects']]
        self.assertCountEqual(deleted, [own_draft, own_public]); self.assertNotIn(foreign, deleted)
        self.assertEqual(database.rows['private'][TARGET]['title'], 'Hello')

    def test_failed_deletion_stays_unpublished_locked_and_can_be_retried(self):
        database = self.memory({PID: self.story()}, {PID: self.story(published=True)})
        self.s3.get_paginator.return_value.paginate.return_value = [{'Contents': [{'Key': f'drafts/{PID}/{ASSET}.png'}]}]
        self.s3.delete_objects.return_value = {'Errors': [{'Code': 'AccessDenied'}]}
        event = self.event(f'/posts/{PID}/content', 'DELETE')
        self.error(503, event)
        self.assertNotIn(PID, database.rows['public']); self.assertTrue(database.rows['private'][PID]['contentDeleting'])
        self.assertNotIn('mediaCleanup', database.rows['private'][PID])
        archive = json.loads(api.handler(self.event('/posts'), None)['body'])['posts']
        self.assertEqual(archive[0]['id'], PID); self.assertEqual(archive[0]['adminState'], 'deleting')
        self.error(409, self.event('/published/' + PID, 'PUT', self.valid()))
        self.s3.delete_objects.return_value = {}
        self.assertEqual(api.handler(event, None)['statusCode'], 200)
        self.assertEqual(api.handler(event, None)['statusCode'], 200)

    def test_delete_handles_public_snapshot_without_draft_and_missing_story_idempotently(self):
        database = self.memory(public={PID: self.story(published=True)})
        event = self.event(f'/posts/{PID}/content', 'DELETE')
        self.assertEqual(api.handler(event, None)['statusCode'], 200)
        self.assertNotIn(PID, database.rows['public'])
        self.assertEqual(api.handler(self.event(f'/posts/{TARGET}/content', 'DELETE'), None)['statusCode'], 200)

    def test_public_only_failed_removal_retains_title_for_retry_ui(self):
        database = self.memory(public={PID: self.story(published=True)})
        self.s3.get_paginator.return_value.paginate.side_effect = OSError('temporary failure')
        self.error(503, self.event(f'/posts/{PID}/content', 'DELETE'))
        pending = json.loads(api.handler(self.event('/posts'), None)['body'])['posts'][0]
        self.assertEqual(pending['title'], 'Hello'); self.assertEqual(pending['adminState'], 'deleting')
        self.assertNotIn(PID, database.rows['public'])

    def test_public_media_cannot_be_presigned_after_story_removal(self):
        self.memory()
        event = self.event('/media/read', token=False)
        event['queryStringParameters'] = {'key': f'published/{PID}/{REV}/{ASSET}.png'}
        self.error(404, event); self.s3.generate_presigned_url.assert_not_called()

if __name__ == '__main__': unittest.main()
