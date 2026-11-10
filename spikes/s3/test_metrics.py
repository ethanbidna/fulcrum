import unittest
from metrics import score, validate_endpoint, validate_request_url


class MetricsTests(unittest.TestCase):
    def test_wrong_identity_and_false_merge_never_count_as_correct(self):
        expected = [{'status': 'resolved', 'entityId': 'north'},
                    {'status': 'ambiguous', 'candidateIds': ['north', 'south']}]
        actual = [{'status': 'resolved', 'entityId': 'south'},
                  {'status': 'resolved', 'entityId': 'north'}]
        self.assertEqual(score(expected, actual),
                         {'queryCount': 2, 'correct': 0, 'accuracy': 0, 'unsafeResolutions': 2})

    def test_abstention_and_candidate_order(self):
        expected = [{'status': 'unresolved'}, {'status': 'ambiguous', 'candidateIds': ['b', 'a']}]
        actual = [{'status': 'unresolved'}, {'status': 'ambiguous', 'candidateIds': ['a', 'b']}]
        self.assertEqual(score(expected, actual)['accuracy'], 1)
        with self.assertRaises(ValueError):
            score(expected, actual[:1])

    def test_runtime_cannot_redirect_or_select_other_routes(self):
        endpoint = 'http://127.0.0.1:11435/v1'
        validate_request_url(endpoint + '/chat/completions', endpoint)
        for value in ['https://api.openai.com/v1/chat/completions',
                      'http://127.0.0.1:11434/v1/embeddings',
                      'http://127.0.0.1:11435/api/pull',
                      'http://127.0.0.1:11435/v1/embeddings?target=x']:
            with self.assertRaises(ValueError):
                validate_request_url(value, endpoint)

    def test_only_explicit_loopback_is_accepted(self):
        self.assertEqual(validate_endpoint('http://127.0.0.1:11435/v1/'), 'http://127.0.0.1:11435/v1')
        for value in ['https://api.openai.com/v1', 'http://localhost:11434/v1',
                      'http://127.0.0.1:11434/v1?redirect=x', 'http://user@127.0.0.1:11434/v1',
                      'http://127.0.0.1/v1']:
            with self.assertRaises(ValueError):
                validate_endpoint(value)


if __name__ == '__main__':
    unittest.main()
