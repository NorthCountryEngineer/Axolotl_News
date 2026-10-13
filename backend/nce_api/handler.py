"""One Core-bound newsroom. Public snapshots and private drafts never share a table.
No permission cache: each protected request uses current Core introspection.
"""
import base64
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler

import boto3
from botocore.config import Config

UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
MEDIA = re.compile(rf'^(drafts|published)/({UUID})/(?:({UUID})/)?({UUID})\.(jpg|png|webp|gif|mp4|webm|pdf)$')
MIMES = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'application/pdf': 'pdf'}
CATEGORIES = {'Stories', 'Fun facts', 'Photos', 'Videos', 'Newsletters', 'Presentation'}
_ddb = _s3 = _ssm = None
_secret = None

class APIError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise APIError(503, 'Core identity redirected unexpectedly. Check its issuer configuration.')


def clients():
    global _ddb, _s3, _ssm
    if _ddb is None:
        _ddb = boto3.resource('dynamodb')
        _s3 = boto3.client('s3', config=Config(signature_version='s3v4'))
        _ssm = boto3.client('ssm')
    return _ddb, _s3, _ssm


def table(published=False):
    return clients()[0].Table(os.environ['PUBLIC_TABLE' if published else 'PRIVATE_TABLE'])


def credentials():
    global _secret
    # Cache only the credential, never membership/permission decisions.
    if not _secret or _secret[0] < time.time() - 60:
        value = clients()[2].get_parameter(Name=os.environ['CORE_CREDENTIALS_PARAMETER'], WithDecryption=True)['Parameter']['Value']
        _secret = (time.time(), json.loads(value))
    return _secret[1]


def authorize(event, *permissions):
    header = event.get('headers', {}).get('authorization', '')
    if not header.startswith('Bearer ') or not 1 <= len(header[7:]) <= 4096:
        raise APIError(401, 'Sign in through Core to continue.')
    creds = credentials()
    basic = base64.b64encode((urlencode({'v': creds['client_id']})[2:] + ':' + urlencode({'v': creds['client_secret']})[2:]).encode()).decode()
    request = Request(os.environ['CORE_ISSUER'].rstrip('/') + '/oauth/introspect/', data=urlencode({'token': header[7:]}).encode(), headers={'Authorization': 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
    try:
        with build_opener(NoRedirect).open(request, timeout=5) as response:
            raw = response.read(65537)
            if len(raw) > 65536: raise APIError(503, 'Core identity returned an invalid response.')
            claims = json.loads(raw)
    except APIError:
        raise
    except (HTTPError, URLError, TimeoutError, ValueError):
        raise APIError(503, 'Core identity is unavailable. Try again shortly.')
    expected = {'iss': os.environ['CORE_ISSUER'], 'organization_id': os.environ['CORE_ORGANIZATION_ID'], 'service_id': os.environ['CORE_SERVICE_ID'], 'aud': 'urn:core:service:' + os.environ['CORE_SERVICE_ID']}
    if claims.get('active') is not True or any(claims.get(k) != v for k, v in expected.items()) or not isinstance(claims.get('exp'), (int, float)) or isinstance(claims.get('exp'), bool) or claims['exp'] <= time.time() or not re.fullmatch(UUID, claims.get('sub', '')) or 'authorization' not in str(claims.get('scope', '')).split() or str(claims.get('token_type', '')).lower() != 'bearer':
        raise APIError(401, 'This Core session is inactive or belongs to another application.')
    granted = claims.get('permissions', [])
    if not isinstance(granted, list) or any(p not in granted for p in permissions):
        raise APIError(403, 'Your Core account does not have this newsroom permission.')
    return claims


def post_id(value):
    if not isinstance(value, str) or not re.fullmatch(UUID, value): raise APIError(400, 'Invalid story identifier.')
    return value


def media_key(value):
    match = MEDIA.fullmatch(value or '') if isinstance(value, str) else None
    if not match or (match[1] == 'drafts' and match[3]) or (match[1] == 'published' and not match[3]): raise APIError(400, 'Invalid media key.')
    return match


def get_post(pid, published=False):
    item = table(published).get_item(Key={'id': pid}, ConsistentRead=True).get('Item')
    if item and item.get('organization_id') != os.environ['CORE_ORGANIZATION_ID']: raise APIError(403, 'Story belongs to another organization.')
    return item


def output(item):
    return {k: v for k, v in item.items() if k in {'id', 'title', 'slug', 'excerpt', 'category', 'document', 'status', 'coverKey', 'publishedAt', 'createdAt', 'updatedAt'}}


def validate_post(body, pid, published=False):
    if not isinstance(body, dict) or body.get('id') != pid: raise APIError(400, 'Story identifiers do not match.')
    title, slug, excerpt, document = [body.get(k) for k in ['title', 'slug', 'excerpt', 'document']]
    if not isinstance(title, str) or not title.strip() or len(title) > 120 or not isinstance(slug, str) or not re.fullmatch(r'[a-z0-9-]{1,100}', slug) or not isinstance(excerpt, str) or len(excerpt) > 300 or body.get('category') not in CATEGORIES or not isinstance(document, str) or len(document.encode()) > 250000: raise APIError(400, 'Story fields are invalid or too large.')
    try: doc = json.loads(document)
    except ValueError: raise APIError(400, 'Invalid story document.')
    if not isinstance(doc, dict) or doc.get('version') != 1 or doc.get('theme') not in {'cream', 'pink', 'green'} or doc.get('layout') not in {'story', 'newsletter'} or not isinstance(doc.get('blocks'), list) or not 1 <= len(doc['blocks']) <= 100: raise APIError(400, 'Unsupported story document.')
    ids, keys = set(), set()
    for block in doc['blocks']:
        if not isinstance(block, dict) or not isinstance(block.get('id'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', block['id']) or block['id'] in ids or block.get('type') not in {'text', 'image', 'video', 'embed', 'fact', 'file'}: raise APIError(400, 'Invalid story block.')
        ids.add(block['id'])
        if block.get('key') is not None:
            m = media_key(block['key'])
            if m[2] != pid or m[1] != ('published' if published else 'drafts'): raise APIError(400, 'Media must belong to this story and publication state.')
            keys.add(block['key'])
        if block['type'] in {'image', 'video', 'file'} and not block.get('key'): raise APIError(400, 'Upload all media before saving.')
    if body.get('coverKey') and body['coverKey'] not in keys: raise APIError(400, 'Cover must be one of the story files.')
    now = datetime.now(timezone.utc).isoformat()
    item = {k: body[k] for k in ['id', 'title', 'slug', 'excerpt', 'category', 'document']}
    item.update(organization_id=os.environ['CORE_ORGANIZATION_ID'], status='Published' if published else ('Published' if body.get('status') == 'Published' else 'Draft'), updatedAt=now)
    if body.get('coverKey'): item['coverKey'] = body['coverKey']
    if published: item['publishedAt'] = now
    elif body.get('publishedAt'): item['publishedAt'] = str(body['publishedAt'])[:80]
    return item, keys


def transact(items):
    try: clients()[0].meta.client.transact_write_items(TransactItems=items)
    except Exception as e:
        if getattr(e, 'response', {}).get('Error', {}).get('Code') in {'TransactionCanceledException', 'ConditionalCheckFailedException'}: raise APIError(409, 'This story is being changed or cleaned up. Reload and retry.')
        raise


def cleanup(pid, delete_draft=False):
    if not get_post(pid): raise APIError(404, 'Draft not found.')
    lock = str(uuid.uuid4())
    transact([
        {'ConditionCheck': {'TableName': os.environ['PUBLIC_TABLE'], 'Key': {'id': pid}, 'ConditionExpression': 'attribute_not_exists(id)'}},
        {'Update': {'TableName': os.environ['PRIVATE_TABLE'], 'Key': {'id': pid}, 'UpdateExpression': 'SET mediaCleanup = :lock, mediaCleanupExpires = :until', 'ConditionExpression': 'attribute_exists(id) AND (attribute_not_exists(mediaCleanup) OR mediaCleanupExpires < :now)', 'ExpressionAttributeValues': {':lock': lock, ':until': int(time.time()) + 90, ':now': int(time.time())}}},
    ])
    try:
        for prefix in ([f'published/{pid}/', f'drafts/{pid}/'] if delete_draft else [f'published/{pid}/']):
            for page in clients()[1].get_paginator('list_objects_v2').paginate(Bucket=os.environ['MEDIA_BUCKET'], Prefix=prefix):
                keys = [{'Key': row['Key']} for row in page.get('Contents', [])]
                if keys:
                    result = clients()[1].delete_objects(Bucket=os.environ['MEDIA_BUCKET'], Delete={'Objects': keys})
                    if result.get('Errors'): raise APIError(503, 'Some files could not be removed. Retry cleanup.')
        if delete_draft:
            table().delete_item(Key={'id': pid}, ConditionExpression='mediaCleanup = :lock', ExpressionAttributeValues={':lock': lock})
    finally:
        if get_post(pid): table().update_item(Key={'id': pid}, UpdateExpression='REMOVE mediaCleanup, mediaCleanupExpires', ConditionExpression='mediaCleanup = :lock', ExpressionAttributeValues={':lock': lock})


def dispatch(event):
    method = event['requestContext']['http']['method']
    path = event.get('rawPath', '/')
    query = event.get('queryStringParameters') or {}
    if method == 'GET' and path == '/health': return {'status': 'ok'}
    if method == 'GET' and path == '/session':
        claims = authorize(event, 'posts-write')
        return {'subject': claims['sub'], 'permissions': claims['permissions']}
    if path in {'/posts', '/published'} and method == 'GET':
        published = path == '/published'
        if not published: authorize(event, 'posts-write')
        options = {'Limit': 100, 'ConsistentRead': True}
        if query.get('cursor'):
            try:
                pid = json.loads(base64.urlsafe_b64decode(query['cursor']))['id']; options['ExclusiveStartKey'] = {'id': post_id(pid)}
            except (ValueError, KeyError, TypeError): raise APIError(400, 'Invalid archive cursor.')
        r = table(published).scan(**options)
        result = {'posts': [output(item) for item in r.get('Items', []) if item.get('organization_id') == os.environ['CORE_ORGANIZATION_ID']]}
        if r.get('LastEvaluatedKey'): result['cursor'] = base64.urlsafe_b64encode(json.dumps(r['LastEvaluatedKey']).encode()).decode()
        return result
    if method == 'GET' and path == '/media/read':
        key = query.get('key', ''); m = media_key(key)
        if m[1] == 'drafts': authorize(event, 'posts-write')
        return {'url': clients()[1].generate_presigned_url('get_object', Params={'Bucket': os.environ['MEDIA_BUCKET'], 'Key': key}, ExpiresIn=300)}
    raw = event.get('body') or '{}'
    if event.get('isBase64Encoded'): raw = base64.b64decode(raw).decode()
    if len(raw.encode()) > 280000: raise APIError(413, 'Request is too large.')
    try: body = json.loads(raw)
    except ValueError: raise APIError(400, 'Invalid JSON.')
    if not isinstance(body, dict): raise APIError(400, 'Expected a JSON object.')
    if path == '/media/upload' and method == 'POST':
        authorize(event, 'posts-write'); m = media_key(body.get('key')); mime, size = body.get('mime'), body.get('size')
        maximum = 50 * 1024 * 1024 if mime in {'video/mp4', 'video/webm'} else 10 * 1024 * 1024
        existing = get_post(m[2])
        if existing and existing.get('mediaCleanup'): raise APIError(409, 'Story media is being cleaned up. Retry after cleanup finishes.')
        if m[1] != 'drafts' or MIMES.get(mime) != m[5] or type(size) is not int or not 1 <= size <= maximum: raise APIError(400, 'Invalid upload type, name or size.')
        disposition = 'attachment' if mime == 'application/pdf' else 'inline'
        return clients()[1].generate_presigned_post(os.environ['MEDIA_BUCKET'], body['key'], Fields={'Content-Type': mime, 'Content-Disposition': disposition}, Conditions=[{'Content-Type': mime}, {'Content-Disposition': disposition}, ['content-length-range', size, size]], ExpiresIn=60)
    if path == '/media/copy' and method == 'POST':
        authorize(event, 'posts-write', 'posts-publish'); source, target = media_key(body.get('source')), media_key(body.get('key'))
        if source[1] != 'drafts' or target[1] != 'published' or source[2] != target[2] or (source[4], source[5]) != (target[4], target[5]) or not get_post(source[2]): raise APIError(400, 'Copy must publish media from its own saved draft.')
        if get_post(source[2]).get('mediaCleanup'): raise APIError(409, 'Story media is being cleaned up. Retry after cleanup finishes.')
        try:
            clients()[1].head_object(Bucket=os.environ['MEDIA_BUCKET'], Key=body['key'])
        except Exception as error:
            if getattr(error, 'response', {}).get('Error', {}).get('Code') not in {'404', 'NoSuchKey', 'NotFound'}: raise
        else:
            raise APIError(409, 'Publication media already exists. Start a new publication revision.')
        clients()[1].copy_object(Bucket=os.environ['MEDIA_BUCKET'], Key=body['key'], CopySource={'Bucket': os.environ['MEDIA_BUCKET'], 'Key': body['source']})
        return {'copied': True}
    if path.startswith('/media/cleanup/') and method == 'DELETE':
        authorize(event, 'posts-write', 'posts-publish'); cleanup(post_id(path.removeprefix('/media/cleanup/'))); return {'removed': True}
    match = re.fullmatch(r'/((?:posts)|(?:published))/([^/]+)', path)
    if match:
        published, pid = match[1] == 'published', post_id(match[2])
        authorize(event, 'posts-write', *(['posts-publish'] if published or method == 'DELETE' else []))
        if method == 'PUT':
            item, keys = validate_post(body, pid, published); previous = get_post(pid, published); item['createdAt'] = previous.get('createdAt', item['updatedAt']) if previous else item['updatedAt']
            if published:
                for key in keys: clients()[1].head_object(Bucket=os.environ['MEDIA_BUCKET'], Key=key)
                transact([
                    {'Update': {'TableName': os.environ['PRIVATE_TABLE'], 'Key': {'id': pid}, 'UpdateExpression': 'SET updatedAt = :now', 'ConditionExpression': 'attribute_exists(id) AND attribute_not_exists(mediaCleanup)', 'ExpressionAttributeValues': {':now': item['updatedAt']}}},
                    {'Put': {'TableName': os.environ['PUBLIC_TABLE'], 'Item': item}},
                ])
            else:
                table().put_item(Item=item, ConditionExpression='attribute_not_exists(mediaCleanup)')
            return output(item)
        if method == 'DELETE':
            if published: table(True).delete_item(Key={'id': pid})
            else: cleanup(pid, delete_draft=True)
            return {'removed': True}
    raise APIError(404, 'API route not found.')


def handler(event, context):
    # The HTTP API's $default route can forward browser preflights here.
    # API Gateway owns the exact-origin CORS policy and supplies its headers.
    # A preflight checks request capabilities; it must not introspect a token,
    # initialize SDK clients, or perform the requested data operation.
    if event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
        return {'statusCode': 204, 'headers': {'Cache-Control': 'no-store'}, 'body': ''}
    try:
        result = dispatch(event); status = 200
    except APIError as e:
        result, status = {'error': e.message}, e.status
    except Exception:
        # Keep tokens, secrets, document content and signed media URLs out of logs.
        print('Publishing request failed; request id:', getattr(context, 'aws_request_id', 'local'))
        result, status = {'error': 'Publishing service could not complete the request. Reload and retry.'}, 503
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}, 'body': json.dumps(result)}
