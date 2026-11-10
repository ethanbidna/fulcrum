import hashlib
import json
from urllib.parse import urlsplit


def validate_endpoint(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1'
            or not parsed.port or parsed.path.rstrip('/') != '/v1'
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise ValueError('LOOPBACK_ENDPOINT_REQUIRED')
    return value.rstrip('/')


def score(expected, actual):
    if len(expected) != len(actual) or not expected:
        raise ValueError('COMPLETE_QUERY_RESULTS_REQUIRED')
    correct = 0
    unsafe_resolutions = 0
    for gold, result in zip(expected, actual):
        same = gold['status'] == result.get('status')
        if gold['status'] == 'resolved':
            same = same and gold['entityId'] == result.get('entityId')
        if gold['status'] == 'ambiguous':
            same = same and sorted(gold['candidateIds']) == sorted(result.get('candidateIds', []))
        correct += int(same)
        unsafe_resolutions += int(result.get('status') == 'resolved' and not same)
    return {'queryCount': len(expected), 'correct': correct,
            'accuracy': correct / len(expected), 'unsafeResolutions': unsafe_resolutions}


def digest_bytes(value):
    return hashlib.sha256(value).hexdigest()


def validate_request_url(value, endpoint):
    requested = urlsplit(str(value))
    expected = urlsplit(validate_endpoint(endpoint))
    allowed_paths = ['/v1/chat/completions', '/v1/embeddings', '/api/tags', '/api/version']
    if (requested.scheme != 'http' or requested.hostname != '127.0.0.1'
            or requested.port != expected.port or requested.path not in allowed_paths
            or requested.query or requested.fragment or requested.username or requested.password):
        raise ValueError('UNEXPECTED_NETWORK_DESTINATION')
